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
  getStagingTargetForHost,
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
      `postgresql://${STAGING_TARGET.role}:${fakePassword}@${STAGING_TARGET.endpointHost}/neondb?sslmode=require&channel_binding=require`,
    ...overrides,
  };
}

async function runStagingMigrations(options) {
  const { pool, ...engineOptions } = options;
  const client = await pool.connect();
  let destroyConnection = false;
  try {
    const result = await runMigrationEngine({
      client,
      expectedRole: STAGING_TARGET.role,
      ...engineOptions,
    });
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

function createFakePool({
  nonEmpty = false,
  contentOverrides = {},
  identityOverrides = {},
  failVersion,
} = {}) {
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
            can_use_public: true,
            can_create_public: true,
            ...identityOverrides,
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
            operator_count: 0,
            statistics_count: 0,
            text_search_config_count: 0,
            text_search_dictionary_count: 0,
            text_search_parser_count: 0,
            text_search_template_count: 0,
            custom_language_count: 0,
            event_trigger_count: 0,
            publication_count: 0,
            subscription_count: 0,
            replication_origin_count: 0,
            foreign_data_wrapper_count: 0,
            foreign_server_count: 0,
            user_mapping_count: 0,
            transform_count: 0,
            database_setting_count: 0,
            large_object_count: 0,
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

test("the new staging branch target recognizes only its exact pooler and direct hosts", () => {
  assert.deepEqual(STAGING_TARGET, {
    projectId: "silent-hat-21218854",
    branchName: "staging",
    branchId: "br-quiet-river-bda1sb4d",
    databaseName: "neondb",
    role: "neondb_owner",
    endpointHost: "ep-dark-dawn-bdayxwt3-pooler.c-8.us-east-2.aws.neon.tech",
    directEndpointHost: "ep-dark-dawn-bdayxwt3.c-8.us-east-2.aws.neon.tech",
  });

  assert.equal(getStagingTargetForHost(STAGING_TARGET.endpointHost), STAGING_TARGET);
  assert.equal(
    getStagingTargetForHost(STAGING_TARGET.directEndpointHost),
    STAGING_TARGET,
  );
  assert.equal(
    getStagingTargetForHost(`${STAGING_TARGET.endpointHost}.attacker.example`),
    undefined,
  );

  const config = buildStagingPoolConfig(environment());
  assert.equal(config.host, STAGING_TARGET.directEndpointHost);
  assert.equal(config.database, "neondb");
  assert.equal(config.user, STAGING_TARGET.role);
  assert.equal(config.port, 5432);

  const directConfig = buildStagingPoolConfig(environment({
    NEON_MIGRATION_DATABASE_URL:
      `postgresql://${STAGING_TARGET.role}:${fakePassword}@${STAGING_TARGET.directEndpointHost}/neondb`,
  }));
  assert.equal(directConfig.host, STAGING_TARGET.directEndpointHost);
});

test("the staging connection URL must use the configured migration role", () => {
  const config = buildStagingPoolConfig(environment());
  assert.equal(config.user, "neondb_owner");

  assert.throws(
    () => buildStagingPoolConfig(environment({
      NEON_MIGRATION_DATABASE_URL:
        `postgresql://another_role:${fakePassword}@${STAGING_TARGET.endpointHost}/neondb`,
    })),
    /staging database validation/,
  );
});

test("staging URLs with an empty fragment are rejected", () => {
  const connectionString = environment().NEON_MIGRATION_DATABASE_URL;
  const url = new URL(`${connectionString}#`);
  assert.equal(url.hash, "");
  assert.equal(url.href.endsWith("#"), true);

  assert.throws(
    () => buildStagingPoolConfig(environment({
      NEON_MIGRATION_DATABASE_URL: url.href,
    })),
    /connection URL fragment validation/,
  );
});

test("staging URLs with a text fragment are rejected", () => {
  const connectionString = environment().NEON_MIGRATION_DATABASE_URL;
  const url = new URL(`${connectionString}#fragment`);
  assert.equal(url.hash, "#fragment");

  assert.throws(
    () => buildStagingPoolConfig(environment({
      NEON_MIGRATION_DATABASE_URL: url.href,
    })),
    /connection URL fragment validation/,
  );
});

test("legacy staging endpoints are rejected by the new staging runner", () => {
  const legacyHosts = [
    "ep-silent-pond-bdceumwc.c-8.us-east-2.aws.neon.tech",
    "ep-mute-fire-bdv1e9ll.c-8.us-east-2.aws.neon.tech",
  ];

  for (const host of legacyHosts) {
    assert.equal(getStagingTargetForHost(host), undefined);
    assert.throws(
      () => buildStagingPoolConfig(environment({
        NEON_MIGRATION_DATABASE_URL:
          `postgresql://${STAGING_TARGET.role}:${fakePassword}@${host}/neondb?sslmode=require`,
      })),
      /staging endpoint validation/,
    );
  }
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
      `postgresql://${STAGING_TARGET.role}:${fakePassword}@${STAGING_TARGET.endpointHost}/neondb?sslmode=require&channel_binding=require`;
    const config = buildStagingPoolConfig();
    assert.equal(config.host, STAGING_TARGET.directEndpointHost);
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

test("arbitrary Neon hosts and fake suffixes are rejected", () => {
  const unapprovedHosts = [
    "ep-random-123456.c-8.us-east-2.aws.neon.tech",
    `${STAGING_TARGET.endpointHost}.attacker.example`,
  ];

  for (const host of unapprovedHosts) {
    assert.throws(
      () => buildStagingPoolConfig(environment({
        NEON_MIGRATION_DATABASE_URL:
          `postgresql://${STAGING_TARGET.role}:${fakePassword}@${host}/neondb`,
      })),
      /staging endpoint validation/,
    );
  }
});

test("empty, invalid, wrong-host, and wrong-database URLs are rejected", () => {
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
        `postgresql://${STAGING_TARGET.role}:${fakePassword}@another-host.example/neondb`,
    })),
    /staging endpoint validation/,
  );
  assert.throws(
    () => buildStagingPoolConfig(environment({
      NEON_MIGRATION_DATABASE_URL:
        `postgresql://${STAGING_TARGET.role}:${fakePassword}@${STAGING_TARGET.endpointHost}/otherdb`,
    })),
    /staging database validation/,
  );
  assert.throws(
    () => buildStagingPoolConfig(environment({
      NEON_MIGRATION_DATABASE_URL:
        `postgresql://${STAGING_TARGET.role}:${fakePassword}@${STAGING_TARGET.endpointHost}:5433/neondb`,
    })),
    /staging database validation/,
  );
});

test("a non-staging endpoint is rejected even when the target says staging", () => {
  const productionEndpointHost = "ep-delicate-hall-bdjuqrzi.c-8.us-east-2.aws.neon.tech";
  assert.throws(
    () => buildStagingPoolConfig(environment({
      NEON_MIGRATION_DATABASE_URL:
        `postgresql://${STAGING_TARGET.role}:${fakePassword}@${productionEndpointHost}/neondb`,
    })),
    /staging endpoint validation/,
  );
});

test("staging connection failures do not expose credentials or the supplied URL", () => {
  const connectionString =
    `postgresql://${STAGING_TARGET.role}:${fakePassword}@${STAGING_TARGET.endpointHost}.attacker.example/neondb?sslmode=require`;

  assert.throws(
    () => buildStagingPoolConfig(environment({
      NEON_MIGRATION_DATABASE_URL: connectionString,
    })),
    (error) => {
      assert.equal(error.message.includes(fakePassword), false);
      assert.equal(error.message.includes(connectionString), false);
      return true;
    },
  );
});

test("migration connection configuration forces certificate verification", () => {
  const config = buildStagingPoolConfig(environment({
    NEON_MIGRATION_DATABASE_URL:
      `postgresql://${STAGING_TARGET.role}:${fakePassword}@${STAGING_TARGET.endpointHost}/neondb?sslmode=require`,
  }));
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.host, STAGING_TARGET.directEndpointHost);
  assert.equal(config.database, "neondb");
  assert.equal(config.max, 1);
  assert.throws(
    () => buildStagingPoolConfig(environment({
      NEON_MIGRATION_DATABASE_URL:
        `postgresql://${STAGING_TARGET.role}:${fakePassword}@${STAGING_TARGET.endpointHost}/neondb?sslmode=disable`,
    })),
    /TLS mode validation/,
  );
});

