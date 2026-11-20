import { Router } from "express";
import { pool as defaultPool } from "../config/database.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { ROLES } from "../constants/roles.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";
import { hashPassword, verifyPassword } from "../utils/password.js";

export function createCustomerRouter({ pool = defaultPool } = {}) {
  const router = Router();
  const requireAuth = createRequireAuth({ pool });

  router.get(
    "/dashboard",
    requireAuth,
    requireRole(ROLES.CUSTOMER),
    async (req, res, next) => {
      try {
        const result = await pool.query(
          `SELECT COUNT(*)::int AS total_bookings
           FROM bookings
           WHERE user_id = $1`,
          [req.user.id],
        );

        return sendSuccess(
          res,
          200,
          "Dashboard customer berhasil dimuat.",
          {
            user: {
              id: req.user.id,
              name: req.user.name,
              email: req.user.email,
              role: req.user.role,
            },
            totalBookings: result.rows[0].total_bookings,
          },
        );
      } catch (error) {
        return next(error);
      }
    },
  );


  // Riwayat booking hanya dapat diakses oleh pemilik akun.
  router.get("/bookings", requireAuth, requireRole(ROLES.CUSTOMER), async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT
           b.booking_code AS "bookingCode",
           b.quantity,
           b.unit_price::double precision AS "unitPrice",
           b.total_price::double precision AS "totalPrice",
           b.status,
           b.created_at AS "createdAt",
           p.status AS "paymentStatus", p.expires_at AS "paymentExpiresAt", p.paid_at AS "paidAt",
           tc.name AS "ticketCategory",
           c.slug AS "concertSlug",
           c.title AS "concertTitle",
           to_char(c.event_date, 'YYYY-MM-DD') AS "eventDate",
           to_char(c.event_time, 'HH24:MI') AS "eventTime"
         FROM bookings AS b
         JOIN payments AS p ON p.booking_id = b.id
         JOIN ticket_categories AS tc ON tc.id = b.ticket_category_id
         JOIN concerts AS c ON c.id = tc.concert_id
         WHERE b.user_id = $1
         ORDER BY b.created_at DESC, b.id DESC`,
        [req.user.id],
      );

      return sendSuccess(
        res,
        200,
        "Riwayat pesanan berhasil dimuat.",
        { bookings: result.rows },
      );
    } catch (error) {
      return next(error);
    }
  });

  // Detail booking dibatasi berdasarkan user_id dan kode booking.
  router.get("/bookings/:bookingCode", requireAuth, requireRole(ROLES.CUSTOMER), async (req, res, next) => {
    const bookingCode =
      typeof req.params.bookingCode === "string"
        ? req.params.bookingCode.trim().toUpperCase()
        : "";

    if (!/^KK-[A-F0-9]{16}$/.test(bookingCode)) {
      return sendError(res, 400, "Format kode pesanan tidak valid.");
    }

    try {
      const result = await pool.query(
        `SELECT
           b.booking_code AS "bookingCode",
           b.customer_name AS "customerName",
           b.customer_email AS "customerEmail",
           b.quantity,
           b.unit_price::double precision AS "unitPrice",
           b.total_price::double precision AS "totalPrice",
           b.status,
           b.created_at AS "createdAt",
           p.status AS "paymentStatus", p.expires_at AS "paymentExpiresAt", p.paid_at AS "paidAt",
           tc.name AS "ticketCategory",
           c.slug AS "concertSlug",
           c.title AS "concertTitle",
           to_char(c.event_date, 'YYYY-MM-DD') AS "eventDate",
           to_char(c.event_time, 'HH24:MI') AS "eventTime"
         FROM bookings AS b
         JOIN payments AS p ON p.booking_id = b.id
         JOIN ticket_categories AS tc ON tc.id = b.ticket_category_id
         JOIN concerts AS c ON c.id = tc.concert_id
         WHERE b.user_id = $1
           AND b.booking_code = $2
         LIMIT 1`,
        [req.user.id, bookingCode],
      );

      if (result.rowCount === 0) {
        return sendError(res, 404, "Pesanan tidak ditemukan.");
      }

      return sendSuccess(
        res,
        200,
        "Detail pesanan berhasil dimuat.",
        {
          ...result.rows[0],
          paymentSimulation: true,
        },
      );
    } catch (error) {
      return next(error);
    }
  });

  router.get("/favorites", requireAuth, requireRole(ROLES.CUSTOMER), async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT c.id::text AS id, c.slug, c.title, c.artist, c.category, c.city,
                c.venue, to_char(c.event_date, 'YYYY-MM-DD') AS date,
                to_char(c.event_time, 'HH24:MI') AS time,
                (SELECT MIN(tc.price)::double precision FROM ticket_categories tc
                 WHERE tc.concert_id=c.id AND tc.archived_at IS NULL) AS price,
                c.accent, c.image_url AS image, c.description,
                f.created_at AS "favoritedAt"
         FROM concert_favorites f JOIN concerts c ON c.id=f.concert_id
         WHERE f.user_id=$1 AND c.archived_at IS NULL
         ORDER BY f.created_at DESC, c.id DESC`,
        [req.user.id],
      );
      return sendSuccess(res, 200, "Konser favorit berhasil dimuat.", result.rows);
    } catch (error) { return next(error); }
  });

  router.post("/favorites/:concertId", requireAuth, requireRole(ROLES.CUSTOMER), async (req, res, next) => {
    const concertId = req.params.concertId;
    if (!/^\d{1,19}$/.test(concertId) || BigInt(concertId) > 9223372036854775807n) {
      return sendError(res, 400, "ID konser tidak valid.");
    }
    try {
      const concert = await pool.query(
        "SELECT id FROM concerts WHERE id=$1::bigint AND archived_at IS NULL",
        [concertId],
      );
      if (!concert.rowCount) return sendError(res, 404, "Konser tidak ditemukan.");
      await pool.query(
        `INSERT INTO concert_favorites (user_id, concert_id) VALUES ($1,$2::bigint)
         ON CONFLICT (user_id, concert_id) DO NOTHING`,
        [req.user.id, concertId],
      );
      return sendSuccess(res, 200, "Konser ditambahkan ke favorit.", { concertId });
    } catch (error) { return next(error); }
  });

  router.delete("/favorites/:concertId", requireAuth, requireRole(ROLES.CUSTOMER), async (req, res, next) => {
    const concertId = req.params.concertId;
    if (!/^\d{1,19}$/.test(concertId) || BigInt(concertId) > 9223372036854775807n) {
      return sendError(res, 400, "ID konser tidak valid.");
    }
    try {
      await pool.query("DELETE FROM concert_favorites WHERE user_id=$1 AND concert_id=$2::bigint", [req.user.id, concertId]);
      return sendSuccess(res, 200, "Konser dihapus dari favorit.", { concertId });
    } catch (error) { return next(error); }
  });

  router.get("/profile", requireAuth, requireRole(ROLES.CUSTOMER), async (req, res, next) => {
    try {
      const result = await pool.query(
        "SELECT id::text AS id, name, email, created_at AS \"createdAt\" FROM users WHERE id=$1",
        [req.user.id],
      );
      if (!result.rowCount) return sendError(res, 404, "Profil tidak ditemukan.");
      return sendSuccess(res, 200, "Profil berhasil dimuat.", result.rows[0]);
    } catch (error) { return next(error); }
  });

  router.patch("/profile", requireAuth, requireRole(ROLES.CUSTOMER), async (req, res, next) => {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return sendError(res, 400, "Data profil tidak valid.");
    const keys = Object.keys(body);
    if (!keys.length || keys.some((key) => !["name", "email"].includes(key))) return sendError(res, 400, "Field profil tidak diizinkan.");
    const name = body.name === undefined ? req.user.name : typeof body.name === "string" ? body.name.trim() : "";
    const email = body.email === undefined ? req.user.email : typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (name.length < 2 || name.length > 80 || /[\u0000-\u001F\u007F]/.test(name) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendError(res, 400, "Nama atau email tidak valid.");
    }
    try {
      const result = await pool.query(
        `UPDATE users SET name=$1, email=$2, updated_at=clock_timestamp()
         WHERE id=$3 RETURNING id::text AS id, name, email`,
        [name, email, req.user.id],
      );
      if (!result.rowCount) return sendError(res, 404, "Profil tidak ditemukan.");
      return sendSuccess(res, 200, "Profil berhasil diperbarui.", result.rows[0]);
    } catch (error) {
      if (error.code === "23505") return sendError(res, 409, "Email sudah digunakan.");
      return next(error);
    }
  });

  router.get("/notifications/unread-count", requireAuth, requireRole(ROLES.CUSTOMER), async (req, res, next) => {
    try {
      const result = await pool.query("SELECT COUNT(*)::int AS count FROM user_notifications WHERE user_id=$1 AND read_at IS NULL", [req.user.id]);
      return sendSuccess(res, 200, "Jumlah notifikasi belum dibaca berhasil dimuat.", { count: result.rows[0].count });
    } catch (error) { return next(error); }
  });

  router.get("/notifications", requireAuth, requireRole(ROLES.CUSTOMER), async (req, res, next) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger((page - 1) * limit)) return sendError(res, 400, "Parameter pagination tidak valid.");
    try {
      const result = await pool.query(
        `SELECT id::text AS id, type, title, message, booking_code AS "bookingCode",
                created_at AS "createdAt", read_at AS "readAt"
         FROM user_notifications WHERE user_id=$1
         ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
        [req.user.id, limit, (page - 1) * limit],
      );
      const count = await pool.query("SELECT COUNT(*)::int AS total FROM user_notifications WHERE user_id=$1", [req.user.id]);
      return sendSuccess(res, 200, "Notifikasi berhasil dimuat.", { items: result.rows, page, limit, total: count.rows[0].total });
    } catch (error) { return next(error); }
  });

  router.patch("/notifications/:notificationId/read", requireAuth, requireRole(ROLES.CUSTOMER), async (req, res, next) => {
    const id = req.params.notificationId;
    if (!/^\d{1,19}$/.test(id) || BigInt(id) > 9223372036854775807n) return sendError(res, 400, "ID notifikasi tidak valid.");
    try {
      const result = await pool.query(
        `UPDATE user_notifications SET read_at=COALESCE(read_at, clock_timestamp())
         WHERE id=$1::bigint AND user_id=$2 RETURNING id::text AS id, read_at AS "readAt"`,
        [id, req.user.id],
      );
      if (!result.rowCount) return sendError(res, 404, "Notifikasi tidak ditemukan.");
      return sendSuccess(res, 200, "Notifikasi ditandai sudah dibaca.", result.rows[0]);
    } catch (error) { return next(error); }
  });

  return router;
}

export default createCustomerRouter();
