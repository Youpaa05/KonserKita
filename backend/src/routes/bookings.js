import express from "express";
import { randomBytes } from "node:crypto";
import { pool as defaultPool } from "../config/database.js";

const MAX_NAME_LENGTH = 150;
const MAX_EMAIL_LENGTH = 254;
const BOOKING_CODE_PATTERN = /^KK-[A-F0-9]{16}$/;
const MAX_BIGINT = 9223372036854775807n;

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

  if (!Number.isSafeInteger(quantity) || quantity < 1) {
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

export function createBookingRouter({
  pool = defaultPool,
  logger = console,
  generateBookingCode = createBookingCode,
} = {}) {
  const router = express.Router();

  router.post("/", async (req, res) => {
    const validation = validateBookingInput(req.body);

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message:
          "Data pesanan tidak valid. Periksa nama, email, kategori tiket, dan jumlah tiket.",
      });
    }

    const {
      customerName,
      customerEmail,
      ticketCategoryId,
      quantity,
    } = validation.value;

    let client;
    let transactionStarted = false;

    try {
      client = await pool.connect();

      await client.query("BEGIN");
      transactionStarted = true;

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
         FOR UPDATE OF tc`,
        [ticketCategoryId],
      );

      if (categoryResult.rowCount === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          success: false,
          message: "Kategori tiket tidak ditemukan.",
        });
      }

      const category = categoryResult.rows[0];

      if (quantity > category.quota) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(409).json({
          success: false,
          message: "Kuota tiket tidak mencukupi.",
          availableQuota: category.quota,
        });
      }

      const bookingCode = generateBookingCode();

      const bookingResult = await client.query(
        `INSERT INTO bookings (
           booking_code,
           ticket_category_id,
           customer_name,
           customer_email,
           quantity,
           unit_price,
           status
         )
         VALUES ($1, $2::bigint, $3, $4, $5, $6, 'pending')
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

      if (quotaResult.rowCount !== 1) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(409).json({
          success: false,
          message: "Kuota tiket berubah. Silakan coba kembali.",
        });
      }

      await client.query("COMMIT");
      transactionStarted = false;

      return res.status(201).json({
        success: true,
        message:
          "Pesanan berhasil dibuat. Pembayaran masih berupa simulasi.",
        data: {
          ...bookingResult.rows[0],
          concert: {
            slug: category.concert_slug,
            title: category.concert_title,
          },
          ticketCategory: category.name,
          remainingQuota: quotaResult.rows[0].quota,
          paymentSimulation: true,
        },
      });
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

      logger.error("Booking creation failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Pesanan gagal diproses. Silakan coba kembali.",
      });
    } finally {
      client?.release();
    }
  });

  router.get("/:bookingCode", async (req, res) => {
    const bookingCode = req.params.bookingCode.trim().toUpperCase();

    if (!BOOKING_CODE_PATTERN.test(bookingCode)) {
      return res.status(400).json({
        success: false,
        message: "Format kode pesanan tidak valid.",
      });
    }

    try {
      const result = await pool.query(
        `SELECT
           b.booking_code AS "bookingCode",
           b.customer_name AS "customerName",
           b.quantity,
           b.unit_price::double precision AS "unitPrice",
           b.total_price::double precision AS "totalPrice",
           b.status,
           b.created_at AS "createdAt",
           tc.name AS "ticketCategory",
           c.slug AS "concertSlug",
           c.title AS "concertTitle",
           to_char(c.event_date, 'YYYY-MM-DD') AS "eventDate",
           to_char(c.event_time, 'HH24:MI') AS "eventTime"
         FROM bookings AS b
         JOIN ticket_categories AS tc
           ON tc.id = b.ticket_category_id
         JOIN concerts AS c
           ON c.id = tc.concert_id
         WHERE b.booking_code = $1`,
        [bookingCode],
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Pesanan tidak ditemukan.",
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          ...result.rows[0],
          paymentSimulation: true,
        },
      });
    } catch (error) {
      logger.error("Booking lookup failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Pesanan gagal dicari. Silakan coba kembali.",
      });
    }
  });

  return router;
}

export default createBookingRouter();
