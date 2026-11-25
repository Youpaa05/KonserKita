import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildProductionPoolConfig,
  PRODUCTION_TARGET,
  runProductionMigrations,
} from "../scripts/migrate-neon-production.js";
import {
  buildStagingPoolConfig,
  STAGING_TARGET,
  runStagingMigrations,
} from "../scripts/migrate-neon.js";

const fakePassword = "production-test-password";
const backendPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function productionUrl({
  host = PRODUCTION_TARGET.endpointHost,
  database = PRODUCTION_TARGET.databaseName,
  role = PRODUCTION_TARGET.role,
  port = String(PRODUCTION_TARGET.port),
  sslMode = "require",
} = {}) {
  const url = new URL(
    `postgresql://${encodeURIComponent(role)}:${encodeURIComponent(fakePassword)}@${host}:${port}/${database}`,
  );
  if (sslMode !== null) url.searchParams.set("sslmode", sslMode);
  url.searchParams.set("channel_binding", "require");
  return url.toString();
}

function productionEnvironment(overrides = {}) {
  return {
    NEON_PRODUCTION_MIGRATION_TARGET: "production",
    NEON_PRODUCTION_MIGRATION_DATABASE_URL: productionUrl(),
    ...overrides,
  };
}

test("the exact production host, role, database, port, and verified TLS are accepted", () => {
  const config = buildProductionPoolConfig(productionEnvironment());

  assert.equal(config.host, "ep-delicate-hall-bdjuqrzi.c-8.us-east-2.aws.neon.tech");
  assert.equal(config.database, "neondb");
  assert.equal(config.user, "neondb_owner");
  assert.equal(config.port, 5432);
  assert.equal(config.password, fakePassword);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.max, 1);
});

test("production target gate rejects staging and missing connection configuration", () => {
  assert.throws(
    () => buildProductionPoolConfig(productionEnvironment({
      NEON_PRODUCTION_MIGRATION_TARGET: "staging",
    })),
    /target validation/,
  );
  assert.throws(
    () => buildProductionPoolConfig(productionEnvironment({
      NEON_PRODUCTION_MIGRATION_TARGET: "",
    })),
    /target validation/,
  );
  assert.throws(
    () => buildProductionPoolConfig(productionEnvironment({
      NEON_PRODUCTION_MIGRATION_DATABASE_URL: "",
    })),
    /connection configuration/,
  );
});

test("staging, pooled, and other hosts are rejected by the production allowlist", () => {
  assert.throws(
    () => buildProductionPoolConfig(productionEnvironment({
      NEON_PRODUCTION_MIGRATION_DATABASE_URL:
        productionUrl({ host: STAGING_TARGET.endpointHost }),
    })),
    /production endpoint validation/,
  );

  const pooledHost = PRODUCTION_TARGET.endpointHost.replace(".c-8.", "-pooler.c-8.");
  assert.throws(
    () => buildProductionPoolConfig(productionEnvironment({
      NEON_PRODUCTION_MIGRATION_DATABASE_URL: productionUrl({ host: pooledHost }),
    })),
    /direct connection validation/,
  );

  assert.throws(
    () => buildProductionPoolConfig(productionEnvironment({
      NEON_PRODUCTION_MIGRATION_DATABASE_URL:
        productionUrl({ host: "another-host.example" }),
    })),
    /production endpoint validation/,
  );
});

test("incorrect production database, role, and port are rejected", () => {
  assert.throws(
    () => buildProductionPoolConfig(productionEnvironment({
      NEON_PRODUCTION_MIGRATION_DATABASE_URL:
        productionUrl({ database: "otherdb" }),
    })),
    /production database validation/,
  );
  assert.throws(
    () => buildProductionPoolConfig(productionEnvironment({
      NEON_PRODUCTION_MIGRATION_DATABASE_URL:
        productionUrl({ role: "other_role" }),
    })),
    /production database validation/,
  );
  assert.throws(
    () => buildProductionPoolConfig(productionEnvironment({
      NEON_PRODUCTION_MIGRATION_DATABASE_URL: productionUrl({ port: "5433" }),
    })),
    /production database validation/,
  );
});

