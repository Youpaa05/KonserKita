import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createBookingRouter } from "../src/routes/bookings.js";
import { hashSessionToken } from "../src/utils/session.js";

const bookingCode = "KK-0123456789ABCDEF";
const ownerToken = "a".repeat(64);
const otherToken = "b".repeat(64);
const adminToken = "c".repeat(64);

const sessions = new Map([
  [hashSessionToken(ownerToken), { id: "101", role: "customer", name: "Owner", email: "owner@example.test" }],
  [hashSessionToken(otherToken), { id: "202", role: "customer", name: "Other", email: "other@example.test" }],
  [hashSessionToken(adminToken), { id: "303", role: "admin", name: "Admin", email: "admin@example.test" }],
]);

function createMockPool(ownerUserId) {
  const calls = [];

  return {
    calls,
    async query(sql, values = []) {
      const normalized = sql.trim().replace(/\s+/g, " ");
      calls.push({ sql: normalized, values });

      if (normalized.includes("FROM user_sessions")) {
        const user = sessions.get(values[0]);
        return { rowCount: user ? 1 : 0, rows: user ? [user] : [] };
      }

      if (normalized.includes("FROM bookings AS b")) {
        const requestedUserId = values.length === 2 ? values[1] : null;
        const permitted =
          ownerUserId === null ||
          (requestedUserId !== null && requestedUserId === ownerUserId);
        const row = permitted
          ? {
              bookingCode,
              customerName: "Pemesan",
              status: "pending",
              paymentStatus: "pending",
            }
          : null;
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }

      throw new Error(`Query mock tidak dikenali: ${normalized}`);
    },
  };
}

async function withApi(pool, run) {
  const app = express();
  app.use("/api/bookings", createBookingRouter({ pool, logger: { error() {} } }));
  const server = createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function sessionCookie(token) {
  return { Cookie: `kk_session=${token}` };
}

test("guest masih dapat mencari booking guest dengan kode booking", async () => {
  await withApi(createMockPool(null), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/bookings/${bookingCode}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.bookingCode, bookingCode);
  });
});

test("guest tidak dapat mencari booking yang terhubung ke akun", async () => {
  await withApi(createMockPool("101"), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/bookings/${bookingCode}`);
    assert.equal(response.status, 404);
  });
});

test("customer hanya dapat mencari booking akun miliknya", async () => {
  await withApi(createMockPool("101"), async (baseUrl) => {
    const ownerResponse = await fetch(`${baseUrl}/api/bookings/${bookingCode}`, {
      headers: sessionCookie(ownerToken),
    });
    assert.equal(ownerResponse.status, 200);

    const otherResponse = await fetch(`${baseUrl}/api/bookings/${bookingCode}`, {
      headers: sessionCookie(otherToken),
    });
    assert.equal(otherResponse.status, 404);
  });
});

test("admin tidak dapat memakai endpoint lookup booking customer", async () => {
  await withApi(createMockPool(null), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/bookings/${bookingCode}`, {
      headers: sessionCookie(adminToken),
    });
    assert.equal(response.status, 403);
  });
});
