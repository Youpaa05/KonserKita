import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import express from "express";
import { createServer } from "node:http";
import { createAdminRouter } from "../src/routes/admin.js";
import { createAdminTicketRouter } from "../src/routes/adminTickets.js";
import { generateSessionToken, hashSessionToken, SESSION_COOKIE_NAME } from "../src/utils/session.js";
import { EXPECTED_MIGRATION_FILES } from "../scripts/internal/neon-migration-engine.js";

const { Pool } = pg;
const databaseUrl = process.env.KONSERKITA_MIGRATION_TEST_DATABASE_URL;
const here = path.dirname(fileURLToPath(import.meta.url));

test("PostgreSQL isolated migrations create role audit and record real payment transitions", { skip: !databaseUrl }, async () => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(target.hostname.replace(/^\[|\]$/g, "").toLowerCase()), "migration integration requires loopback only");
  assert.ok(["konserkita_batch4_migration_test", "konserkita_batch4_migration_api_test", "konserkita_batch4_ticket_race_test"].includes(decodeURIComponent(target.pathname.slice(1))), "must use a dedicated empty migration test database");
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const existing = await pool.query("SELECT count(*)::int AS total FROM pg_tables WHERE schemaname='public'");
    assert.equal(existing.rows[0].total, 0, "dedicated migration database must be empty");
    const schema = await readFile(path.resolve(here, "../database/schema.sql"), "utf8");
    await pool.query(schema);
    const migrationDir = path.resolve(here, "../database/migrations");
    const files = (await readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort();
    assert.deepEqual(files, [...EXPECTED_MIGRATION_FILES]);
    for (const file of files) await pool.query(await readFile(path.join(migrationDir, file), "utf8"));

    const adminRole = await pool.query("SELECT id FROM roles WHERE name='admin'");
    const customerRole = await pool.query("SELECT id FROM roles WHERE name='customer'");
    const user = await pool.query("INSERT INTO users(role_id,name,email,password_hash) VALUES($1,'Test Admin','migration@example.test','scrypt:test') RETURNING id", [adminRole.rows[0].id]);
    const customer = await pool.query("INSERT INTO users(role_id,name,email,password_hash) VALUES($1,'Test Customer','customer-migration@example.test','scrypt:test') RETURNING id", [customerRole.rows[0].id]);
    const concert = await pool.query(`INSERT INTO concerts(slug,title,artist,category,city,venue,event_date,event_time,image_url,description) VALUES('migration-test','Migration Test','Test','Music','City','Venue','2030-01-01','19:00','https://example.test/poster','Fixture') RETURNING id`);
    const category = await pool.query("INSERT INTO ticket_categories(concert_id,name,price,quota) VALUES($1,'General',100,10) RETURNING id", [concert.rows[0].id]);
    const booking = await pool.query(`INSERT INTO bookings(booking_code,user_id,ticket_category_id,customer_name,customer_email,quantity,unit_price,status) VALUES('KK-ABCDEF0123456789',$1,$2,'Test Admin','migration@example.test',1,100,'pending') RETURNING id`, [user.rows[0].id, category.rows[0].id]);
    const payment = await pool.query(`INSERT INTO payments(booking_id,amount,expires_at) VALUES($1,100,clock_timestamp()+interval '15 minutes') RETURNING id`, [booking.rows[0].id]);
    await pool.query("UPDATE payments SET status='paid' WHERE id=$1", [payment.rows[0].id]);
    await pool.query("UPDATE payments SET status='paid' WHERE id=$1", [payment.rows[0].id]);
    const history = await pool.query("SELECT previous_status,new_status FROM payment_status_history WHERE payment_id=$1 ORDER BY id", [payment.rows[0].id]);
    assert.deepEqual(history.rows, [{ previous_status: "pending", new_status: "paid" }]);
    await pool.query("INSERT INTO admin_role_change_audit(actor_user_id,target_user_id,previous_role,new_role,affected_sessions) VALUES($1,$1,'admin','customer',0)", [user.rows[0].id]);
    const cancellation = await pool.query("SELECT cancelled_at,cancellation_reason FROM concerts WHERE id=$1", [concert.rows[0].id]);
    assert.equal(cancellation.rows[0].cancelled_at, null);

    const adminToken = generateSessionToken();
    await pool.query("INSERT INTO user_sessions(session_token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')", [hashSessionToken(adminToken), user.rows[0].id]);
    await pool.query("UPDATE bookings SET status='confirmed' WHERE id=$1", [booking.rows[0].id]);
    const ticketCode = `KK-TKT-${"C".repeat(64)}`;
    await pool.query("INSERT INTO digital_tickets(booking_id,ticket_number,ticket_code) VALUES($1,1,$2)", [booking.rows[0].id, ticketCode]);
    const app = express(); app.use(express.json()); app.use("/api/admin", createAdminRouter({ pool })); app.use("/api/admin/tickets", createAdminTicketRouter({ pool }));
    const server = createServer(app); await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const cookie = `${SESSION_COOKIE_NAME}=${adminToken}`;
      const scan = () => fetch(`${base}/api/admin/tickets/validate`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ ticketCode }) });
      const scans = await Promise.all([scan(), scan()]);
      assert.deepEqual(scans.map((response) => response.status).sort(), [200, 409]);
      const usedTicket = await pool.query("SELECT status,used_by,used_at FROM digital_tickets WHERE ticket_code=$1", [ticketCode]);
      assert.equal(usedTicket.rows[0].status, "used"); assert.equal(String(usedTicket.rows[0].used_by), String(user.rows[0].id)); assert.ok(usedTicket.rows[0].used_at);
      const users = await fetch(`${base}/api/admin/users?role=customer`, { headers: { Cookie: cookie } });
      assert.equal(users.status, 200);
      const listed = await users.json(); assert.ok(listed.data.users.some((item) => item.email === "customer-migration@example.test"));
      const promote = await fetch(`${base}/api/admin/users/${customer.rows[0].id}/role`, { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ role: "admin" }) });
      assert.equal(promote.status, 200);
      const oldCustomerSession = await pool.query("SELECT count(*)::int AS total FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL", [customer.rows[0].id]);
      assert.equal(oldCustomerSession.rows[0].total, 0);

      const remainingAdminToken = generateSessionToken();
      await pool.query("INSERT INTO user_sessions(session_token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')", [hashSessionToken(remainingAdminToken), customer.rows[0].id]);
      const remainingAdminCookie = `${SESSION_COOKIE_NAME}=${remainingAdminToken}`;
      const demoteOther = await fetch(`${base}/api/admin/users/${user.rows[0].id}/role`, { method: "PATCH", headers: { Cookie: remainingAdminCookie, "Content-Type": "application/json" }, body: JSON.stringify({ role: "customer" }) });
      assert.equal(demoteOther.status, 200);
      const lastAdmin = await fetch(`${base}/api/admin/users/${customer.rows[0].id}/role`, { method: "PATCH", headers: { Cookie: remainingAdminCookie, "Content-Type": "application/json" }, body: JSON.stringify({ role: "customer" }) });
      assert.equal(lastAdmin.status, 409);
      const roleAudit = await pool.query("SELECT count(*)::int AS total FROM admin_role_change_audit"); assert.equal(roleAudit.rows[0].total, 3);
    } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  } finally { await pool.end(); }
});
