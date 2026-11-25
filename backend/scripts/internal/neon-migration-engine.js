import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(currentDirectory, "../../database/migrations");
const schemaFile = path.resolve(currentDirectory, "../../database/schema.sql");
const ADVISORY_LOCK_KEY = 2026112008;
const VERSION_SCHEMA = "000";
const INSERT_MIGRATION = `
  INSERT INTO public.schema_migrations (version, name, checksum)
  VALUES ($1, $2, $3)
`;

export const EXPECTED_MIGRATION_FILES = Object.freeze([
  "001_create_users_roles.sql",
  "002_create_user_sessions.sql",
  "003_concert_management.sql",
  "004_ticket_category_inventory.sql",
  "005_create_payments.sql",
  "006_create_digital_tickets.sql",
  "007_customer_experience.sql",
  "008_rate_limits_and_ticket_backfill.sql",
  "009_reconcile_digital_tickets.sql",
  "010_concert_cancellation.sql",
  "011_admin_operations_history.sql",
]);

const DATABASE_IDENTITY_QUERY = `
  SELECT current_database() AS database_name,
         current_user AS role_name,
         current_setting('transaction_read_only') AS transaction_read_only,
         current_setting('server_version_num') AS server_version_num,
         has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public
`;

const DATABASE_CONTENT_QUERY = `
  WITH user_schemas AS (
    SELECT oid, nspname
    FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog', 'information_schema')
      AND nspname NOT LIKE 'pg_%'
  )
  SELECT
    (SELECT COUNT(*) FROM user_schemas) AS non_system_schema_count,
    EXISTS (SELECT 1 FROM user_schemas WHERE nspname = 'public') AS has_public_schema,
    (SELECT COUNT(*)
     FROM pg_class c
     JOIN user_schemas n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'i', 'I')) AS relation_count,
    (SELECT COUNT(*)
     FROM pg_proc p
     JOIN user_schemas n ON n.oid = p.pronamespace) AS routine_count,
    (SELECT COUNT(*)
     FROM pg_type t
     JOIN user_schemas n ON n.oid = t.typnamespace
     WHERE t.typtype <> 'p') AS type_count,
    (SELECT COUNT(*)
     FROM pg_extension e
     JOIN user_schemas n ON n.oid = e.extnamespace) AS extension_count,
    (SELECT COUNT(*)
     FROM pg_collation c
     JOIN user_schemas n ON n.oid = c.collnamespace) AS collation_count,
    (SELECT COUNT(*)
     FROM pg_conversion c
     JOIN user_schemas n ON n.oid = c.connamespace) AS conversion_count,
    (SELECT COUNT(*)
     FROM pg_opclass c
     JOIN user_schemas n ON n.oid = c.opcnamespace) AS operator_class_count,
    (SELECT COUNT(*)
     FROM pg_opfamily f
     JOIN user_schemas n ON n.oid = f.opfnamespace) AS operator_family_count,
    (SELECT COUNT(*)
     FROM pg_ts_config c
     JOIN user_schemas n ON n.oid = c.cfgnamespace) AS text_search_config_count,
    (SELECT COUNT(*)
     FROM pg_ts_dict d
     JOIN user_schemas n ON n.oid = d.dictnamespace) AS text_search_dictionary_count,
    (SELECT COUNT(*)
     FROM pg_ts_parser p
     JOIN user_schemas n ON n.oid = p.prsnamespace) AS text_search_parser_count,
    (SELECT COUNT(*)
     FROM pg_ts_template t
     JOIN user_schemas n ON n.oid = t.tmplnamespace) AS text_search_template_count,
    (SELECT COUNT(*)
     FROM pg_default_acl d
     LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
     WHERE NOT (
       pg_get_userbyid(d.defaclrole) = 'cloud_admin'
       AND n.nspname = 'public'
       AND (
         (d.defaclobjtype = 'S'
          AND d.defaclacl = ARRAY['neon_superuser=r*w*U*/cloud_admin'::aclitem])
         OR
         (d.defaclobjtype = 'r'
          AND d.defaclacl = ARRAY['neon_superuser=a*r*w*d*D*m*/cloud_admin'::aclitem])
       )
     )) AS unexpected_default_privilege_count
`;

const BASELINE_TABLES_QUERY = `
  SELECT COUNT(*) = 3 AS baseline_tables_present
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relname IN ('concerts', 'ticket_categories', 'bookings')
`;

