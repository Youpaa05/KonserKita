import { Router } from "express";
import { pool as defaultPool } from "../config/database.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";
import { readSessionToken } from "../utils/session.js";
import { issueBookingTickets } from "../services/digitalTickets.js";
import { createRateLimiter, hashRateLimitIdentity } from "../middleware/rateLimit.js";

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

export function createPaymentRouter({ pool = defaultPool, issueTickets = issueBookingTickets } = {}) {
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
   rows: [{ ...payment, tickets: ticketResult.rows }],
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

 async function expireLockedPayment(client, payment) {
  await client.query("UPDATE payments SET status='expired',expired_at=clock_timestamp(),quota_restored_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND status='pending'",[payment.id]);
  await client.query("UPDATE bookings SET status='cancelled',updated_at=clock_timestamp() WHERE id=$1",[payment.booking_id]);
  await client.query("UPDATE ticket_categories SET quota=quota+$1 WHERE id=$2",[payment.quantity,payment.ticket_category_id]);
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
  try {
   const user = await currentUserIfAuthenticated(req);
   if (user?.authStatus) return sendError(res,user.authStatus,"Session tidak valid.");
   if (user && user.role !== "customer") return sendError(res,403,"Akses ditolak.");
   const userId=user?.id ?? null;
   const client=await pool.connect();
   try {
    await client.query("BEGIN");
    const locked=await client.query(`SELECT p.id,p.status,b.id AS booking_id,b.booking_code,b.user_id,b.ticket_category_id,b.quantity FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE b.booking_code=$1 FOR UPDATE OF p,b`,[code]);
    if (!locked.rowCount || (userId ? locked.rows[0].user_id !== userId : locked.rows[0].user_id !== null)) { await client.query("ROLLBACK"); return sendError(res,404,"Pesanan tidak ditemukan."); }
    const p=locked.rows[0];
    let issuedTickets=[];
    if (p.status === "pending") {
     const expiry=await client.query("SELECT expires_at <= clock_timestamp() AS is_expired FROM payments WHERE id=$1",[p.id]);
     if (expiry.rows[0]?.is_expired) {
      await expireLockedPayment(client,p);
     } else if(req.body.outcome === "success") {
      const paid=await client.query("UPDATE payments SET status='paid',paid_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND status='pending' AND expires_at > clock_timestamp() RETURNING id",[p.id]);
      if (paid.rowCount) {
       await client.query("UPDATE bookings SET status='confirmed',updated_at=clock_timestamp() WHERE id=$1",[p.booking_id]);
       issuedTickets=await issueTickets(client,p.booking_id);
       if (p.user_id) {
        await client.query(
         `INSERT INTO user_notifications (user_id,event_key,type,title,message,booking_code)
          VALUES ($1::bigint,$2,'payment_paid','Pembayaran berhasil','Pembayaran simulasi berhasil dan pesanan Anda telah dikonfirmasi.',$3)
          ON CONFLICT (user_id,event_key) DO NOTHING`,
         [p.user_id,`booking:${p.booking_id}:paid`,p.booking_code],
        );
        await client.query(
         `INSERT INTO user_notifications (user_id,event_key,type,title,message,booking_code)
          VALUES ($1::bigint,$2,'ticket_issued','Tiket digital diterbitkan','E-ticket Anda sudah tersedia di menu Tiket Saya.',$3)
          ON CONFLICT (user_id,event_key) DO NOTHING`,
         [p.user_id,`booking:${p.booking_id}:tickets-issued`,p.booking_code],
        );
       }
      }
      else await expireLockedPayment(client,p);
     } else {
      const failed=await client.query("UPDATE payments SET status='failed',failed_at=clock_timestamp(),quota_restored_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND status='pending' AND expires_at > clock_timestamp() RETURNING id",[p.id]);
      if (failed.rowCount) {
       await client.query("UPDATE bookings SET status='cancelled',updated_at=clock_timestamp() WHERE id=$1",[p.booking_id]);
       await client.query("UPDATE ticket_categories SET quota=quota+$1 WHERE id=$2",[p.quantity,p.ticket_category_id]);
      } else await expireLockedPayment(client,p);
     }
    }
    const result=await client.query(`${SELECT_PAYMENT} WHERE b.id=$1`,[p.booking_id]);
    await client.query("COMMIT");
    return sendSuccess(res,200,"Status pembayaran berhasil diperiksa.",{...result.rows[0],tickets:issuedTickets});
   } catch(error) { await client.query("ROLLBACK"); throw error; }
   finally { client.release(); }
  } catch(error) { return next(error); }
 });
 return router;
}

export default createPaymentRouter();
