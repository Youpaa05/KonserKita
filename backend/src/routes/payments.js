import { Router } from "express";
import { pool as defaultPool } from "../config/database.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";
import { readSessionToken } from "../utils/session.js";
import { createRateLimiter, hashRateLimitIdentity } from "../middleware/rateLimit.js";
import { issueBookingTickets } from "../services/digitalTickets.js";
import { isPaymentSimulationEnabled } from "../config/paymentSimulation.js";

const CODE = /^KK-[A-F0-9]{16}$/;
const SELECT_PAYMENT = `SELECT b.id::text AS "bookingId", b.booking_code AS "bookingCode",
 b.customer_name AS "customerName", b.user_id AS "userId", b.quantity,
 b.unit_price::double precision AS "unitPrice", b.total_price::double precision AS "totalPrice",
 b.status AS "bookingStatus", p.status AS "paymentStatus", p.amount::double precision AS amount,
 p.payment_method AS "paymentMethod", p.expires_at AS "expiresAt", p.paid_at AS "paidAt",
 p.failed_at AS "failedAt", p.expired_at AS "expiredAt", p.created_at AS "createdAt",
 tc.name AS "ticketCategory", c.slug AS "concertSlug", c.title AS "concertTitle",
 to_char(c.event_date, 'YYYY-MM-DD') AS "eventDate", to_char(c.event_time, 'HH24:MI') AS "eventTime"
 FROM bookings b JOIN payments p ON p.booking_id=b.id
 JOIN ticket_categories tc ON tc.id=b.ticket_category_id JOIN concerts c ON c.id=tc.concert_id`;