test("the npm migration script rejects an unapproved host without logging credentials", () => {
  const command = process.platform === "win32"
    ? process.env.ComSpec || "cmd.exe"
    : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd run db:migrate:neon"]
    : ["run", "db:migrate:neon"];
  const invalidUrl =
    `postgresql://${STAGING_TARGET.role}:${fakePassword}@${STAGING_TARGET.endpointHost}.attacker.example/neondb?sslmode=require`;
  const result = spawnSync(
    command,
    args,
    {
      cwd: backendPath,
      encoding: "utf8",
      env: {
        ...process.env,
        NEON_MIGRATION_TARGET: "staging",
        NEON_MIGRATION_DATABASE_URL: invalidUrl,
      },
    },
  );

  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, output);
  assert.match(output, /staging endpoint validation/);
  assert.doesNotMatch(output, new RegExp(fakePassword));
  assert.equal(output.includes(invalidUrl), false);
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
  assert.match(
    runnerSource,
    /runMigrationEngine\(\{\s*client,\s*expectedRole:\s*STAGING_TARGET\.role/s,
  );
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
      /bootstrap schema verification/,
    );
    assert.equal(fake.database.trackingExists, false);
    assert.equal(fake.calls.some(({ query }) => query.includes("CREATE TABLE public.schema_migrations")), false);
    assert.deepEqual(fake.executedVersions, []);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("the migration engine accepts the expected connected role and rejects another role", async () => {
  const fixture = await createMigrationFixture();
  const valid = createFakePool();
  const invalid = createFakePool({
    identityOverrides: { role_name: "unexpected_role" },
  });

  try {
    const result = await runStagingMigrations({
      pool: valid.pool,
      expectedRole: "neondb_owner",
      migrationsPath: fixture.migrationsPath,
      schemaPath: fixture.schemaPath,
      logger: { log() {}, error() {} },
    });
    assert.equal(result.complete, true);
    const identityQuery = valid.calls.find(({ query }) =>
      query.includes("current_database() AS database_name")
    )?.query;
    assert.match(identityQuery, /has_schema_privilege\(current_user, 'public', 'USAGE'\)/);
    assert.match(identityQuery, /has_schema_privilege\(current_user, 'public', 'CREATE'\)/);

    await assert.rejects(
      runStagingMigrations({
        pool: invalid.pool,
        expectedRole: "neondb_owner",
        migrationsPath: fixture.migrationsPath,
        schemaPath: fixture.schemaPath,
        logger: { log() {}, error() {} },
      }),
      /database identity and privilege verification/,
    );
    assert.equal(invalid.database.trackingExists, false);
    assert.deepEqual(invalid.executedVersions, []);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("the migration engine requires an explicitly expected database name", async () => {
  const fixture = await createMigrationFixture();
  const databaseName = "konserkita_phase20_test_0123456789abcdef";
  const identityOverrides = {
    database_name: databaseName,
    role_name: "postgres",
  };
  const rejected = createFakePool({ identityOverrides });
  const accepted = createFakePool({ identityOverrides });

  try {
    await assert.rejects(
      runMigrationEngine({
        client: rejected.client,
        expectedRole: "postgres",
        migrationsPath: fixture.migrationsPath,
        schemaPath: fixture.schemaPath,
        logger: { log() {}, error() {} },
      }),
      /database identity and privilege verification/,
    );

    const result = await runMigrationEngine({
      client: accepted.client,
      expectedRole: "postgres",
      expectedDatabaseName: databaseName,
      migrationsPath: fixture.migrationsPath,
      schemaPath: fixture.schemaPath,
      logger: { log() {}, error() {} },
    });

    assert.equal(result.complete, true);
    assert.equal(result.bootstrapApplied, true);
    assert.equal(accepted.database.trackingExists, true);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("the migration engine rejects missing USAGE or CREATE privilege on public", async () => {
  const fixture = await createMigrationFixture();
  try {
    for (const privileges of [
      { can_use_public: false },
      { can_create_public: false },
    ]) {
      const fake = createFakePool({ identityOverrides: privileges });
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
    }
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
      /bootstrap schema verification/,
    );
    assert.equal(fake.database.trackingExists, false);
    assert.deepEqual(fake.executedVersions, []);
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("an unrecognized database-level object blocks bootstrap", async () => {
  const fixture = await createMigrationFixture();
  const fake = createFakePool({
    contentOverrides: { event_trigger_count: 1 },
  });
  try {
    await assert.rejects(
      runStagingMigrations({
        pool: fake.pool,
        migrationsPath: fixture.migrationsPath,
        schemaPath: fixture.schemaPath,
        logger: { log() {}, error() {} },
      }),
      /bootstrap schema verification/,
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
    assert.match(contentQuery, /nspname !~ '\^pg_'/);
    assert.match(contentQuery, /pg_operator/);
    assert.match(contentQuery, /pg_statistic_ext/);
    assert.match(contentQuery, /pg_event_trigger/);
    assert.match(contentQuery, /pg_publication/);
    assert.match(contentQuery, /pg_largeobject_metadata/);
    assert.match(contentQuery, /pg_get_userbyid\(d\.defaclrole\) = 'cloud_admin'/);
    assert.match(contentQuery, /WHERE n\.oid IS NULL OR NOT \(/);
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
      /bootstrap schema verification/,
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

test("migration 012 widens session user IDs without changing migration 002", async () => {
  const migration002 = await fs.readFile(
    path.join(actualMigrationsPath, "002_create_user_sessions.sql"),
    "utf8",
  );
  const migration012 = await fs.readFile(
    path.join(actualMigrationsPath, "012_user_sessions_user_id_bigint.sql"),
    "utf8",
  );

  assert.equal(
    EXPECTED_MIGRATION_FILES[EXPECTED_MIGRATION_FILES.length - 1],
    "012_user_sessions_user_id_bigint.sql",
  );
  assert.match(migration002, /user_id INTEGER NOT NULL REFERENCES users\(id\)/);
  assert.match(migration012, /DROP CONSTRAINT user_sessions_user_id_fkey/i);
  assert.match(migration012, /ALTER COLUMN user_id TYPE BIGINT/i);
  assert.match(migration012, /ADD CONSTRAINT user_sessions_user_id_fkey/i);
  assert.match(migration012, /REFERENCES public\.users\(id\)\s+ON DELETE CASCADE/i);
});
