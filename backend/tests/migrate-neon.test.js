import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runMigrationEngine } from "../scripts/internal/neon-migration-engine.js";
import {
  buildStagingPoolConfig,
  EXPECTED_MIGRATION_FILES,
  runStagingMigrations as stagingRunner,
  STAGING_TARGET,
} from "../scripts/migrate-neon.js";

const fakePassword = "staging-test-password";
const actualMigrationsPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../database/migrations",
);
const backendPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function environment(overrides = {}) {
  return {
    NEON_MIGRATION_TARGET: "staging",
    NEON_MIGRATION_DATABASE_URL:
      `postgresql://migration:${fakePassword}@${STAGING_TARGET.endpointHost}/neondb?sslmode=require&channel_binding=require`,
    ...overrides,
  };
}

async function runStagingMigrations(options) {
  const { pool, ...engineOptions } = options;
  const client = await pool.connect();
  let destroyConnection = false;
  try {
    const result = await runMigrationEngine({ client, ...engineOptions });
    destroyConnection = result.releaseConnection;
    return result;
  } catch (error) {
    destroyConnection = Boolean(error.destroyConnection);
    throw error;
  } finally {
    client.release(destroyConnection || undefined);
  }
}

async function createMigrationFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "konserkita-neon-migration-"));
  const schemaPath = path.join(directory, "schema.sql");
  const migrationsPath = path.join(directory, "migrations");
  await fs.mkdir(migrationsPath);
  await fs.writeFile(
    schemaPath,
    "BEGIN;\nCREATE TABLE public.concerts (id integer);\nCOMMIT;\n",
  );

  for (const file of EXPECTED_MIGRATION_FILES) {
    const version = file.slice(0, 3);
    await fs.writeFile(
      path.join(migrationsPath, file),
      `-- test fixture ${version}\nSELECT '${version}';\n`,
    );
  }

  return { directory, schemaPath, migrationsPath };
}

function createFakePool({ nonEmpty = false, contentOverrides = {}, failVersion } = {}) {
  const database = {
    trackingExists: false,
    baselineExists: false,
    ledger: new Map(),
    transactionSnapshot: null,
  };
  const calls = [];
  const executedVersions = [];
  let lockHeld = false;

  const client = {
    async query(sql, values = []) {
      const query = String(sql).trim();
      calls.push({ query, values });

      if (query.includes("current_database() AS database_name")) {
        return {
          rows: [{
            database_name: "neondb",
            role_name: "neondb_owner",
            transaction_read_only: "off",
            server_version_num: "180000",
            can_create_public: true,
          }],
        };
      }
      if (query.includes("pg_advisory_lock")) {
        lockHeld = true;
        return { rows: [] };
      }
      if (query.includes("pg_advisory_unlock")) {
        lockHeld = false;
        return { rows: [{ pg_advisory_unlock: true }] };
      }
      if (query.includes("to_regclass('public.schema_migrations')")) {
        return { rows: [{ tracking_exists: database.trackingExists }] };
      }
      if (query.includes("non_system_schema_count")) {
        return {
          rows: [{
            non_system_schema_count: 1,
            has_public_schema: true,
            relation_count: nonEmpty ? 1 : 0,
            routine_count: 0,
            type_count: 0,
            extension_count: 0,
            collation_count: 0,
            conversion_count: 0,
            operator_class_count: 0,
            operator_family_count: 0,
            text_search_config_count: 0,
            text_search_dictionary_count: 0,
            text_search_parser_count: 0,
            text_search_template_count: 0,
            unexpected_default_privilege_count: 0,
            ...contentOverrides,
          }],
        };
      }
      if (query.includes("SELECT version, name, checksum")) {
        return {
          rows: [...database.ledger.values()].map((row) => ({ ...row })),
        };
      }
      if (query.includes("baseline_tables_present")) {
        return { rows: [{ baseline_tables_present: database.baselineExists }] };
      }
      if (query === "BEGIN") {
        database.transactionSnapshot = {
          trackingExists: database.trackingExists,
          baselineExists: database.baselineExists,
          ledger: new Map([...database.ledger].map(([key, row]) => [key, { ...row }])),
        };
        return { rows: [] };
      }
      if (query === "COMMIT") {
        database.transactionSnapshot = null;
        return { rows: [] };
      }
      if (query === "ROLLBACK") {
        const snapshot = database.transactionSnapshot;
        if (snapshot) {
          database.trackingExists = snapshot.trackingExists;
          database.baselineExists = snapshot.baselineExists;
          database.ledger = snapshot.ledger;
        }
        database.transactionSnapshot = null;
        return { rows: [] };
      }
      if (query.includes("CREATE TABLE public.schema_migrations")) {
        database.trackingExists = true;
        return { rows: [] };
      }
      if (query.includes("CREATE TABLE public.concerts")) {
        database.baselineExists = true;
        return { rows: [] };
      }
      if (query.includes("CREATE TABLE IF NOT EXISTS concerts")) {
        database.baselineExists = true;
        return { rows: [] };
      }
      if (query.startsWith("INSERT INTO public.schema_migrations")) {
        const [version, name, checksum] = values;
        database.ledger.set(version, { version, name, checksum });
        return { rows: [] };
      }

      const migrationMatch = query.match(/SELECT '(\d{3})';/);
      if (migrationMatch) {
        const version = migrationMatch[1];
        executedVersions.push(version);
        if (version === failVersion) {
          const error = new Error(`Sensitive connection ${fakePassword}`);
          error.code = "XX001";
          throw error;
        }
        return { rows: [] };
      }

      const nextVersion = EXPECTED_MIGRATION_FILES[executedVersions.length]?.slice(0, 3);
      if (nextVersion) {
        executedVersions.push(nextVersion);
        if (nextVersion === failVersion) {
          const error = new Error(`Sensitive connection ${fakePassword}`);
          error.code = "XX001";
          throw error;
        }
        return { rows: [] };
      }

      throw new Error("Unexpected fake database query.");
    },
    release() {
      if (lockHeld) throw new Error("Advisory lock was not released.");
    },
  };

  return {
    database,
    calls,
    executedVersions,
    client,
    pool: {
      async connect() {
        return client;
      },
    },
  };
}

