import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createCustomerRouter } from "../src/routes/customer.js";
import { createAuthRouter } from "../src/routes/auth.js";
import { createBookingRouter } from "../src/routes/bookings.js";
import { hashPassword, verifyPassword } from "../src/utils/password.js";
import { generateSessionToken, hashSessionToken, SESSION_COOKIE_NAME } from "../src/utils/session.js";

async function serve(router, prefix, run) {
  const app = express(); app.use(express.json()); app.use(prefix, router);
  app.use((_error, _req, res, _next) => {
    res.status(500).json({ success: false, message: "Terjadi kesalahan pada server." });
  });
  const server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function customerHarness(run, { role = "customer", authenticated = true } = {}) {
  const token = generateSessionToken(); const tokenHash = hashSessionToken(token); const favorites = new Set(); const calls = [];
  const pool = { async query(sql, values = []) {
    const query = sql.replace(/\s+/g, " ").trim(); calls.push({ query, values });
    if (query.includes("FROM user_sessions")) return { rowCount: authenticated ? 1 : 0, rows: authenticated ? [{ id: "12", name: "Test User", email: "test@example.test", role }] : [] };
    if (query.startsWith("SELECT id FROM concerts")) return { rowCount: values[0] === "9" ? 1 : 0, rows: values[0] === "9" ? [{ id: "9" }] : [] };
    if (query.startsWith("INSERT INTO concert_favorites")) { favorites.add(`${values[0]}:${values[1]}`); return { rowCount: 1, rows: [] }; }
    if (query.startsWith("DELETE FROM concert_favorites")) { favorites.delete(`${values[0]}:${values[1]}`); return { rowCount: 1, rows: [] }; }
    if (query.startsWith("SELECT id::text AS id, name, email, created_at")) return { rowCount: 1, rows: [{ id: "12", name: "Test User", email: "test@example.test", createdAt: "2026-01-01" }] };
    if (query.startsWith("UPDATE users SET name=")) { if (values[0] === "evil") { const error = new Error("unique"); error.code = "23505"; throw error; } return { rowCount: 1, rows: [{ id: "12", name: values[0], email: values[1] }] }; }
    if (query.includes("COUNT(*)::int AS count FROM user_notifications")) return { rowCount: 1, rows: [{ count: 2 }] };
    if (query.includes("COUNT(*)::int AS total FROM user_notifications")) return { rowCount: 1, rows: [{ total: 1 }] };
    if (query.includes("FROM user_notifications") && query.startsWith("SELECT id::text")) return { rowCount: 1, rows: [{ id: "4", type: "booking_created", title: "Pesanan", message: "Menunggu pembayaran", bookingCode: "KK-0123456789ABCDEF", createdAt: "2026-01-01", readAt: null }] };
    if (query.startsWith("UPDATE user_notifications")) return values[0] === "4" && values[1] === "12" ? { rowCount: 1, rows: [{ id: values[0], readAt: "2026-01-02" }] } : { rowCount: 0, rows: [] };
    throw new Error(`Query customer test tidak dikenal: ${query}`);
  } };
  const router = createCustomerRouter({ pool });
  return serve(router, "/api/customer", async (base) => run(base, token, calls, favorites));
}

function authHarness(run, { rollbackFails = false, failSessionRevocation = false } = {}) {
  const token = generateSessionToken(); const tokenHash = hashSessionToken(token); const oldHash = hashPassword("Current-Password-123");
  return oldHash.then((hash) => {
    let currentHash = hash; let revoked = 0; const calls = []; const rollbackLogs = []; let releasedWithError = false;
    const pool = {
      async query(sql, values = []) { if (sql.includes("FROM user_sessions")) return { rowCount: values[0] === tokenHash ? 1 : 0, rows: [{ id: "12", name: "User", email: "user@example.test", role: "customer" }] }; throw new Error(`Pool query tidak dikenal: ${sql}`); },
      async connect() { return { async query(sql, values = []) { calls.push(sql); if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] }; if (sql === "ROLLBACK") { if (rollbackFails) throw Object.assign(new Error("sensitive rollback detail"), { code: "XX999" }); return { rows: [] }; } if (sql.includes("SELECT password_hash")) return { rowCount: 1, rows: [{ password_hash: currentHash }] }; if (sql.startsWith("UPDATE users SET password_hash")) { currentHash = values[0]; return { rowCount: 1, rows: [] }; } if (sql.startsWith("UPDATE user_sessions")) { if (failSessionRevocation) throw Object.assign(new Error("sensitive primary detail"), { code: "XX998" }); revoked += 1; return { rowCount: 1, rows: [] }; } throw new Error(`Client query tidak dikenal: ${sql}`); }, release(error) { releasedWithError = Boolean(error); } }; },
    };
    const logger = { error(...values) { rollbackLogs.push(values); } };
    return serve(createAuthRouter({ pool, logger }), "/api/auth", (base) => run(base, token, () => ({ currentHash, revoked, calls, rollbackLogs, releasedWithError })));
  });
}