test("production requires an explicit secure SSL mode", () => {
  for (const sslMode of [null, "disable", "prefer", "no-verify"]) {
    assert.throws(
      () => buildProductionPoolConfig(productionEnvironment({
        NEON_PRODUCTION_MIGRATION_DATABASE_URL: productionUrl({ sslMode }),
      })),
      /TLS mode validation/,
    );
  }
});

test("production npm runner rejects invalid TLS without printing credentials", () => {
  const command = process.platform === "win32"
    ? process.env.ComSpec || "cmd.exe"
    : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd run db:migrate:neon:production"]
    : ["run", "db:migrate:neon:production"];
  const invalidUrl = productionUrl({ sslMode: "disable" });
  const result = spawnSync(command, args, {
    cwd: backendPath,
    encoding: "utf8",
    env: {
      ...process.env,
      NEON_PRODUCTION_MIGRATION_TARGET: "production",
      NEON_PRODUCTION_MIGRATION_DATABASE_URL: invalidUrl,
    },
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, output);
  assert.match(output, /TLS mode validation/);
  assert.doesNotMatch(output, new RegExp(fakePassword));
  assert.equal(output.includes(invalidUrl), false);
  assert.doesNotMatch(output, /\[RUN\]|\[PASS\] Migration/);
});

test("production PowerShell launcher prompts secretly and restores process environment", async () => {
  const launcher = await fs.readFile(
    new URL("../scripts/migrate-neon-production.ps1", import.meta.url),
    "utf8",
  );
  const packageJson = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.match(launcher, /Read-Host .* -AsSecureString/);
  assert.match(launcher, /\$env:NEON_PRODUCTION_MIGRATION_TARGET\s*=\s*"production"/);
  assert.match(launcher, /\$env:NEON_PRODUCTION_MIGRATION_DATABASE_URL\s*=/);
  assert.match(launcher, /npm\.cmd run db:migrate:neon:production/);
  assert.match(launcher, /SetEnvironmentVariable\("NEON_PRODUCTION_MIGRATION_DATABASE_URL"/);
  assert.match(launcher, /SetEnvironmentVariable\("NEON_PRODUCTION_MIGRATION_TARGET"/);
  assert.match(launcher, /ZeroFreeBSTR/);
  assert.equal(
    packageJson.scripts["db:migrate:neon:production"],
    "node scripts/migrate-neon-production.js",
  );
  assert.equal(
    packageJson.scripts["db:migrate:neon:production:windows"],
    "powershell -NoProfile -File scripts/migrate-neon-production.ps1",
  );
  assert.doesNotMatch(launcher, /Write-(?:Host|Output).*NEON_PRODUCTION_MIGRATION_DATABASE_URL/i);
});

test("production runner is connection-owning and invokes the shared migration engine", async () => {
  const runnerSource = await fs.readFile(
    new URL("../scripts/migrate-neon-production.js", import.meta.url),
    "utf8",
  );

  assert.equal(runProductionMigrations.length, 0);
  assert.match(runnerSource, /new pg\.Pool\(config\)/);
  assert.match(runnerSource, /runMigrationEngine\(/);
  assert.ok(runnerSource.includes("expectedRole: PRODUCTION_TARGET.role"));
  assert.doesNotMatch(runnerSource, /suppliedPool|seed\.sql/);
});

test("staging connection builder and entry point remain available", () => {
  const url = `postgresql://migration:${fakePassword}@${STAGING_TARGET.endpointHost}/neondb?sslmode=require`;
  const config = buildStagingPoolConfig({
    NEON_MIGRATION_TARGET: "staging",
    NEON_MIGRATION_DATABASE_URL: url,
  });

  assert.equal(config.host, STAGING_TARGET.endpointHost);
  assert.equal(config.database, "neondb");
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(typeof runStagingMigrations, "function");
});
