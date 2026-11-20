import { Router } from "express";
import { pool as defaultPool } from "../config/database.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { ROLES } from "../constants/roles.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";
import { isValidTicketCode } from "../services/digitalTickets.js";

const TICKET_SELECT = `SELECT t.ticket_code AS "ticketCode", t.ticket_number AS "ticketNumber",
 t.status AS "ticketStatus", t.issued_at AS "issuedAt", t.used_at AS "usedAt",
 b.booking_code AS "bookingCode", b.customer_name AS "ownerName",
 tc.name AS "ticketCategory", c.title AS "concertTitle", c.slug AS "concertSlug",
 c.venue, c.city, to_char(c.event_date, 'YYYY-MM-DD') AS "eventDate",
 to_char(c.event_time, 'HH24:MI') AS "eventTime"
 FROM digital_tickets t JOIN bookings b ON b.id=t.booking_id
 JOIN payments p ON p.booking_id=b.id
 JOIN ticket_categories tc ON tc.id=b.ticket_category_id
 JOIN concerts c ON c.id=tc.concert_id`;

export function createCustomerTicketRouter({ pool = defaultPool } = {}) {
  const router = Router();
  const requireAuth = createRequireAuth({ pool });
  const customerGuard = [requireAuth, requireRole(ROLES.CUSTOMER)];

  router.get("/", ...customerGuard, async (req, res, next) => {
    try {
      const result = await pool.query(
        `${TICKET_SELECT} WHERE b.user_id=$1 AND b.status='confirmed' AND p.status='paid' ORDER BY b.created_at DESC, t.ticket_number`,
        [req.user.id],
      );
      return sendSuccess(res, 200, "Tiket digital berhasil dimuat.", {
        tickets: result.rows,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:ticketCode", ...customerGuard, async (req, res, next) => {
    const { ticketCode } = req.params;
    if (!isValidTicketCode(ticketCode)) {
      return sendError(res, 400, "Kode tiket tidak valid.");
    }

    try {
      const result = await pool.query(
        `${TICKET_SELECT}
         WHERE b.user_id=$1 AND t.ticket_code=$2 AND p.status='paid'
           AND b.status='confirmed' LIMIT 1`,
        [req.user.id, ticketCode],
      );
      if (!result.rowCount) return sendError(res, 404, "Tiket tidak ditemukan.");
      return sendSuccess(res, 200, "Detail tiket berhasil dimuat.", result.rows[0]);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createCustomerTicketRouter();