test("target values other than staging are rejected", () => {
  assert.throws(
    () => buildStagingPoolConfig(environment({ NEON_MIGRATION_TARGET: "production" })),
    /target validation/,
  );
  assert.throws(
    () => buildStagingPoolConfig(environment({ NEON_MIGRATION_TARGET: "" })),
    /target validation/,
  );
});

test("the process environment rejects missing and empty values and accepts valid staging values", () => {
  const previousTarget = process.env.NEON_MIGRATION_TARGET;
  const previousUrl = process.env.NEON_MIGRATION_DATABASE_URL;

  try {
    delete process.env.NEON_MIGRATION_TARGET;
    delete process.env.NEON_MIGRATION_DATABASE_URL;
    assert.throws(() => buildStagingPoolConfig(), /target validation/);

    process.env.NEON_MIGRATION_TARGET = "staging";
    assert.throws(() => buildStagingPoolConfig(), /connection configuration/);
    process.env.NEON_MIGRATION_DATABASE_URL = " ";
    assert.throws(() => buildStagingPoolConfig(), /connection configuration/);

    process.env.NEON_MIGRATION_DATABASE_URL =
      `postgresql://migration:${fakePassword}@${STAGING_TARGET.endpointHost}/neondb?sslmode=require&channel_binding=require`;
    const config = buildStagingPoolConfig();
    assert.equal(config.host, STAGING_TARGET.endpointHost);
    assert.equal(config.database, "neondb");
    assert.deepEqual(config.ssl, { rejectUnauthorized: true });

    process.env.NEON_MIGRATION_TARGET = "production";
    assert.throws(() => buildStagingPoolConfig(), /target validation/);
  } finally {
    if (previousTarget === undefined) delete process.env.NEON_MIGRATION_TARGET;
    else process.env.NEON_MIGRATION_TARGET = previousTarget;
    if (previousUrl === undefined) delete process.env.NEON_MIGRATION_DATABASE_URL;
    else process.env.NEON_MIGRATION_DATABASE_URL = previousUrl;
  }
});

