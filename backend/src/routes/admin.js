import { Router } from "express";
import { randomBytes } from "node:crypto";
import { pool as defaultPool } from "../config/database.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { ROLES } from "../constants/roles.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";
import { createRateLimiter, getClientIp } from "../middleware/rateLimit.js";

const MAX_CONCERT_BIGINT = 9223372036854775807n;

function isValidConcertId(value) {
  if (typeof value !== "string" || !/^[1-9]\d{0,18}$/.test(value)) return false;
  try { return BigInt(value) <= MAX_CONCERT_BIGINT; } catch { return false; }
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function parsePagination(query, { defaultLimit = 20, maxLimit = 50 } = {}) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? defaultLimit : Number(query.limit);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit || !Number.isSafeInteger((page - 1) * limit)) return null;
  return { page, limit, offset: (page - 1) * limit };
}

function parseDateRange(query) {
  const from = query.from === undefined ? "" : query.from;
  const to = query.to === undefined ? "" : query.to;
  if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) return null;
  return { from, to };
}

function addDatePredicates(values, column, range) {
  const conditions = [];
  if (range.from) { values.push(range.from); conditions.push(`(${column} AT TIME ZONE 'UTC') >= $${values.length}::date`); }
  if (range.to) { values.push(range.to); conditions.push(`(${column} AT TIME ZONE 'UTC') < ($${values.length}::date + INTERVAL '1 day')`); }
  return conditions;
}

function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function sendCsv(res, filename, headers, rows) {
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(`\uFEFF${csv}`);
}

