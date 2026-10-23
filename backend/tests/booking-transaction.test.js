import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createBookingRouter } from "../src/routes/bookings.js";

const validPayload = {
  customerName: "Pengguna Tes",
  customerEmail: "test@example.com",
  ticketCategoryId: "1",
  quantity: 2,
};

const category = {
  id: "1",
  name: "General",
  price: "350000.00",
  quota: 10,
  concert_id: "1",
  concert_slug: "konser-tes",
  concert_title: "Konser Pengujian",
};

const booking = {
  id: "101",
  bookingCode: "KK-0123456789ABCDEF",
  customerName: validPayload.customerName,
  quantity: validPayload.quantity,
  unitPrice: 350000,
  totalPrice: 700000,
  status: "pending",
  createdAt: "2026-01-01T00:00:00.000Z",
};

async function withApi(pool, run) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/bookings",
    createBookingRouter({
      pool,
      generateBookingCode: () => "KK-0123456789ABCDEF",
      logger: { error() {} },
    }),
  );

  const server = createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

function createMockPool({
  categoryResult = { rowCount: 1, rows: [category] },
  insertError = null,
  categoryError = null,
  quotaResult = { rowCount: 1, rows: [{ quota: 8 }] },
  quotaError = null,
  connectError = null,
} = {}) {
  const calls = [];
  let released = 0;

  const client = {
    async query(sql) {
      const normalized = sql.trim().replace(/\s+/g, " ");
      calls.push(normalized);

      if (normalized === "BEGIN") {
        return { rowCount: null, rows: [] };
      }

      if (normalized === "COMMIT") {
        return { rowCount: null, rows: [] };
      }

      if (normalized === "ROLLBACK") {
        return { rowCount: null, rows: [] };
      }

      if (normalized.startsWith("SELECT tc.id")) {
        if (categoryError) throw categoryError;
        return categoryResult;
      }

      if (normalized.startsWith("INSERT INTO bookings")) {
        if (insertError) throw insertError;
        return { rowCount: 1, rows: [booking] };
      }

      if (normalized.startsWith("UPDATE ticket_categories")) {
        if (quotaError) throw quotaError;
        return quotaResult;
      }

      throw new Error(`Query mock tidak dikenali: ${normalized}`);
    },

    release() {
      released += 1;
    },
  };

  const pool = {
    async connect() {
      calls.push("CONNECT");
      if (connectError) throw connectError;
      return client;
    },
    async query() {
      throw new Error("pool.query tidak diharapkan pada POST test");
    },
  };

  return {
    pool,
    calls,
    get released() {
      return released;
    },
  };
}

async function postBooking(baseUrl) {
  return fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validPayload),
  });
}

test("rollback ketika query kategori gagal dan koneksi dilepas", async () => {
  const mock = createMockPool({
    categoryError: new Error("simulated category query failure"),
  });

  await withApi(mock.pool, async (baseUrl) => {
    const response = await postBooking(baseUrl);
    assert.equal(response.status, 500);

    const body = await response.json();
    assert.equal(body.success, false);
  });

  assert.ok(mock.calls.includes("BEGIN"));
  assert.ok(mock.calls.includes("ROLLBACK"));
  assert.ok(!mock.calls.includes("COMMIT"));
  assert.equal(mock.released, 1);
});

test("rollback ketika INSERT booking gagal", async () => {
  const mock = createMockPool({
    insertError: new Error("simulated insert failure"),
  });

  await withApi(mock.pool, async (baseUrl) => {
    const response = await postBooking(baseUrl);
    assert.equal(response.status, 500);

    const body = await response.json();
    assert.equal(body.success, false);
  });

  assert.ok(mock.calls.includes("ROLLBACK"));
  assert.ok(!mock.calls.includes("COMMIT"));
  assert.equal(mock.released, 1);
});

test("rollback ketika UPDATE kuota gagal setelah INSERT", async () => {
  const mock = createMockPool({
    quotaError: new Error("simulated quota update failure"),
  });

  await withApi(mock.pool, async (baseUrl) => {
    const response = await postBooking(baseUrl);
    assert.equal(response.status, 500);
  });

  assert.ok(
    mock.calls.some((call) => call.startsWith("INSERT INTO bookings")),
  );
  assert.ok(
    mock.calls.some((call) => call.startsWith("UPDATE ticket_categories")),
  );
  assert.ok(mock.calls.includes("ROLLBACK"));
  assert.ok(!mock.calls.includes("COMMIT"));
  assert.equal(mock.released, 1);
});

