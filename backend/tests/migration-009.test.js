import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../database/migrations/009_reconcile_digital_tickets.sql",
  import.meta.url,
);
const runnerUrl = new URL("../scripts/migrate.js", import.meta.url);

const [migration, runner] = await Promise.all([
  readFile(migrationUrl, "utf8"),
  readFile(runnerUrl, "utf8"),
]);

const normalizedMigration = migration.replace(/\s+/g, " ").toLowerCase();
const normalizedRunner = runner.replace(/\s+/g, " ").toLowerCase();

test("scenario 1: eligible bookings generate ticket numbers through quantity", () => {
  assert.match(normalizedMigration, /b\.status = 'confirmed' and p\.status = 'paid'/);
  assert.match(normalizedMigration, /generate_series\(1, b\.quantity\)/);
});

test("eligible booking rows are locked in stable order before validation", () => {
  assert.match(
    normalizedMigration,
    /and exists \( select 1 from generate_series\(1, b\.quantity\) as expected\(ticket_number\)/,
  );
  assert.match(normalizedMigration, /order by b\.id for update of b/);
  assert.ok(
    normalizedMigration.indexOf("for update of b")
      < normalizedMigration.indexOf("inconsistent booking/payment statuses"),
  );
});

test("scenario 2 and 3: complete tickets are preserved and missing numbers are selected", () => {
  assert.match(
    normalizedMigration,
    /existing\.booking_id = b\.id and existing\.ticket_number = ticket\.ticket_number/,
  );
  assert.match(
    normalizedMigration,
    /on conflict \(booking_id, ticket_number\) do nothing/,
  );
});

test("scenario 4: out-of-range tickets abort without deletion", () => {
  assert.match(normalizedMigration, /t\.ticket_number < 1 or t\.ticket_number > b\.quantity/);
  assert.match(normalizedMigration, /outside the expected range/);
  assert.doesNotMatch(
    normalizedMigration,
    /\bdelete\s+from\s+public\.digital_tickets\b/,
  );
});

test("scenario 5: ticket-code conflicts raise instead of being ignored", () => {
  assert.match(normalizedMigration, /when unique_violation then/);
  assert.match(normalizedMigration, /v_constraint_name = 'digital_tickets_code_unique'/);
  assert.match(normalizedMigration, /a generated ticket_code conflicts/);
  assert.doesNotMatch(normalizedMigration, /on conflict do nothing/);
});

test("scenarios 6 and 7: non-eligible booking/payment states are not backfilled", () => {
  assert.match(normalizedMigration, /where b\.status = 'confirmed' and p\.status = 'paid'/);
  assert.match(normalizedMigration, /b\.status = 'pending' and p\.status = 'pending'/);
  assert.match(normalizedMigration, /b\.status = 'cancelled' and p\.status in \('failed', 'expired'\)/);
  assert.match(normalizedMigration, /p\.id is null/);
  assert.match(normalizedMigration, /inconsistent booking\/payment statuses/);
});

test("scenario 8: existing ticket statuses are not changed", () => {
  assert.doesNotMatch(
    normalizedMigration,
    /\bupdate\s+public\.(bookings|payments|digital_tickets)\b/,
  );
  assert.doesNotMatch(
    normalizedMigration,
    /\bdelete\s+from\s+public\.(bookings|payments|digital_tickets)\b/,
  );
});

test("scenario 9: post-validation requires exact count and ticket-number range", () => {
  assert.match(normalizedMigration, /count\(t\.id\) <> b\.quantity/);
  assert.match(normalizedMigration, /count\(distinct t\.ticket_number\) <> b\.quantity/);
  assert.match(normalizedMigration, /min\(t\.ticket_number\) <> 1/);
  assert.match(normalizedMigration, /max\(t\.ticket_number\) <> b\.quantity/);
  assert.match(normalizedMigration, /expected %s tickets numbered/);
});

test("scenario 10: runner tracks checksums and commits migration history atomically", () => {
  assert.match(normalizedRunner, /createhash\(["']sha256["']\)/);
  assert.match(normalizedRunner, /existing\.checksum\.trim\(\) !== checksum/);
  assert.match(normalizedRunner, /await client\.query\("begin"\)/);
  assert.match(normalizedRunner, /await client\.query\("rollback"\)/);
  assert.match(normalizedRunner, /await client\.query\(normalizedsql\)/);
  assert.match(normalizedRunner, /insert into public\.schema_migrations/);
});
