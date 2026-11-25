import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PRODUCTION_DEMO_CONCERTS } from "../database/production-demo-concerts.js";
import { EXPECTED_MIGRATION_FILES } from "../scripts/internal/neon-migration-engine.js";
import {
  ProductionSeedError,
  runProductionDemoSeed,
} from "../scripts/internal/production-demo-seed-engine.js";
import {
  buildProductionSeedPoolConfig,
} from "../scripts/seed-neon-production.js";

const backendPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fakePassword = "production-seed-test-password";

function productionUrl({
  host = "ep-delicate-hall-bdjuqrzi.c-8.us-east-2.aws.neon.tech",
  database = "neondb",
  role = "neondb_owner",
  port = "5432",
  sslMode = "require",
} = {}) {
  const url = new URL(
    `postgresql://${encodeURIComponent(role)}:${encodeURIComponent(fakePassword)}@${host}:${port}/${database}`,
  );
  if (sslMode !== null) url.searchParams.set("sslmode", sslMode);
  return url.toString();
}

function seedEnvironment(overrides = {}) {
  return {
    NEON_PRODUCTION_SEED_TARGET: "production",
    NEON_PRODUCTION_SEED_DATABASE_URL: productionUrl(),
    ...overrides,
  };
}

async function expectedMigrationHistory() {
  const normalize = (sql) => sql.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const sourceDirectory = path.join(backendPath, "database");
  const entries = [{
    version: "000",
    name: "schema.sql",
    checksum: crypto.createHash("sha256")
      .update(normalize(await fs.readFile(path.join(sourceDirectory, "schema.sql"), "utf8")))
      .digest("hex"),
  }];
  for (const name of EXPECTED_MIGRATION_FILES) {
    entries.push({
      version: name.slice(0, 3),
      name,
      checksum: crypto.createHash("sha256")
        .update(normalize(await fs.readFile(path.join(sourceDirectory, "migrations", name), "utf8")))
        .digest("hex"),
    });
  }
  return entries;
}

function cloneState(state) {
  return {
    migrations: state.migrations.map((row) => ({ ...row })),
    concerts: new Map([...state.concerts].map(([key, row]) => [key, { ...row }])),
    categories: new Map([...state.categories].map(([key, row]) => [key, { ...row }])),
    nextId: state.nextId,
    nextCategoryId: state.nextCategoryId,
  };
}

