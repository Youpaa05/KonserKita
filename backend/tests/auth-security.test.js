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