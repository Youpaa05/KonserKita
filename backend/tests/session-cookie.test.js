import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createApp, resolveCorsOrigin } from "../src/app.js";
import {
  getSessionCookieOptions,
  SESSION_MAX_AGE_SECONDS,
} from "../src/utils/session.js";

test("cookie default local mempertahankan atribut aman dan SameSite=Lax", () => {
  const options = getSessionCookieOptions(
    { secure: false },
    { NODE_ENV: "development" },
  );

  assert.deepEqual(options, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS * 1000,
  });
});

test("cookie production memakai Secure untuk deployment same-site", () => {
  const options = getSessionCookieOptions(
    { secure: false },
    { NODE_ENV: "production" },
  );

  assert.equal(options.secure, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.httpOnly, true);
});

test("cookie cross-site hanya diaktifkan untuk production dengan origin frontend HTTPS eksplisit", () => {
  const options = getSessionCookieOptions(
    { secure: false },
    {
      NODE_ENV: "production",
      SESSION_COOKIE_SAME_SITE: "None",
      FRONTEND_URL: "https://concerts.example.test",
    },
  );

  assert.equal(options.sameSite, "none");
  assert.equal(options.secure, true);
  assert.equal(options.httpOnly, true);
  assert.equal(options.path, "/");
  assert.equal(options.maxAge, SESSION_MAX_AGE_SECONDS * 1000);
});

test("cookie cross-site menolak development, HTTP, origin wildcard, dan nilai invalid", () => {
  for (const environment of [
    {
      NODE_ENV: "development",
      SESSION_COOKIE_SAME_SITE: "none",
      FRONTEND_URL: "https://concerts.example.test",
    },
    {
      NODE_ENV: "production",
      SESSION_COOKIE_SAME_SITE: "none",
      FRONTEND_URL: "http://concerts.example.test",
    },
    {
      NODE_ENV: "production",
      SESSION_COOKIE_SAME_SITE: "none",
      FRONTEND_URL: "https://*.example.test",
    },
    {
      NODE_ENV: "production",
      SESSION_COOKIE_SAME_SITE: "strict",
      FRONTEND_URL: "https://concerts.example.test",
    },
  ]) {
    assert.throws(() => getSessionCookieOptions({ secure: false }, environment));
  }
});

test("CORS production mensyaratkan satu origin HTTPS eksplisit", () => {
  assert.equal(
    resolveCorsOrigin({
      NODE_ENV: "production",
      FRONTEND_URL: "https://concerts.example.test",
    }),
    "https://concerts.example.test",
  );
  assert.throws(() => resolveCorsOrigin({ NODE_ENV: "production" }));
  assert.throws(() => resolveCorsOrigin({
    NODE_ENV: "production",
    FRONTEND_URL: "http://concerts.example.test",
  }));
  assert.throws(() => resolveCorsOrigin({
    NODE_ENV: "production",
    FRONTEND_URL: "https://*.example.test",
  }));
  assert.equal(
    resolveCorsOrigin({ NODE_ENV: "development" }),
    "http://localhost:5173",
  );
});

test("CORS cross-site memakai origin eksplisit dan credentials tanpa wildcard", async () => {
  const previousFrontendUrl = process.env.FRONTEND_URL;
  const previousNodeEnvironment = process.env.NODE_ENV;
  const frontendOrigin = "https://concerts.example.test";
  process.env.FRONTEND_URL = frontendOrigin;
  process.env.NODE_ENV = "production";

  const emptyRouter = express.Router();
  const app = createApp({
    concertRouter: emptyRouter,
    bookingRouter: emptyRouter,
    authRouter: emptyRouter,
    adminRouter: emptyRouter,
    customerRouter: emptyRouter,
    paymentRouter: emptyRouter,
    customerTicketRouter: emptyRouter,
    adminTicketRouter: emptyRouter,
    logger: { error() {} },
  });
  const server = createServer(app);

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const allowed = await fetch(`${baseUrl}/api/auth/login`, {
      method: "OPTIONS",
      headers: {
        Origin: frontendOrigin,
        "Access-Control-Request-Method": "POST",
      },
    });
    const denied = await fetch(`${baseUrl}/api/auth/login`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://attacker.example",
        "Access-Control-Request-Method": "POST",
      },
    });

    assert.equal(allowed.headers.get("access-control-allow-origin"), frontendOrigin);
    assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
    assert.equal(denied.headers.get("access-control-allow-origin"), frontendOrigin);
    assert.notEqual(denied.headers.get("access-control-allow-origin"), "https://attacker.example");
    assert.notEqual(denied.headers.get("access-control-allow-origin"), "*");
    assert.equal(denied.headers.get("access-control-allow-credentials"), "true");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnvironment;
  }
});
