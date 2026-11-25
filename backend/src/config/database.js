import dotenv from "dotenv";
import { isIP } from "node:net";
import path from "node:path";
import pg from "pg";
import pgConnectionString from "pg-connection-string";

const workingDirectory = path.resolve(process.cwd());
const backendDirectory =
  path.basename(workingDirectory).toLowerCase() === "backend"
    ? workingDirectory
    : path.resolve(workingDirectory, "backend");
const envPath = path.join(backendDirectory, ".env");

dotenv.config({ path: envPath });

const { Pool } = pg;

const POOL_OPTIONS = {
  max: 10,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
};

const DEVELOPMENT_DATABASE = {
  host: "localhost",
  port: 5432,
  name: "konserkita_db",
  user: "postgres",
};

function isLoopbackHost(host) {
  const normalized = String(host || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  const isLoopbackIpv4 = isIP(normalized) === 4 && normalized.split(".")[0] === "127";
  return normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    isLoopbackIpv4;
}

function parseSslSetting(value) {
  const setting = String(value || "").trim().toLowerCase();
  if (!setting) return null;
  if (setting === "true") return true;
  if (setting === "false") return false;
  throw new Error("DATABASE_SSL must be set to true or false.");
}

export function resolveDatabaseSsl(
  nodeEnvironment,
  sslSetting,
  ca,
  host = "localhost",
  defaultEnabled = true,
) {
  const localHost = isLoopbackHost(host);
  const setting = parseSslSetting(sslSetting);

  if (setting === false) {
    if (nodeEnvironment === "production") {
      return { rejectUnauthorized: true, ...(typeof ca === "string" && ca ? { ca } : {}) };
    }
    if (!localHost) {
      throw new Error("DATABASE_SSL=false is only allowed for a local development database.");
    }
    return false;
  }

  if (setting === true || defaultEnabled || !localHost || nodeEnvironment === "production") {
    return { rejectUnauthorized: true, ...(typeof ca === "string" && ca ? { ca } : {}) };
  }

  return false;
}

function parseDatabasePort(value) {
  if (value === undefined || value === null || String(value).trim() === "") return 5432;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DB_PORT must be an integer between 1 and 65535.");
  }
  return port;
}

function parseDatabaseUrl(value) {
  if (!/^postgres(?:ql)?:\/\//i.test(value)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL.");
  }

  try {
    const parsed = pgConnectionString.parse(value);
    if (!parsed.host || !parsed.database) {
      throw new Error("Invalid PostgreSQL connection URL.");
    }
    return parsed;
  } catch {
    throw new Error("DATABASE_URL is invalid; provide a PostgreSQL host and database.");
  }
}

export function buildDatabasePoolConfig(environment = process.env) {
  const databaseUrl = environment.DATABASE_URL?.trim();
  const nodeEnvironment = environment.NODE_ENV;
  const isProduction = nodeEnvironment === "production";

  if (databaseUrl) {
    const parsed = parseDatabaseUrl(databaseUrl);
    if (!isProduction) {
      if (nodeEnvironment === "test" && !isLoopbackHost(parsed.host)) {
        throw new Error("Test DATABASE_URL must use a local database host.");
      }

      if (nodeEnvironment !== "test") {
        const port = parsed.port === undefined || parsed.port === null
          ? 5432
          : Number(parsed.port);
        const expectedHost = environment.DB_HOST?.trim() || DEVELOPMENT_DATABASE.host;
        const expectedPort = parseDatabasePort(environment.DB_PORT);
        const expectedDatabase = environment.DB_NAME?.trim() || DEVELOPMENT_DATABASE.name;
        const expectedUser = environment.DB_USER?.trim() || DEVELOPMENT_DATABASE.user;

        if (
          !isLoopbackHost(expectedHost) ||
          expectedHost.toLowerCase() !== DEVELOPMENT_DATABASE.host ||
          expectedHost.toLowerCase() !== parsed.host.toLowerCase() ||
          expectedPort !== DEVELOPMENT_DATABASE.port ||
          port !== expectedPort ||
          expectedDatabase !== DEVELOPMENT_DATABASE.name ||
          parsed.database !== expectedDatabase ||
          expectedUser !== DEVELOPMENT_DATABASE.user ||
          expectedUser !== parsed.user
        ) {
          throw new Error("Development DATABASE_URL must match the configured local KonserKita database.");
        }
      }
    }

    const ca = environment.DATABASE_SSL_CA || parsed.ssl?.ca;
    return {
      ...parsed,
      ssl: resolveDatabaseSsl(
        nodeEnvironment,
        environment.DATABASE_SSL,
        ca,
        parsed.host,
        isProduction,
      ),
      ...POOL_OPTIONS,
    };
  }

  const host = environment.DB_HOST?.trim() || DEVELOPMENT_DATABASE.host;
  const port = parseDatabasePort(environment.DB_PORT);
  const database = environment.DB_NAME?.trim();
  const user = environment.DB_USER?.trim();

  if (!isProduction) {
    if (nodeEnvironment === "test") {
      if (!isLoopbackHost(host)) {
        throw new Error("Test database must use a local database host.");
      }
    } else if (
      !isLoopbackHost(host) ||
      host.toLowerCase() !== DEVELOPMENT_DATABASE.host ||
      port !== DEVELOPMENT_DATABASE.port ||
      database !== DEVELOPMENT_DATABASE.name ||
      user !== DEVELOPMENT_DATABASE.user
    ) {
      throw new Error("Development database must be the configured local KonserKita database.");
    }
  }

  return {
    host,
    port,
    database,
    user,
    password: environment.DB_PASSWORD,
    ssl: resolveDatabaseSsl(
      nodeEnvironment,
      environment.DATABASE_SSL,
      environment.DATABASE_SSL_CA,
      host,
      false,
    ),
    ...POOL_OPTIONS,
  };
}

export const requiredVariables = [
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
];

export const missingVariables = requiredVariables.filter(
  (name) => !process.env[name]?.trim(),
);

export const databaseConfigured =
  Boolean(process.env.DATABASE_URL?.trim()) || missingVariables.length === 0;

export const pool = new Pool(buildDatabasePoolConfig());

export async function checkDatabaseConnection() {
  if (!databaseConfigured) {
    console.error(
      "Database configuration missing:",
      missingVariables,
    );

    return {
      connected: false,
      reason: "configuration_missing",
    };
  }

  try {
    await pool.query("SELECT 1");

    return {
      connected: true,
    };
  } catch (error) {
    console.error("Database connection failed:", { name: error?.name || "Error", code: error?.code || "unknown" });

    return {
      connected: false,
      reason: "connection_failed",
    };
  }
}