const authHeaders = (token) => ({ Cookie: `${SESSION_COOKIE_NAME}=${token}` });

async function bookingNotificationHarness(failNotification, run) {
  const token = generateSessionToken(); const tokenHash = hashSessionToken(token);
  const state = { quota: 10, booking: false, notifications: 0, committed: false };
  let snapshot;
  const category = { id: "9", name: "Reguler", price: "100", quota: 10, concert_slug: "tes", concert_title: "Konser Tes" };
  const pool = {
    async query(sql, values = []) {
      if (sql.includes("FROM user_sessions")) return { rowCount: values[0] === tokenHash ? 1 : 0, rows: [{ id: "12", name: "Test User", email: "test@example.test", role: "customer" }] };
      throw new Error(`Pool query tidak dikenal: ${sql}`);
    },
    async connect() { return {
      async query(sql, values = []) {
        const query = sql.replace(/\s+/g, " ").trim();
        if (query === "BEGIN") { snapshot = { ...state }; return { rows: [] }; }
        if (query === "COMMIT") { state.committed = true; snapshot = null; return { rows: [] }; }
        if (query === "ROLLBACK") { if (snapshot) Object.assign(state, snapshot); snapshot = null; return { rows: [] }; }
        if (query.startsWith("SELECT tc.id")) return { rowCount: 1, rows: [category] };
        if (query.startsWith("INSERT INTO bookings")) { state.booking = true; return { rowCount: 1, rows: [{ id: "101", bookingCode: "KK-0123456789ABCDEF", customerName: "Test User", quantity: 2, unitPrice: 100, totalPrice: 200, status: "pending", createdAt: "2026-01-01" }] }; }
        if (query.startsWith("UPDATE ticket_categories")) { state.quota -= values[0]; return { rowCount: 1, rows: [{ quota: state.quota }] }; }
        if (query.startsWith("INSERT INTO payments")) return { rowCount: 1, rows: [] };
        if (query.startsWith("INSERT INTO user_notifications")) { if (failNotification) throw new Error("notification unavailable"); state.notifications += 1; return { rowCount: 1, rows: [] }; }
        throw new Error(`Client query tidak dikenal: ${query}`);
      }, release() {},
    }; },
  };
  const router = createBookingRouter({ pool, generateBookingCode: () => "KK-0123456789ABCDEF", logger: { error() {} } });
  await serve(router, "/api/bookings", (base) => run(base, token, state));
}

test("wishlist idempotent per customer dan menghapus milik customer saja", async () => customerHarness(async (base, token, calls, favorites) => {
  for (let i = 0; i < 2; i++) { const response = await fetch(`${base}/api/customer/favorites/9`, { method: "POST", headers: authHeaders(token) }); assert.equal(response.status, 200); }
  assert.equal(favorites.size, 1);
  assert.equal(calls.filter(({ query }) => query.includes("ON CONFLICT (user_id, concert_id) DO NOTHING")).length, 2);
  const missing = await fetch(`${base}/api/customer/favorites/10`, { method: "POST", headers: authHeaders(token) }); assert.equal(missing.status, 404);
  const removed = await fetch(`${base}/api/customer/favorites/9`, { method: "DELETE", headers: authHeaders(token) }); assert.equal(removed.status, 200); assert.equal(favorites.size, 0);
}));

test("wishlist, profil, dan notifikasi menolak guest dan role lain", async () => {
  await customerHarness(async (base) => { assert.equal((await fetch(`${base}/api/customer/favorites`)).status, 401); }, { authenticated: false });
  await customerHarness(async (base, token) => { assert.equal((await fetch(`${base}/api/customer/profile`, { headers: authHeaders(token) })).status, 403); }, { role: "admin" });
});