export class MigrationRunnerError extends Error {
  constructor(stage, code, { destroyConnection = false } = {}) {
    const safeCode =
      typeof code === "string" && /^[A-Z0-9_-]{1,16}$/.test(code)
        ? code
        : null;
    super(
      `Neon migration runner failed during ${stage}${safeCode ? ` (database code ${safeCode})` : ""}.`,
    );
    this.name = "MigrationRunnerError";
    this.code = safeCode;
    this.stage = stage;
    this.destroyConnection = destroyConnection;
    this.reported = false;
  }
}

function normalizeSql(sql) {
  return sql.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

function calculateChecksum(sql) {
  return crypto.createHash("sha256").update(normalizeSql(sql)).digest("hex");
}

function stripBootstrapTransaction(sql) {
  const normalized = normalizeSql(sql);
  const match = normalized.match(/^\s*BEGIN\s*;\s*([\s\S]*?)\s*COMMIT\s*;\s*$/i);
  if (!match) {
    throw new MigrationRunnerError("bootstrap transaction validation");
  }
  return match[1];
}

async function loadMigrationFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  if (
    files.length !== EXPECTED_MIGRATION_FILES.length ||
    files.some((file, index) => file !== EXPECTED_MIGRATION_FILES[index])
  ) {
    throw new MigrationRunnerError("migration inventory validation");
  }

  const migrations = [];
  for (const file of files) {
    const sql = normalizeSql(await fs.readFile(path.join(directory, file), "utf8"));
    if (!sql.trim() || sql.length > 1000000) {
      throw new MigrationRunnerError("migration source validation");
    }
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql)) {
      throw new MigrationRunnerError("migration transaction validation");
    }
    if (
      /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(sql) ||
      /\bVACUUM\b/i.test(sql)
    ) {
      throw new MigrationRunnerError("migration transaction compatibility");
    }

    migrations.push({
      version: file.slice(0, 3),
      name: file,
      sql,
      checksum: calculateChecksum(sql),
    });
  }

  return migrations;
}

function isDatabaseEmpty(row) {
  return Number(row.non_system_schema_count) === 1 &&
    row.has_public_schema === true &&
    Number(row.relation_count) === 0 &&
    Number(row.routine_count) === 0 &&
    Number(row.type_count) === 0 &&
    Number(row.extension_count) === 0 &&
    Number(row.collation_count) === 0 &&
    Number(row.conversion_count) === 0 &&
    Number(row.operator_class_count) === 0 &&
    Number(row.operator_family_count) === 0 &&
    Number(row.text_search_config_count) === 0 &&
    Number(row.text_search_dictionary_count) === 0 &&
    Number(row.text_search_parser_count) === 0 &&
    Number(row.text_search_template_count) === 0 &&
    Number(row.unexpected_default_privilege_count) === 0;
}

function validateMigrationHistory(rows, expectedEntries) {
  const expected = new Map(
    expectedEntries.map((entry) => [entry.version, entry]),
  );
  const recorded = new Map();

  for (const row of rows) {
    const version = String(row.version).trim();
    const source = expected.get(version);
    if (!source) {
      throw new MigrationRunnerError("migration history validation");
    }

    if (
      row.name !== source.name ||
      String(row.checksum).trim() !== source.checksum
    ) {
      throw new MigrationRunnerError(`checksum validation for ${version}`);
    }
    recorded.set(version, source);
  }

  if (!recorded.has(VERSION_SCHEMA)) {
    throw new MigrationRunnerError("bootstrap history validation");
  }

  let missingEarlierVersion = false;
  for (const entry of expectedEntries) {
    if (!recorded.has(entry.version)) {
      missingEarlierVersion = true;
    } else if (missingEarlierVersion) {
      throw new MigrationRunnerError("migration sequence validation");
    }
  }

  return recorded;
}

async function executeTransaction(client, stage, callback) {
  await client.query("BEGIN");
  try {
    const result = await callback();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    let rollbackError;
    try {
      await client.query("ROLLBACK");
    } catch (caughtRollbackError) {
      rollbackError = caughtRollbackError;
    }
    throw new MigrationRunnerError(
      stage,
      rollbackError?.code || error?.code,
      { destroyConnection: Boolean(rollbackError) },
    );
  }
}

async function verifyDatabaseTarget(client, expectedRole) {
  const result = await client.query(DATABASE_IDENTITY_QUERY);
  const identity = result.rows[0];
  if (
    !identity ||
    identity.database_name !== "neondb" ||
    (expectedRole && identity.role_name !== expectedRole) ||
    identity.transaction_read_only !== "off" ||
    Number(identity.server_version_num) < 140000 ||
    identity.can_create_public !== true
  ) {
    throw new MigrationRunnerError("database identity and privilege verification");
  }
}

