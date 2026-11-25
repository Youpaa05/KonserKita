import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
} from "../src/utils/password.js";
import {
  generateSessionToken,
  hashSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "../src/utils/session.js";
import {
  isTrustedOrigin,
  requireTrustedOrigin,
} from "../src/middleware/trustedOrigin.js";

test("development mempercayai dua origin lokal exact dan menolak origin asing", () => {
  const previousNodeEnvironment = process.env.NODE_ENV;
  const previousFrontendUrl = process.env.FRONTEND_URL;
  process.env.NODE_ENV = "development";
  process.env.FRONTEND_URL = "http://127.0.0.1:5173";

  try {
    assert.equal(isTrustedOrigin({ get(name) { return name === "origin" ? "http://localhost:5173" : undefined; } }), true);
    assert.equal(isTrustedOrigin({ get(name) { return name === "origin" ? "http://127.0.0.1:5173" : undefined; } }), true);
    assert.equal(isTrustedOrigin({ get(name) { return name === "origin" ? "https://attacker.example" : undefined; } }), false);
    assert.equal(isTrustedOrigin({ get(name) { return name === "origin" ? "http://localhost:5173.evil.test" : undefined; } }), false);
    assert.equal(isTrustedOrigin({ get() { return undefined; } }), false);

    process.env.NODE_ENV = "production";
    process.env.FRONTEND_URL = "https://concerts.example.test";
    assert.equal(isTrustedOrigin({ get(name) { return name === "origin" ? "https://concerts.example.test" : undefined; } }), true);
    assert.equal(isTrustedOrigin({ get(name) { return name === "origin" ? "http://localhost:5173" : undefined; } }), false);
  } finally {
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnvironment;
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
  }
});

test("trusted-origin middleware menerima kedua origin lokal dan menolak origin asing", () => {
  const previousNodeEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";

  try {
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173"]) {
      let proceeded = false;
      const response = {
        status() { return this; },
        json() { assert.fail("origin valid tidak boleh ditolak"); },
      };
      requireTrustedOrigin(
        { get(name) { return name === "origin" ? origin : undefined; } },
        response,
        () => { proceeded = true; },
      );
      assert.equal(proceeded, true);
    }

    let proceeded = false;
    let statusCode = null;
    let body = null;
    const response = {
      status(code) { statusCode = code; return this; },
      json(value) { body = value; return this; },
    };
    requireTrustedOrigin(
      { get(name) { return name === "origin" ? "https://attacker.example" : undefined; } },
      response,
      () => { proceeded = true; },
    );
    assert.equal(proceeded, false);
    assert.equal(statusCode, 403);
    assert.equal(body.success, false);

    proceeded = false;
    statusCode = null;
    requireTrustedOrigin(
      { get() { return undefined; } },
      response,
      () => { proceeded = true; },
    );
    assert.equal(proceeded, false);
    assert.equal(statusCode, 403);
  } finally {
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnvironment;
  }
});

test("password disimpan sebagai scrypt hash, bukan plaintext", async () => {
  const password = "KonserKita-Test-Password-2026";
  const encoded = await hashPassword(password);

  assert.notEqual(encoded, password);
  assert.match(encoded, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("password-salah", encoded), false);
});

test("password dengan panjang di luar batas ditolak", async () => {
  await assert.rejects(
    () => hashPassword("pendek"),
    /10 sampai 128/,
  );

  await assert.rejects(
    () => hashPassword("x".repeat(129)),
    /10 sampai 128/,
  );
});

test("format hash tidak valid tidak dapat diverifikasi", async () => {
  assert.equal(await verifyPassword("password-valid", "invalid-hash"), false);
});

test("session token memiliki 256 bit entropy dalam representasi hex", () => {
  const token = generateSessionToken();

  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(token.length, 64);
});

test("hash token konsisten dan tidak sama dengan token asli", () => {
  const token = generateSessionToken();
  const firstHash = hashSessionToken(token);
  const secondHash = hashSessionToken(token);

  assert.equal(firstHash, secondHash);
  assert.notEqual(firstHash, token);
  assert.match(firstHash, /^[a-f0-9]{64}$/);
});

test("token malformed ditolak oleh fungsi hash", () => {
  assert.throws(() => hashSessionToken("token-tidak-valid"));
});

test("konfigurasi session memiliki cookie dan masa berlaku yang ditetapkan", () => {
  assert.equal(SESSION_COOKIE_NAME, "kk_session");
  assert.equal(SESSION_MAX_AGE_SECONDS, 604800);
});