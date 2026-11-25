import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { pool as defaultPool } from "../config/database.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import { readSessionToken } from "../utils/session.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { isPaymentSimulationEnabled } from "../config/paymentSimulation.js";

const MAX_NAME_LENGTH = 150;
const MAX_EMAIL_LENGTH = 254;
const MAX_BOOKING_QUANTITY = 100;
const BOOKING_CODE_PATTERN = /^KK-[A-F0-9]{16}$/;
const MAX_BIGINT = 9223372036854775807n;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/;

function validateBookingInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false };
  }

  const customerName =
    typeof body.customerName === "string"
      ? body.customerName.trim()
      : "";

  const customerEmail =
    typeof body.customerEmail === "string"
      ? body.customerEmail.trim().toLowerCase()
      : "";

  const rawCategoryId = body.ticketCategoryId;

  const ticketCategoryId =
    typeof rawCategoryId === "number" &&
    Number.isSafeInteger(rawCategoryId)
      ? String(rawCategoryId)
      : typeof rawCategoryId === "string"
        ? rawCategoryId.trim()
        : "";

  const quantity = body.quantity;

  if (
    customerName.length < 2 ||
    customerName.length > MAX_NAME_LENGTH ||
    /[\u0000-\u001F\u007F]/.test(customerName)
  ) {
    return { valid: false };
  }

  if (
    customerEmail.length > MAX_EMAIL_LENGTH ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)
  ) {
    return { valid: false };
  }

  if (!/^[1-9]\d{0,18}$/.test(ticketCategoryId)) {
    return { valid: false };
  }

  try {
    if (BigInt(ticketCategoryId) > MAX_BIGINT) {
      return { valid: false };
    }
  } catch {
    return { valid: false };
  }

  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_BOOKING_QUANTITY) {
    return { valid: false };
  }

  return {
    valid: true,
    value: {
      customerName,
      customerEmail,
      ticketCategoryId,
      quantity,
    },
  };
}

function createBookingCode() {
  return `KK-${randomBytes(8).toString("hex").toUpperCase()}`;
}

function bookingCodeForIdempotencyKey(key) {
  return `KK-${createHash("sha256").update(key).digest("hex").slice(0, 16).toUpperCase()}`;
}

function advisoryLockKey(key) {
  return createHash("sha256").update(key).digest().readBigInt64BE(0).toString();
}

