import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import pgConnectionString from "pg-connection-string";
import {
  EXPECTED_MIGRATION_FILES,
  MigrationRunnerError,
  runMigrationEngine,
} from "./internal/neon-migration-engine.js";

export { EXPECTED_MIGRATION_FILES, MigrationRunnerError };

export const PRODUCTION_TARGET = Object.freeze({
  databaseName: "neondb",
  endpointHost: "ep-delicate-hall-bdjuqrzi.c-8.us-east-2.aws.neon.tech",
  port: 5432,
  role: "neondb_owner",
});

export function buildProductionPoolConfig(environment = process.env) {
  if (environment.NEON_PRODUCTION_MIGRATION_TARGET !== "production") {
    throw new MigrationRunnerError("target validation");
  }

  const connectionString = environment.NEON_PRODUCTION_MIGRATION_DATABASE_URL;
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    throw new MigrationRunnerError("connection configuration");
  }

  let url;
  let parsed;
  try {
    url = new URL(connectionString);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error("Invalid protocol.");
    }

    const parsingUrl = new URL(connectionString);
    parsingUrl.searchParams.delete("sslmode");
    parsed = pgConnectionString.parse(parsingUrl.toString());
  } catch {
    throw new MigrationRunnerError("connection URL validation");
  }

  const host = url.hostname.toLowerCase();
  if (/-pooler(?:[.-]|$)/i.test(host)) {
    throw new MigrationRunnerError("direct connection validation");
  }
  if (host !== PRODUCTION_TARGET.endpointHost || parsed.host?.toLowerCase() !== host) {
    throw new MigrationRunnerError("production endpoint validation");
  }

  if (
    (url.port && url.port !== String(PRODUCTION_TARGET.port)) ||
    (parsed.port && String(parsed.port) !== String(PRODUCTION_TARGET.port)) ||
    url.pathname !== `/${PRODUCTION_TARGET.databaseName}` ||
    parsed.database !== PRODUCTION_TARGET.databaseName ||
    parsed.user !== PRODUCTION_TARGET.role ||
    typeof parsed.password !== "string" ||
    parsed.password.length === 0 ||
    url.hash
  ) {
    throw new MigrationRunnerError("production database validation");
  }

  const allowedQueryParameters = new Set([
    "sslmode",
    "channel_binding",
    "application_name",
  ]);
  for (const key of new Set(url.searchParams.keys())) {
    if (!allowedQueryParameters.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new MigrationRunnerError("connection URL option validation");
    }
  }

  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  if (!sslMode || !["require", "verify-full"].includes(sslMode)) {
    throw new MigrationRunnerError("TLS mode validation");
  }

  return {
    host: PRODUCTION_TARGET.endpointHost,
    port: PRODUCTION_TARGET.port,
    database: PRODUCTION_TARGET.databaseName,
    user: PRODUCTION_TARGET.role,
    password: parsed.password,
    ssl: { rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
  };
}

function getSafeError(error, stage) {
  if (error instanceof MigrationRunnerError) return error;
  return new MigrationRunnerError(stage, error?.code);
}

export async function runProductionMigrations() {
  let pool;
  let client;
  let failure;
  let result;
  let releaseConnection = false;

  try {
    const config = buildProductionPoolConfig();
    pool = new pg.Pool(config);
    client = await pool.connect();
    const engineResult = await runMigrationEngine({
      client,
      expectedRole: PRODUCTION_TARGET.role,
    });
    releaseConnection = engineResult.releaseConnection;
    result = {
      bootstrapApplied: engineResult.bootstrapApplied,
      appliedVersions: engineResult.appliedVersions,
      skippedVersions: engineResult.skippedVersions,
      complete: engineResult.complete,
    };
  } catch (error) {
    failure = getSafeError(error, client ? "database migration" : "database connection");
    releaseConnection ||= Boolean(error?.destroyConnection);
  } finally {
    if (client) {
      try {
        client.release(releaseConnection || undefined);
      } catch (error) {
        if (!failure) failure = getSafeError(error, "database connection cleanup");
      }
    }

    if (pool) {
      try {
        await pool.end();
      } catch (error) {
        if (!failure) failure = getSafeError(error, "database pool cleanup");
      }
    }
  }

  if (failure) {
    if (!failure.reported) console.error(`[FAIL] ${failure.message}`);
    throw failure;
  }

  console.log("[PASS] Production bootstrap and migrations 001–011 are complete.");
  return result;
}

async function main() {
  try {
    await runProductionMigrations();
  } catch {
    process.exitCode = 1;
  }
}

const invokedFile = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedFile === import.meta.url) {
  await main();
}