test("profil hanya menerima nama dan email dan tidak mengembalikan hash", async () => customerHarness(async (base, token) => {
  const response = await fetch(`${base}/api/customer/profile`, { method: "PATCH", headers: { ...authHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify({ name: "Nama Baru", role: "admin" }) });
  assert.equal(response.status, 400);
  const success = await fetch(`${base}/api/customer/profile`, { method: "PATCH", headers: { ...authHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify({ name: "Nama Baru", email: "new@example.test" }) });
  const body = await success.json(); assert.equal(success.status, 200); assert.equal(body.data.name, "Nama Baru"); assert.equal(JSON.stringify(body).includes("password_hash"), false);
}));

test("authenticated mutations reject untrusted or missing production Origin", async () => customerHarness(async (base, token) => {
  const originalEnvironment = process.env.NODE_ENV;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  process.env.NODE_ENV = "production";
  process.env.FRONTEND_URL = "http://localhost:5173";
  try {
    const body = JSON.stringify({ name: "Nama Baru" });
    const headers = { ...authHeaders(token), "Content-Type": "application/json" };
    const untrusted = await fetch(`${base}/api/customer/profile`, {
      method: "PATCH",
      headers: { ...headers, Origin: "https://attacker.example" },
      body,
    });
    assert.equal(untrusted.status, 403);

    const missing = await fetch(`${base}/api/customer/profile`, {
      method: "PATCH",
      headers,
      body,
    });
    assert.equal(missing.status, 403);

    const trusted = await fetch(`${base}/api/customer/profile`, {
      method: "PATCH",
      headers: { ...headers, Origin: "http://localhost:5173" },
      body,
    });
    assert.equal(trusted.status, 200);
  } finally {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
  }
}));

test("notifikasi dipaginasi, dimiliki customer dan dapat ditandai dibaca", async () => customerHarness(async (base, token) => {
  const response = await fetch(`${base}/api/customer/notifications?page=1&limit=10`, { headers: authHeaders(token) }); const body = await response.json(); assert.equal(body.status, undefined); assert.equal(body.data.total, 1);
  assert.equal((await fetch(`${base}/api/customer/notifications/4/read`, { method: "PATCH", headers: authHeaders(token) })).status, 200);
  assert.equal((await fetch(`${base}/api/customer/notifications/5/read`, { method: "PATCH", headers: authHeaders(token) })).status, 404);
  assert.equal((await fetch(`${base}/api/customer/notifications/unread-count`, { headers: authHeaders(token) })).status, 200);
}));

test("ubah password menolak password saat ini salah dan tidak menyimpan plaintext", async () => authHarness(async (base, token, state) => {
  const headers = { ...authHeaders(token), Origin: "http://localhost:5173", "Content-Type": "application/json" };
  const bad = await fetch(`${base}/api/auth/password/change`, { method: "POST", headers, body: JSON.stringify({ currentPassword: "wrong-password", newPassword: "New-Password-123" }) }); assert.equal(bad.status, 400);
  const invalid = await fetch(`${base}/api/auth/password/change`, { method: "POST", headers, body: JSON.stringify({ currentPassword: "Current-Password-123", newPassword: "short" }) }); assert.equal(invalid.status, 400);
  const success = await fetch(`${base}/api/auth/password/change`, { method: "POST", headers, body: JSON.stringify({ currentPassword: "Current-Password-123", newPassword: "New-Password-123" }) });
  assert.equal(success.status, 200); assert.equal(state().revoked, 1); assert.notEqual(state().currentHash, "New-Password-123"); assert.equal(await verifyPassword("New-Password-123", state().currentHash), true); assert.match(success.headers.get("set-cookie") || "", /Expires=Thu, 01 Jan 1970/);
}));

test("kegagalan rollback perubahan password dicatat aman dan client dikeluarkan dari pool", async () => authHarness(async (base, token, state) => {
  const response = await fetch(`${base}/api/auth/password/change`, {
    method: "POST",
    headers: { ...authHeaders(token), Origin: "http://localhost:5173", "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: "Current-Password-123", newPassword: "New-Password-123" }),
  });
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.message, "Terjadi kesalahan pada server.");
  assert.equal(state().rollbackLogs.length, 1);
  assert.deepEqual(state().rollbackLogs[0][1], {
    operation: "change-password",
    name: "Error",
    code: "XX999",
  });
  assert.equal(JSON.stringify(state().rollbackLogs).includes("sensitive"), false);
  assert.equal(JSON.stringify(body).includes("sensitive"), false);
  assert.equal(state().releasedWithError, true);
}, { rollbackFails: true, failSessionRevocation: true }));

test("notifikasi booking hanya tersimpan bersama transaksi booking dan kuota", async () => {
  const payload = { customerName: "Test User", customerEmail: "test@example.test", ticketCategoryId: "9", quantity: 2 };
  await bookingNotificationHarness(false, async (base, token, state) => {
    const response = await fetch(`${base}/api/bookings`, { method: "POST", headers: { ...authHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal(response.status, 201); assert.equal(state.booking, true); assert.equal(state.quota, 8); assert.equal(state.notifications, 1); assert.equal(state.committed, true);
  });
  await bookingNotificationHarness(true, async (base, token, state) => {
    const response = await fetch(`${base}/api/bookings`, { method: "POST", headers: { ...authHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal(response.status, 500); assert.equal(state.booking, false); assert.equal(state.quota, 10); assert.equal(state.notifications, 0); assert.equal(state.committed, false);
  });
});
