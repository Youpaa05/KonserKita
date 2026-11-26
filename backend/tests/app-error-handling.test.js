import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Router } from "express";
import { createApp } from "../src/app.js";

async function withServer(callback, appOptions = {}) {
  const app = createApp({
    logger: {
      error() {},
    },
    ...appOptions,
  });

  const server = createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

test("health endpoint memakai standard success envelope", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(typeof body.message, "string");
    assert.equal(body.service, "konserkita-backend");
  });
});

test("malformed JSON menghasilkan HTTP 400", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{",
    });

    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.message, "Format JSON tidak valid.");
  });
});

test("unexpected API errors return a safe response and log limited diagnostics", async () => {
  const sensitiveValue = "private-database-value";
  const logs = [];
  const concertRouter = Router();

  concertRouter.get("/trigger-error", (_req, _res, next) => {
    const error = new Error(`Database failure ${sensitiveValue}`);
    Object.assign(error, {
      name: "DatabaseError",
      code: "23505",
      detail: sensitiveValue,
      hint: sensitiveValue,
      where: sensitiveValue,
      query: `INSERT INTO users VALUES ('${sensitiveValue}')`,
      parameters: [sensitiveValue],
      connectionString: `postgresql://user:${sensitiveValue}@host/database`,
    });
    next(error);
  });

  concertRouter.get("/unsafe-error-code", (_req, _res, next) => {
    const error = new Error("Request failed");
    error.code = sensitiveValue;
    next(error);
  });

  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/concerts/trigger-error?token=${sensitiveValue}`,
    );
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, {
      success: false,
      message: "Terjadi kesalahan pada server.",
    });
    assert.equal(JSON.stringify(body).includes(sensitiveValue), false);

    const unsafeCodeResponse = await fetch(
      `${baseUrl}/api/concerts/unsafe-error-code`,
    );
    assert.equal(unsafeCodeResponse.status, 500);
    assert.equal((await unsafeCodeResponse.json()).message, "Terjadi kesalahan pada server.");
  }, {
    concertRouter,
    logger: {
      error(...args) {
        logs.push(args);
      },
    },
  });

  assert.deepEqual(logs, [
    [
      "API request failed:",
      {
        name: "DatabaseError",
        code: "23505",
        method: "GET",
      },
    ],
    [
      "API request failed:",
      {
        name: "Error",
        code: "unknown",
        method: "GET",
      },
    ],
  ]);
  assert.equal(JSON.stringify(logs).includes(sensitiveValue), false);
  assert.equal(JSON.stringify(logs).includes("INSERT INTO users"), false);
});

test("errors after headers are sent are delegated without a second response", async () => {
  const expectedError = new Error("Failure after response started");
  const logs = [];
  const concertRouter = Router();
  concertRouter.get("/headers-sent", (_req, res, next) => {
    res.status(202).type("text/plain").write("partial response");
    next(expectedError);
  });

  const app = createApp({
    concertRouter,
    logger: {
      error(...args) {
        logs.push(args);
      },
    },
  });
  let forwardedError;
  app.use((error, _req, res, next) => {
    if (error !== expectedError) return next(error);
    forwardedError = { error, headersSent: res.headersSent };
    res.end();
  });

  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/concerts/headers-sent`,
      { signal: AbortSignal.timeout(2000) },
    );

    assert.equal(response.status, 202);
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(await response.text(), "partial response");
    assert.deepEqual(forwardedError, {
      error: expectedError,
      headersSent: true,
    });
    assert.deepEqual(logs, []);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

test("request body terlalu besar menghasilkan HTTP 413", async () => {
  await withServer(async (baseUrl) => {
    const oversizedBody =
      '{"customerName":"' + "a".repeat(110 * 1024) + '"}';

    const response = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: oversizedBody,
    });

    const body = await response.json();

    assert.equal(response.status, 413);
    assert.equal(body.success, false);
    assert.equal(typeof body.message, "string");
  });
});

test("endpoint tidak tersedia menghasilkan standard error envelope", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/endpoint-tidak-ada`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.success, false);
    assert.equal(typeof body.message, "string");
  });
});

test("database health failure menghasilkan HTTP 503", async () => {
  const app = createApp({
    databaseHealthCheck: async () => ({
      connected: false,
      reason: "connection_failed",
    }),
    logger: {
      error() {},
    },
  });

  const server = createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/health/db`,
    );

    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.success, false);
    assert.equal(body.database, "unavailable");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});