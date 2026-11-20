import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";

async function withServer(callback) {
  const app = createApp({
    logger: {
      error() {},
    },
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