async function bootstrapDatabase(client, schemaSql, schemaChecksum) {
  const schemaBody = stripBootstrapTransaction(schemaSql);
  await executeTransaction(client, "schema bootstrap", async () => {
    await client.query(`
      CREATE TABLE public.schema_migrations (
        version VARCHAR(20) PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(schemaBody);
    await client.query(INSERT_MIGRATION, [
      VERSION_SCHEMA,
      "schema.sql",
      schemaChecksum,
    ]);
  });
}

function getSafeError(error, stage) {
  if (error instanceof MigrationRunnerError) return error;
  return new MigrationRunnerError(stage, error?.code);
}

function log(logger, method, message) {
  if (typeof logger?.[method] === "function") logger[method](message);
  else if (method === "log" && typeof logger?.info === "function") logger.info(message);
}

export async function runMigrationEngine({
  client,
  expectedRole,
  logger = console,
  migrationsPath = migrationsDirectory,
  schemaPath = schemaFile,
} = {}) {
  let stage = "database client validation";
  let lockAcquired = false;
  let failure;
  let result;
  let releaseConnection = false;

  try {
    if (!client || typeof client.query !== "function") {
      throw new MigrationRunnerError(stage);
    }

    stage = "database identity and privilege verification";
    await verifyDatabaseTarget(client, expectedRole);

    stage = "migration lock";
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    lockAcquired = true;

    const schemaSql = normalizeSql(await fs.readFile(schemaPath, "utf8"));
    const schemaChecksum = calculateChecksum(schemaSql);
    const migrations = await loadMigrationFiles(migrationsPath);
    const expectedEntries = [
      { version: VERSION_SCHEMA, name: "schema.sql", checksum: schemaChecksum },
      ...migrations.map(({ version, name, checksum }) => ({
        version,
        name,
        checksum,
      })),
    ];

    stage = "migration tracking inspection";
    const trackingResult = await client.query(`
      SELECT to_regclass('public.schema_migrations') IS NOT NULL AS tracking_exists
    `);
    let historyRows;

    if (trackingResult.rows[0]?.tracking_exists === true) {
      const historyResult = await client.query(`
        SELECT version, name, checksum
        FROM public.schema_migrations
      `);
      historyRows = historyResult.rows;
    } else {
      stage = "empty database verification";
      const contentResult = await client.query(DATABASE_CONTENT_QUERY);
      if (!contentResult.rows[0] || !isDatabaseEmpty(contentResult.rows[0])) {
        throw new MigrationRunnerError("empty database verification");
      }

      stage = "schema bootstrap";
      log(logger, "log", "Bootstrapping empty database.");
      await bootstrapDatabase(client, schemaSql, schemaChecksum);
      historyRows = [{
        version: VERSION_SCHEMA,
        name: "schema.sql",
        checksum: schemaChecksum,
      }];
    }

    const recorded = validateMigrationHistory(historyRows, expectedEntries);

    stage = "baseline verification";
    const baselineResult = await client.query(BASELINE_TABLES_QUERY);
    if (baselineResult.rows[0]?.baseline_tables_present !== true) {
      throw new MigrationRunnerError("baseline verification");
    }

    const appliedVersions = [];
    const skippedVersions = [];
    for (const migration of migrations) {
      if (recorded.has(migration.version)) {
        skippedVersions.push(migration.version);
        log(logger, "log", `[SKIP] Migration ${migration.version} is already recorded.`);
        continue;
      }

      stage = `migration ${migration.version}`;
      log(logger, "log", `[RUN] Migration ${migration.version}.`);
      await executeTransaction(client, stage, async () => {
        await client.query(migration.sql);
        await client.query(INSERT_MIGRATION, [
          migration.version,
          migration.name,
          migration.checksum,
        ]);
      });

      recorded.set(migration.version, migration);
      appliedVersions.push(migration.version);
      log(logger, "log", `[PASS] Migration ${migration.version} committed.`);
    }

    result = {
      bootstrapApplied: !trackingResult.rows[0]?.tracking_exists,
      appliedVersions,
      skippedVersions,
      complete: true,
    };
  } catch (error) {
    failure = getSafeError(error, stage);
    releaseConnection = Boolean(error?.destroyConnection);
  } finally {
    if (client && lockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
      } catch (error) {
        releaseConnection = true;
        if (!failure) failure = getSafeError(error, "migration lock release");
      }
    }

    if (failure) failure.destroyConnection ||= releaseConnection;
  }

  if (failure) {
    log(logger, "error", `[FAIL] ${failure.message}`);
    failure.reported = true;
    throw failure;
  }

  return { ...result, releaseConnection };
}