test("pooled, empty, invalid, wrong-host, and wrong-database URLs are rejected", () => {
  const pooledHost = STAGING_TARGET.endpointHost.replace(".c-8.", "-pooler.c-8.");
  assert.throws(
    () => buildStagingPoolConfig(environment({
      NEON_MIGRATION_DATABASE_URL:
        `postgresql://migration:${fakePassword}@${pooledHost}/neondb`,
    })),
    /direct connection validation/,
  );
  assert.throws(
    () => buildStagingPoolConfig(environment({ NEON_MIGRATION_DATABASE_URL: "" })),
    /connection configuration/,
  );
  assert.throws(
    () => buildStagingPoolConfig(environment({ NEON_MIGRATION_DATABASE_URL: "not-a-url" })),
    /connection URL validation/,
  );
  assert.throws(
    () => buildStagingPoolConfig(environment({
      NEON_MIGRATION_DATABASE_URL:
        `postgresql://migration:${fakePassword}@another-host.example/neondb`,
    })),
    /staging endpoint validation/,
  );
  assert.throws(
    () => buildStagingPoolConfig(environment({
      NEON_MIGRATION_DATABASE_URL:
        `postgresql://migration:${fakePassword}@${STAGING_TARGET.endpointHost}/otherdb`,
    })),
    /staging database validation/,
  );
});

test("a non-staging endpoint is rejected even when the target says staging", () => {
  const productionEndpointHost = "ep-delicate-hall-bdjuqrzi.c-8.us-east-2.aws.neon.tech";
  assert.throws(
    () => buildStagingPoolConfig(environment({
      NEON_MIGRATION_DATABASE_URL:
        `postgresql://migration:${fakePassword}@${productionEndpointHost}/neondb`,
    })),
    /staging endpoint validation/,
  );
});

test("migration connection configuration forces certificate verification", () => {
  const config = buildStagingPoolConfig(environment({
    NEON_MIGRATION_DATABASE_URL:
      `postgresql://migration:${fakePassword}@${STAGING_TARGET.endpointHost}/neondb?sslmode=require`,
  }));
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.host, STAGING_TARGET.endpointHost);
  assert.equal(config.database, "neondb");
  assert.equal(config.max, 1);
  assert.throws(
    () => buildStagingPoolConfig(environment({
      NEON_MIGRATION_DATABASE_URL:
        `postgresql://migration:${fakePassword}@${STAGING_TARGET.endpointHost}/neondb?sslmode=disable`,
    })),
    /TLS mode validation/,
  );
});

test("the npm migration script receives environment variables before URL validation", () => {
  const command = process.platform === "win32"
    ? process.env.ComSpec || "cmd.exe"
    : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd run db:migrate:neon"]
    : ["run", "db:migrate:neon"];
  const result = spawnSync(
    command,
    args,
    {
      cwd: backendPath,
      encoding: "utf8",
      env: {
        ...process.env,
        NEON_MIGRATION_TARGET: "staging",
        NEON_MIGRATION_DATABASE_URL: "not-a-url",
      },
    },
  );

  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, output);
  assert.match(output, /connection URL validation/);
  assert.doesNotMatch(output, /connection configuration/);
  assert.doesNotMatch(output, /\[RUN\]|\[PASS\] Migration/);
});