function createFakeClient({
  migrations,
  identity = {
    database_name: "neondb",
    role_name: "neondb_owner",
    transaction_read_only: "off",
    server_version_num: "180007",
  },
} = {}) {
  const state = {
    migrations,
    concerts: new Map(),
    categories: new Map(),
    nextId: 1,
    nextCategoryId: 1,
  };
  let snapshot = null;
  const queries = [];

  const client = {
    async query(sql, values = []) {
      const statement = String(sql).trim();
      queries.push(statement);
      if (statement === "BEGIN") {
        snapshot = cloneState(state);
        return { rows: [] };
      }
      if (statement === "COMMIT") {
        snapshot = null;
        return { rows: [] };
      }
      if (statement === "ROLLBACK") {
        if (snapshot) {
          state.migrations = snapshot.migrations;
          state.concerts = snapshot.concerts;
          state.categories = snapshot.categories;
          state.nextId = snapshot.nextId;
          state.nextCategoryId = snapshot.nextCategoryId;
        }
        snapshot = null;
        return { rows: [] };
      }
      if (statement.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (statement.includes("current_database() AS database_name")) {
        return { rows: [identity] };
      }
      if (statement.includes("SELECT version, name, checksum")) {
        return { rows: state.migrations };
      }
      if (statement.startsWith("INSERT INTO public.concerts")) {
        const [
          slug, title, artist, category, city, venue, eventDate,
          eventTime, accent, imageUrl, description,
        ] = values;
        if (state.concerts.has(slug)) return { rows: [] };
        const row = {
          id: String(state.nextId++),
          slug,
          title,
          artist,
          category,
          city,
          venue,
          event_date: eventDate,
          event_time: eventTime,
          accent,
          image_url: imageUrl,
          description,
          is_active: true,
        };
        state.concerts.set(slug, row);
        return { rows: [{ id: row.id }] };
      }
      if (statement.includes("FROM public.concerts") && statement.includes("WHERE slug = $1")) {
        const row = state.concerts.get(values[0]);
        return { rows: row ? [{ ...row }] : [] };
      }
      if (statement.startsWith("INSERT INTO public.ticket_categories")) {
        const [concertId, name, price, quota] = values;
        const key = `${concertId}:${name}`;
        if (state.categories.has(key)) return { rows: [] };
        state.categories.set(key, {
          id: String(state.nextCategoryId++),
          concert_id: concertId,
          name,
          price: String(price),
          quota,
          is_active: true,
        });
        return { rows: [{ id: String(state.nextCategoryId - 1) }] };
      }
      if (statement.includes("FROM public.ticket_categories") && statement.includes("WHERE concert_id = $1")) {
        const row = state.categories.get(`${values[0]}:${values[1]}`);
        return { rows: row ? [{ ...row }] : [] };
      }
      if (statement.includes("active_demo_concerts")) {
        const slugs = new Set(values[0]);
        const demoRows = [...state.concerts.values()].filter((row) => slugs.has(row.slug));
        const demoIds = new Set(demoRows.map((row) => row.id));
        const demoCategories = [...state.categories.values()].filter((row) =>
          demoIds.has(row.concert_id),
        );
        const concertIdsWithActiveCategories = new Set(
          [...state.categories.values()]
            .filter((row) => row.is_active)
            .map((row) => row.concert_id),
        );
        return {
          rows: [{
            total_concerts: state.concerts.size,
            total_categories: state.categories.size,
            active_demo_concerts: demoRows.filter((row) => row.is_active).length,
            active_demo_categories: demoCategories.filter((row) => row.is_active).length,
            active_concerts_without_categories: [...state.concerts.values()].filter(
              (row) => row.is_active && !concertIdsWithActiveCategories.has(row.id),
            ).length,
            negative_prices: [...state.categories.values()].filter(
              (row) => Number(row.price) < 0,
            ).length,
            negative_quotas: [...state.categories.values()].filter(
              (row) => row.quota < 0,
            ).length,
            past_demo_concerts: 0,
          }],
        };
      }
      throw new Error(`Unexpected seed SQL: ${statement}`);
    },
  };

  return { client, state, queries };
}

test("the production demo dataset contains eight future concerts and 24 valid categories", () => {
  assert.equal(PRODUCTION_DEMO_CONCERTS.length, 8);
  assert.equal(new Set(PRODUCTION_DEMO_CONCERTS.map(({ slug }) => slug)).size, 8);
  assert.equal(
    PRODUCTION_DEMO_CONCERTS.reduce(
      (count, concert) => count + concert.ticketCategories.length,
      0,
    ),
    24,
  );
  for (const concert of PRODUCTION_DEMO_CONCERTS) {
    assert.ok(concert.eventDate > "2026-11-20");
    assert.match(concert.imageUrl, /^https:\/\//);
    assert.equal(concert.ticketCategories.length, 3);
    assert.ok(concert.ticketCategories.every(({ price, quota }) => price > 0 && quota > 0));
  }
  assert.match(PRODUCTION_DEMO_CONCERTS[6].description, /fiktif.*bukan pengumuman acara sungguhan/);
  assert.match(PRODUCTION_DEMO_CONCERTS[7].description, /fiktif.*bukan pengumuman acara sungguhan/);
});

test("the production seed URL requires the exact direct production target and verified TLS", () => {
  const config = buildProductionSeedPoolConfig(seedEnvironment());
  assert.equal(config.host, "ep-delicate-hall-bdjuqrzi.c-8.us-east-2.aws.neon.tech");
  assert.equal(config.database, "neondb");
  assert.equal(config.user, "neondb_owner");
  assert.equal(config.port, 5432);
  assert.equal(config.password, fakePassword);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });

  for (const overrides of [
    { NEON_PRODUCTION_SEED_TARGET: "staging" },
    { NEON_PRODUCTION_SEED_TARGET: "" },
    { NEON_PRODUCTION_SEED_DATABASE_URL: "" },
    { NEON_PRODUCTION_SEED_DATABASE_URL: productionUrl({ database: "otherdb" }) },
    { NEON_PRODUCTION_SEED_DATABASE_URL: productionUrl({ role: "other_role" }) },
    { NEON_PRODUCTION_SEED_DATABASE_URL: productionUrl({ port: "5433" }) },
    { NEON_PRODUCTION_SEED_DATABASE_URL: productionUrl({ sslMode: "disable" }) },
    {
      NEON_PRODUCTION_SEED_DATABASE_URL: productionUrl({
        host: "ep-delicate-hall-bdjuqrzi-pooler.c-8.us-east-2.aws.neon.tech",
      }),
    },
    {
      NEON_PRODUCTION_SEED_DATABASE_URL: productionUrl({
        host: "ep-mute-fire-bdv1e9ll.c-8.us-east-2.aws.neon.tech",
      }),
    },
  ]) {
    assert.throws(() => buildProductionSeedPoolConfig(seedEnvironment(overrides)));
  }
});

