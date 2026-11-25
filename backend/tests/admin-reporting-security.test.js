import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createAdminRouter } from "../src/routes/admin.js";
import { generateSessionToken, hashSessionToken, SESSION_COOKIE_NAME } from "../src/utils/session.js";

async function withAdminApi({ role = "admin", authenticated = true } = {}, run) {
  const token = generateSessionToken(); const tokenHash = hashSessionToken(token); const calls = [];
  const pool = { async query(sql, values = []) {
    calls.push({ sql: sql.replace(/\s+/g, " ").trim(), values });
    if (sql.includes("FROM user_sessions")) return { rowCount: authenticated ? 1 : 0, rows: authenticated ? [{ id: "7", name: "Admin", email: "admin@example.test", role }] : [] };
    if (sql.includes("payment_status_history h")) return { rowCount: 1, rows: [{ booking_code: "KK-0123456789ABCDEF", previousStatus: null, newStatus: null, changedAt: null }] };
    if (sql.includes("AS total_users")) return { rowCount: 1, rows: [{ total_users: "15", total_concerts: "8", active_concerts: "6", archived_concerts: "2", total_bookings: "50", pending_bookings: "3", confirmed_bookings: "40", cancelled_bookings: "7", pending_payments: "3", paid_payments: "39", failed_payments: "4", expired_payments: "4", paid_amount: "1250000.00", issued_tickets: "82", used_tickets: "21" }] };
    if (sql.includes("FROM bookings b LEFT JOIN payments p") && sql.includes("COUNT(*)")) return { rowCount: 1, rows: [{ total: "51" }] };
    if (sql.includes("AS \"customerType\"")) return { rowCount: 1, rows: [{ bookingCode: "KK-0123456789ABCDEF", customerName: "Test Customer", customerType: "customer", quantity: 2, totalPrice: "500", bookingStatus: "confirmed", paymentStatus: "paid", concertTitle: "Test Concert", ticketCategory: "VIP" }] };
    if (sql.includes("AS tickets")) return { rowCount: 1, rows: [{ bookingCode: "KK-0123456789ABCDEF", quantity: 2, totalPrice: "500", amount: "500", bookingStatus: "confirmed", paymentStatus: "paid", tickets: [{ ticketCode: "KK-TKT-OPAQUE", ticketNumber: 1, status: "used", validatorName: "Admin" }] }] };
    if (sql.includes("WITH booking_stats AS")) return { rowCount: 1, rows: [{ concertId: "9", concertTitle: "Test Concert", bookingCount: "7", ticketQuantity: "12", activeTicketQuantity: "4", paidPaymentCount: "6", paidAmount: "1500.00", availableQuota: "20" }] };
    if (sql.includes("COUNT(*)::bigint AS total FROM concerts")) return { rowCount: 1, rows: [{ total: "3" }] };
    if (sql.includes("date_trunc('day'") || sql.includes("date_trunc('month'")) return { rowCount: 1, rows: [{ period: "2026-01-01", bookingCount: "2", ticketQuantity: "3", paidPaymentCount: "1", paidAmount: "500" }] };
    if (sql.includes("COUNT(*)::bigint AS total FROM payments")) return { rowCount: 1, rows: [{ total: "4" }] };
    if (sql.includes("AS \"paymentId\"")) return { rowCount: 1, rows: [{ paymentId: "5", bookingCode: "KK-0123456789ABCDEF", paymentStatus: values[0] || "pending", amount: "500.00", paymentMethod: "simulation", createdAt: "2026-01-01T00:00:00Z", paidAt: null, expiresAt: "2026-01-01T00:15:00Z", concertTitle: "Test Concert" }] };
    if (sql.includes("AS \"bookingStatus\"")) return { rowCount: 1, rows: [{ bookingCode: "KK-0123456789ABCDEF", bookingStatus: "confirmed", concertTitle: "=HYPERLINK(1)", ticketCategory: "VIP", quantity: 2, totalPrice: "500.00", paymentStatus: "paid", createdAt: "2026-01-01T00:00:00Z" }] };
    if (sql.includes("AS \"paymentMethod\"")) return { rowCount: 1, rows: [{ bookingCode: "KK-0123456789ABCDEF", concertTitle: "Test", paymentStatus: "paid", amount: "500.00", paymentMethod: "simulation", createdAt: "2026-01-01T00:00:00Z", paidAt: "2026-01-01T00:01:00Z" }] };
    if (sql.includes("WITH paid AS")) return { rowCount: 1, rows: [{ title: "Test Concert", bookings: "2", paid_orders: "1", tickets_sold: "3", gross_sales: "500.00", available_quota: "20" }] };
    throw new Error(`Query admin reporting tidak dikenal: ${sql}`);
  } };
  const app = express(); app.use(express.json()); app.use("/api/admin", createAdminRouter({ pool }));
  const server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`, `${SESSION_COOKIE_NAME}=${token}`, calls); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

const headers = (cookie) => ({ Cookie: cookie });

test("dashboard admin mengembalikan statistik source-based termasuk paid saja untuk nominal", async () => withAdminApi({}, async (base, cookie, calls) => {
  const response = await fetch(`${base}/api/admin/dashboard`, { headers: headers(cookie) }); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.data.activeConcerts, "6"); assert.equal(body.data.pendingBookings, "3"); assert.equal(body.data.paymentCounts.expired, "4"); assert.equal(body.data.paidAmount, "1250000.00"); assert.equal(body.data.issuedTickets, "82"); assert.equal(calls.filter((call) => call.sql.includes("AS total_users")).length, 1);
  assert.equal(body.data.definitions.activeConcerts, "Konser dengan archived_at NULL dan cancelled_at NULL.");
}));

test("dashboard dan semua laporan menolak guest dan customer", async () => {
  await withAdminApi({ authenticated: false }, async (base) => { assert.equal((await fetch(`${base}/api/admin/dashboard`)).status, 401); });
  await withAdminApi({ role: "customer" }, async (base, cookie) => { assert.equal((await fetch(`${base}/api/admin/reports/payments`, { headers: headers(cookie) })).status, 403); });
});

test("laporan pesanan memfilter dan memaginasi tanpa menyisipkan input ke SQL", async () => withAdminApi({}, async (base, cookie, calls) => {
  const response = await fetch(`${base}/api/admin/orders?status=confirmed&bookingCode=KK-012&customer=Alice&from=2026-01-01&to=2026-01-31&sort=totalPrice&direction=asc&page=2&limit=10`, { headers: headers(cookie) });
  const body = await response.json(); const dataQuery = calls.find((call) => call.sql.includes('AS "customerType"'));
  assert.equal(response.status, 200); assert.equal(body.data.page, 2); assert.equal(body.data.totalPages, 6); assert.equal(body.data.orders[0].customerType, "customer");
  assert.equal(/password_hash|session_token_hash|ticket_code/.test(JSON.stringify(body)), false);
  assert.equal(Object.hasOwn(body.data.orders[0], "customerEmail"), false);
  assert.ok(dataQuery.sql.includes("b.status=$1")); assert.ok(dataQuery.sql.includes("b.booking_code ILIKE $2")); assert.equal(dataQuery.values[2], "%Alice%"); assert.ok(dataQuery.sql.includes("ORDER BY b.total_price ASC"));
}));

test("order customer search treats SQL injection input as a parameter", async () => withAdminApi({}, async (base, cookie, calls) => {
  const payload = "' OR 1=1--";
  const response = await fetch(`${base}/api/admin/orders?customer=${encodeURIComponent(payload)}`, { headers: headers(cookie) });
  assert.equal(response.status, 200);
  const query = calls.find((call) => call.sql.includes('AS "customerType"'));
  assert.equal(query.sql.includes(payload), false); assert.ok(query.values.includes(`%${payload}%`));
}));

test("detail pesanan menggabungkan status, nominal payment, tiket dan petugas dari sumber database", async () => withAdminApi({}, async (base, cookie) => {
  const response = await fetch(`${base}/api/admin/orders/KK-0123456789ABCDEF`, { headers: headers(cookie) });
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.data.bookingStatus, "confirmed");
  assert.equal(body.data.amount, "500"); assert.equal(body.data.tickets[0].ticketCode, "KK-TKT-OPAQUE"); assert.equal(body.data.tickets[0].validatorName, "Admin");
}));

test("laporan pesanan menolak status, tanggal, sorting dan query yang malformed", async () => withAdminApi({}, async (base, cookie, calls) => {
  for (const query of ["status=paid", "sort=created_at%3BDROP", "from=2026-02-30", "page=0", "customer=%00"]) {
    const response = await fetch(`${base}/api/admin/orders?${query}`, { headers: headers(cookie) }); assert.equal(response.status, 400, query);
  }
  assert.equal(calls.filter((call) => call.sql.includes("AS \"customerType\"")).length, 0);
}));

test("laporan pembayaran menerima setiap status aktual dan tidak mengubah status", async () => withAdminApi({}, async (base, cookie, calls) => {
  for (const status of ["pending", "paid", "failed", "expired"]) {
    const response = await fetch(`${base}/api/admin/reports/payments?status=${status}`, { headers: headers(cookie) }); const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.data.payments[0].paymentStatus, status);
  }
  const paymentCalls = calls.filter((call) => call.sql.includes("AS \"paymentId\""));
  assert.equal(paymentCalls.length, 4); assert.ok(paymentCalls.every((call) => call.sql.includes("p.status=$1")));
}));

test("analitik konser menggunakan agregasi terpisah dan tren menetapkan timezone UTC", async () => withAdminApi({}, async (base, cookie, calls) => {
  const analytics = await fetch(`${base}/api/admin/analytics/concerts?from=2026-01-01&to=2026-01-31&limit=5`, { headers: headers(cookie) }); const analyticsBody = await analytics.json();
  assert.equal(analytics.status, 200); assert.equal(analyticsBody.data.concerts[0].ticketQuantity, "12");
  const query = calls.find((call) => call.sql.includes("WITH booking_stats AS")); assert.match(query.sql, /paid_stats AS/); assert.match(query.sql, /inventory AS/); assert.match(query.sql, /p\.paid_at AT TIME ZONE 'UTC'\) >= \$1::date/); assert.deepEqual(query.values, ["2026-01-01", "2026-01-31", 5, 0]);
  const trends = await fetch(`${base}/api/admin/analytics/trends?from=2026-01-01&to=2026-01-31&interval=day`, { headers: headers(cookie) }); const trendBody = await trends.json();
  assert.equal(trends.status, 200); assert.equal(trendBody.data.timezone, "UTC"); assert.equal(trendBody.data.points[0].paidAmount, "500");
  assert.equal((await fetch(`${base}/api/admin/analytics/trends?from=2026-01-01&to=2027-06-01&interval=day`, { headers: headers(cookie) })).status, 400);
}));

test("customer tidak dapat mengakses semua endpoint operasi admin baru", async () => withAdminApi({ role: "customer" }, async (base, cookie) => {
  const paths = ["/api/admin/users", "/api/admin/payments/KK-0123456789ABCDEF/history", "/api/admin/exports/orders.csv", "/api/admin/exports/payments.csv", "/api/admin/exports/concert-performance.csv?from=2026-01-01&to=2026-01-02"];
  for (const path of paths) assert.equal((await fetch(`${base}${path}`, { headers: headers(cookie) })).status, 403, path);
}));

test("payment history only returns recorded transitions and identifies its start boundary", async () => withAdminApi({}, async (base, cookie, calls) => {
  const response = await fetch(`${base}/api/admin/payments/KK-0123456789ABCDEF/history`, { headers: headers(cookie) });
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.data.events.length, 0);
  assert.match(body.data.availableSince, /tidak direka ulang/);
  assert.ok(calls.some((call) => call.sql.includes("LEFT JOIN payment_status_history")));
}));

test("CSV export applies parameterized filters, emits headers, and neutralizes formulas", async () => withAdminApi({}, async (base, cookie, calls) => {
  const response = await fetch(`${base}/api/admin/exports/orders.csv?status=confirmed&from=2026-01-01&to=2026-01-31`, { headers: headers(cookie) });
  const csv = await response.text(); assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /text\/csv/);
  assert.match(csv, /"booking_code","booking_status"/); assert.match(csv, /'=HYPERLINK/);
  const query = calls.find((call) => call.sql.includes('AS "bookingStatus"'));
  assert.ok(query.sql.includes("b.status=$1")); assert.deepEqual(query.values, ["confirmed", "2026-01-01", "2026-01-31"]);
  const performance = await fetch(`${base}/api/admin/exports/concert-performance.csv?from=2026-01-01&to=2026-01-31`, { headers: headers(cookie) });
  assert.equal(performance.status, 200); assert.match(await performance.text(), /gross_sales_paid_in_period/);
  const invalid = await fetch(`${base}/api/admin/exports/payments.csv?from=2026-02-30&to=2026-03-01`, { headers: headers(cookie) }); assert.equal(invalid.status, 400);
}));
