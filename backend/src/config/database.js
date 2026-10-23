import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const requiredVariables = [
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
];

const missingVariables = requiredVariables.filter(
  (name) => !process.env[name]?.trim(),
);

export const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || undefined,
  user: process.env.DB_USER || undefined,
  password: process.env.DB_PASSWORD || undefined,
  max: 10,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
});

export async function checkDatabaseConnection() {
  if (missingVariables.length > 0) {
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
