import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import pgConnectionString from "pg-connection-string";
import {
  EXPECTED_MIGRATION_FILES,
  MigrationRunnerError,
  runMigrationEngine,
} from "./internal/neon-migration-engine.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export { EXPECTED_MIGRATION_FILES, MigrationRunnerError };

export const STAGING_TARGET = Object.freeze({
  projectId: "twilight-block-46431039",
  branchId: "br-lively-glitter-bdluy8ax",
  databaseName: "neondb",
  endpointHost: "ep-mute-fire-bdv1e9ll.c-8.us-east-2.aws.neon.tech",
});

export function buildStagingPoolConfig(environment = process.env) {
  if (environment.NEON_MIGRATION_TARGET !== "staging") {
    throw new MigrationRunnerError("target validation");
  }

  const connectionString = environment.NEON_MIGRATION_DATABASE_URL;
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    throw new MigrationRunnerError("connection configuration");
  }

  let url;
  let parsed;
  try {
    url = new URL(connectionString);
    const parsingUrl = new URL(connectionString);
    parsingUrl.searchParams.delete("sslmode");
    parsed = pgConnectionString.parse(parsingUrl.toString());
  } catch {
    throw new MigrationRunnerError("connection URL validation");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new MigrationRunnerError("connection URL validation");
  }

  const host = url.hostname.toLowerCase();
  if (/-pooler(?:[.-]|$)/i.test(host)) {
    throw new MigrationRunnerError("direct connection validation");
  }
  if (host !== STAGING_TARGET.endpointHost || parsed.host?.toLowerCase() !== host) {
    throw new MigrationRunnerError("staging endpoint validation");
  }

  if (
    (url.port && url.port !== "5432") ||
    (parsed.port && String(parsed.port) !== "5432") ||
    url.pathname !== `/${STAGING_TARGET.databaseName}` ||
    parsed.database !== STAGING_TARGET.databaseName ||
    !parsed.user ||
    !parsed.password
  ) {
    throw new MigrationRunnerError("staging database validation");
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

  const sslMode = url.searchParams.get("sslmode");
  if (sslMode && !["require", "verify-full"].includes(sslMode.toLowerCase())) {
    throw new MigrationRunnerError("TLS mode validation");
  }

  return {
    host: STAGING_TARGET.endpointHost,
    port: 5432,
    database: STAGING_TARGET.databaseName,
    user: parsed.user,
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

export async function runStagingMigrations() {
  let pool;
  let client;
  let failure;
  let result;
  let releaseConnection = false;

  try {
    const config = buildStagingPoolConfig();
    pool = new pg.Pool(config);
    client = await pool.connect();
    const engineResult = await runMigrationEngine({ client });
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

  console.log("[PASS] Staging bootstrap and migrations 001–011 are complete.");
  return result;
}

async function main() {
  try {
    await runStagingMigrations();
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
