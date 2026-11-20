import { Router } from "express";
import { pool as defaultPool } from "../config/database.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { ROLES } from "../constants/roles.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";
import { isValidTicketCode } from "../services/digitalTickets.js";
import { createRateLimiter, getClientIp } from "../middleware/rateLimit.js";

const TICKET_DETAILS = `SELECT t.id, t.ticket_code AS "ticketCode",
 t.ticket_number AS "ticketNumber", t.status AS "ticketStatus",
 t.issued_at AS "issuedAt", t.used_at AS "usedAt", t.used_by AS "usedBy",
 b.booking_code AS "bookingCode", b.customer_name AS "ownerName",
 b.status AS "bookingStatus", p.status AS "paymentStatus",
 tc.name AS "ticketCategory", c.title AS "concertTitle", c.venue, c.city,
 to_char(c.event_date, 'YYYY-MM-DD') AS "eventDate",
 to_char(c.event_time, 'HH24:MI') AS "eventTime"
 FROM digital_tickets t JOIN bookings b ON b.id=t.booking_id
 JOIN payments p ON p.booking_id=b.id
 JOIN ticket_categories tc ON tc.id=b.ticket_category_id
 JOIN concerts c ON c.id=tc.concert_id`;

export function createAdminTicketRouter({ pool = defaultPool } = {}) {
  const router = Router();
  const requireAuth = createRequireAuth({ pool });
  const adminGuard = [requireAuth, requireRole(ROLES.ADMIN)];
  const ticketScanLimit = createRateLimiter({ scope: "admin-ticket-scan", windowMs: 60 * 1000, max: 120, keyGenerator: (req) => req.user?.id || getClientIp(req), pool });

  router.post("/validate", ...adminGuard, ticketScanLimit, async (req, res, next) => {
    if (
      !req.body ||
      Object.keys(req.body).length !== 1 ||
      !isValidTicketCode(req.body.ticketCode)
    ) {
      return sendError(res, 400, "Kode tiket tidak valid.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(
        `${TICKET_DETAILS} WHERE t.ticket_code=$1 FOR UPDATE OF t,b,p`,
        [req.body.ticketCode],
      );
      if (!found.rowCount) {
        await client.query("ROLLBACK");
        return sendError(res, 404, "Tiket tidak ditemukan.");
      }

      const ticket = found.rows[0];
      if (ticket.paymentStatus !== "paid" || ticket.bookingStatus !== "confirmed") {
        await client.query("ROLLBACK");
        return sendError(res, 409, "Pembayaran atau booking tiket tidak valid.");
      }
      if (ticket.ticketStatus !== "issued") {
        await client.query("ROLLBACK");
        return sendError(res, 409, "Tiket sudah pernah digunakan.", {
          ticket: {
            ticketNumber: ticket.ticketNumber,
            ticketStatus: ticket.ticketStatus,
            usedAt: ticket.usedAt,
            bookingCode: ticket.bookingCode,
            ownerName: ticket.ownerName,
            ticketCategory: ticket.ticketCategory,
            concertTitle: ticket.concertTitle,
            venue: ticket.venue,
            city: ticket.city,
            eventDate: ticket.eventDate,
            eventTime: ticket.eventTime,
          },
        });
      }

      const used = await client.query(
        `UPDATE digital_tickets
         SET status='used', used_at=clock_timestamp(), used_by=$2::bigint
         WHERE id=$1::bigint AND status='issued'
         RETURNING used_at AS "usedAt"`,
        [ticket.id, req.user.id],
      );
      if (used.rowCount !== 1) {
        await client.query("ROLLBACK");
        return sendError(res, 409, "Tiket sudah pernah digunakan.");
      }

      await client.query("COMMIT");
      return sendSuccess(res, 200, "Tiket valid dan berhasil digunakan.", {
        valid: true,
        ticket: {
          ticketCode: ticket.ticketCode,
          ticketNumber: ticket.ticketNumber,
          ticketStatus: "used",
          usedAt: used.rows[0].usedAt,
          bookingCode: ticket.bookingCode,
          ownerName: ticket.ownerName,
          ticketCategory: ticket.ticketCategory,
          concertTitle: ticket.concertTitle,
          venue: ticket.venue,
          city: ticket.city,
          eventDate: ticket.eventDate,
          eventTime: ticket.eventTime,
        },
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      return next(error);
    } finally {
      client.release();
    }
  });

  return router;
}

export default createAdminTicketRouter();
