import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import pg from "pg";
import { createPaymentRouter } from "../src/routes/payments.js";
import { generateSessionToken, hashSessionToken, SESSION_COOKIE_NAME } from "../src/utils/session.js";

const { Pool } = pg;
const databaseUrl = process.env.KONSERKITA_PAYMENT_TEST_DATABASE_URL;
const here = path.dirname(fileURLToPath(import.meta.url));

test("PostgreSQL payment simulation enforces ownership, expiry, atomic tickets, rollback, and idempotency", { skip: !databaseUrl }, async () => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(target.hostname.replace(/^\[|\]$/g, "").toLowerCase()));
  assert.ok(["konserkita_batch4_payment_test", "konserkita_batch4_payment_verify_test"].includes(decodeURIComponent(target.pathname.slice(1))));
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  let server;
  try {
    const existing = await pool.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'");
    assert.equal(existing.rows[0].count, 0, "payment integration database must be empty");
    await pool.query(await readFile(path.resolve(here, "../database/schema.sql"), "utf8"));
    const migrationDir = path.resolve(here, "../database/migrations");
    const migrations = (await readdir(migrationDir)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
    assert.equal(migrations.length, 11);
    for (const migration of migrations) await pool.query(await readFile(path.join(migrationDir, migration), "utf8"));

    const roles = await pool.query("SELECT id,name FROM roles WHERE name IN ('customer','admin')");
    const customerRole = roles.rows.find((row) => row.name === "customer").id;
    const customer = await pool.query("INSERT INTO users(role_id,name,email,password_hash) VALUES($1,'Integration Customer','payment-customer@example.test','test-only') RETURNING id", [customerRole]);
    const other = await pool.query("INSERT INTO users(role_id,name,email,password_hash) VALUES($1,'Other Customer','payment-other@example.test','test-only') RETURNING id", [customerRole]);
    const token = generateSessionToken();
    await pool.query("INSERT INTO user_sessions(session_token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')", [hashSessionToken(token), customer.rows[0].id]);
    const concert = await pool.query("INSERT INTO concerts(slug,title,artist,category,city,venue,event_date,event_time,image_url,description) VALUES($1,'Payment Integration','Test Artist','Music','Test City','Test Venue','2035-01-01','19:00','https://example.test/poster','Integration fixture') RETURNING id", [`payment-${randomBytes(4).toString("hex")}`]);
    const category = await pool.query("INSERT INTO ticket_categories(concert_id,name,price,quota) VALUES($1,'General',100,100) RETURNING id", [concert.rows[0].id]);

    async function createBooking({ quantity = 1, ownerId = customer.rows[0].id, expired = false, cancelled = false, mismatch = false } = {}) {
      const bookingCode = `KK-${randomBytes(8).toString("hex").toUpperCase()}`;
      const booking = await pool.query("INSERT INTO bookings(booking_code,user_id,ticket_category_id,customer_name,customer_email,quantity,unit_price) VALUES($1,$2,$3,'Integration Customer','payment-customer@example.test',$4,100) RETURNING id", [bookingCode, ownerId, category.rows[0].id, quantity]);
      await pool.query("UPDATE ticket_categories SET quota=quota-$1 WHERE id=$2", [quantity, category.rows[0].id]);
      await pool.query("INSERT INTO payments(booking_id,amount,payment_method,expires_at) VALUES($1,$2,'simulation',$3)", [booking.rows[0].id, mismatch ? 999 : quantity * 100, expired ? new Date(Date.now() - 1000) : new Date(Date.now() + 60_000)]);
      if (cancelled) await pool.query("UPDATE concerts SET cancelled_at=clock_timestamp(),cancellation_reason='Integration cancellation' WHERE id=$1", [concert.rows[0].id]);
      return { bookingCode, bookingId: booking.rows[0].id };
    }

    const app = express();
    app.use(express.json());
    app.use("/api/payments", createPaymentRouter({ pool, environment: { NODE_ENV: "development", PAYMENT_SIMULATION_ENABLED: "true" } }));
    app.use((error, _req, res, _next) => res.status(500).json({ success: false, message: "internal error" }));
    server = createServer(app);
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Cookie: `${SESSION_COOKIE_NAME}=${token}`, "Content-Type": "application/json" };
    const attempt = (bookingCode, outcome = "success", cookie = headers.Cookie) => fetch(`${base}/api/payments/${bookingCode}/attempt`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ outcome }) });

    const paid = await createBooking({ quantity: 2 });
    const [first, duplicate] = await Promise.all([attempt(paid.bookingCode), attempt(paid.bookingCode)]);
    assert.deepEqual([first.status, duplicate.status], [200, 200]);
    const paidState = await pool.query("SELECT b.status AS booking_status,p.status AS payment_status,p.amount=b.total_price AS amount_matches,(SELECT count(*)::int FROM digital_tickets t WHERE t.booking_id=b.id) AS ticket_count FROM bookings b JOIN payments p ON p.booking_id=b.id WHERE b.id=$1", [paid.bookingId]);
    assert.deepEqual(paidState.rows[0], { booking_status: "confirmed", payment_status: "paid", amount_matches: true, ticket_count: 2 });
    const history = await pool.query("SELECT previous_status,new_status FROM payment_status_history h JOIN payments p ON p.id=h.payment_id WHERE p.booking_id=$1", [paid.bookingId]);
    assert.deepEqual(history.rows, [{ previous_status: "pending", new_status: "paid" }]);

    const failed = await createBooking();
    assert.equal((await attempt(failed.bookingCode, "failure")).status, 200);
    const failedState = await pool.query("SELECT b.status AS booking_status,p.status AS payment_status,p.quota_restored_at IS NOT NULL AS quota_restored FROM bookings b JOIN payments p ON p.booking_id=b.id WHERE b.id=$1", [failed.bookingId]);
    assert.deepEqual(failedState.rows[0], { booking_status: "cancelled", payment_status: "failed", quota_restored: true });

    const expired = await createBooking({ expired: true });
    assert.equal((await attempt(expired.bookingCode)).status, 409);
    const expiredState = await pool.query("SELECT b.status AS booking_status,p.status AS payment_status,p.quota_restored_at IS NOT NULL AS quota_restored FROM bookings b JOIN payments p ON p.booking_id=b.id WHERE b.id=$1", [expired.bookingId]);
    assert.deepEqual(expiredState.rows[0], { booking_status: "cancelled", payment_status: "expired", quota_restored: true });

    const wrongOwner = await createBooking({ ownerId: other.rows[0].id });
    assert.equal((await attempt(wrongOwner.bookingCode)).status, 404);
    const mismatch = await createBooking({ mismatch: true });
    assert.equal((await attempt(mismatch.bookingCode)).status, 409);
    const mismatchState = await pool.query("SELECT b.status AS booking_status,p.status AS payment_status FROM bookings b JOIN payments p ON p.booking_id=b.id WHERE b.id=$1", [mismatch.bookingId]);
    assert.deepEqual(mismatchState.rows[0], { booking_status: "pending", payment_status: "pending" });

    const unauthenticated = await createBooking();
    assert.equal((await attempt(unauthenticated.bookingCode, "success", "")).status, 401);

    const rollback = await createBooking({ quantity: 2 });
    await pool.query(`CREATE FUNCTION public.fail_payment_test_ticket() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.booking_id=${Number(rollback.bookingId)} AND NEW.ticket_number=2 THEN RAISE EXCEPTION 'intentional integration rollback'; END IF; RETURN NEW; END $$`);
    await pool.query("CREATE TRIGGER fail_payment_test_ticket BEFORE INSERT ON digital_tickets FOR EACH ROW EXECUTE FUNCTION public.fail_payment_test_ticket()");
    assert.equal((await attempt(rollback.bookingCode)).status, 500);
    await pool.query("DROP TRIGGER fail_payment_test_ticket ON digital_tickets");
    await pool.query("DROP FUNCTION public.fail_payment_test_ticket()");
    const rollbackState = await pool.query("SELECT b.status AS booking_status,p.status AS payment_status,(SELECT count(*)::int FROM digital_tickets t WHERE t.booking_id=b.id) AS ticket_count FROM bookings b JOIN payments p ON p.booking_id=b.id WHERE b.id=$1", [rollback.bookingId]);
    assert.deepEqual(rollbackState.rows[0], { booking_status: "pending", payment_status: "pending", ticket_count: 0 });

    const cancelled = await createBooking({ cancelled: true });
    assert.equal((await attempt(cancelled.bookingCode)).status, 409);
    const cancelledState = await pool.query("SELECT b.status AS booking_status,p.status AS payment_status FROM bookings b JOIN payments p ON p.booking_id=b.id WHERE b.id=$1", [cancelled.bookingId]);
    assert.deepEqual(cancelledState.rows[0], { booking_status: "pending", payment_status: "pending" });
    assert.ok(headers.Cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