export function createPaymentRouter({ pool = defaultPool, environment = process.env } = {}) {
 const paymentSimulationEnabled = isPaymentSimulationEnabled(environment);
 const router = Router();
 const requireAuth = createRequireAuth({ pool });
 const paymentReadLimit = createRateLimiter({ scope: "payment-read", windowMs: 15 * 60 * 1000, max: 120, pool });
 const paymentAttemptIpLimit = createRateLimiter({ scope: "payment-attempt-ip", windowMs: 15 * 60 * 1000, max: 120, pool });
 const paymentAttemptLimit = createRateLimiter({ scope: "payment-attempt-code", windowMs: 15 * 60 * 1000, max: 12, keyGenerator: (req) => hashRateLimitIdentity(req.params.bookingCode || "invalid-payment"), pool });

 function currentUserIfAuthenticated(req) {
  if (!readSessionToken(req)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
   const response = {
    status(statusCode) { this.statusCode = statusCode; return this; },
    json() { resolve({ authStatus: this.statusCode || 401 }); },
   };
   requireAuth(req, response, error => {
    if (error) reject(error);
    else resolve(req.user || null);
   });
  });
 }

 async function readPayment(code, userId) {
  const result = userId
   ? pool.query(`${SELECT_PAYMENT} WHERE b.booking_code=$1 AND b.user_id=$2`, [code, userId])
   : pool.query(`${SELECT_PAYMENT} WHERE b.booking_code=$1 AND b.user_id IS NULL`, [code]);
  const paymentResult = await result;
  if (!paymentResult.rowCount) return paymentResult;

  const payment = paymentResult.rows[0];
  const ticketResult = payment.paymentStatus === "paid" && payment.bookingStatus === "confirmed"
   ? await pool.query(
    `SELECT ticket_code AS "ticketCode", ticket_number AS "ticketNumber",
            status AS "ticketStatus", issued_at AS "issuedAt", used_at AS "usedAt"
     FROM digital_tickets
     WHERE booking_id=$1::bigint
     ORDER BY ticket_number`,
    [payment.bookingId],
   )
   : { rows: [] };

  return {
   ...paymentResult,
   rows: [{ ...payment, tickets: ticketResult.rows, paymentSimulation: paymentSimulationEnabled && payment.userId !== null }],
  };
 }

 async function expireIfNeeded(code, userId) {
  const client = await pool.connect();
  try {
   await client.query("BEGIN");
   const result = await client.query(`SELECT p.id,p.status,b.id AS booking_id,b.ticket_category_id,b.quantity FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE b.booking_code=$1 AND ${userId ? "b.user_id=$2" : "b.user_id IS NULL"} FOR UPDATE OF p,b`, userId ? [code,userId] : [code]);
   if (result.rowCount && result.rows[0].status === "pending") {
    const p=result.rows[0];
    const expired = await client.query("UPDATE payments SET status='expired',expired_at=clock_timestamp(),quota_restored_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND status='pending' AND expires_at <= clock_timestamp() RETURNING id",[p.id]);
    if (expired.rowCount) {
     await client.query("UPDATE bookings SET status='cancelled',updated_at=clock_timestamp() WHERE id=$1",[p.booking_id]);
     await client.query("UPDATE ticket_categories SET quota=quota+$1 WHERE id=$2",[p.quantity,p.ticket_category_id]);
    }
   }
   await client.query("COMMIT");
  } catch(error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
 }

 router.get("/:bookingCode", paymentReadLimit, async (req,res,next) => {
  const code = String(req.params.bookingCode || "").toUpperCase();
  if (!CODE.test(code)) return sendError(res,400,"Format kode pesanan tidak valid.");
  try {
   const user = await currentUserIfAuthenticated(req);
   if (user?.authStatus) return sendError(res,user.authStatus,"Session tidak valid.");
   if (user && user.role !== "customer") return sendError(res,403,"Akses ditolak.");
   const userId = user?.id ?? null;
   await expireIfNeeded(code,userId);
   const result = await readPayment(code,userId);
   if (!result.rowCount) return sendError(res,404,"Pesanan tidak ditemukan.");
   return sendSuccess(res,200,"Informasi pembayaran berhasil dimuat.",result.rows[0]);
  } catch(error) { return next(error); }
 });

 router.post("/:bookingCode/attempt", paymentAttemptIpLimit, paymentAttemptLimit, async (req,res,next) => {
  const code = String(req.params.bookingCode || "").toUpperCase();
  if (!CODE.test(code)) return sendError(res,400,"Format kode pesanan tidak valid.");
  if (!req.body || Object.keys(req.body).length !== 1 || !["success","failure"].includes(req.body.outcome)) return sendError(res,400,"Outcome pembayaran tidak valid.");
  if (!paymentSimulationEnabled) {
   return sendError(res,503,"Simulasi pembayaran dinonaktifkan pada environment ini. Tidak ada transaksi yang diubah.");
  }

  try {
   const user = await currentUserIfAuthenticated(req);
   if (!user) return sendError(res,401,"Silakan login untuk menjalankan simulasi pembayaran.");
   if (user.authStatus) return sendError(res,user.authStatus,"Session tidak valid.");
   if (user.role !== "customer") return sendError(res,403,"Akses ditolak.");

   const client = await pool.connect();
   try {
    await client.query("BEGIN");
    const locked = await client.query(
     `SELECT b.id::text AS booking_id,b.quantity,b.status AS booking_status,
             b.ticket_category_id,
             b.total_price,(p.amount=b.total_price) AS amount_matches_total,
             p.id AS payment_id,p.status AS payment_status,
             p.amount,p.payment_method,p.expires_at <= clock_timestamp() AS expired
      FROM bookings b JOIN payments p ON p.booking_id=b.id
      WHERE b.booking_code=$1 AND b.user_id=$2
      FOR UPDATE OF b,p`,
     [code,user.id],
    );
    if (!locked.rowCount) {
     await client.query("ROLLBACK");
     return sendError(res,404,"Pesanan tidak ditemukan.");
    }
    const booking = locked.rows[0];
    const category = await client.query(
     `SELECT tc.id AS ticket_category_id,c.cancelled_at
      FROM ticket_categories tc JOIN concerts c ON c.id=tc.concert_id
      WHERE tc.id=$1 FOR UPDATE OF tc,c`,
     [booking.ticket_category_id],
    );
    if (!category.rowCount) throw new Error("Kategori tiket pesanan tidak ditemukan.");
    if (category.rows[0].cancelled_at) {
     await client.query("ROLLBACK");
     return sendError(res,409,"Konser telah dibatalkan; pembayaran tidak dapat diproses.");
    }

    if (!booking.amount_matches_total || booking.payment_method !== "simulation") {
     await client.query("ROLLBACK");
     return sendError(res,409,"Payment tidak memenuhi aturan simulasi pesanan.");
    }

    if (booking.payment_status === "paid" && booking.booking_status === "confirmed") {
     const tickets = await issueBookingTickets(client,booking.booking_id);
     await client.query("COMMIT");
     return sendSuccess(res,200,"Simulasi pembayaran sudah berhasil diproses.",{bookingCode:code,paymentStatus:"paid",bookingStatus:"confirmed",tickets,paymentSimulation:true});
    }
    if (booking.payment_status !== "pending" || booking.booking_status !== "pending") {
     await client.query("ROLLBACK");
     return sendError(res,409,"Status pesanan tidak mengizinkan pembayaran.");
    }
    if (booking.expired) {
     const expired = await client.query("UPDATE payments SET status='expired',expired_at=clock_timestamp(),quota_restored_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND status='pending' AND quota_restored_at IS NULL RETURNING id",[booking.payment_id]);
     if (!expired.rowCount) throw new Error("Payment expired tidak dapat dicatat.");
     await client.query("UPDATE bookings SET status='cancelled',updated_at=clock_timestamp() WHERE id=$1::bigint AND status='pending'",[booking.booking_id]);
     await client.query("UPDATE ticket_categories SET quota=quota+$1 WHERE id=$2",[booking.quantity,category.rows[0].ticket_category_id]);
     await client.query("COMMIT");
     return sendError(res,409,"Batas waktu pesanan telah berakhir.");
    }
    if (req.body.outcome === "failure") {
     const failed = await client.query("UPDATE payments SET status='failed',failed_at=clock_timestamp(),quota_restored_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND status='pending' AND quota_restored_at IS NULL RETURNING id",[booking.payment_id]);
     if (!failed.rowCount) throw new Error("Payment gagal tidak dapat dicatat.");
     await client.query("UPDATE bookings SET status='cancelled',updated_at=clock_timestamp() WHERE id=$1::bigint AND status='pending'",[booking.booking_id]);
     await client.query("UPDATE ticket_categories SET quota=quota+$1 WHERE id=$2",[booking.quantity,category.rows[0].ticket_category_id]);
     await client.query("COMMIT");
     return sendSuccess(res,200,"Simulasi pembayaran gagal; pesanan dibatalkan.",{bookingCode:code,paymentStatus:"failed",bookingStatus:"cancelled",tickets:[],paymentSimulation:true});
    }

    const paid = await client.query("UPDATE payments SET status='paid',paid_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND status='pending' AND expires_at>clock_timestamp() RETURNING id",[booking.payment_id]);
    if (!paid.rowCount) {
     await client.query("ROLLBACK");
     return sendError(res,409,"Batas waktu pesanan telah berakhir.");
    }
    const confirmed = await client.query("UPDATE bookings SET status='confirmed',updated_at=clock_timestamp() WHERE id=$1::bigint AND status='pending' RETURNING id",[booking.booking_id]);
    if (!confirmed.rowCount) throw new Error("Booking tidak dapat dikonfirmasi.");
    const tickets = await issueBookingTickets(client,booking.booking_id);
    if (tickets.length !== Number(booking.quantity)) throw new Error("Penerbitan tiket tidak lengkap.");
    await client.query("COMMIT");
    return sendSuccess(res,200,"Simulasi pembayaran berhasil; tidak ada dana sungguhan yang diproses.",{bookingCode:code,paymentStatus:"paid",bookingStatus:"confirmed",tickets,paymentSimulation:true});
   } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
   } finally { client.release(); }
  } catch(error) { return next(error); }
 });
 return router;
}

export default createPaymentRouter();