test("kuota berubah menjadi tidak mencukupi: rollback dan HTTP 409", async () => {
  const mock = createMockPool({
    quotaResult: { rowCount: 0, rows: [] },
  });

  await withApi(mock.pool, async (baseUrl) => {
    const response = await postBooking(baseUrl);
    assert.equal(response.status, 409);

    const body = await response.json();
    assert.equal(body.success, false);
  });

  assert.ok(mock.calls.includes("ROLLBACK"));
  assert.ok(!mock.calls.includes("COMMIT"));
  assert.equal(mock.released, 1);
});

test("kategori tidak ditemukan: rollback dan HTTP 404", async () => {
  const mock = createMockPool({
    categoryResult: { rowCount: 0, rows: [] },
  });

  await withApi(mock.pool, async (baseUrl) => {
    const response = await postBooking(baseUrl);
    assert.equal(response.status, 404);
  });

  assert.ok(mock.calls.includes("ROLLBACK"));
  assert.ok(!mock.calls.includes("COMMIT"));
  assert.equal(mock.released, 1);
});

test("kuota tidak cukup sebelum INSERT: rollback dan HTTP 409", async () => {
  const mock = createMockPool({
    categoryResult: {
      rowCount: 1,
      rows: [{ ...category, quota: 1 }],
    },
  });

  await withApi(mock.pool, async (baseUrl) => {
    const response = await postBooking(baseUrl);
    assert.equal(response.status, 409);
  });

  assert.ok(mock.calls.includes("ROLLBACK"));
  assert.ok(
    !mock.calls.some((call) => call.startsWith("INSERT INTO bookings")),
  );
  assert.ok(!mock.calls.includes("COMMIT"));
  assert.equal(mock.released, 1);
});

test("transaksi berhasil melakukan COMMIT dan melepas koneksi", async () => {
  const mock = createMockPool();

  await withApi(mock.pool, async (baseUrl) => {
    const response = await postBooking(baseUrl);
    assert.equal(response.status, 201);

    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.bookingCode, "KK-0123456789ABCDEF");
    assert.equal(body.data.paymentSimulation, true);
  });

  assert.ok(mock.calls.includes("COMMIT"));
  assert.ok(!mock.calls.includes("ROLLBACK"));
  assert.equal(mock.released, 1);
});

test("kegagalan memperoleh koneksi mengembalikan 500 tanpa COMMIT", async () => {
  const mock = createMockPool({
    connectError: new Error("simulated connection failure"),
  });

  await withApi(mock.pool, async (baseUrl) => {
    const response = await postBooking(baseUrl);
    assert.equal(response.status, 500);
  });

  assert.ok(!mock.calls.includes("BEGIN"));
  assert.ok(!mock.calls.includes("COMMIT"));
  assert.equal(mock.released, 0);
});

test("GET booking mengembalikan 404 jika kode valid tidak ditemukan", async () => {
  const calls = [];
  const pool = {
    async connect() {
      throw new Error("connect tidak boleh dipanggil untuk GET");
    },
    async query(sql, values) {
      calls.push({ sql, values });
      return { rowCount: 0, rows: [] };
    },
  };

  await withApi(pool, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/bookings/KK-0123456789ABCDEF`,
    );

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(typeof body.message, "string");
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /WHERE b\.booking_code = \$1/);
  assert.deepEqual(calls[0].values, ["KK-0123456789ABCDEF"]);
});

test("GET booking mengembalikan data ketika kode ditemukan", async () => {
  const calls = [];
  const lookupRow = {
    bookingCode: "KK-0123456789ABCDEF",
    customerName: "Pengguna Tes",
    quantity: 2,
    unitPrice: 350000,
    totalPrice: 700000,
    status: "pending",
    ticketCategory: "General",
    concertSlug: "konser-tes",
    concertTitle: "Konser Pengujian",
    eventDate: "2027-01-17",
    eventTime: "19:00",
  };

  const pool = {
    async connect() {
      throw new Error("connect tidak boleh dipanggil untuk GET");
    },
    async query(sql, values) {
      calls.push({ sql, values });
      return { rowCount: 1, rows: [lookupRow] };
    },
  };

  await withApi(pool, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/bookings/KK-0123456789ABCDEF`,
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.bookingCode, "KK-0123456789ABCDEF");
    assert.equal(body.data.totalPrice, 700000);
    assert.equal(body.data.paymentSimulation, true);
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /WHERE b\.booking_code = \$1/);
  assert.deepEqual(calls[0].values, ["KK-0123456789ABCDEF"]);
});

test("GET booking mengembalikan 500 saat query database gagal", async () => {
  const pool = {
    async connect() {
      throw new Error("connect tidak boleh dipanggil untuk GET");
    },
    async query() {
      throw new Error("simulated lookup database failure");
    },
  };

  await withApi(pool, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/bookings/KK-0123456789ABCDEF`,
    );

    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(typeof body.message, "string");
  });
});