test("the Windows launcher uses hidden input, process-scoped env, and the npm runner", async () => {
  const launcher = await fs.readFile(
    new URL("../scripts/migrate-neon.ps1", import.meta.url),
    "utf8",
  );
  const packageJson = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.match(launcher, /Read-Host .* -AsSecureString/);
  assert.match(launcher, /\$env:NEON_MIGRATION_TARGET\s*=\s*"staging"/);
  assert.match(launcher, /\$env:NEON_MIGRATION_DATABASE_URL\s*=/);
  assert.match(launcher, /npm\.cmd run db:migrate:neon/);
  assert.match(launcher, /SetEnvironmentVariable\("NEON_MIGRATION_DATABASE_URL"/);
  assert.match(launcher, /SetEnvironmentVariable\("NEON_MIGRATION_TARGET"/);
  assert.match(launcher, /ZeroFreeBSTR/);
  assert.equal(
    packageJson.scripts["db:migrate:neon:windows"],
    "powershell -NoProfile -File scripts/migrate-neon.ps1",
  );
  assert.doesNotMatch(launcher, /Write-(?:Host|Output).*NEON_MIGRATION_DATABASE_URL/i);
});

test("the staging entry point has no caller-supplied pool or connection seam", async () => {
  const runnerSource = await fs.readFile(
    new URL("../scripts/migrate-neon.js", import.meta.url),
    "utf8",
  );

  assert.equal(stagingRunner.length, 0);
  assert.match(runnerSource, /buildStagingPoolConfig\(\)/);
  assert.match(runnerSource, /new pg\.Pool\(config\)/);
  assert.match(runnerSource, /runMigrationEngine\(\{\s*client\s*\}\)/);
  assert.doesNotMatch(runnerSource, /suppliedPool|pool\s*:\s*[^:]/);
});

test("a non-empty database without migration tracking is not bootstrapped", async () => {
  const fixture = await createMigrationFixture();
  const fake = createFakePool({ nonEmpty: true });
  try {
    await assert.rejects(
      runStagingMigrations({
        environment: environment(),
        pool: fake.pool,
        migrationsPath: fixture.migrationsPath,
        schemaPath: fixture.schemaPath,
        logger: { log() {}, error() {} },
      }),
      /empty database verification/,
    );
    assert.equal(fake.database.trackingExists, false);
    assert.equal(fake.calls.some(({ query }) => query.includes("CREATE TABLE public.schema_migrations")), false);
    assert.deepEqual(fake.executedVersions, []);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("the migration engine verifies an explicitly required connected role", async () => {
  const fixture = await createMigrationFixture();
  const fake = createFakePool();
  const originalQuery = fake.client.query.bind(fake.client);
  fake.client.query = async (sql, values) => {
    const result = await originalQuery(sql, values);
    if (String(sql).includes("current_database() AS database_name")) {
      result.rows[0].role_name = "unexpected_role";
    }
    return result;
  };

  try {
    await assert.rejects(
      runStagingMigrations({
        pool: fake.pool,
        expectedRole: "neondb_owner",
        migrationsPath: fixture.migrationsPath,
        schemaPath: fixture.schemaPath,
        logger: { log() {}, error() {} },
      }),
      /database identity and privilege verification/,
    );
    assert.equal(fake.database.trackingExists, false);
    assert.deepEqual(fake.executedVersions, []);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("a database with user-defined catalog objects is not bootstrapped", async () => {
  const fixture = await createMigrationFixture();
  const fake = createFakePool({ contentOverrides: { collation_count: 1 } });
  try {
    await assert.rejects(
      runStagingMigrations({
        environment: environment(),
        pool: fake.pool,
        migrationsPath: fixture.migrationsPath,
        schemaPath: fixture.schemaPath,
        logger: { log() {}, error() {} },
      }),
      /empty database verification/,
    );
    assert.equal(fake.database.trackingExists, false);
    assert.deepEqual(fake.executedVersions, []);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("only the exact Neon default ACLs are ignored by empty-database verification", async () => {
  const fixture = await createMigrationFixture();
  const fake = createFakePool();
  const unexpected = createFakePool({
    contentOverrides: { unexpected_default_privilege_count: 1 },
  });
  try {
    await runStagingMigrations({
      pool: fake.pool,
      migrationsPath: fixture.migrationsPath,
      schemaPath: fixture.schemaPath,
      logger: { log() {}, error() {} },
    });

    const contentQuery = fake.calls.find(({ query }) =>
      query.includes("unexpected_default_privilege_count")
    )?.query;
    assert.ok(contentQuery);
    assert.match(contentQuery, /pg_get_userbyid\(d\.defaclrole\) = 'cloud_admin'/);
    assert.match(contentQuery, /n\.nspname = 'public'/);
    assert.match(contentQuery, /d\.defaclobjtype = 'S'/);
    assert.match(contentQuery, /d\.defaclobjtype = 'r'/);
    assert.match(contentQuery, /neon_superuser=r\*w\*U\*\/cloud_admin/);
    assert.match(contentQuery, /neon_superuser=a\*r\*w\*d\*D\*m\*\/cloud_admin/);
    assert.match(contentQuery, /LEFT JOIN pg_namespace n ON n\.oid = d\.defaclnamespace/);

    await assert.rejects(
      runStagingMigrations({
        pool: unexpected.pool,
        migrationsPath: fixture.migrationsPath,
        schemaPath: fixture.schemaPath,
        logger: { log() {}, error() {} },
      }),
      /empty database verification/,
    );
    assert.equal(unexpected.database.trackingExists, false);
    assert.deepEqual(unexpected.executedVersions, []);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("bootstrap and migrations execute in order and recorded migrations are skipped", async () => {
  const fixture = await createMigrationFixture();
  const fake = createFakePool();
  try {
    const first = await runStagingMigrations({
      environment: environment(),
      pool: fake.pool,
      migrationsPath: fixture.migrationsPath,
      schemaPath: fixture.schemaPath,
      logger: { log() {}, error() {} },
    });
    assert.equal(first.bootstrapApplied, true);
    assert.equal(first.complete, true);
    assert.deepEqual(
      fake.executedVersions,
      EXPECTED_MIGRATION_FILES.map((file) => file.slice(0, 3)),
    );

    const second = await runStagingMigrations({
      environment: environment(),
      pool: fake.pool,
      migrationsPath: fixture.migrationsPath,
      schemaPath: fixture.schemaPath,
      logger: { log() {}, error() {} },
    });
    assert.equal(second.bootstrapApplied, false);
    assert.deepEqual(second.appliedVersions, []);
    assert.deepEqual(
      second.skippedVersions,
      EXPECTED_MIGRATION_FILES.map((file) => file.slice(0, 3)),
    );
    assert.equal(fake.executedVersions.length, EXPECTED_MIGRATION_FILES.length);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("a changed checksum fails before any unapplied migration runs", async () => {
  const fixture = await createMigrationFixture();
  const fake = createFakePool();
  try {
    await runStagingMigrations({
      environment: environment(),
      pool: fake.pool,
      migrationsPath: fixture.migrationsPath,
      schemaPath: fixture.schemaPath,
      logger: { log() {}, error() {} },
    });
    const changedFile = path.join(fixture.migrationsPath, EXPECTED_MIGRATION_FILES[2]);
    await fs.writeFile(changedFile, "-- changed checksum\nSELECT '003';\n");

    await assert.rejects(
      runStagingMigrations({
        environment: environment(),
        pool: fake.pool,
        migrationsPath: fixture.migrationsPath,
        schemaPath: fixture.schemaPath,
        logger: { log() {}, error() {} },
      }),
      /checksum validation for 003/,
    );
    assert.equal(fake.executedVersions.length, EXPECTED_MIGRATION_FILES.length);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("a failed migration rolls back its transaction and does not record that version", async () => {
  const fixture = await createMigrationFixture();
  const fake = createFakePool({ failVersion: "005" });
  const messages = [];
  try {
    await assert.rejects(
      runStagingMigrations({
        environment: environment(),
        pool: fake.pool,
        migrationsPath: fixture.migrationsPath,
        schemaPath: fixture.schemaPath,
        logger: {
          log(message) { messages.push(message); },
          error(message) { messages.push(message); },
        },
      }),
      /migration 005/,
    );
    assert.equal(fake.database.ledger.has("004"), true);
    assert.equal(fake.database.ledger.has("005"), false);
    assert.equal(
      fake.calls.some(({ query }) => query === "ROLLBACK"),
      true,
    );
    assert.equal(messages.some((message) => message.includes(fakePassword)), false);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("database error text containing credentials is never written to logs", async () => {
  const fixture = await createMigrationFixture();
  const fake = createFakePool({ failVersion: "001" });
  const messages = [];
  try {
    await assert.rejects(
      runStagingMigrations({
        environment: environment(),
        pool: fake.pool,
        migrationsPath: fixture.migrationsPath,
        schemaPath: fixture.schemaPath,
        logger: {
          log(message) { messages.push(message); },
          error(message) { messages.push(message); },
        },
      }),
      (error) => {
        assert.equal(error.message.includes(fakePassword), false);
        assert.equal(error.message.includes("postgresql://"), false);
        return true;
      },
    );
    assert.equal(messages.join("\n").includes(fakePassword), false);
    assert.equal(messages.join("\n").includes("postgresql://"), false);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("repository migrations are compatible with per-file transactions", async () => {
  for (const file of EXPECTED_MIGRATION_FILES) {
    const sql = await fs.readFile(path.join(actualMigrationsPath, file), "utf8");
    assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im);
    assert.doesNotMatch(sql, /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i);
    assert.doesNotMatch(sql, /\bVACUUM\b/i);
  }
});
