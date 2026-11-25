import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDatabasePoolConfig,
  resolveDatabaseSsl,
} from "../src/config/database.js";

const credentials = {
  DB_NAME: "konserkita_db",
  DB_USER: "postgres",
  DB_PASSWORD: "test-password",
};

test("DB_* tetap mendukung PostgreSQL lokal tanpa TLS pada development", () => {
  const config = buildDatabasePoolConfig({
    ...credentials,
    NODE_ENV: "development",
  });
  assert.equal(config.host, "localhost");
  assert.equal(config.port, 5432);
  assert.equal(config.ssl, false);
});

test("development menerima DATABASE_URL loopback yang sesuai dengan DB_NAME", () => {
  const config = buildDatabasePoolConfig({
    DB_USER: "postgres",
    DB_HOST: "localhost",
    DB_PORT: "5432",
    DB_NAME: "konserkita_db",
    DATABASE_URL: "postgresql://postgres@localhost:5432/konserkita_db",
    NODE_ENV: "development",
  });

  assert.equal(config.host, "localhost");
  assert.equal(Number(config.port), 5432);
  assert.equal(config.database, "konserkita_db");
  assert.equal(config.ssl, false);
});

test("development menolak DATABASE_URL yang bukan target lokal KonserKita", () => {
  assert.throws(
    () => buildDatabasePoolConfig({
      ...credentials,
      DB_NAME: "konserkita_db",
      DATABASE_URL: "postgresql://app@ep-example.neon.tech/konserkita",
      NODE_ENV: "development",
    }),
    /must match the configured local KonserKita database/,
  );

  assert.throws(
    () => buildDatabasePoolConfig({
      DB_USER: "postgres",
      DB_NAME: "konserkita_db",
      DATABASE_URL: "postgresql://app@localhost:55432/konserkita_batch08",
      NODE_ENV: "development",
    }),
    /must match the configured local KonserKita database/,
  );

  assert.throws(
    () => buildDatabasePoolConfig({
      ...credentials,
      DB_USER: "other",
      DB_NAME: "konserkita_db",
      DATABASE_URL: "postgresql://other@localhost:5432/konserkita_db",
      NODE_ENV: "development",
    }),
    /must match the configured local KonserKita database/,
  );

  assert.throws(
    () => buildDatabasePoolConfig({
      ...credentials,
      DB_HOST: "localhost",
      DB_PORT: "55432",
      DB_NAME: "konserkita_db",
      NODE_ENV: "development",
    }),
    /must be the configured local KonserKita database/,
  );

  assert.throws(
    () => buildDatabasePoolConfig({
      DB_HOST: "localhost",
      DB_PORT: "5432",
      DB_NAME: "konserkita_db",
      DB_PASSWORD: "test-password",
      NODE_ENV: "development",
    }),
    /must be the configured local KonserKita database/,
  );
});

test("test environment juga menolak DATABASE_URL remote", () => {
  assert.throws(
    () => buildDatabasePoolConfig({
      DATABASE_URL: "postgresql://app@db.example.test/konserkita_test",
      NODE_ENV: "test",
    }),
    /Test DATABASE_URL must use a local database host/,
  );
});

test("production DATABASE_URL tetap menjadi pilihan eksplisit dan memakai TLS", () => {
  const config = buildDatabasePoolConfig({
    DATABASE_URL: "postgresql://app@db.example.test/konserkita",
    NODE_ENV: "production",
  });

  assert.equal(config.host, "db.example.test");
  assert.equal(config.database, "konserkita");
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("DB_* remote menggunakan TLS dengan validasi sertifikat", () => {
  const config = buildDatabasePoolConfig({
    ...credentials,
    DB_HOST: "ep-example.neon.tech",
    NODE_ENV: "production",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("DB_* remote dapat menggunakan CA yang dikonfigurasi", () => {
  const ca = "-----BEGIN CERTIFICATE-----\npublic-test-ca\n-----END CERTIFICATE-----";
  const config = buildDatabasePoolConfig({
    ...credentials,
    DB_HOST: "db.example.test",
    DATABASE_SSL_CA: ca,
    NODE_ENV: "production",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true, ca });
});

test("DATABASE_URL tetap memverifikasi sertifikat walau URL meminta no-verify", () => {
  const config = buildDatabasePoolConfig({
    DATABASE_URL: "postgresql://app@db.example.test/konserkita?sslmode=no-verify",
    NODE_ENV: "production",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("TLS tidak dapat dimatikan untuk host remote pada development", () => {
  assert.throws(
    () => resolveDatabaseSsl("development", "false", undefined, "db.example.test"),
    /only allowed for a local development database/,
  );
});

test("konfigurasi TLS dan port yang tidak valid ditolak", () => {
  assert.throws(
    () => buildDatabasePoolConfig({
      ...credentials,
      DATABASE_SSL: "maybe",
      NODE_ENV: "development",
    }),
    /DATABASE_SSL must be set to true or false/,
  );
  assert.throws(
    () => buildDatabasePoolConfig({
      ...credentials,
      DB_PORT: "not-a-port",
      NODE_ENV: "development",
    }),
    /DB_PORT must be an integer/,
  );
  assert.throws(
    () => buildDatabasePoolConfig({
      DATABASE_URL: "not-a-postgres-url",
      NODE_ENV: "production",
    }),
    (error) => {
      assert.match(error.message, /DATABASE_URL must be a PostgreSQL connection URL/);
      assert.equal(error.message.includes("not-a-postgres-url"), false);
      return true;
    },
  );
});
