import { pool as defaultPool } from "../config/database.js";

const BATCH_SIZE = 100;
const MAX_BATCHES_PER_RUN = 5;

export async function expireStaleBookings({
  pool = defaultPool,
  batchSize = BATCH_SIZE,
  maxBatches = MAX_BATCHES_PER_RUN,
} = {}) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error("Ukuran batch expiry tidak valid.");
  }
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1) {
    throw new Error("Jumlah batch expiry tidak valid.");
  }

  const client = await pool.connect();
  let expiredBookings = 0;
  let restoredTickets = 0;
  let batches = 0;
  let hasMore = false;

  try {
    for (let batch = 0; batch < maxBatches; batch += 1) {
      await client.query("BEGIN");
      let transactionOpen = true;

      try {
        const candidates = await client.query(
          `SELECT p.id::text AS "paymentId", b.id::text AS "bookingId",
                  b.ticket_category_id::text AS "categoryId", b.quantity
           FROM public.payments p
           JOIN public.bookings b ON b.id = p.booking_id
           WHERE p.status = 'pending'
             AND b.status = 'pending'
             AND p.expires_at <= clock_timestamp()
           ORDER BY p.expires_at, p.id
           LIMIT $1
           FOR UPDATE OF p, b SKIP LOCKED`,
          [batchSize],
        );

        if (candidates.rowCount === 0) {
          await client.query("COMMIT");
          transactionOpen = false;
          break;
        }

        const paymentIds = candidates.rows.map((row) => row.paymentId);
        const expired = await client.query(
          `UPDATE public.payments
           SET status = 'expired',
               expired_at = clock_timestamp(),
               quota_restored_at = clock_timestamp(),
               updated_at = clock_timestamp()
           WHERE id = ANY($1::bigint[])
             AND status = 'pending'
             AND expires_at <= clock_timestamp()
           RETURNING id::text AS id`,
          [paymentIds],
        );

        if (expired.rowCount !== candidates.rowCount) {
          throw new Error("Status payment berubah saat expiry diproses.");
        }

        const bookingIds = candidates.rows.map((row) => row.bookingId);
        const cancelled = await client.query(
          `UPDATE public.bookings
           SET status = 'cancelled', updated_at = clock_timestamp()
           WHERE id = ANY($1::bigint[])
             AND status = 'pending'
           RETURNING id::text AS id,
                     ticket_category_id::text AS "categoryId",
                     quantity`,
          [bookingIds],
        );

        if (cancelled.rowCount !== expired.rowCount) {
          throw new Error("Status booking berubah saat expiry diproses.");
        }

        const quotaByCategory = new Map();
        for (const booking of cancelled.rows) {
          quotaByCategory.set(
            booking.categoryId,
            (quotaByCategory.get(booking.categoryId) || 0) + booking.quantity,
          );
        }

        const categoryIds = [...quotaByCategory.keys()];
        const lockedCategories = await client.query(
          `SELECT id::text AS id
           FROM public.ticket_categories
           WHERE id = ANY($1::bigint[])
           ORDER BY id
           FOR UPDATE`,
          [categoryIds],
        );

        if (lockedCategories.rowCount !== categoryIds.length) {
          throw new Error("Kategori tiket tidak ditemukan saat mengembalikan kuota.");
        }

        for (const category of lockedCategories.rows) {
          const restored = await client.query(
            `UPDATE public.ticket_categories
             SET quota = quota + $2
             WHERE id = $1::bigint
             RETURNING id`,
            [category.id, quotaByCategory.get(category.id)],
          );

          if (restored.rowCount !== 1) {
            throw new Error("Kuota tiket gagal dikembalikan.");
          }
        }

        await client.query("COMMIT");
        transactionOpen = false;
        batches += 1;
        expiredBookings += cancelled.rowCount;
        restoredTickets += cancelled.rows.reduce(
          (total, booking) => total + booking.quantity,
          0,
        );

        if (candidates.rowCount < batchSize) break;
        if (batch === maxBatches - 1) hasMore = true;
      } catch (error) {
        if (transactionOpen) {
          await client.query("ROLLBACK");
          transactionOpen = false;
        }
        throw error;
      }
    }

    return { expiredBookings, restoredTickets, batches, hasMore };
  } finally {
    client.release();
  }
}
