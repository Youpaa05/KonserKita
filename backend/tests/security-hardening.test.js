import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import serverless from "serverless-http";
import { createRateLimiter, getClientIp } from "../src/middleware/rateLimit.js";
import { getSessionCookieOptions } from "../src/utils/session.js";
import { resolveDatabaseSsl } from "../src/config/database.js";
import pgConnectionString from "pg-connection-string";
import { createApp } from "../src/app.js";
import { createAuthRouter } from "../src/routes/auth.js";

function fakeResponse() {
  return { headers: {}, statusCode: 200, body: null, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test("rate limiter in-memory mengembalikan envelope 429 dan membuka kembali bucket setelah window", () => {
  let now = 1000; const limiter = createRateLimiter({ windowMs: 5000, max: 2, keyGenerator: (req) => req.key, now: () => now });
  let passed = 0;
  for (let index = 0; index < 2; index++) { const response = fakeResponse(); limiter({ key: "admin-7" }, response, () => { passed += 1; }); assert.equal(response.statusCode, 200); }
  const blocked = fakeResponse(); limiter({ key: "admin-7" }, blocked, () => { passed += 1; });
  assert.equal(passed, 2); assert.equal(blocked.statusCode, 429); assert.equal(blocked.body.success, false); assert.equal(blocked.body.retryAfterSeconds, 5); assert.equal(blocked.headers["Retry-After"], "5");
  now += 5000; const reset = fakeResponse(); limiter({ key: "admin-7" }, reset, () => { passed += 1; }); assert.equal(reset.statusCode, 200); assert.equal(passed, 3);
});

test("IP Netlify hanya diambil dari event adapter atau header Netlify yang tervalidasi", () => {
  assert.equal(
    getClientIp({
      apiGateway: {
        event: { requestContext: { identity: { sourceIp: "203.0.113.10" } } },
      },
      headers: { "x-nf-client-connection-ip": "203.0.113.11" },
    }),
    "203.0.113.10",
  );
  assert.equal(
    getClientIp({
      apiGateway: { event: {} },
      headers: { "x-nf-client-connection-ip": "203.0.113.11" },
    }),
    "203.0.113.11",
  );
  assert.equal(
    getClientIp({
      headers: { "x-nf-client-connection-ip": "203.0.113.11", "x-forwarded-for": "203.0.113.12" },
    }),
    null,
  );
  assert.equal(
    getClientIp({ ip: "127.0.0.1", headers: { "x-forwarded-for": "203.0.113.12" } }),
    "127.0.0.1",
  );
});

test("serverless-http meneruskan source IP event ke middleware Express", async () => {
  const app = express();
  app.get("/ip", (req, res) => res.json({ ip: getClientIp(req) }));
  const handler = serverless(app);
  const response = await handler({
    httpMethod: "GET",
    path: "/ip",
    headers: {},
    body: null,
    isBase64Encoded: false,
    requestContext: { identity: { sourceIp: "203.0.113.20" } },
  }, {});

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).ip, "203.0.113.20");
});

test("rate limiter menolak request tanpa IP daripada menggabungkannya ke bucket unknown", () => {
  let queries = 0;
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 1,
    pool: { async query() { queries += 1; return { rowCount: 1, rows: [] }; } },
    store: "postgres",
  });
  const response = fakeResponse();

  limiter({ headers: { "x-forwarded-for": "203.0.113.10" } }, response, () => {
    assert.fail("Request tanpa sumber IP tepercaya tidak boleh diteruskan.");
  });

  assert.equal(response.statusCode, 503);
  assert.equal(queries, 0);
});

