import assert from "node:assert/strict";
import { test } from "node:test";
import { expireStaleBookings } from "../src/services/expireBookings.js";

function createPool(initialRows, { failQuotaUpdate = false, holdFirstSelection = false } = {}) {
  const rows = initialRows.map((row) => ({ ...row }));
  const categories = new Map();
  const lockedPaymentIds = new Set();
  let nextClientId = 0;
  let firstSelectionResolve;
  let releaseFirstSelection;
  const firstSelection = new Promise((resolve) => {
    firstSelectionResolve = resolve;
  });
  const firstSelectionGate = new Promise((resolve) => {
    releaseFirstSelection = resolve;
  });

  for (const row of rows) {
    categories.set(row.categoryId, row.quota);
  }

  return {
    rows,
    categories,
    firstSelection,
    releaseFirstSelection,
    async connect() {
      const clientId = nextClientId++;
      const ownedLocks = new Set();
      let snapshot;

      return {
        async query(sql, values = []) {
          const normalized = sql.trim().replace(/\s+/g, " ");

          if (normalized === "BEGIN") {
            snapshot = {
              rows: rows.map((row) => ({ ...row })),
              categories: new Map(categories),
            };
            return { rowCount: null, rows: [] };
          }

          if (normalized === "COMMIT") {
            snapshot = null;
            for (const id of ownedLocks) lockedPaymentIds.delete(id);
            ownedLocks.clear();
            return { rowCount: null, rows: [] };
          }

          if (normalized === "ROLLBACK") {
            if (snapshot) {
              rows.splice(0, rows.length, ...snapshot.rows);
              categories.clear();
              for (const [id, quota] of snapshot.categories) categories.set(id, quota);
              snapshot = null;
            }
            for (const id of ownedLocks) lockedPaymentIds.delete(id);
            ownedLocks.clear();
            return { rowCount: null, rows: [] };
          }

          if (normalized.startsWith("SELECT p.id::text AS")) {
            const candidates = rows
              .filter(
                (row) =>
                  row.paymentStatus === "pending" &&
                  row.bookingStatus === "pending" &&
                  row.expiresAt <= Date.now() &&
                  !lockedPaymentIds.has(row.paymentId),
              )
              .sort((left, right) => left.expiresAt - right.expiresAt)
              .slice(0, values[0]);

            for (const row of candidates) {
              lockedPaymentIds.add(row.paymentId);
              ownedLocks.add(row.paymentId);
            }

            if (holdFirstSelection && clientId === 0) {
              firstSelectionResolve();
              await firstSelectionGate;
            }

            return {
              rowCount: candidates.length,
              rows: candidates.map((row) => ({
                paymentId: row.paymentId,
                bookingId: row.bookingId,
                categoryId: row.categoryId,
                quantity: row.quantity,
              })),
            };
          }

          if (normalized.startsWith("UPDATE public.payments")) {
            const matches = rows.filter(
              (row) =>
                values[0].includes(row.paymentId) &&
                ownedLocks.has(row.paymentId) &&
                row.paymentStatus === "pending" &&
                row.expiresAt <= Date.now(),
            );
            for (const row of matches) row.paymentStatus = "expired";
            return {
              rowCount: matches.length,
              rows: matches.map((row) => ({ id: row.paymentId })),
            };
          }

          if (normalized.startsWith("UPDATE public.bookings")) {
            const matches = rows.filter(
              (row) =>
                values[0].includes(row.bookingId) &&
                ownedLocks.has(row.paymentId) &&
                row.bookingStatus === "pending",
            );
            for (const row of matches) row.bookingStatus = "cancelled";
            return {
              rowCount: matches.length,
              rows: matches.map((row) => ({
                id: row.bookingId,
                categoryId: row.categoryId,
                quantity: row.quantity,
              })),
            };
          }

          if (normalized.startsWith("SELECT id::text AS id")) {
            const ids = [...new Set(values[0])].sort();
            return {
              rowCount: ids.filter((id) => categories.has(id)).length,
              rows: ids
                .filter((id) => categories.has(id))
                .map((id) => ({ id })),
            };
          }

          if (normalized.startsWith("UPDATE public.ticket_categories")) {
            if (failQuotaUpdate) throw new Error("simulated quota update failure");
            const [id, quantity] = values;
            categories.set(id, categories.get(id) + quantity);
            return { rowCount: 1, rows: [{ id }] };
          }

          throw new Error(`Query mock tidak dikenali: ${normalized}`);
        },
        release() {
          for (const id of ownedLocks) lockedPaymentIds.delete(id);
        },
      };
    },
  };
}

function expiredBooking(overrides = {}) {
  return {
    paymentId: "201",
    bookingId: "101",
    categoryId: "1",
    paymentStatus: "pending",
    bookingStatus: "pending",
    quantity: 3,
    expiresAt: Date.now() - 60_000,
    quota: 4,
    ...overrides,
  };
}

test("expiry membatalkan hanya payment pending dan mengembalikan kuota sekali", async () => {
  const pool = createPool([
    expiredBooking(),
    expiredBooking({
      paymentId: "202",
      bookingId: "102",
      paymentStatus: "paid",
      bookingStatus: "confirmed",
      quantity: 2,
    }),
    expiredBooking({
      paymentId: "203",
      bookingId: "103",
      expiresAt: Date.now() + 60_000,
      quantity: 4,
    }),
  ]);

  const result = await expireStaleBookings({ pool });

  assert.deepEqual(result, {
    expiredBookings: 1,
    restoredTickets: 3,
    batches: 1,
    hasMore: false,
  });
  assert.equal(pool.rows[0].paymentStatus, "expired");
  assert.equal(pool.rows[0].bookingStatus, "cancelled");
  assert.equal(pool.rows[1].paymentStatus, "paid");
  assert.equal(pool.rows[1].bookingStatus, "confirmed");
  assert.equal(pool.rows[2].paymentStatus, "pending");
  assert.equal(pool.categories.get("1"), 7);
});

test("dua expiry worker tidak mengembalikan kuota dua kali", async () => {
  const pool = createPool([expiredBooking()], { holdFirstSelection: true });

  const firstWorker = expireStaleBookings({ pool, maxBatches: 1 });
  await pool.firstSelection;
  const secondWorker = await expireStaleBookings({ pool, maxBatches: 1 });
  pool.releaseFirstSelection();
  const firstResult = await firstWorker;

  assert.equal(firstResult.expiredBookings, 1);
  assert.equal(secondWorker.expiredBookings, 0);
  assert.equal(pool.rows[0].paymentStatus, "expired");
  assert.equal(pool.rows[0].bookingStatus, "cancelled");
  assert.equal(pool.categories.get("1"), 7);
});

test("kegagalan pengembalian kuota me-rollback expiry", async () => {
  const pool = createPool([expiredBooking()], { failQuotaUpdate: true });

  await assert.rejects(expireStaleBookings({ pool }), /simulated quota update failure/);
  assert.equal(pool.rows[0].paymentStatus, "pending");
  assert.equal(pool.rows[0].bookingStatus, "pending");
  assert.equal(pool.categories.get("1"), 4);
});