export function createBookingRouter({
  pool = defaultPool,
  logger = console,
  generateBookingCode = createBookingCode,
} = {}) {
  const router = express.Router();
  const requireAuth = createRequireAuth({ pool });
  const bookingCreationLimit = createRateLimiter({ scope: "booking-create", windowMs: 15 * 60 * 1000, max: 30, pool });
  const bookingLookupLimit = createRateLimiter({ scope: "booking-lookup", windowMs: 15 * 60 * 1000, max: 120, pool });

  // Guest tetap dapat memesan. Jika session tersedia, booking
  // wajib terhubung dengan akun customer yang terautentikasi.
  function optionalCustomerAuth(req, res, next) {
    let token;

    try {
      token = readSessionToken(req);
    } catch {
      return sendError(res, 401, "Session tidak valid.");
    }

    if (!token) return next();

    return requireAuth(req, res, () => {
      if (req.user?.role !== "customer") {
        return sendError(
          res,
          403,
          "Hanya akun customer yang dapat membuat pesanan.",
        );
      }

      return next();
    });
  }

  router.post("/", bookingCreationLimit, optionalCustomerAuth, async (req, res) => {
    const validation = validateBookingInput(req.body);

    if (!validation.valid) {
      return sendError(
        res,
        400,
        "Data pesanan tidak valid. Periksa nama, email, kategori tiket, dan jumlah tiket.",
      );
    }

    const customerName = req.user?.name ?? validation.value.customerName;
    const customerEmail = req.user?.email ?? validation.value.customerEmail;
    const { ticketCategoryId, quantity } = validation.value;
    const userId = req.user?.id ?? null;
    const idempotencyKey = req.get("Idempotency-Key") || "";

    if (idempotencyKey && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return sendError(res, 400, "Idempotency-Key tidak valid.");
    }

    let client;
    let transactionStarted = false;

    try {
      client = await pool.connect();

      await client.query("BEGIN");
      transactionStarted = true;

      const bookingCode = idempotencyKey
        ? bookingCodeForIdempotencyKey(idempotencyKey)
        : generateBookingCode();

      if (idempotencyKey) {
        await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
          advisoryLockKey(idempotencyKey),
        ]);

        const existingResult = await client.query(
          `SELECT b.id::text AS id,
                  b.booking_code AS "bookingCode",
                  b.customer_name AS "customerName",
                  b.customer_email AS "customerEmail",
                  b.user_id::text AS "userId",
                  b.ticket_category_id::text AS "ticketCategoryId",
                  b.quantity,
                  b.unit_price::double precision AS "unitPrice",
                  b.total_price::double precision AS "totalPrice",
                  b.status,
                  b.created_at AS "createdAt",
                  tc.name AS "ticketCategory",
                  tc.quota AS "remainingQuota",
                  c.slug AS "concertSlug",
                  c.title AS "concertTitle"
           FROM bookings b
           JOIN payments p ON p.booking_id = b.id
           JOIN ticket_categories tc ON tc.id = b.ticket_category_id
           JOIN concerts c ON c.id = tc.concert_id
           WHERE b.booking_code = $1
           FOR UPDATE OF b`,
          [bookingCode],
        );

        if (existingResult.rowCount) {
          const existing = existingResult.rows[0];
          const sameRequest =
            String(existing.userId ?? "") === String(userId ?? "") &&
            existing.ticketCategoryId === ticketCategoryId &&
            existing.customerName === customerName &&
            existing.customerEmail === customerEmail &&
            Number(existing.quantity) === quantity;

          if (!sameRequest) {
            await client.query("ROLLBACK");
            transactionStarted = false;
            return sendError(res, 409, "Idempotency-Key sudah digunakan untuk pesanan lain.");
          }

          await client.query("COMMIT");
          transactionStarted = false;
          return sendSuccess(
            res,
            200,
            "Pesanan yang sama sudah pernah diproses.",
            {
              id: existing.id,
              bookingCode: existing.bookingCode,
              customerName: existing.customerName,
              quantity: existing.quantity,
              unitPrice: existing.unitPrice,
              totalPrice: existing.totalPrice,
              status: existing.status,
              createdAt: existing.createdAt,
              concert: { slug: existing.concertSlug, title: existing.concertTitle },
              ticketCategory: existing.ticketCategory,
              remainingQuota: existing.remainingQuota,
              paymentSimulation: Boolean(userId && isPaymentSimulationEnabled()),
            },
          );
        }
      }

      const categoryResult = await client.query(
        `SELECT
           tc.id,
           tc.name,
           tc.price,
           tc.quota,
           c.id AS concert_id,
           c.slug AS concert_slug,
           c.title AS concert_title
         FROM ticket_categories AS tc
         JOIN concerts AS c ON c.id = tc.concert_id
         WHERE tc.id = $1::bigint
            AND c.archived_at IS NULL
            AND c.cancelled_at IS NULL
            AND tc.archived_at IS NULL
         FOR UPDATE OF tc, c`,
        [ticketCategoryId],
      );

      if (categoryResult.rowCount === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return sendError(
          res,
          404,
          "Kategori tiket tidak ditemukan.",
        );
      }

      const category = categoryResult.rows[0];

      if (quantity > category.quota) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return sendError(
          res,
          409,
          "Kuota tiket tidak mencukupi.",
          { availableQuota: category.quota },
        );
      }

      const bookingResult = await client.query(
        `INSERT INTO bookings (
           booking_code,
           user_id,
           ticket_category_id,
           customer_name,
           customer_email,
           quantity,
           unit_price,
           status
         )
         VALUES ($1, $2::bigint, $3::bigint, $4, $5, $6, $7, 'pending')
         RETURNING
           id::text AS id,
           booking_code AS "bookingCode",
           customer_name AS "customerName",
           quantity,
           unit_price::double precision AS "unitPrice",
           total_price::double precision AS "totalPrice",
           status,
           created_at AS "createdAt"`,
        [
          bookingCode,
          userId,
          ticketCategoryId,
          customerName,
          customerEmail,
          quantity,
          category.price,
        ],
      );

      const quotaResult = await client.query(
        `UPDATE ticket_categories
         SET quota = quota - $1
         WHERE id = $2::bigint
           AND quota >= $1
         RETURNING quota`,
        [quantity, ticketCategoryId],
      );

      await client.query(
        `INSERT INTO payments (booking_id, amount, payment_method, expires_at)
         VALUES ($1::bigint, $2, 'simulation', clock_timestamp() + INTERVAL '15 minutes')`,
        [bookingResult.rows[0].id, bookingResult.rows[0].totalPrice],
      );

      if (userId) {
        await client.query(
          `INSERT INTO user_notifications (user_id, event_key, type, title, message, booking_code)
           VALUES ($1::bigint, $2, 'booking_created', 'Pesanan berhasil dibuat',
                   'Pesanan menunggu pembayaran melalui metode yang tersedia.', $3)
           ON CONFLICT (user_id, event_key) DO NOTHING`,
          [userId, `booking:${bookingResult.rows[0].id}:created`, bookingCode],
        );
      }

      if (quotaResult.rowCount !== 1) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return sendError(
          res,
          409,
          "Kuota tiket berubah. Silakan coba kembali.",
        );
      }

      await client.query("COMMIT");
      transactionStarted = false;

      return sendSuccess(
        res,
        201,
        "Pesanan berhasil dibuat. Pembayaran belum terhubung ke payment gateway.",
        {
          ...bookingResult.rows[0],
          concert: {
            slug: category.concert_slug,
            title: category.concert_title,
          },
          ticketCategory: category.name,
          remainingQuota: quotaResult.rows[0].quota,
          paymentSimulation: Boolean(userId && isPaymentSimulationEnabled()),
        },
      );
    } catch (error) {
      if (client && transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.error(
            "Gagal membatalkan transaksi pesanan:",
            rollbackError.message,
          );
        }
      }

      logger.error("Booking creation failed:", { name: error?.name || "Error", code: error?.code || "unknown" });

      return sendError(
        res,
        500,
        "Pesanan gagal diproses. Silakan coba kembali.",
      );
    } finally {
      client?.release();
    }
  });

  router.get("/:bookingCode", bookingLookupLimit, optionalCustomerAuth, async (req, res) => {
    const rawCode = req.params.bookingCode;

    const bookingCode =
      typeof rawCode === "string"
        ? rawCode.trim().toUpperCase()
        : "";

    if (!BOOKING_CODE_PATTERN.test(bookingCode)) {
      return sendError(
        res,
        400,
        "Format kode pesanan tidak valid.",
      );
    }

    try {
      const ownershipCondition = req.user
        ? "(b.user_id IS NULL OR b.user_id = $2::bigint)"
        : "b.user_id IS NULL";
      const values = req.user
        ? [bookingCode, req.user.id]
        : [bookingCode];
      const result = await pool.query(
        `SELECT
           b.booking_code AS "bookingCode",
           b.customer_name AS "customerName",
           b.quantity,
           b.unit_price::double precision AS "unitPrice",
           b.total_price::double precision AS "totalPrice",
           b.status,
           b.created_at AS "createdAt",
           p.status AS "paymentStatus",
           p.expires_at AS "paymentExpiresAt",
           tc.name AS "ticketCategory",
           c.slug AS "concertSlug",
           c.title AS "concertTitle",
           to_char(c.event_date, 'YYYY-MM-DD') AS "eventDate",
           to_char(c.event_time, 'HH24:MI') AS "eventTime"
         FROM bookings AS b
         JOIN payments AS p ON p.booking_id = b.id
         JOIN ticket_categories AS tc
           ON tc.id = b.ticket_category_id
         JOIN concerts AS c
           ON c.id = tc.concert_id
         WHERE b.booking_code = $1
           AND ${ownershipCondition}`,
        values,
      );

      if (result.rowCount === 0) {
        return sendError(
          res,
          404,
          "Pesanan tidak ditemukan.",
        );
      }

      return sendSuccess(
        res,
        200,
        "Detail pesanan berhasil ditemukan.",
        {
          ...result.rows[0],
          paymentSimulation: Boolean(req.user && isPaymentSimulationEnabled()),
        },
      );
    } catch (error) {
      logger.error("Booking lookup failed:", { name: error?.name || "Error", code: error?.code || "unknown" });

      return sendError(
        res,
        500,
        "Pesanan gagal dicari. Silakan coba kembali.",
      );
    }
  });

  return router;
}

export default createBookingRouter();