test("rate limiter PostgreSQL membagikan counter secara atomik antar-instance", async () => {
  const queries = [];
  let count = 0;
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.startsWith("DELETE")) return { rowCount: 0, rows: [] };
      count += 1;
      return {
        rowCount: 1,
        rows: [{ request_count: count, reset_at: values[3] }],
      };
    },
  };
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 1,
    scope: "test-shared",
    keyGenerator: (req) => req.key,
    now: () => 120_000,
    pool,
    store: "postgres",
  });
  let passed = 0;
  const first = fakeResponse();
  await limiter({ key: "shared-user" }, first, () => { passed += 1; });
  const second = fakeResponse();
  await limiter({ key: "shared-user" }, second, () => { passed += 1; });

  assert.equal(passed, 1);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /ON CONFLICT \(scope, identity_hash, window_start\)/);
  assert.equal(queries[0].values[0], "test-shared");
  assert.match(queries[0].values[1], /^[a-f0-9]{64}$/);
});

test("database URL TLS memverifikasi sertifikat dan hanya dapat dimatikan pada development", () => {
  assert.deepEqual(resolveDatabaseSsl("production", "false"), { rejectUnauthorized: true });
  assert.deepEqual(resolveDatabaseSsl("development", "true"), { rejectUnauthorized: true });
  assert.equal(resolveDatabaseSsl("development", "false"), false);
  const parsed = pgConnectionString.parse("postgresql://db.example.test/konserkita?sslmode=no-verify");
  const effectiveSsl = resolveDatabaseSsl("production", "false", parsed.ssl?.ca);
  assert.deepEqual(effectiveSsl, { rejectUnauthorized: true });
});

test("secure cookie tidak mempercayai X-Forwarded-Proto mentah", () => {
  const options = getSessionCookieOptions({ secure: false, get: () => "https" });
  assert.equal(options.secure, process.env.NODE_ENV === "production");
  assert.equal(options.httpOnly, true); assert.equal(options.sameSite, "lax");
});

test("API memasang security headers dan tidak mencatat pesan error mentah", async () => {
  const messages = []; const brokenRouter = express.Router();
  brokenRouter.get("/failure", (_req, _res, next) => next(Object.assign(new Error("sensitive-password-token"), { code: "TEST" })));
  const emptyRouter = express.Router();
  const app = createApp({ concertRouter: brokenRouter, bookingRouter: emptyRouter, authRouter: emptyRouter, adminRouter: emptyRouter, customerRouter: emptyRouter, paymentRouter: emptyRouter, customerTicketRouter: emptyRouter, adminTicketRouter: emptyRouter, databaseHealthCheck: async () => ({ connected: true }), logger: { error: (...values) => messages.push(values) } });
  assert.equal(app.get("trust proxy"), false);
  const server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(`${base}/api/health`); assert.equal(health.status, 200); assert.equal(health.headers.get("x-content-type-options"), "nosniff"); assert.equal(health.headers.get("x-frame-options"), "DENY"); assert.equal(health.headers.get("referrer-policy"), "strict-origin-when-cross-origin"); assert.equal(health.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()"); assert.match(health.headers.get("content-security-policy"), /script-src 'self'/); assert.doesNotMatch(health.headers.get("content-security-policy"), /'unsafe-inline'/); assert.equal(health.headers.get("x-powered-by"), null);
    const failure = await fetch(`${base}/api/concerts/failure`); assert.equal(failure.status, 500); assert.equal(messages.length, 1); assert.equal(JSON.stringify(messages).includes("sensitive-password-token"), false);
  } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

test("login menerapkan account-based rate limit sebelum query autentikasi berikutnya", async () => {
  let userLookups = 0;
  const pool = { async query(sql) { if (sql.includes("FROM user_sessions")) return { rowCount: 0, rows: [] }; if (sql.includes("FROM users u")) { userLookups += 1; return { rowCount: 0, rows: [] }; } throw new Error("query tidak dikenal"); } };
  const server = createServer(express().use(express.json()).use("/api/auth", createAuthRouter({ pool })));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/api/auth/login`;
    const request = () => fetch(endpoint, { method: "POST", headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" }, body: JSON.stringify({ email: "limited@example.test", password: "incorrect-password" }) });
    for (let index = 0; index < 10; index++) assert.equal((await request()).status, 401);
    const limited = await request(); const body = await limited.json();
    assert.equal(limited.status, 429); assert.equal(body.success, false); assert.ok(Number(limited.headers.get("retry-after")) > 0); assert.equal(userLookups, 10);
  } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
