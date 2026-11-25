import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_DEMO_CONCERTS } from "../../database/production-demo-concerts.js";
import { EXPECTED_MIGRATION_FILES } from "./neon-migration-engine.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const databaseDirectory = path.resolve(currentDirectory, "../../database");
const MIGRATION_ADVISORY_LOCK_KEY = 2026112008;
const EXPECTED_DATABASE = "neondb";
const EXPECTED_ROLE = "neondb_owner";
const REQUIRED_MIGRATION_COUNT = EXPECTED_MIGRATION_FILES.length + 1;

export class ProductionSeedError extends Error {
  constructor(stage, code) {
    const safeCode =
      typeof code === "string" && /^[A-Z0-9_-]{1,16}$/.test(code)
        ? code
        : null;
    super(
      `Production demo seed failed during ${stage}${safeCode ? ` (database code ${safeCode})` : ""}.`,
    );
    this.name = "ProductionSeedError";
    this.code = safeCode;
    this.stage = stage;
  }
}

function normalizeSql(sql) {
  return sql.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

async function loadExpectedMigrationHistory() {
  const schemaSql = normalizeSql(
    await fs.readFile(path.join(databaseDirectory, "schema.sql"), "utf8"),
  );
  const entries = [{
    version: "000",
    name: "schema.sql",
    checksum: crypto.createHash("sha256").update(schemaSql).digest("hex"),
  }];
  const migrationDirectory = path.join(databaseDirectory, "migrations");
  const files = (await fs.readdir(migrationDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  if (
    files.length !== EXPECTED_MIGRATION_FILES.length ||
    files.some((name, index) => name !== EXPECTED_MIGRATION_FILES[index])
  ) {
    throw new ProductionSeedError("migration source verification");
  }

  for (const name of files) {
    const sql = normalizeSql(await fs.readFile(path.join(migrationDirectory, name), "utf8"));
    entries.push({
      version: name.slice(0, 3),
      name,
      checksum: crypto.createHash("sha256").update(sql).digest("hex"),
    });
  }

  return entries;
}

async function verifyDatabaseIdentity(client) {
  const result = await client.query(`
    SELECT current_database() AS database_name,
           current_user AS role_name,
           current_setting('transaction_read_only') AS transaction_read_only,
           current_setting('server_version_num') AS server_version_num
  `);
  const identity = result.rows[0];
  const version = Number(identity?.server_version_num);

  if (
    identity?.database_name !== EXPECTED_DATABASE ||
    identity?.role_name !== EXPECTED_ROLE ||
    identity?.transaction_read_only !== "off" ||
    !Number.isInteger(version) ||
    version < 180000 ||
    version >= 190000
  ) {
    throw new ProductionSeedError("database identity verification");
  }
}

function sameConcert(existing, concert) {
  return existing &&
    existing.slug === concert.slug &&
    existing.title === concert.title &&
    existing.artist === concert.artist &&
    existing.category === concert.category &&
    existing.city === concert.city &&
    existing.venue === concert.venue &&
    existing.event_date === concert.eventDate &&
    existing.event_time === concert.eventTime &&
    existing.accent === concert.accent &&
    existing.image_url === concert.imageUrl &&
    existing.description === concert.description &&
    existing.is_active === true;
}

async function ensureConcert(client, concert) {
  const inserted = await client.query(
    `INSERT INTO public.concerts
      (slug, title, artist, category, city, venue, event_date, event_time,
       accent, image_url, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::time,$9,$10,$11)
     ON CONFLICT (slug) DO NOTHING
     RETURNING id::text AS id`,
    [
      concert.slug,
      concert.title,
      concert.artist,
      concert.category,
      concert.city,
      concert.venue,
      concert.eventDate,
      concert.eventTime,
      concert.accent,
      concert.imageUrl,
      concert.description,
    ],
  );
  if (inserted.rows[0]) {
    return { id: inserted.rows[0].id, inserted: true };
  }

  const existing = await client.query(
    `SELECT id::text AS id, slug, title, artist, category, city, venue,
            to_char(event_date, 'YYYY-MM-DD') AS event_date,
            to_char(event_time, 'HH24:MI') AS event_time,
            accent, image_url, description, archived_at IS NULL AS is_active
     FROM public.concerts
     WHERE slug = $1
     FOR UPDATE`,
    [concert.slug],
  );
  if (!sameConcert(existing.rows[0], concert)) {
    throw new ProductionSeedError("concert slug conflict");
  }

  return { id: existing.rows[0].id, inserted: false };
}

async function ensureTicketCategory(client, concertId, category) {
  const inserted = await client.query(
    `INSERT INTO public.ticket_categories (concert_id, name, price, quota)
     VALUES ($1::bigint, $2, $3, $4)
     ON CONFLICT (concert_id, name) DO NOTHING
     RETURNING id`,
    [concertId, category.name, category.price, category.quota],
  );
  if (inserted.rows[0]) return true;

  const existing = await client.query(
    `SELECT price::text AS price, quota,
            archived_at IS NULL AS is_active
     FROM public.ticket_categories
     WHERE concert_id = $1::bigint AND name = $2
     FOR UPDATE`,
    [concertId, category.name],
  );
  const row = existing.rows[0];
  if (
    !row ||
    Number(row.price) !== category.price ||
    Number(row.quota) !== category.quota ||
    row.is_active !== true
  ) {
    throw new ProductionSeedError("ticket category conflict");
  }

  return false;
}

async function verifySeedResult(client, expectedConcertCount, expectedCategoryCount) {
  const result = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM public.concerts) AS total_concerts,
       (SELECT COUNT(*)::int FROM public.ticket_categories) AS total_categories,
       (SELECT COUNT(*)::int
        FROM public.concerts
        WHERE slug = ANY($1::text[]) AND archived_at IS NULL) AS active_demo_concerts,
       (SELECT COUNT(*)::int
        FROM public.ticket_categories tc
        JOIN public.concerts c ON c.id = tc.concert_id
        WHERE c.slug = ANY($1::text[]) AND tc.archived_at IS NULL) AS active_demo_categories,
       (SELECT COUNT(*)::int
        FROM public.concerts c
        WHERE c.archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.ticket_categories tc
            WHERE tc.concert_id = c.id AND tc.archived_at IS NULL
          )) AS active_concerts_without_categories,
       (SELECT COUNT(*)::int FROM public.ticket_categories WHERE price < 0) AS negative_prices,
       (SELECT COUNT(*)::int FROM public.ticket_categories WHERE quota < 0) AS negative_quotas,
       (SELECT COUNT(*)::int
        FROM public.concerts
        WHERE slug = ANY($1::text[]) AND event_date <= CURRENT_DATE) AS past_demo_concerts`,
    [PRODUCTION_DEMO_CONCERTS.map(({ slug }) => slug)],
  );
  const counts = result.rows[0];

  if (
    !counts ||
    Number(counts.active_demo_concerts) !== expectedConcertCount ||
    Number(counts.active_demo_categories) !== expectedCategoryCount ||
    Number(counts.active_concerts_without_categories) !== 0 ||
    Number(counts.negative_prices) !== 0 ||
    Number(counts.negative_quotas) !== 0 ||
    Number(counts.past_demo_concerts) !== 0
  ) {
    throw new ProductionSeedError("post-seed verification");
  }

  return {
    totalConcerts: Number(counts.total_concerts),
    totalCategories: Number(counts.total_categories),
    demoConcerts: Number(counts.active_demo_concerts),
    demoCategories: Number(counts.active_demo_categories),
  };
}

export async function runProductionDemoSeed({
  client,
  concerts = PRODUCTION_DEMO_CONCERTS,
} = {}) {
  if (!client || typeof client.query !== "function") {
    throw new ProductionSeedError("database client validation");
  }
  if (!Array.isArray(concerts) || concerts.length < 1) {
    throw new ProductionSeedError("demo data validation");
  }
  const categoryCount = concerts.reduce(
    (count, concert) => count + concert.ticketCategories.length,
    0,
  );
  if (
    concerts.some((concert) =>
      new Date(`${concert.eventDate}T00:00:00Z`).getTime() <= Date.now() ||
      !concert.imageUrl.startsWith("https://")
    )
  ) {
    throw new ProductionSeedError("demo data validation");
  }

  const expectedHistory = await loadExpectedMigrationHistory();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
      MIGRATION_ADVISORY_LOCK_KEY,
    ]);

    await verifyDatabaseIdentity(client);
    const historyResult = await client.query(`
      SELECT version, name, checksum
      FROM public.schema_migrations
      ORDER BY version
    `);
    if (
      historyResult.rows.length !== REQUIRED_MIGRATION_COUNT ||
      historyResult.rows.some((row, index) =>
        row.version !== expectedHistory[index]?.version ||
        row.name !== expectedHistory[index]?.name ||
        row.checksum !== expectedHistory[index]?.checksum
      )
    ) {
      throw new ProductionSeedError("migration history verification");
    }

    let insertedConcerts = 0;
    let insertedCategories = 0;
    for (const concert of concerts) {
      const { id, inserted } = await ensureConcert(client, concert);
      if (inserted) insertedConcerts += 1;
      for (const category of concert.ticketCategories) {
        if (await ensureTicketCategory(client, id, category)) {
          insertedCategories += 1;
        }
      }
    }

    const counts = await verifySeedResult(client, concerts.length, categoryCount);
    await client.query("COMMIT");
    transactionOpen = false;

    return {
      ...counts,
      insertedConcerts,
      insertedCategories,
    };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The original failure is reported below; the connection is discarded by the caller.
      }
    }
    if (error instanceof ProductionSeedError) throw error;
    throw new ProductionSeedError("database transaction", error?.code);
  }
}
