import test from "node:test";
import assert from "node:assert/strict";
import { buildDatabasePoolConfig } from "../src/config/database.js";

const credentials = {
  DB_NAME: "konserkita",
  DB_USER: "konserkita_app",
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
    () => buildDatabasePoolConfig({
      ...credentials,
      DB_HOST: "db.example.test",
      DATABASE_SSL: "false",
      NODE_ENV: "development",
    }),
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
