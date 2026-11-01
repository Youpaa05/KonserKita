import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL?.trim();

const requiredVariables = [
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
];

const missingVariables = requiredVariables.filter(
  (name) => !process.env[name]?.trim(),
);

const databaseConfigured = databaseUrl || missingVariables.length === 0;

const pool = new Pool(
  databaseUrl
    ? {
        connectionString: databaseUrl,
        max: 10,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 30000,
      }
    : {
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        max: 10,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 30000,
      },
);

export { pool };

export async function checkDatabaseConnection() {
  if (!databaseConfigured) {
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
    console.error("Database connection failed:", error.message);

    return {
      connected: false,
      reason: "connection_failed",
    };
  }
}
