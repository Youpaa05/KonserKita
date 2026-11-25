import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  buildProductionPoolConfig,
  MigrationRunnerError,
  PRODUCTION_TARGET,
} from "./migrate-neon-production.js";
import {
  ProductionSeedError,
  runProductionDemoSeed,
} from "./internal/production-demo-seed-engine.js";

export { ProductionSeedError, runProductionDemoSeed };

export function buildProductionSeedPoolConfig(environment = process.env) {
  if (environment.NEON_PRODUCTION_SEED_TARGET !== "production") {
    throw new ProductionSeedError("target validation");
  }
  return buildProductionPoolConfig({
    NEON_PRODUCTION_MIGRATION_TARGET: "production",
    NEON_PRODUCTION_MIGRATION_DATABASE_URL:
      environment.NEON_PRODUCTION_SEED_DATABASE_URL,
  });
}

export async function seedProductionDemoConcerts() {
  let pool;
  let client;
  let failure;
  let result;

  try {
    pool = new pg.Pool(buildProductionSeedPoolConfig());
    client = await pool.connect();
    result = await runProductionDemoSeed({ client });
  } catch (error) {
    failure = error instanceof ProductionSeedError
      ? error
      : error instanceof MigrationRunnerError
        ? new ProductionSeedError(error.stage, error.code)
      : new ProductionSeedError("database connection", error?.code);
  } finally {
    if (client) {
      try {
        client.release(Boolean(failure) || undefined);
      } catch (error) {
        if (!failure) failure = new ProductionSeedError("connection cleanup", error?.code);
      }
    }
    if (pool) {
      try {
        await pool.end();
      } catch (error) {
        if (!failure) failure = new ProductionSeedError("connection cleanup", error?.code);
      }
    }
  }

  if (failure) {
    console.error(`[FAIL] ${failure.message}`);
    throw failure;
  }

  console.log(
    `[PASS] Production demo data verified: ${result.demoConcerts} concerts, ` +
    `${result.demoCategories} categories (${result.insertedConcerts} concerts and ` +
    `${result.insertedCategories} categories inserted).`,
  );
  return result;
}

async function main() {
  try {
    await seedProductionDemoConcerts();
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
