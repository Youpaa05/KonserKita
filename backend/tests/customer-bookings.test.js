import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createCustomerRouter } from "../src/routes/customer.js";
import { hashSessionToken } from "../src/utils/session.js";

const tokenA = "a".repeat(64);
const tokenB = "b".repeat(64);

const users = {
  [hashSessionToken(tokenA)]: {
    id: "customer-1",
    name: "Customer One",
    email: "one@example.com",
    role: "customer",
  },
  [hashSessionToken(tokenB)]: {
    id: "customer-2",
    name: "Customer Two",
    email: "two@example.com",
    role: "customer",
  },
};

const bookings = [
  {
    id: "101",
    booking_code: "KK-0123456789ABCDEF",
    user_id: "customer-1",
    customer_name: "Customer One",
    customer_email: "one@example.com",
    concert_title: "Konser Pengujian",
    concert_slug: "konser-pengujian",
    category_name: "Festival",
    quantity: 2,
    unit_price: "350000.00",
    total_price: "700000.00",
    status: "pending",
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

function createMockPool() {
  const calls = [];

  return {
    calls,
    async query(sql, params = []) {
      const normalized = sql.trim().replace(/\s+/g, " ");
      calls.push({ sql: normalized, params });

      if (normalized.includes("FROM user_sessions")) {
        const user = users[params[0]];
        return {
          rowCount: user ? 1 : 0,
          rows: user ? [user] : [],
        };
      }

      if (normalized.includes("FROM bookings")) {
        if (params.length === 2) {
          const [userId, bookingCode] = params;
          const found = bookings.find(
            (booking) =>
              booking.user_id === userId &&
              booking.booking_code === bookingCode,
          );

          return {
            rowCount: found ? 1 : 0,
            rows: found ? [found] : [],
          };
        }

        const userId = params[0];
        const rows = bookings.filter(
          (booking) => booking.user_id === userId,
        );

        return { rowCount: rows.length, rows };
      }

      throw new Error(`Query mock tidak dikenali: ${normalized}`);
    },
  };
}

async function withApi(pool, run) {
  const app = express();
  app.use(express.json());
  app.use("/api/customer", createCustomerRouter({ pool }));

  const server = createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

function authHeaders(token) {
  return { Cookie: `kk_session=${token}` };
}

test("riwayat booking menolak pengguna tanpa sesi", async () => {
  const pool = createMockPool();

  await withApi(pool, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/customer/bookings`);
    assert.equal(response.status, 401);

    const body = await response.json();
    assert.equal(body.success, false);
  });
});

test("customer hanya menerima riwayat booking miliknya", async () => {
  const pool = createMockPool();

  await withApi(pool, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/customer/bookings`, {
      headers: authHeaders(tokenA),
    });

    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.success, true);

    const serialized = JSON.stringify(body);
    assert.match(serialized, /KK-0123456789ABCDEF/);
    assert.doesNotMatch(serialized, /two@example\.com/);
  });
});

test("customer dapat melihat detail booking miliknya", async () => {
  const pool = createMockPool();

  await withApi(pool, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/customer/bookings/KK-0123456789ABCDEF`,
      { headers: authHeaders(tokenA) },
    );

    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.success, true);
    assert.match(JSON.stringify(body), /Konser Pengujian/);
  });
});

test("customer tidak dapat melihat booking milik customer lain", async () => {
  const pool = createMockPool();

  await withApi(pool, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/customer/bookings/KK-0123456789ABCDEF`,
      { headers: authHeaders(tokenB) },
    );

    assert.equal(response.status, 404);

    const body = await response.json();
    assert.equal(body.success, false);
  });
});

test("detail booking menolak format kode yang tidak valid", async () => {
  const pool = createMockPool();

  await withApi(pool, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/customer/bookings/KODE-TIDAK-VALID`,
      { headers: authHeaders(tokenA) },
    );

    assert.equal(response.status, 400);

    const body = await response.json();
    assert.equal(body.success, false);
  });
});
