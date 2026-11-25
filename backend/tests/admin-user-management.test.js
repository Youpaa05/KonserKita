import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createAdminRouter } from "../src/routes/admin.js";
import { generateSessionToken, hashSessionToken, SESSION_COOKIE_NAME } from "../src/utils/session.js";

async function withApi({ role = "admin", authenticated = true, adminCount = 2, targetRole = "customer" } = {}, run) {
  const calls = []; const token = generateSessionToken(); const tokenHash = hashSessionToken(token);
  const client = { async query(sql, values = []) {
    const query = sql.replace(/\s+/g, " ").trim(); calls.push({ query, values });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(query)) return { rowCount: null, rows: [] };
    if (query.startsWith("SELECT pg_advisory_xact_lock")) return { rowCount: null, rows: [] };
    if (query.startsWith("SELECT u.id, r.name AS role")) return { rowCount: 1, rows: [{ id: "9", role: targetRole }] };
    if (query.startsWith("SELECT COUNT(*)::int AS total FROM users")) return { rowCount: 1, rows: [{ total: adminCount }] };
    if (query.startsWith("UPDATE users SET role_id")) return { rowCount: 1, rows: [] };
    if (query.startsWith("UPDATE user_sessions SET revoked_at")) return { rowCount: 2, rows: [] };
    if (query.startsWith("INSERT INTO admin_role_change_audit")) return { rowCount: 1, rows: [] };
    throw new Error(`Query transaksi tidak dikenal: ${query}`);
  }, release() {} };
  const pool = {
    async query(sql, values = []) {
      const query = sql.replace(/\s+/g, " ").trim(); calls.push({ query, values });
      if (query.includes("FROM user_sessions")) return { rowCount: authenticated ? 1 : 0, rows: authenticated ? [{ id: "7", name: "Admin", email: "admin@example.test", role }] : [] };
      if (query.includes("SELECT COUNT(*)::bigint AS total FROM users")) return { rowCount: 1, rows: [{ total: "1" }] };
      if (query.includes("SELECT COUNT(*)::bigint AS total FROM admin_role_change_audit")) return { rowCount: 1, rows: [{ total: "1" }] };
      if (query.includes("FROM admin_role_change_audit a")) return { rowCount: 1, rows: [{ id: "3", previousRole: "customer", newRole: "admin", affectedSessions: 2, changedAt: new Date("2026-01-02T03:04:00Z"), actorName: "Admin", actorEmail: "admin@example.test", targetName: "Customer", targetEmail: "customer@example.test" }] };
      if (query.includes("FROM users u JOIN roles r") && query.includes("ORDER BY u.created_at")) return { rowCount: 1, rows: [{ id: "9", name: "Customer", email: "customer@example.test", role: "customer", createdAt: new Date("2026-01-01T00:00:00Z") }] };
      throw new Error(`Query pool tidak dikenal: ${query}`);
    },
    async connect() { return client; },
  };
  const app = express(); app.use(express.json()); app.use("/api/admin", createAdminRouter({ pool }));
  app.use((error, _req, res, _next) => res.status(500).json({ success: false, message: "Internal server error." }));
  const server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`, `${SESSION_COOKIE_NAME}=${token}`, calls); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("admin user list is searchable and never returns password/session fields", async () => withApi({}, async (base, cookie, calls) => {
  const response = await fetch(`${base}/api/admin/users?q=Cust&role=customer`, { headers: { Cookie: cookie } });
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.data.users[0].email, "customer@example.test");
  assert.doesNotMatch(JSON.stringify(body), /password_hash|session_token_hash/);
  const query = calls.find((entry) => entry.query.includes("ORDER BY u.created_at")); assert.deepEqual(query.values.slice(0, 2), ["%Cust%", "customer"]);
}));

test("customers and unauthenticated users cannot access user management", async () => {
  await withApi({ authenticated: false }, async (base) => assert.equal((await fetch(`${base}/api/admin/users`)).status, 401));
  await withApi({ role: "customer" }, async (base, cookie) => assert.equal((await fetch(`${base}/api/admin/users`, { headers: { Cookie: cookie } })).status, 403));
});

test("role change audit is paginated and restricted to admins", async () => {
  await withApi({}, async (base, cookie, calls) => {
    const response = await fetch(`${base}/api/admin/audit/role-changes?page=1&limit=10`, { headers: { Cookie: cookie } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.events[0].previousRole, "customer");
    assert.equal(body.data.events[0].affectedSessions, 2);
    assert.equal(body.data.total, 1);
    assert.deepEqual(calls.find(({ query }) => query.includes("FROM admin_role_change_audit a")).values, [10, 0]);
  });
  await withApi({ authenticated: false }, async (base) => assert.equal((await fetch(`${base}/api/admin/audit/role-changes`)).status, 401));
  await withApi({ role: "customer" }, async (base, cookie) => assert.equal((await fetch(`${base}/api/admin/audit/role-changes`, { headers: { Cookie: cookie } })).status, 403));
});

test("role changes reject invalid role and preserve the last admin", async () => {
  await withApi({}, async (base, cookie, calls) => {
    const response = await fetch(`${base}/api/admin/users/9/role`, { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ role: "owner" }) });
    assert.equal(response.status, 400); assert.equal(calls.some(({ query }) => query.startsWith("BEGIN")), false);
  });
  await withApi({ adminCount: 1, targetRole: "admin" }, async (base, cookie, calls) => {
    const response = await fetch(`${base}/api/admin/users/9/role`, { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ role: "customer" }) });
    assert.equal(response.status, 409); assert.equal(calls.some(({ query }) => query.startsWith("UPDATE users SET role_id")), false);
  });
});

test("role changes revoke target sessions and persist an audit event transactionally", async () => withApi({}, async (base, cookie, calls) => {
  const response = await fetch(`${base}/api/admin/users/9/role`, { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ role: "admin" }) });
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.data.revokedSessions, 2);
  assert.ok(calls.some(({ query }) => query.startsWith("SELECT pg_advisory_xact_lock")));
  assert.ok(calls.some(({ query }) => query.startsWith("UPDATE user_sessions SET revoked_at")));
  assert.ok(calls.some(({ query }) => query.startsWith("INSERT INTO admin_role_change_audit")));
}));
