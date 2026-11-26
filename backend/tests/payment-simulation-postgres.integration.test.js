import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import { createServer } from "node:http";
import pg from "pg";
import { generateSessionToken, hashSessionToken, SESSION_COOKIE_NAME } from "../src/utils/session.js";
import {
  EXPECTED_MIGRATION_FILES,
  runMigrationEngine,
} from "../scripts/internal/neon-migration-engine.js";
import { parseTemporaryDatabaseUrl } from "../scripts/phase20-run-local-pg-tests.mjs";

const { Client, Pool } = pg;
const databaseUrl = process.env.KONSERKITA_PAYMENT_TEST_DATABASE_URL;
const here = path.dirname(fileURLToPath(import.meta.url));

for (const key of [
  "DATABASE_URL",
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "DATABASE_SSL",
  "DATABASE_SSL_CA",
]) {
  delete process.env[key];
}
process.env.NODE_ENV = "test";
dotenv.config = () => ({ parsed: {} });

test("PostgreSQL payment simulation enforces ownership, expiry, atomic tickets, rollback, and idempotency", { skip: !databaseUrl }, async () => {
  const target = parseTemporaryDatabaseUrl(databaseUrl);
  const migrationClient = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
    application_name: "KonserKita phase20 migration test",
  });
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 8,
    connectionTimeoutMillis: 5000,
    application_name: "KonserKita phase20 payment test",
  });
  let server;
  let migrationClientConnected = false;
  let defaultDatabasePool;
  try {
    await migrationClient.connect();
    migrationClientConnected = true;
    const identity = await migrationClient.query(`
      SELECT current_database() AS database_name,
             current_user AS role_name,
             host(inet_server_addr()) AS server_address,
             inet_server_port() AS server_port,
             current_setting('server_version_num') AS server_version_num,
             current_setting('transaction_read_only') AS transaction_read_only
    `);
    const serverIdentity = identity.rows[0];
    assert.ok(serverIdentity, "PostgreSQL identity query must return a row");
    assert.equal(serverIdentity.database_name, target.databaseName);
    assert.equal(serverIdentity.role_name, "postgres");
    assert.equal(serverIdentity.server_address, "127.0.0.1");
    assert.equal(Number(serverIdentity.server_port), 5432);
    assert.equal(serverIdentity.transaction_read_only, "off");
    assert.ok(
      Math.floor(Number(serverIdentity.server_version_num) / 10000) === 18,
      "integration server must be PostgreSQL 18",
    );

    const emptyState = await migrationClient.query(`
      SELECT to_regclass('public.schema_migrations') IS NULL AS no_migration_ledger,
             (SELECT COUNT(*)::int
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'i', 'I')
             ) AS public_object_count
    `);
    assert.equal(emptyState.rows[0].no_migration_ledger, true, "temporary database must have no migration ledger");
    assert.equal(emptyState.rows[0].public_object_count, 0, "temporary database must have no public objects");

    const migrationDir = path.resolve(here, "../database/migrations");
    const migrations = (await readdir(migrationDir))
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .sort();
    assert.deepEqual(migrations, EXPECTED_MIGRATION_FILES);

    const migrationResult = await runMigrationEngine({
      client: migrationClient,
      expectedRole: "postgres",
      expectedDatabaseName: target.databaseName,
    });
    assert.equal(migrationResult.complete, true);
    assert.equal(migrationResult.bootstrapApplied, true, "schema bootstrap must start from a verified empty database");
    assert.deepEqual(
      migrationResult.appliedVersions,
      EXPECTED_MIGRATION_FILES.map((name) => name.slice(0, 3)),
    );
    assert.deepEqual(migrationResult.skippedVersions, []);

    const ledger = await migrationClient.query(
      "SELECT version, name, checksum FROM public.schema_migrations ORDER BY version",
    );
    const expectedLedgerNames = ["schema.sql", ...EXPECTED_MIGRATION_FILES];
    assert.equal(ledger.rows.length, expectedLedgerNames.length);
    assert.deepEqual(
      ledger.rows.map((row) => row.name),
      expectedLedgerNames,
    );
    ledger.rows.forEach((row) => assert.match(String(row.checksum).trim(), /^[a-f0-9]{64}$/));
    assert.equal(ledger.rows.at(-1).version, "012");

    const userIdTypes = await migrationClient.query(`
      SELECT c.relname AS table_name,
             a.attname AS column_name,
             format_type(a.atttypid, a.atttypmod) AS data_type
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND ((c.relname = 'users' AND a.attname = 'id')
          OR (c.relname = 'user_sessions' AND a.attname = 'user_id'))
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY c.relname, a.attname
    `);
    const dataTypes = new Map(
      userIdTypes.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]),
    );
    assert.equal(dataTypes.get("users.id"), "bigint");
    assert.equal(dataTypes.get("user_sessions.user_id"), "bigint");

    const constraints = await migrationClient.query(`
      SELECT conname, contype, convalidated
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
        AND conname = ANY($1::text[])
    `, [[
      "users_role_fk",
      "bookings_user_fk",
      "user_sessions_user_id_fkey",
      "payments_status_valid",
      "digital_tickets_booking_number_unique",
      "concerts_cancellation_state_consistent",
      "payment_history_status_changed",
    ]]);
    assert.equal(constraints.rows.length, 7);
    assert.ok(constraints.rows.every((row) => row.convalidated));

    const sessionForeignKey = await migrationClient.query(`
      SELECT pg_get_constraintdef(oid) AS definition, convalidated
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
        AND conname = 'user_sessions_user_id_fkey'
        AND contype = 'f'
    `);
    assert.equal(sessionForeignKey.rows.length, 1);
    assert.equal(sessionForeignKey.rows[0].convalidated, true);
    assert.match(sessionForeignKey.rows[0].definition, /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);

    const indexes = await migrationClient.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY($1::text[])
    `, [[
      "users_email_lower_unique_idx",
      "user_sessions_user_id_idx",
      "payments_status_expiry_idx",
      "digital_tickets_status_idx",
      "api_rate_limit_buckets_reset_at_idx",
      "payment_status_history_payment_changed_idx",
      "admin_role_change_audit_changed_idx",
      "concerts_cancelled_at_idx",
    ]]);
    assert.equal(indexes.rows.length, 8);

    const trigger = await migrationClient.query(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'payments_status_history_after_update'
          AND tgrelid = 'public.payments'::regclass
          AND NOT tgisinternal
      ) AS present,
      to_regprocedure('public.record_payment_status_change()') IS NOT NULL AS function_present
    `);
    assert.equal(trigger.rows[0].present, true);
    assert.equal(trigger.rows[0].function_present, true);

    ({ pool: defaultDatabasePool } = await import("../src/config/database.js"));
    const { createPaymentRouter } = await import("../src/routes/payments.js");

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
    const cleanupFailures = [];
    if (server?.listening) {
      try {
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      } catch {
        cleanupFailures.push("HTTP server");
      }
    }
    try {
      await pool.end();
    } catch {
      cleanupFailures.push("payment pool");
    }
    if (migrationClientConnected) {
      try {
        await migrationClient.end();
      } catch {
        cleanupFailures.push("migration client");
      }
    }
    if (defaultDatabasePool) {
      try {
        await defaultDatabasePool.end();
      } catch {
        cleanupFailures.push("default application pool");
      }
    }
    if (cleanupFailures.length > 0) {
      throw new Error(`Payment integration cleanup failed: ${cleanupFailures.join(", ")}.`);
    }
  }
});