test("production seed inserts eight concerts and 24 categories atomically and is idempotent", async () => {
  const { client, state, queries } = createFakeClient({
    migrations: await expectedMigrationHistory(),
  });

  const first = await runProductionDemoSeed({ client });
  assert.deepEqual(first, {
    totalConcerts: 8,
    totalCategories: 24,
    demoConcerts: 8,
    demoCategories: 24,
    insertedConcerts: 8,
    insertedCategories: 24,
  });
  assert.equal(queries[0], "BEGIN");
  assert.equal(queries.at(-1), "COMMIT");
  assert.ok(queries.every((query) =>
    !/\b(?:DELETE|UPDATE|DROP|ALTER|TRUNCATE)\b/i.test(query),
  ));
  assert.ok(queries.every((query) =>
    !/INSERT INTO public\.(?!concerts\b|ticket_categories\b)/i.test(query),
  ));

  const second = await runProductionDemoSeed({ client });
  assert.deepEqual(second, {
    totalConcerts: 8,
    totalCategories: 24,
    demoConcerts: 8,
    demoCategories: 24,
    insertedConcerts: 0,
    insertedCategories: 0,
  });
  assert.equal(state.concerts.size, 8);
  assert.equal(state.categories.size, 24);
});

test("a conflicting slug rolls back every earlier insert and does not overwrite existing data", async () => {
  const { client, state } = createFakeClient({
    migrations: await expectedMigrationHistory(),
  });
  const last = PRODUCTION_DEMO_CONCERTS.at(-1);
  state.concerts.set(last.slug, {
    id: "99",
    slug: last.slug,
    title: "Existing unrelated concert",
    artist: last.artist,
    category: last.category,
    city: last.city,
    venue: last.venue,
    event_date: last.eventDate,
    event_time: last.eventTime,
    accent: last.accent,
    image_url: last.imageUrl,
    description: last.description,
    is_active: true,
  });

  await assert.rejects(
    runProductionDemoSeed({ client }),
    (error) => error instanceof ProductionSeedError && error.stage === "concert slug conflict",
  );
  assert.equal(state.concerts.size, 1);
  assert.equal(state.concerts.get(last.slug).title, "Existing unrelated concert");
  assert.equal(state.categories.size, 0);
});

test("production identity and migration history mismatches abort before data inserts", async (t) => {
  const history = await expectedMigrationHistory();
  for (const scenario of [
    {
      name: "wrong PostgreSQL role",
      identity: { role_name: "other_role" },
      migrations: history,
      stage: "database identity verification",
    },
    {
      name: "changed migration checksum",
      migrations: history.map((row, index) =>
        index === 4 ? { ...row, checksum: "0".repeat(64) } : row,
      ),
      stage: "migration history verification",
    },
  ]) {
    await t.test(scenario.name, async () => {
      const identity = scenario.identity
        ? {
            database_name: "neondb",
            role_name: "neondb_owner",
            transaction_read_only: "off",
            server_version_num: "180007",
            ...scenario.identity,
          }
        : undefined;
      const { client, state } = createFakeClient({
        migrations: scenario.migrations,
        identity,
      });

      await assert.rejects(
        runProductionDemoSeed({ client }),
        (error) => error instanceof ProductionSeedError && error.stage === scenario.stage,
      );
      assert.equal(state.concerts.size, 0);
      assert.equal(state.categories.size, 0);
    });
  }
});

test("the Windows launcher uses hidden input, scoped environment variables, and the seed script", async () => {
  const launcher = await fs.readFile(
    new URL("../scripts/seed-neon-production.ps1", import.meta.url),
    "utf8",
  );
  const packageJson = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.match(launcher, /Read-Host .* -AsSecureString/);
  assert.match(launcher, /\$env:NEON_PRODUCTION_SEED_TARGET\s*=\s*"production"/);
  assert.match(launcher, /\$env:NEON_PRODUCTION_SEED_DATABASE_URL\s*=/);
  assert.match(launcher, /npm\.cmd run db:seed:neon:production/);
  assert.match(launcher, /ZeroFreeBSTR/);
  assert.match(launcher, /SetEnvironmentVariable\("NEON_PRODUCTION_SEED_DATABASE_URL"/);
  assert.equal(packageJson.scripts["db:seed:neon:production"], "node scripts/seed-neon-production.js");
  assert.equal(
    packageJson.scripts["db:seed:neon:production:windows"],
    "powershell -NoProfile -File scripts/seed-neon-production.ps1",
  );
  assert.doesNotMatch(launcher, /Write-(?:Host|Output).*NEON_PRODUCTION_SEED_DATABASE_URL/i);
});
