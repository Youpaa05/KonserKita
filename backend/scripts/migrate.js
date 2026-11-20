import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  pool,
  databaseConfigured,
  missingVariables,
} from "../src/config/database.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

const migrationsDirectory = path.resolve(
  currentDirectory,
  "../database/migrations",
);

const EXPECTED_DATABASE = "konserkita_db";
const EXPECTED_DATABASE_USER = "postgres";
const EXPECTED_PORT = 5432;
const ADVISORY_LOCK_KEY = 2026111801;

function calculateChecksum(content) {
  return crypto
    .createHash("sha256")
    .update(content)
    .digest("hex");
}

function isLocalAddress(address) {
  return [
    "::1",
    "::1/128",
    "127.0.0.1",
    "127.0.0.1/32",
  ].includes(address);
}

async function verifyDatabaseIdentity(client) {
  const result = await client.query(`
    SELECT
      current_database() AS database_name,
      current_user AS database_user,
      inet_server_addr()::text AS server_address,
      inet_server_port() AS server_port,
      current_setting('transaction_read_only') AS read_only
  `);

  const identity = result.rows[0];

  console.log("[DATABASE TARGET]");
  console.log(JSON.stringify(identity, null, 2));

  if (identity.database_name !== EXPECTED_DATABASE) {
    throw new Error("Migration ditolak: nama database tidak sesuai.");
  }

  if (identity.database_user !== EXPECTED_DATABASE_USER) {
    throw new Error("Migration ditolak: pengguna database tidak sesuai.");
  }

  if (!isLocalAddress(identity.server_address)) {
    throw new Error("Migration ditolak: server bukan loopback lokal.");
  }

  if (Number(identity.server_port) !== EXPECTED_PORT) {
    throw new Error("Migration ditolak: port database tidak sesuai.");
  }

  if (identity.read_only !== "off") {
    throw new Error("Migration ditolak: koneksi sedang read-only.");
  }

  console.log("[PASS] Identitas database terverifikasi.");
}

async function getMigrationFiles() {
  const entries = await fs.readdir(migrationsDirectory, {
    withFileTypes: true,
  });

  const files = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^\d+_[a-zA-Z0-9_-]+\.sql$/.test(entry.name),
    )
    .map((entry) => entry.name);

  const migrations = files.map((file) => {
    const version = file.split("_")[0];

    return {
      file,
      version,
      numericVersion: BigInt(version),
    };
  });

  const seenVersions = new Set();

  for (const migration of migrations) {
    const numericVersion = migration.numericVersion.toString();

    if (seenVersions.has(numericVersion)) {
      throw new Error(
        `Nomor versi migration duplikat: ${migration.version}`,
      );
    }

    seenVersions.add(numericVersion);
  }

  migrations.sort((a, b) => {
    if (a.numericVersion < b.numericVersion) return -1;
    if (a.numericVersion > b.numericVersion) return 1;
    return 0;
  });

  return migrations;
}

async function executeTransaction(client, callback) {
  await client.query("BEGIN");

  try {
    const result = await callback();

    await client.query("COMMIT");

    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Migration gagal dan rollback juga mengalami kegagalan.",
      );
    }

    throw error;
  }
}

async function runMigrations() {
  let client;
  let lockAcquired = false;

  try {
    if (!databaseConfigured) {
      throw new Error(
        `Konfigurasi database tidak lengkap: ${missingVariables.join(", ")}`,
      );
    }

    client = await pool.connect();

    // Tidak ada operasi perubahan database sebelum identitas diverifikasi.
    await verifyDatabaseIdentity(client);

    await client.query(
      "SELECT pg_advisory_lock($1)",
      [ADVISORY_LOCK_KEY],
    );

    lockAcquired = true;

    const migrations = await getMigrationFiles();

    if (migrations.length === 0) {
      console.log("[INFO] Tidak ada file migration.");
      return;
    }

    // Buat tabel tracking secara transaksional.
    await executeTransaction(client, async () => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
          version VARCHAR(20) PRIMARY KEY,
          name VARCHAR(200) NOT NULL,
          checksum CHAR(64) NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    });

    const historyResult = await client.query(`
      SELECT version, name, checksum
      FROM public.schema_migrations
    `);

    const appliedMigrations = new Map(
      historyResult.rows.map((row) => [row.version, row]),
    );

    const availableVersions = new Set(
      migrations.map((migration) => migration.version),
    );

    // Riwayat tanpa file sumber merupakan kondisi yang harus dihentikan.
    for (const version of appliedMigrations.keys()) {
      if (!availableVersions.has(version)) {
        throw new Error(
          `Riwayat migration ${version} tidak memiliki file SQL yang sesuai.`,
        );
      }
    }

    for (const migration of migrations) {
      const { file, version } = migration;

      const sql = await fs.readFile(
        path.join(migrationsDirectory, file),
        "utf8",
      );

      const normalizedSql = sql
        .replace(/^\uFEFF/, "")
        .replace(/\r\n/g, "\n");

      const checksum = calculateChecksum(normalizedSql);

      if (normalizedSql.trim().length === 0) {
        throw new Error(`Migration kosong: ${file}`);
      }

      if (normalizedSql.length > 1000000) {
        throw new Error(`Ukuran migration terlalu besar: ${file}`);
      }

      const existing = appliedMigrations.get(version);

      if (existing) {
        if (
          existing.name !== file ||
          existing.checksum.trim() !== checksum
        ) {
          throw new Error(
            `Nama atau checksum migration ${version} berubah setelah diterapkan.`,
          );
        }

        console.log(`[SKIP] ${file} sudah diterapkan.`);
        continue;
      }

      console.log(`[RUN] ${file}`);

      await executeTransaction(client, async () => {
        await client.query(normalizedSql);

        await client.query(
          `INSERT INTO public.schema_migrations
             (version, name, checksum)
           VALUES ($1, $2, $3)`,
          [version, file, checksum],
        );
      });

      console.log(`[PASS] ${file}`);

      appliedMigrations.set(version, {
        version,
        name: file,
        checksum,
      });
    }

    console.log("[PASS] Seluruh migration selesai.");
  } finally {
    if (client && lockAcquired) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock($1)",
          [ADVISORY_LOCK_KEY],
        );
      } catch (error) {
        console.error(
          "[WARN] Gagal melepas advisory lock:",
          error.message,
        );
      }
    }

    client?.release();

    await pool.end();
  }
}

runMigrations().catch((error) => {
  console.error("[MIGRATION FAILED]", error.message);
  process.exitCode = 1;
});