function validateReportFilters(query, { statuses, dateColumn }) {
  const range = parseDateRange(query);
  const status = query.status === undefined ? "" : query.status;
  const bookingCode = query.bookingCode === undefined ? "" : query.bookingCode;
  const concertId = query.concertId === undefined ? "" : query.concertId;
  if (!range || (status && !statuses.includes(status)) || typeof bookingCode !== "string" || bookingCode.length > 40 || /[^a-zA-Z0-9-]/.test(bookingCode) || (concertId && !isValidConcertId(concertId))) return null;
  const values = [];
  const conditions = [];
  if (status) { values.push(status); conditions.push(`${dateColumn.status}=$${values.length}`); }
  if (bookingCode) { values.push(`${bookingCode}%`); conditions.push(`b.booking_code ILIKE $${values.length}`); }
  if (concertId) { values.push(concertId); conditions.push(`c.id=$${values.length}::bigint`); }
  conditions.push(...addDatePredicates(values, dateColumn.date, range));
  return { values, where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", range };
}

async function rollbackTransaction(client, logger, operation, primaryError) {
  try {
    await client.query("ROLLBACK");
    return false;
  } catch (rollbackError) {
    const details = {
      operation,
      name: rollbackError?.name || "Error",
      code: rollbackError?.code || "unknown",
    };
    logger.error("Admin transaction rollback failed.", details);
    if (primaryError && typeof primaryError === "object") {
      primaryError.rollbackError = details;
    }
    return true;
  }
}

function releaseTransactionClient(client, rollbackFailed) {
  if (rollbackFailed) {
    client.release(new Error("Admin transaction rollback failed."));
  } else {
    client.release();
  }
}

export function createAdminRouter({ pool = defaultPool, logger = console } = {}) {
  const router = Router();
  const requireAuth = createRequireAuth({ pool });
  const adminReadLimit = createRateLimiter({ scope: "admin-read", windowMs: 60 * 1000, max: 60, keyGenerator: (req) => req.user?.id || getClientIp(req), pool });
  const reportGuard = [requireAuth, requireRole(ROLES.ADMIN), adminReadLimit];
  const concertAdminGuard = [requireAuth, requireRole(ROLES.ADMIN)];

  router.get("/users", ...reportGuard, async (req, res, next) => {
    const pagination = parsePagination(req.query);
    const query = req.query.q === undefined ? "" : req.query.q;
    const role = req.query.role === undefined ? "" : req.query.role;
    if (!pagination || typeof query !== "string" || query.length > 100 || /[\u0000-\u001F\u007F]/.test(query) || (role && !["customer", "admin"].includes(role))) return sendError(res, 400, "Filter pengguna tidak valid.");
    const values = [];
    const conditions = [];
    if (query) { values.push(`%${query}%`); conditions.push(`(u.name ILIKE $${values.length} OR u.email ILIKE $${values.length})`); }
    if (role) { values.push(role); conditions.push(`r.name=$${values.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    try {
      const [count, result] = await Promise.all([
        pool.query(`SELECT COUNT(*)::bigint AS total FROM users u JOIN roles r ON r.id=u.role_id ${where}`, values),
        pool.query(`SELECT u.id::text AS id, u.name, u.email, r.name AS role, u.created_at AS "createdAt" FROM users u JOIN roles r ON r.id=u.role_id ${where} ORDER BY u.created_at DESC, u.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pagination.limit, pagination.offset]),
      ]);
      const total = Number(count.rows[0].total);
      return sendSuccess(res, 200, "Daftar pengguna berhasil dimuat.", { users: result.rows, total, page: pagination.page, limit: pagination.limit, totalPages: Math.ceil(total / pagination.limit) });
    } catch (error) { return next(error); }
  });

  router.get("/audit/role-changes", ...reportGuard, async (req, res, next) => {
    const pagination = parsePagination(req.query);
    if (!pagination) return sendError(res, 400, "Parameter halaman audit tidak valid.");
    try {
      const [count, result] = await Promise.all([
        pool.query("SELECT COUNT(*)::bigint AS total FROM admin_role_change_audit"),
        pool.query(
          `SELECT a.id::text AS id,
                  a.previous_role AS "previousRole",
                  a.new_role AS "newRole",
                  a.affected_sessions AS "affectedSessions",
                  a.changed_at AS "changedAt",
                  actor.name AS "actorName",
                  actor.email AS "actorEmail",
                  target.name AS "targetName",
                  target.email AS "targetEmail"
           FROM admin_role_change_audit a
           LEFT JOIN users actor ON actor.id=a.actor_user_id
           LEFT JOIN users target ON target.id=a.target_user_id
           ORDER BY a.changed_at DESC, a.id DESC
           LIMIT $1 OFFSET $2`,
          [pagination.limit, pagination.offset],
        ),
      ]);
      const total = Number(count.rows[0].total);
      return sendSuccess(res, 200, "Audit perubahan role berhasil dimuat.", {
        events: result.rows,
        total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: Math.ceil(total / pagination.limit),
      });
    } catch (error) { return next(error); }
  });

  router.patch("/users/:userId/role", ...concertAdminGuard, async (req, res, next) => {
    if (!isValidConcertId(req.params.userId) || !req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length !== 1 || !["customer", "admin"].includes(req.body.role)) return sendError(res, 400, "Perubahan role tidak valid.");
    let client;
    let rollbackFailed = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(2026112201)");
      const target = await client.query(`SELECT u.id, r.name AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1::bigint FOR UPDATE OF u`, [req.params.userId]);
      if (!target.rowCount) {
        rollbackFailed = await rollbackTransaction(client, logger, "change-user-role");
        if (rollbackFailed) return next(new Error("Role-change transaction rollback failed."));
        return sendError(res, 404, "Pengguna tidak ditemukan.");
      }
      const previousRole = target.rows[0].role;
      const newRole = req.body.role;
      if (previousRole === "admin" && newRole !== "admin") {
        const admins = await client.query("SELECT COUNT(*)::int AS total FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='admin'");
        if (admins.rows[0].total <= 1) {
          rollbackFailed = await rollbackTransaction(client, logger, "change-user-role");
          if (rollbackFailed) return next(new Error("Role-change transaction rollback failed."));
          return sendError(res, 409, "Role admin terakhir tidak dapat diturunkan.");
        }
      }
      let revokedSessions = 0;
      if (previousRole !== newRole) {
        await client.query("UPDATE users SET role_id=(SELECT id FROM roles WHERE name=$1), updated_at=clock_timestamp() WHERE id=$2", [newRole, req.params.userId]);
        const revoked = await client.query("UPDATE user_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL", [req.params.userId]);
        revokedSessions = revoked.rowCount;
        await client.query("INSERT INTO admin_role_change_audit (actor_user_id,target_user_id,previous_role,new_role,affected_sessions) VALUES ($1,$2,$3,$4,$5)", [req.user.id, req.params.userId, previousRole, newRole, revokedSessions]);
      }
      await client.query("COMMIT");
      return sendSuccess(res, 200, previousRole === newRole ? "Role pengguna tidak berubah." : "Role pengguna diperbarui dan sesi aktifnya dicabut.", { userId: req.params.userId, previousRole, role: newRole, revokedSessions });
    } catch (error) {
      if (client) rollbackFailed = await rollbackTransaction(client, logger, "change-user-role", error);
      return next(error);
    } finally { if (client) releaseTransactionClient(client, rollbackFailed); }
  });

  router.get(
    "/dashboard",
    requireAuth,
    requireRole(ROLES.ADMIN),
    adminReadLimit,
    async (_req, res, next) => {
      try {
        const result = await pool.query(`
          SELECT
            (SELECT COUNT(*)::bigint FROM users) AS total_users,
            (SELECT COUNT(*)::bigint FROM concerts) AS total_concerts,
            (SELECT COUNT(*)::bigint FROM concerts WHERE archived_at IS NULL AND cancelled_at IS NULL) AS active_concerts,
            (SELECT COUNT(*)::bigint FROM concerts WHERE cancelled_at IS NOT NULL) AS cancelled_concerts,
            (SELECT COUNT(*)::bigint FROM concerts WHERE archived_at IS NOT NULL) AS archived_concerts,
            (SELECT COUNT(*)::bigint FROM bookings) AS total_bookings,
            (SELECT COUNT(*)::bigint FROM bookings WHERE status='pending') AS pending_bookings,
            (SELECT COUNT(*)::bigint FROM bookings WHERE status='confirmed') AS confirmed_bookings,
            (SELECT COUNT(*)::bigint FROM bookings WHERE status='cancelled') AS cancelled_bookings,
            (SELECT COUNT(*)::bigint FROM payments WHERE status='pending') AS pending_payments,
            (SELECT COUNT(*)::bigint FROM payments WHERE status='paid') AS paid_payments,
            (SELECT COUNT(*)::bigint FROM payments WHERE status='failed') AS failed_payments,
            (SELECT COUNT(*)::bigint FROM payments WHERE status='expired') AS expired_payments,
            (SELECT COALESCE(SUM(amount),0)::text FROM payments WHERE status='paid') AS paid_amount,
            (SELECT COUNT(*)::bigint FROM digital_tickets) AS issued_tickets,
            (SELECT COUNT(*)::bigint FROM digital_tickets WHERE status='used') AS used_tickets
        `);

        const summary = result.rows[0];

        return sendSuccess(
          res,
          200,
          "Ringkasan dashboard admin berhasil dimuat.",
          {
            totalUsers: summary.total_users,
            totalConcerts: summary.total_concerts,
            activeConcerts: summary.active_concerts,
            cancelledConcerts: summary.cancelled_concerts,
            archivedConcerts: summary.archived_concerts,
            totalBookings: summary.total_bookings,
            pendingBookings: summary.pending_bookings,
            confirmedBookings: summary.confirmed_bookings,
            cancelledBookings: summary.cancelled_bookings,
            paymentCounts: {
              pending: summary.pending_payments,
              paid: summary.paid_payments,
              failed: summary.failed_payments,
              expired: summary.expired_payments,
            },
            paidAmount: summary.paid_amount,
            issuedTickets: summary.issued_tickets,
            usedTickets: summary.used_tickets,
            definitions: {
              activeConcerts: "Konser dengan archived_at NULL dan cancelled_at NULL.",
              paidAmount: "Jumlah amount pembayaran berstatus paid saja.",
              issuedTickets: "Semua row digital_tickets; status used tetap dihitung sebagai pernah diterbitkan.",
            },
          },
        );
      } catch (error) {
        return next(error);
      }
    },
  );

  // Fase 05: Concert management.
  router.get("/orders", ...reportGuard, async (req, res, next) => {
    const pagination = parsePagination(req.query);
    const range = parseDateRange(req.query);
    const status = req.query.status === undefined ? "" : req.query.status;
    const bookingCode = req.query.bookingCode === undefined ? "" : req.query.bookingCode;
    const customer = req.query.customer === undefined ? "" : req.query.customer;
    const concertId = req.query.concertId === undefined ? "" : req.query.concertId;
    const sort = req.query.sort === undefined ? "createdAt" : req.query.sort;
    const direction = req.query.direction === undefined ? "desc" : req.query.direction;
    if (!pagination || !range || (status && !["pending", "confirmed", "cancelled"].includes(status)) ||
        typeof bookingCode !== "string" || bookingCode.length > 40 || /[^a-zA-Z0-9-]/.test(bookingCode) ||
        typeof customer !== "string" || customer.length > 100 || /[\u0000-\u001F\u007F]/.test(customer) ||
        (concertId && !isValidConcertId(concertId)) || !["createdAt", "bookingCode", "totalPrice"].includes(sort) || !["asc", "desc"].includes(direction)) {
      return sendError(res, 400, "Filter laporan pesanan tidak valid.");
    }
    const values = [];
    const conditions = [];
    if (status) { values.push(status); conditions.push(`b.status=$${values.length}`); }
    if (bookingCode) { values.push(`${bookingCode}%`); conditions.push(`b.booking_code ILIKE $${values.length}`); }
    if (customer) { values.push(`%${customer}%`); conditions.push(`(b.customer_name ILIKE $${values.length} OR b.customer_email ILIKE $${values.length})`); }
    if (concertId) { values.push(concertId); conditions.push(`c.id=$${values.length}::bigint`); }
    conditions.push(...addDatePredicates(values, "b.created_at", range));
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const orderBy = { createdAt: "b.created_at", bookingCode: "b.booking_code", totalPrice: "b.total_price" }[sort];
    try {
      const count = await pool.query(`SELECT COUNT(*)::bigint AS total FROM bookings b LEFT JOIN payments p ON p.booking_id=b.id JOIN ticket_categories tc ON tc.id=b.ticket_category_id JOIN concerts c ON c.id=tc.concert_id ${where}`, values);
      const pageValues = [...values, pagination.limit, pagination.offset];
      const result = await pool.query(`SELECT b.booking_code AS "bookingCode", b.customer_name AS "customerName", CASE WHEN b.user_id IS NULL THEN 'guest' ELSE 'customer' END AS "customerType", b.quantity, b.total_price::text AS "totalPrice", b.status AS "bookingStatus", p.status AS "paymentStatus", b.created_at AS "createdAt", tc.name AS "ticketCategory", c.title AS "concertTitle", c.city, to_char(c.event_date,'YYYY-MM-DD') AS "eventDate" FROM bookings b LEFT JOIN payments p ON p.booking_id=b.id JOIN ticket_categories tc ON tc.id=b.ticket_category_id JOIN concerts c ON c.id=tc.concert_id ${where} ORDER BY ${orderBy} ${direction.toUpperCase()}, b.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, pageValues);
      const total = Number(count.rows[0].total);
      return sendSuccess(res, 200, "Daftar pesanan berhasil dimuat.", { orders: result.rows, total, page: pagination.page, limit: pagination.limit, totalPages: Math.ceil(total / pagination.limit), timezone: "UTC" });
    } catch (error) { return next(error); }
  });

  router.get("/orders/:bookingCode", ...reportGuard, async (req, res, next) => {
    const code = String(req.params.bookingCode || "").toUpperCase();
    if (!/^KK-[A-F0-9]{16}$/.test(code)) return sendError(res, 400, "Format kode pesanan tidak valid.");
    try {
      const result = await pool.query(`SELECT b.booking_code AS "bookingCode", b.customer_name AS "customerName", b.customer_email AS "customerEmail", b.quantity, b.unit_price::double precision AS "unitPrice", b.total_price::double precision AS "totalPrice", b.status AS "bookingStatus", p.status AS "paymentStatus", p.amount::double precision AS amount, p.payment_method AS "paymentMethod", p.expires_at AS "expiresAt", p.paid_at AS "paidAt", p.failed_at AS "failedAt", p.expired_at AS "expiredAt", b.created_at AS "createdAt", tc.name AS "ticketCategory", c.title AS "concertTitle", c.cancelled_at AS "concertCancelledAt", c.cancellation_reason AS "cancellationReason", COALESCE((SELECT json_agg(json_build_object('ticketCode',t.ticket_code,'ticketNumber',t.ticket_number,'status',t.status,'issuedAt',t.issued_at,'usedAt',t.used_at,'validatorName',u.name) ORDER BY t.ticket_number) FROM digital_tickets t LEFT JOIN users u ON u.id=t.used_by WHERE t.booking_id=b.id),'[]'::json) AS tickets FROM bookings b JOIN payments p ON p.booking_id=b.id JOIN ticket_categories tc ON tc.id=b.ticket_category_id JOIN concerts c ON c.id=tc.concert_id WHERE b.booking_code=$1`, [code]);
      if (!result.rowCount) return sendError(res, 404, "Pesanan tidak ditemukan.");
      return sendSuccess(res, 200, "Detail pesanan berhasil dimuat.", result.rows[0]);
    } catch (error) { return next(error); }
  });

  router.get("/payments/:bookingCode/history", ...reportGuard, async (req, res, next) => {
    const code = String(req.params.bookingCode || "").toUpperCase();
    if (!/^KK-[A-F0-9]{16}$/.test(code)) return sendError(res, 400, "Format kode pesanan tidak valid.");
    try {
      const result = await pool.query(`SELECT b.booking_code, h.previous_status AS "previousStatus", h.new_status AS "newStatus", h.changed_at AS "changedAt" FROM bookings b JOIN payments p ON p.booking_id=b.id LEFT JOIN payment_status_history h ON h.payment_id=p.id WHERE b.booking_code=$1 ORDER BY h.changed_at ASC NULLS FIRST,h.id ASC`, [code]);
      if (!result.rowCount) return sendError(res, 404, "Pembayaran tidak ditemukan.");
      return sendSuccess(res, 200, "Histori perubahan status pembayaran berhasil dimuat.", { bookingCode: code, events: result.rows.filter((row) => row.newStatus), availableSince: "Pencatatan dimulai setelah migrasi histori pembayaran diterapkan; histori sebelumnya tidak direka ulang." });
    } catch (error) { return next(error); }
  });

  router.get("/analytics/concerts", ...reportGuard, async (req, res, next) => {
    const pagination = parsePagination(req.query, { defaultLimit: 10, maxLimit: 50 });
    const requestedRange = parseDateRange(req.query);
    const hasPartialRange = requestedRange && Boolean(requestedRange.from) !== Boolean(requestedRange.to);
    const rangeTooWide = requestedRange?.from && requestedRange?.to &&
      (Date.parse(`${requestedRange.to}T00:00:00Z`) - Date.parse(`${requestedRange.from}T00:00:00Z`)) / 86400000 > 365;
    const range = requestedRange && (requestedRange.from || requestedRange.to)
      ? requestedRange
      : { from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };
    const sort = req.query.sort === undefined ? "ticketQuantity" : req.query.sort;
    const direction = req.query.direction === undefined ? "desc" : req.query.direction;
    if (!pagination || !requestedRange || hasPartialRange || rangeTooWide || !["ticketQuantity", "bookingCount", "paidAmount", "title"].includes(sort) || !["asc", "desc"].includes(direction)) return sendError(res, 400, "Filter analitik konser tidak valid. Rentang maksimal 366 hari dan harus memiliki tanggal awal serta akhir.");

    const values = [];
    const bookingDates = addDatePredicates(values, "b.created_at", range);
    const paidValues = [];
    const paidDates = addDatePredicates(paidValues, "p.paid_at", range);
    const pageValues = [...values, pagination.limit, pagination.offset];
    const orderBy = { ticketQuantity: "ticket_quantity", bookingCount: "booking_count", paidAmount: "paid_amount", title: "c.title" }[sort];
    try {
      const [result, count] = await Promise.all([
        pool.query(`WITH booking_stats AS (
          SELECT tc.concert_id, COUNT(b.id)::bigint AS booking_count,
                 COALESCE(SUM(b.quantity),0)::bigint AS ticket_quantity,
                 COALESCE(SUM(b.quantity) FILTER (WHERE b.status IN ('pending','confirmed')),0)::bigint AS active_ticket_quantity
          FROM bookings b JOIN ticket_categories tc ON tc.id=b.ticket_category_id
          WHERE ${bookingDates.join(" AND ")} GROUP BY tc.concert_id
        ), paid_stats AS (
          SELECT tc.concert_id, COUNT(p.id)::bigint AS paid_payment_count,
                 COALESCE(SUM(p.amount),0)::text AS paid_amount
          FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN ticket_categories tc ON tc.id=b.ticket_category_id
          WHERE p.status='paid' AND ${paidDates.join(" AND ")} GROUP BY tc.concert_id
        ), inventory AS (
          SELECT concert_id, COALESCE(SUM(quota),0)::bigint AS available_quota
          FROM ticket_categories WHERE archived_at IS NULL GROUP BY concert_id
        )
        SELECT c.id::text AS "concertId", c.title AS "concertTitle", c.artist,
               COALESCE(bs.booking_count,0)::bigint AS "bookingCount",
               COALESCE(bs.ticket_quantity,0)::bigint AS "ticketQuantity",
               COALESCE(bs.active_ticket_quantity,0)::bigint AS "activeTicketQuantity",
               COALESCE(ps.paid_payment_count,0)::bigint AS "paidPaymentCount",
               COALESCE(ps.paid_amount,'0') AS "paidAmount",
               COALESCE(i.available_quota,0)::bigint AS "availableQuota"
        FROM concerts c LEFT JOIN booking_stats bs ON bs.concert_id=c.id
        LEFT JOIN paid_stats ps ON ps.concert_id=c.id LEFT JOIN inventory i ON i.concert_id=c.id
        WHERE c.archived_at IS NULL ORDER BY ${orderBy} ${direction.toUpperCase()}, c.id ASC
        LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`, pageValues),
        pool.query("SELECT COUNT(*)::bigint AS total FROM concerts WHERE archived_at IS NULL"),
      ]);
      const total = Number(count.rows[0].total);
      return sendSuccess(res, 200, "Analitik konser berhasil dimuat.", {
        concerts: result.rows, total, page: pagination.page, limit: pagination.limit,
        totalPages: Math.ceil(total / pagination.limit), period: range,
        definitions: { ticketQuantity: "Jumlah quantity pada booking yang dibuat dalam periode, termasuk booking yang kemudian dibatalkan.", activeTicketQuantity: "Quantity booking pending atau confirmed dalam periode.", availableQuota: "Jumlah kuota tersisa pada kategori tiket aktif saat ini.", paidAmount: "Amount pembayaran paid berdasarkan paid_at dalam periode." },
      });
    } catch (error) { return next(error); }
  });

  router.get("/analytics/trends", ...reportGuard, async (req, res, next) => {
    const range = parseDateRange(req.query);
    const interval = req.query.interval === undefined ? "day" : req.query.interval;
    if (!range || !range.from || !range.to || !["day", "month"].includes(interval)) return sendError(res, 400, "Periode tren tidak valid.");
    const days = (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000;
    if (days < 0 || days > 365) return sendError(res, 400, "Rentang tren maksimal 366 hari.");
    const bucket = interval === "day" ? "day" : "month";
    try {
      const result = await pool.query(`SELECT to_char(date_trunc('${bucket}', b.created_at AT TIME ZONE 'UTC'), '${bucket === "day" ? "YYYY-MM-DD" : "YYYY-MM"}') AS period,
        COUNT(b.id)::bigint AS "bookingCount", COALESCE(SUM(b.quantity),0)::bigint AS "ticketQuantity",
        COUNT(p.id) FILTER (WHERE p.status='paid')::bigint AS "paidPaymentCount",
        COALESCE(SUM(p.amount) FILTER (WHERE p.status='paid'),0)::text AS "paidAmount"
        FROM bookings b LEFT JOIN payments p ON p.booking_id=b.id
        WHERE (b.created_at AT TIME ZONE 'UTC') >= $1::date AND (b.created_at AT TIME ZONE 'UTC') < ($2::date + INTERVAL '1 day')
        GROUP BY date_trunc('${bucket}', b.created_at AT TIME ZONE 'UTC') ORDER BY date_trunc('${bucket}', b.created_at AT TIME ZONE 'UTC')`, [range.from, range.to]);
      return sendSuccess(res, 200, "Tren pemesanan berhasil dimuat.", { interval, timezone: "UTC", period: range, points: result.rows, definitions: { period: "Bucket memakai waktu pembuatan booking (created_at) UTC.", paidAmount: "Nominal payment berstatus paid yang terkait booking dalam bucket; bukan dikelompokkan berdasarkan paid_at." } });
    } catch (error) { return next(error); }
  });

  router.get("/reports/payments", ...reportGuard, async (req, res, next) => {
    const pagination = parsePagination(req.query);
    const range = parseDateRange(req.query);
    const status = req.query.status === undefined ? "" : req.query.status;
    const bookingCode = req.query.bookingCode === undefined ? "" : req.query.bookingCode;
    const concertId = req.query.concertId === undefined ? "" : req.query.concertId;
    const sort = req.query.sort === undefined ? "createdAt" : req.query.sort;
    const direction = req.query.direction === undefined ? "desc" : req.query.direction;
    if (!pagination || !range || (status && !["pending", "paid", "failed", "expired"].includes(status)) ||
        typeof bookingCode !== "string" || bookingCode.length > 40 || /[^a-zA-Z0-9-]/.test(bookingCode) ||
        (concertId && !isValidConcertId(concertId)) || !["createdAt", "paidAt", "amount"].includes(sort) || !["asc", "desc"].includes(direction)) return sendError(res, 400, "Filter laporan pembayaran tidak valid.");
    const values = [];
    const conditions = [];
    if (status) { values.push(status); conditions.push(`p.status=$${values.length}`); }
    if (bookingCode) { values.push(`${bookingCode}%`); conditions.push(`b.booking_code ILIKE $${values.length}`); }
    if (concertId) { values.push(concertId); conditions.push(`c.id=$${values.length}::bigint`); }
    conditions.push(...addDatePredicates(values, "p.created_at", range));
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const orderBy = { createdAt: "p.created_at", paidAt: "p.paid_at", amount: "p.amount" }[sort];
    try {
      const count = await pool.query(`SELECT COUNT(*)::bigint AS total FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN ticket_categories tc ON tc.id=b.ticket_category_id JOIN concerts c ON c.id=tc.concert_id ${where}`, values);
      const pageValues = [...values, pagination.limit, pagination.offset];
      const result = await pool.query(`SELECT p.id::text AS "paymentId", b.booking_code AS "bookingCode", p.status AS "paymentStatus", p.amount::text AS amount, p.payment_method AS "paymentMethod", p.created_at AS "createdAt", p.paid_at AS "paidAt", p.expires_at AS "expiresAt", c.title AS "concertTitle" FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN ticket_categories tc ON tc.id=b.ticket_category_id JOIN concerts c ON c.id=tc.concert_id ${where} ORDER BY ${orderBy} ${direction.toUpperCase()} NULLS LAST, p.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, pageValues);
      const total = Number(count.rows[0].total);
      return sendSuccess(res, 200, "Laporan pembayaran berhasil dimuat.", { payments: result.rows, total, page: pagination.page, limit: pagination.limit, totalPages: Math.ceil(total / pagination.limit), period: range, timezone: "UTC", revenueDefinition: "Hanya amount berstatus paid yang dihitung; nilai ini bukan settlement payment gateway." });
    } catch (error) { return next(error); }
  });

  router.get("/exports/orders.csv", ...reportGuard, async (req, res, next) => {
    const filters = validateReportFilters(req.query, { statuses: ["pending", "confirmed", "cancelled"], dateColumn: { status: "b.status", date: "b.created_at" } });
    if (!filters) return sendError(res, 400, "Filter export pesanan tidak valid.");
    try {
      const result = await pool.query(`SELECT b.booking_code AS "bookingCode", b.status AS "bookingStatus", c.title AS "concertTitle", tc.name AS "ticketCategory", b.quantity, b.total_price::text AS "totalPrice", p.status AS "paymentStatus", b.created_at AS "createdAt" FROM bookings b LEFT JOIN payments p ON p.booking_id=b.id JOIN ticket_categories tc ON tc.id=b.ticket_category_id JOIN concerts c ON c.id=tc.concert_id ${filters.where} ORDER BY b.created_at DESC,b.id DESC LIMIT 10001`, filters.values);
      const limited = result.rows.slice(0, 10000);
      if (result.rows.length > 10000) res.setHeader("X-Export-Truncated", "true");
      return sendCsv(res, "konserkita-orders.csv", ["booking_code", "booking_status", "concert", "ticket_category", "quantity", "total_amount", "payment_status", "created_at_utc"], limited.map((row) => [row.bookingCode, row.bookingStatus, row.concertTitle, row.ticketCategory, row.quantity, row.totalPrice, row.paymentStatus, row.createdAt]));
    } catch (error) { return next(error); }
  });

  router.get("/exports/payments.csv", ...reportGuard, async (req, res, next) => {
    const filters = validateReportFilters(req.query, { statuses: ["pending", "paid", "failed", "expired"], dateColumn: { status: "p.status", date: "p.created_at" } });
    if (!filters) return sendError(res, 400, "Filter export pembayaran tidak valid.");
    try {
      const result = await pool.query(`SELECT b.booking_code AS "bookingCode", c.title AS "concertTitle", p.status AS "paymentStatus", p.amount::text AS amount, p.payment_method AS "paymentMethod", p.created_at AS "createdAt", p.paid_at AS "paidAt" FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN ticket_categories tc ON tc.id=b.ticket_category_id JOIN concerts c ON c.id=tc.concert_id ${filters.where} ORDER BY p.created_at DESC,p.id DESC LIMIT 10001`, filters.values);
      const limited = result.rows.slice(0, 10000);
      if (result.rows.length > 10000) res.setHeader("X-Export-Truncated", "true");
      return sendCsv(res, "konserkita-payments.csv", ["booking_code", "concert", "payment_status", "amount", "method", "created_at_utc", "paid_at_utc"], limited.map((row) => [row.bookingCode, row.concertTitle, row.paymentStatus, row.amount, row.paymentMethod, row.createdAt, row.paidAt]));
    } catch (error) { return next(error); }
  });

  router.get("/exports/concert-performance.csv", ...reportGuard, async (req, res, next) => {
    const range = parseDateRange(req.query);
    const days = range?.from && range?.to ? (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000 : Infinity;
    if (!range || !range.from || !range.to || days < 0 || days > 365) return sendError(res, 400, "Rentang export performa wajib valid dan maksimal 366 hari.");
    try {
      const result = await pool.query(`WITH paid AS (SELECT b.id,b.quantity,b.ticket_category_id,p.amount FROM bookings b JOIN payments p ON p.booking_id=b.id WHERE p.status='paid' AND (p.paid_at AT TIME ZONE 'UTC') >= $1::date AND (p.paid_at AT TIME ZONE 'UTC') < ($2::date + INTERVAL '1 day')), booking_totals AS (SELECT tc.concert_id,COUNT(b.id)::bigint AS bookings FROM bookings b JOIN ticket_categories tc ON tc.id=b.ticket_category_id WHERE (b.created_at AT TIME ZONE 'UTC') >= $1::date AND (b.created_at AT TIME ZONE 'UTC') < ($2::date + INTERVAL '1 day') GROUP BY tc.concert_id), paid_totals AS (SELECT tc.concert_id,COUNT(p.id)::bigint AS paid_orders,COALESCE(SUM(p.quantity),0)::bigint AS tickets_sold,COALESCE(SUM(p.amount),0)::text AS gross_sales FROM paid p JOIN ticket_categories tc ON tc.id=p.ticket_category_id GROUP BY tc.concert_id), inventory AS (SELECT concert_id,COALESCE(SUM(quota),0)::bigint AS available_quota FROM ticket_categories WHERE archived_at IS NULL GROUP BY concert_id) SELECT c.title,COALESCE(bt.bookings,0)::bigint AS bookings,COALESCE(pt.paid_orders,0)::bigint AS paid_orders,COALESCE(pt.tickets_sold,0)::bigint AS tickets_sold,COALESCE(pt.gross_sales,'0') AS gross_sales,COALESCE(i.available_quota,0)::bigint AS available_quota FROM concerts c LEFT JOIN booking_totals bt ON bt.concert_id=c.id LEFT JOIN paid_totals pt ON pt.concert_id=c.id LEFT JOIN inventory i ON i.concert_id=c.id ORDER BY c.title,c.id LIMIT 10001`, [range.from, range.to]);
      const limited = result.rows.slice(0, 10000);
      if (result.rows.length > 10000) res.setHeader("X-Export-Truncated", "true");
      return sendCsv(res, "konserkita-concert-performance.csv", ["concert", "bookings_created_in_period", "paid_orders_paid_in_period", "tickets_sold_paid_in_period", "gross_sales_paid_in_period", "available_quota_current"], limited.map((row) => [row.title, row.bookings, row.paid_orders, row.tickets_sold, row.gross_sales, row.available_quota]));
    } catch (error) { return next(error); }
  });

  function validateConcert(body, requireCategories = false) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }

    const fields = [
      ["title", 200],
      ["artist", 200],
      ["category", 80],
      ["city", 100],
      ["venue", 200],
      ["imageUrl", 10000],
      ["description", 20000],
      ["accent", 30],
    ];

    const value = {};

    for (const [field, max] of fields) {
      if (typeof body[field] !== "string") return null;
      value[field] = body[field].trim();
      if (!value[field] || value[field].length > max) return null;
      if (/[\u0000-\u001F\u007F]/.test(value[field])) return null;
    }

    if (
      typeof body.eventDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.eventDate)
    ) return null;

    const parsedDate = new Date(`${body.eventDate}T00:00:00Z`);
    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== body.eventDate
    ) return null;

    if (
      typeof body.eventTime !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.eventTime)
    ) return null;

    value.eventDate = body.eventDate;
    value.eventTime = body.eventTime;

    if (requireCategories) {
      if (
        !Array.isArray(body.ticketCategories) ||
        body.ticketCategories.length < 1 ||
        body.ticketCategories.length > 20
      ) return null;

      const names = new Set();
      value.ticketCategories = [];

      for (const item of body.ticketCategories) {
        if (!item || typeof item !== "object") return null;

        const name = typeof item.name === "string" ? item.name.trim() : "";
        const price = item.price;
        const quota = item.quota;

        if (
          !name ||
          name.length > 80 ||
          /[\u0000-\u001F\u007F]/.test(name) ||
          names.has(name.toLowerCase()) ||
          typeof price !== "number" ||
          !Number.isFinite(price) ||
          price < 0 ||
          !Number.isSafeInteger(quota) ||
          quota < 0
        ) return null;

        names.add(name.toLowerCase());
        value.ticketCategories.push({ name, price, quota });
      }
    }

    return value;
  }

  router.get(
    "/concerts",
    ...concertAdminGuard,
    async (req, res, next) => {
      try {
        const status = req.query.status === "archived"
          ? "archived"
          : req.query.status === "cancelled"
            ? "cancelled"
          : req.query.status === "all"
            ? "all"
            : "active";

        const condition = status === "active"
          ? "WHERE c.archived_at IS NULL AND c.cancelled_at IS NULL"
          : status === "archived"
            ? "WHERE c.archived_at IS NOT NULL"
            : status === "cancelled"
              ? "WHERE c.cancelled_at IS NOT NULL"
            : "";

        const result = await pool.query(
          `SELECT
             c.id::text AS id,
             c.slug,
             c.title,
             c.artist,
             c.category,
             c.city,
             c.venue,
             to_char(c.event_date, 'YYYY-MM-DD') AS "eventDate",
             to_char(c.event_time, 'HH24:MI') AS "eventTime",
             c.accent,
             c.image_url AS "imageUrl",
             c.description,
             c.archived_at AS "archivedAt",
             c.cancelled_at AS "cancelledAt",
             c.cancellation_reason AS "cancellationReason",
             COALESCE(
               (SELECT COUNT(*)::int FROM ticket_categories tc
                WHERE tc.concert_id = c.id), 0
             ) AS "categoryCount"
           FROM concerts c
           ${condition}
           ORDER BY c.event_date DESC, c.id DESC`,
        );

        return sendSuccess(res, 200, "Data konser admin berhasil dimuat.", result.rows);
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    "/concerts/:id",
    ...concertAdminGuard,
    async (req, res, next) => {
      try {
        if (!isValidConcertId(req.params.id)) {
          return sendError(res, 400, "ID konser tidak valid.");
        }

        const result = await pool.query(
          `SELECT
             c.id::text AS id, c.slug, c.title, c.artist,
             c.category, c.city, c.venue,
             to_char(c.event_date, 'YYYY-MM-DD') AS "eventDate",
             to_char(c.event_time, 'HH24:MI') AS "eventTime",
             c.accent, c.image_url AS "imageUrl",
             c.description, c.archived_at AS "archivedAt",
             c.cancelled_at AS "cancelledAt",
             c.cancellation_reason AS "cancellationReason",
             COALESCE(
               (SELECT json_agg(json_build_object(
                 'id', tc.id::text,
                 'name', tc.name,
                 'price', tc.price::double precision,
                 'quota', tc.quota
               ) ORDER BY tc.id)
               FROM ticket_categories tc
               WHERE tc.concert_id = c.id), '[]'::json
             ) AS "ticketCategories"
           FROM concerts c
           WHERE c.id = $1::bigint`,
          [req.params.id],
        );

        if (!result.rowCount) {
          return sendError(res, 404, "Konser tidak ditemukan.");
        }

        return sendSuccess(res, 200, "Detail konser berhasil dimuat.", result.rows[0]);
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/concerts",
    ...concertAdminGuard,
    async (req, res, next) => {
      const data = validateConcert(req.body, true);
      if (!data) {
        return sendError(res, 400, "Data konser atau kategori tiket tidak valid.");
      }

      const client = await pool.connect();
      let rollbackFailed = false;
      try {
        await client.query("BEGIN");

        const slugBase = data.title
          .toLowerCase()
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 90) || "konser";

        const slug = `${slugBase}-${randomBytes(4).toString("hex")}`;

        const inserted = await client.query(
          `INSERT INTO concerts
            (slug, title, artist, category, city, venue,
             event_date, event_time, accent, image_url, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING id::text AS id, slug`,
          [
            slug, data.title, data.artist, data.category,
            data.city, data.venue, data.eventDate, data.eventTime,
            data.accent, data.imageUrl, data.description,
          ],
        );

        const concertId = inserted.rows[0].id;

        for (const category of data.ticketCategories) {
          await client.query(
            `INSERT INTO ticket_categories (concert_id, name, price, quota)
             VALUES ($1::bigint, $2, $3, $4)`,
            [concertId, category.name, category.price, category.quota],
          );
        }

        await client.query("COMMIT");
        return sendSuccess(res, 201, "Konser berhasil dibuat.", inserted.rows[0]);
      } catch (error) {
        rollbackFailed = await rollbackTransaction(client, logger, "create-concert", error);
        return next(error);
      } finally {
        releaseTransactionClient(client, rollbackFailed);
      }
    },
  );

  router.put(
    "/concerts/:id",
    ...concertAdminGuard,
    async (req, res, next) => {
      if (!isValidConcertId(req.params.id)) {
        return sendError(res, 400, "ID konser tidak valid.");
      }

      const data = validateConcert(req.body, false);
      if (!data) {
        return sendError(res, 400, "Data konser tidak valid.");
      }

      try {
        const result = await pool.query(
          `UPDATE concerts
           SET title=$1, artist=$2, category=$3, city=$4,
               venue=$5, event_date=$6, event_time=$7,
               accent=$8, image_url=$9, description=$10,
               updated_at=NOW()
           WHERE id=$11::bigint AND archived_at IS NULL AND cancelled_at IS NULL
           RETURNING id::text AS id, slug`,
          [
            data.title, data.artist, data.category, data.city,
            data.venue, data.eventDate, data.eventTime, data.accent,
            data.imageUrl, data.description, req.params.id,
          ],
        );

        if (!result.rowCount) {
          return sendError(res, 404, "Konser aktif tidak ditemukan.");
        }

        return sendSuccess(res, 200, "Konser berhasil diperbarui.", result.rows[0]);
      } catch (error) {
        return next(error);
      }
    },
  );

  router.delete(
    "/concerts/:id",
    ...concertAdminGuard,
    async (req, res, next) => {
      if (!isValidConcertId(req.params.id)) {
        return sendError(res, 400, "ID konser tidak valid.");
      }

      try {
        const result = await pool.query(
          `UPDATE concerts
           SET archived_at=NOW(), updated_at=NOW()
           WHERE id=$1::bigint AND archived_at IS NULL
           RETURNING id::text AS id, archived_at AS "archivedAt"`,
          [req.params.id],
        );

        if (!result.rowCount) {
          return sendError(res, 404, "Konser aktif tidak ditemukan.");
        }

        return sendSuccess(
          res, 200,
          "Konser berhasil diarsipkan. Riwayat booking tetap dipertahankan.",
          result.rows[0],
        );
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post("/concerts/:id/cancel", ...concertAdminGuard, async (req, res, next) => {
    if (!isValidConcertId(req.params.id)) return sendError(res, 400, "ID konser tidak valid.");
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (Object.keys(req.body || {}).some((key) => key !== "reason") || !reason || reason.length > 500 || /[\u0000-\u001F\u007F]/.test(reason)) {
      return sendError(res, 400, "Alasan pembatalan wajib diisi (maksimal 500 karakter).");
    }
    try {
      const result = await pool.query(
        `UPDATE concerts SET cancelled_at=clock_timestamp(), cancellation_reason=$1, updated_at=clock_timestamp()
         WHERE id=$2::bigint AND archived_at IS NULL AND cancelled_at IS NULL
         RETURNING id::text AS id, cancelled_at AS "cancelledAt", cancellation_reason AS "cancellationReason"`,
        [reason, req.params.id],
      );
      if (!result.rowCount) return sendError(res, 404, "Konser aktif yang belum dibatalkan tidak ditemukan.");
      return sendSuccess(res, 200, "Konser dibatalkan. Booking, pembayaran, dan tiket yang sudah ada tetap dipertahankan.", result.rows[0]);
    } catch (error) { return next(error); }
  });

  router.post(
    "/concerts/:id/restore",
    ...concertAdminGuard,
    async (req, res, next) => {
      if (!isValidConcertId(req.params.id)) {
        return sendError(res, 400, "ID konser tidak valid.");
      }

      try {
        const result = await pool.query(
          `UPDATE concerts
           SET archived_at=NULL, updated_at=NOW()
           WHERE id=$1::bigint AND archived_at IS NOT NULL
           RETURNING id::text AS id, slug`,
          [req.params.id],
        );

        if (!result.rowCount) {
          return sendError(res, 404, "Konser arsip tidak ditemukan.");
        }

        return sendSuccess(res, 200, "Konser berhasil dipulihkan.", result.rows[0]);
      } catch (error) {
        return next(error);
      }
    },
  );


// Fase 06: Ticket category management (Tasks 065-066).
const MAX_CATEGORY_PRICE = 9999999999.99;
const MAX_CATEGORY_QUOTA = 2147483647;

function validateCategoryName(value) {
  if (typeof value !== "string") return null;

  const name = value.trim();

  if (
    !name ||
    name.length > 80 ||
    /[\u0000-\u001F\u007F]/.test(name)
  ) {
    return null;
  }

  return name;
}

function validateCategoryCreate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const name = validateCategoryName(body.name);
  const price = body.price;
  const quota = body.quota;

  if (!name) return null;

  if (
    typeof price !== "number" ||
    !Number.isFinite(price) ||
    price < 0 ||
    price > MAX_CATEGORY_PRICE ||
    Math.abs(price * 100 - Math.round(price * 100)) > 0.000001
  ) {
    return null;
  }

  if (
    typeof quota !== "number" ||
    !Number.isInteger(quota) ||
    quota < 0 ||
    quota > MAX_CATEGORY_QUOTA
  ) {
    return null;
  }

  return { name, price, quota };
}

router.post(
  "/concerts/:concertId/ticket-categories",
  ...concertAdminGuard,
  async (req, res, next) => {
    if (!isValidConcertId(req.params.concertId)) {
      return sendError(res, 400, "ID konser tidak valid.");
    }

    const data = validateCategoryCreate(req.body);

    if (!data) {
      return sendError(res, 400, "Data kategori tiket tidak valid.");
    }

    const client = await pool.connect();
    let rollbackFailed = false;

    try {
      await client.query("BEGIN");

      const concertResult = await client.query(
        `SELECT id
         FROM concerts
         WHERE id = $1::bigint
           AND archived_at IS NULL
           AND cancelled_at IS NULL
         FOR UPDATE`,
        [req.params.concertId],
      );

      if (!concertResult.rowCount) {
        rollbackFailed = await rollbackTransaction(client, logger, "create-ticket-category");
        if (rollbackFailed) return next(new Error("Admin transaction rollback failed."));
        return sendError(res, 404, "Konser aktif tidak ditemukan.");
      }

      const duplicateResult = await client.query(
        `SELECT id
         FROM ticket_categories
         WHERE concert_id = $1::bigint
           AND LOWER(name) = LOWER($2)
         LIMIT 1`,
        [req.params.concertId, data.name],
      );

      if (duplicateResult.rowCount) {
        rollbackFailed = await rollbackTransaction(client, logger, "create-ticket-category");
        if (rollbackFailed) return next(new Error("Admin transaction rollback failed."));
        return sendError(res, 409, "Nama kategori tiket sudah digunakan.");
      }

      const inserted = await client.query(
        `INSERT INTO ticket_categories
          (concert_id, name, price, quota)
         VALUES ($1::bigint, $2, $3, $4)
         RETURNING
           id::text AS id,
           concert_id::text AS "concertId",
           name,
           price::double precision AS price,
           quota,
           created_at AS "createdAt"`,
        [
          req.params.concertId,
          data.name,
          data.price,
          data.quota,
        ],
      );

      await client.query("COMMIT");

      return sendSuccess(
        res,
        201,
        "Kategori tiket berhasil dibuat.",
        inserted.rows[0],
      );
    } catch (error) {
      rollbackFailed = await rollbackTransaction(client, logger, "create-ticket-category", error);

      if (!rollbackFailed && error.code === "23505") {
        return sendError(res, 409, "Nama kategori tiket sudah digunakan.");
      }

      return next(error);
    } finally {
      releaseTransactionClient(client, rollbackFailed);
    }
  },
);

router.put(
  "/concerts/:concertId/ticket-categories/:categoryId",
  ...concertAdminGuard,
  async (req, res, next) => {
    if (
      !isValidConcertId(req.params.concertId) ||
      !isValidConcertId(req.params.categoryId)
    ) {
      return sendError(res, 400, "ID konser atau kategori tiket tidak valid.");
    }

    const body = req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return sendError(res, 400, "Data kategori tiket tidak valid.");
    }

    const allowedFields = ["name", "price", "quota"];
    const suppliedFields = Object.keys(body);

    if (
      suppliedFields.length === 0 ||
      suppliedFields.some((field) => !allowedFields.includes(field))
    ) {
      return sendError(res, 400, "Field perubahan kategori tidak valid.");
    }

    const updates = {};

    if (Object.hasOwn(body, "name")) {
      const name = validateCategoryName(body.name);

      if (!name) {
        return sendError(res, 400, "Nama kategori tiket tidak valid.");
      }

      updates.name = name;
    }

    if (Object.hasOwn(body, "price")) {
      const price = body.price;

      if (
        typeof price !== "number" ||
        !Number.isFinite(price) ||
        price < 0 ||
        price > MAX_CATEGORY_PRICE ||
        Math.abs(price * 100 - Math.round(price * 100)) > 0.000001
      ) {
        return sendError(res, 400, "Harga kategori tiket tidak valid.");
      }

      updates.price = price;
    }

    if (Object.hasOwn(body, "quota")) {
      const quota = body.quota;

      if (
        typeof quota !== "number" ||
        !Number.isInteger(quota) ||
        quota < 0 ||
        quota > MAX_CATEGORY_QUOTA
      ) {
        return sendError(res, 400, "Kuota kategori tiket tidak valid.");
      }

      updates.quota = quota;
    }

    const client = await pool.connect();
    let rollbackFailed = false;

    try {
      await client.query("BEGIN");

      const categoryResult = await client.query(
        `SELECT tc.id,tc.concert_id
         FROM ticket_categories AS tc
         JOIN concerts AS c ON c.id = tc.concert_id
         WHERE c.id = $1::bigint
           AND tc.id = $2::bigint
           AND c.archived_at IS NULL
           AND c.cancelled_at IS NULL
           AND tc.archived_at IS NULL
         FOR UPDATE OF tc, c`,
        [req.params.concertId, req.params.categoryId],
      );

      if (categoryResult.rowCount === 0) {
        rollbackFailed = await rollbackTransaction(client, logger, "update-ticket-category");
        if (rollbackFailed) return next(new Error("Admin transaction rollback failed."));
        return sendError(res, 404, "Kategori tiket tidak ditemukan.");
      }

      const category = categoryResult.rows[0];

      if (Object.hasOwn(updates, "name")) {
        const duplicateResult = await client.query(
          `SELECT id
           FROM ticket_categories
           WHERE concert_id = $1::bigint
             AND LOWER(name) = LOWER($2)
             AND id <> $3::bigint
           LIMIT 1`,
          [category.concert_id, updates.name, req.params.categoryId],
        );

        if (duplicateResult.rowCount > 0) {
          rollbackFailed = await rollbackTransaction(client, logger, "update-ticket-category");
          if (rollbackFailed) return next(new Error("Admin transaction rollback failed."));
          return sendError(res, 409, "Nama kategori sudah digunakan.");
        }
      }

      const values = [];
      const assignments = [];

      for (const field of ["name", "price", "quota"]) {
        if (!Object.hasOwn(updates, field)) continue;

        values.push(updates[field]);
        assignments.push(`${field} = $${values.length}`);
      }

      values.push(req.params.categoryId);
      const categoryIdParameter = values.length;
      values.push(req.params.concertId);
      const concertIdParameter = values.length;

      const updateResult = await client.query(
        `UPDATE ticket_categories
         SET ${assignments.join(", ")}
         WHERE id = $${categoryIdParameter}::bigint
           AND concert_id = $${concertIdParameter}::bigint
         RETURNING
           id::text AS id,
           concert_id::text AS "concertId",
           name,
           price::double precision AS price,
           quota`,
        values,
      );

      if (updateResult.rowCount !== 1) {
        rollbackFailed = await rollbackTransaction(client, logger, "update-ticket-category");
        if (rollbackFailed) return next(new Error("Admin transaction rollback failed."));
        return sendError(res, 404, "Kategori tiket tidak ditemukan.");
      }

      await client.query("COMMIT");

      return sendSuccess(
        res,
        200,
        "Kategori tiket berhasil diperbarui.",
        updateResult.rows[0],
      );
    } catch (error) {
      rollbackFailed = await rollbackTransaction(client, logger, "update-ticket-category", error);

      return next(error);
    } finally {
      releaseTransactionClient(client, rollbackFailed);
    }
  },
);

router.delete(
  "/ticket-categories/:categoryId",
  ...concertAdminGuard,
  async (req, res, next) => {
    if (!isValidConcertId(req.params.categoryId)) {
      return sendError(res, 400, "ID kategori tiket tidak valid.");
    }

    const client = await pool.connect();
    let rollbackFailed = false;

    try {
      await client.query("BEGIN");

      const categoryResult = await client.query(
        `SELECT tc.id,tc.concert_id
         FROM ticket_categories AS tc
         JOIN concerts AS c ON c.id = tc.concert_id
         WHERE tc.id = $1::bigint
           AND c.archived_at IS NULL
           AND c.cancelled_at IS NULL
         FOR UPDATE OF tc, c`,
        [req.params.categoryId],
      );

      if (categoryResult.rowCount === 0) {
        rollbackFailed = await rollbackTransaction(client, logger, "archive-ticket-category");
        if (rollbackFailed) return next(new Error("Admin transaction rollback failed."));
        return sendError(res, 404, "Kategori tiket tidak ditemukan.");
      }

      const result = await client.query(
        `UPDATE ticket_categories
         SET archived_at = COALESCE(archived_at, NOW())
         WHERE id = $1::bigint
         RETURNING id::text AS id`,
        [req.params.categoryId],
      );

      if (result.rowCount !== 1) {
        rollbackFailed = await rollbackTransaction(client, logger, "archive-ticket-category");
        if (rollbackFailed) return next(new Error("Admin transaction rollback failed."));
        return sendError(res, 404, "Kategori tiket tidak ditemukan.");
      }

      await client.query("COMMIT");

      return sendSuccess(
        res,
        200,
        "Kategori tiket berhasil dinonaktifkan.",
        result.rows[0],
      );
    } catch (error) {
      rollbackFailed = await rollbackTransaction(client, logger, "archive-ticket-category", error);

      return next(error);
    } finally {
      releaseTransactionClient(client, rollbackFailed);
    }
  },
);

router.post(
  "/ticket-categories/:categoryId/restore",
  ...concertAdminGuard,
  async (req, res, next) => {
    if (!isValidConcertId(req.params.categoryId)) {
      return sendError(res, 400, "ID kategori tiket tidak valid.");
    }

    const client = await pool.connect();
    let rollbackFailed = false;

    try {
      await client.query("BEGIN");

      const categoryResult = await client.query(
        `SELECT tc.id,tc.concert_id
         FROM ticket_categories AS tc
         JOIN concerts AS c ON c.id = tc.concert_id
         WHERE tc.id = $1::bigint
           AND c.archived_at IS NULL
           AND c.cancelled_at IS NULL
         FOR UPDATE OF tc, c`,
        [req.params.categoryId],
      );

      if (categoryResult.rowCount === 0) {
        rollbackFailed = await rollbackTransaction(client, logger, "restore-ticket-category");
        if (rollbackFailed) return next(new Error("Admin transaction rollback failed."));
        return sendError(res, 404, "Kategori tiket tidak ditemukan.");
      }

      const result = await client.query(
        `UPDATE ticket_categories
         SET archived_at = NULL
         WHERE id = $1::bigint
           AND archived_at IS NOT NULL
         RETURNING id::text AS id`,
        [req.params.categoryId],
      );

      if (result.rowCount !== 1) {
        rollbackFailed = await rollbackTransaction(client, logger, "restore-ticket-category");
        if (rollbackFailed) return next(new Error("Admin transaction rollback failed."));
        return sendError(res, 409, "Kategori tiket sudah aktif.");
      }

      await client.query("COMMIT");

      return sendSuccess(
        res,
        200,
        "Kategori tiket berhasil dipulihkan.",
        result.rows[0],
      );
    } catch (error) {
      rollbackFailed = await rollbackTransaction(client, logger, "restore-ticket-category", error);

      return next(error);
    } finally {
      releaseTransactionClient(client, rollbackFailed);
    }
  },
);

  return router;
}

export default createAdminRouter();
