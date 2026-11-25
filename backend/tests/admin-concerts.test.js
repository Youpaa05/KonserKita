import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createAdminRouter } from "../src/routes/admin.js";
import {
  generateSessionToken,
  hashSessionToken,
  SESSION_COOKIE_NAME,
} from "../src/utils/session.js";

const validPayload = {
  title: "Konser Pengujian",
  artist: "Artist Test",
  category: "Festival",
  city: "Jakarta",
  venue: "Venue Test",
  eventDate: "2027-05-20",
  eventTime: "19:00",
  accent: "#8b5cf6",
  imageUrl: "https://example.com/concert.jpg",
  description: "Deskripsi konser untuk pengujian.",
  ticketCategories: [
    { name: "Regular", price: 100000, quota: 100 },
    { name: "VIP", price: 250000, quota: 50 },
  ],
};

const concert = {
  id: "42",
  slug: "konser-pengujian",
  title: "Konser Pengujian",
  artist: "Artist Test",
  category: "Festival",
  city: "Jakarta",
  venue: "Venue Test",
  eventDate: "2027-05-20",
  eventTime: "19:00",
  accent: "#8b5cf6",
  imageUrl: "https://example.com/concert.jpg",
  description: "Deskripsi konser untuk pengujian.",
  archivedAt: null,
  categoryCount: 2,
};

async function withApi(
  {
    role = "admin",
    authenticated = true,
    categoryInsertError = null,
  } = {},
  run,
) {
  const calls = [];
  let released = 0;
  let connected = 0;
  let insertedCategories = 0;

  const client = {
    async query(sql) {
      const normalized = sql.trim().replace(/\s+/g, " ");
      calls.push(normalized);

      if (normalized === "BEGIN" ||
          normalized === "COMMIT" ||
          normalized === "ROLLBACK") {
        return { rowCount: null, rows: [] };
      }

      if (normalized.startsWith("INSERT INTO concerts")) {
        return {
          rowCount: 1,
          rows: [{ id: "42", slug: "konser-pengujian-a1b2c3d4" }],
        };
      }

      if (normalized.startsWith("INSERT INTO ticket_categories")) {
        if (categoryInsertError) throw categoryInsertError;
        insertedCategories += 1;
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`Client query mock tidak dikenal: ${normalized}`);
    },

    release() {
      released += 1;
    },
  };

  const pool = {
    async query(sql) {
      const normalized = sql.trim().replace(/\s+/g, " ");
      calls.push(normalized);

      if (normalized.includes("FROM user_sessions")) {
        return {
          rowCount: authenticated ? 1 : 0,
          rows: authenticated
            ? [{
                id: 1,
                name: "Pengguna Tes",
                email: "test@example.com",
                role,
              }]
            : [],
        };
      }

      if (normalized.includes('AS "categoryCount"')) {
        return { rowCount: 1, rows: [concert] };
      }

      if (normalized.includes('AS "ticketCategories"')) {
        return {
          rowCount: 1,
          rows: [{
            ...concert,
            ticketCategories: [
              { id: "1", name: "Regular", price: 100000, quota: 100 },
              { id: "2", name: "VIP", price: 250000, quota: 50 },
            ],
          }],
        };
      }

      if (normalized.startsWith("UPDATE concerts")) {
        return {
          rowCount: 1,
          rows: [{
            id: "42",
            slug: "konser-pengujian",
            archivedAt: new Date("2027-01-01T00:00:00.000Z"),
          }],
        };
      }

      throw new Error(`Pool query mock tidak dikenal: ${normalized}`);
    },

    async connect() {
      connected += 1;
      return client;
    },
  };

  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminRouter({ pool }));
  app.use((error, _req, res, _next) => {
    res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  });

  const server = createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const token = generateSessionToken();
  const cookie = `${SESSION_COOKIE_NAME}=${token}`;

  try {
    const address = server.address();
    await run({
      baseUrl: `http://127.0.0.1:${address.port}`,
      cookie,
      calls,
      get released() { return released; },
      get connected() { return connected; },
      get insertedCategories() { return insertedCategories; },
      tokenHash: hashSessionToken(token),
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function request(baseUrl, path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

function adminHeaders(cookie) {
  return { Cookie: cookie };
}

test("admin API menolak request tanpa autentikasi", async () => {
  await withApi({ authenticated: false }, async ({ baseUrl }) => {
    const response = await request(baseUrl, "/api/admin/concerts");

    assert.equal(response.status, 401);

    const body = await response.json();
    assert.equal(body.success, false);
  });
});

test("admin API menolak customer dengan HTTP 403", async () => {
  await withApi({ role: "customer" }, async ({ baseUrl, cookie }) => {
    const response = await request(
      baseUrl,
      "/api/admin/concerts",
      { headers: adminHeaders(cookie) },
    );

    assert.equal(response.status, 403);

    const body = await response.json();
    assert.equal(body.success, false);
  });
});

test("pembatalan konser hanya admin, wajib beralasan, dan tidak menghapus relasi transaksi", async () => {
  await withApi({ role: "customer" }, async ({ baseUrl, cookie }) => {
    const response = await request(baseUrl, "/api/admin/concerts/42/cancel", {
      method: "POST", headers: { ...adminHeaders(cookie), "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Jadwal berubah" }),
    });
    assert.equal(response.status, 403);
  });
  await withApi({}, async ({ baseUrl, cookie, calls }) => {
    const invalid = await request(baseUrl, "/api/admin/concerts/42/cancel", {
      method: "POST", headers: { ...adminHeaders(cookie), "Content-Type": "application/json" },
      body: JSON.stringify({ reason: " " }),
    });
    assert.equal(invalid.status, 400);
    const response = await request(baseUrl, "/api/admin/concerts/42/cancel", {
      method: "POST", headers: { ...adminHeaders(cookie), "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Jadwal berubah" }),
    });
    assert.equal(response.status, 200);
    assert.ok(calls.some((sql) => sql.startsWith("UPDATE concerts SET cancelled_at=")));
    assert.ok(!calls.some((sql) => sql.startsWith("DELETE FROM")));
  });
});

test("endpoint pesanan admin menolak pengguna tanpa sesi dan customer", async () => {
  await withApi({ authenticated: false }, async ({ baseUrl }) => {
    const response = await request(baseUrl, "/api/admin/orders");
    assert.equal(response.status, 401);
  });
  await withApi({ role: "customer" }, async ({ baseUrl, cookie }) => {
    const response = await request(baseUrl, "/api/admin/orders", { headers: adminHeaders(cookie) });
    assert.equal(response.status, 403);
  });
});

test("admin dapat melihat daftar konser aktif, arsip, dan semua", async () => {
  await withApi({}, async ({ baseUrl, cookie, calls }) => {
    for (const status of ["active", "archived", "all"]) {
      const response = await request(
        baseUrl,
        `/api/admin/concerts?status=${status}`,
        { headers: adminHeaders(cookie) },
      );

      assert.equal(response.status, 200);

      const body = await response.json();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data));
    }

    assert.ok(calls.some((sql) => sql.includes("WHERE c.archived_at IS NULL")));
    assert.ok(calls.some((sql) => sql.includes("WHERE c.archived_at IS NOT NULL")));
  });
});

test("admin dapat melihat detail konser dan ID tidak valid ditolak", async () => {
  await withApi({}, async ({ baseUrl, cookie, calls }) => {
    const response = await request(
      baseUrl,
      "/api/admin/concerts/42",
      { headers: adminHeaders(cookie) },
    );

    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.id, "42");
    assert.ok(Array.isArray(body.data.ticketCategories));

    const callsBeforeInvalid = calls.length;

    const invalid = await request(
      baseUrl,
      "/api/admin/concerts/invalid",
      { headers: adminHeaders(cookie) },
    );

    assert.equal(invalid.status, 400);
    assert.equal(calls.length, callsBeforeInvalid + 1);
  });
});

test("admin dapat membuat konser dan kategori tiket dalam satu transaksi", async () => {
  await withApi({}, async (context) => {
    const { baseUrl, cookie, calls } = context;
    const response = await request(
      baseUrl,
      "/api/admin/concerts",
      {
        method: "POST",
        headers: {
          ...adminHeaders(cookie),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validPayload),
      },
    );

    assert.equal(response.status, 201);

    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.id, "42");

    assert.ok(calls.includes("BEGIN"));
    assert.ok(calls.includes("COMMIT"));
    assert.ok(!calls.includes("ROLLBACK"));
    assert.equal(context.insertedCategories, 2);
    assert.equal(context.released, 1);
  });
});

test("pembuatan konser menolak kategori tiket tidak valid", async () => {
  await withApi({}, async ({ baseUrl, cookie, connected }) => {
    const invalidPayload = {
      ...validPayload,
      ticketCategories: [
        { name: "Regular", price: -100, quota: 100 },
      ],
    };

    const response = await request(
      baseUrl,
      "/api/admin/concerts",
      {
        method: "POST",
        headers: {
          ...adminHeaders(cookie),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(invalidPayload),
      },
    );

    assert.equal(response.status, 400);
    assert.equal(connected, 0);
  });
});

test("kegagalan INSERT kategori melakukan rollback dan melepas koneksi", async () => {
  await withApi(
    { categoryInsertError: new Error("simulated category insert failure") },
    async (context) => {
      const { baseUrl, cookie, calls } = context;
      const response = await request(
        baseUrl,
        "/api/admin/concerts",
        {
          method: "POST",
          headers: {
            ...adminHeaders(cookie),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(validPayload),
        },
      );

      assert.equal(response.status, 500);
      assert.ok(calls.includes("BEGIN"));
      assert.ok(calls.includes("ROLLBACK"));
      assert.ok(!calls.includes("COMMIT"));
      assert.equal(context.released, 1);
    },
  );
});

test("admin dapat memperbarui konser aktif", async () => {
  await withApi({}, async ({ baseUrl, cookie, calls }) => {
    const payload = { ...validPayload };
    delete payload.ticketCategories;

    const response = await request(
      baseUrl,
      "/api/admin/concerts/42",
      {
        method: "PUT",
        headers: {
          ...adminHeaders(cookie),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.success, true);
    assert.ok(calls.some((sql) =>
      sql.startsWith("UPDATE concerts") &&
      sql.includes("archived_at IS NULL")
    ));
  });
});

test("admin mengarsipkan konser tanpa menghapus relasinya", async () => {
  await withApi({}, async ({ baseUrl, cookie, calls }) => {
    const response = await request(
      baseUrl,
      "/api/admin/concerts/42",
      {
        method: "DELETE",
        headers: adminHeaders(cookie),
      },
    );

    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.success, true);
    assert.match(body.message, /Riwayat booking tetap dipertahankan/);

    assert.ok(calls.some((sql) =>
      sql.startsWith("UPDATE concerts") &&
      sql.includes("archived_at=NOW()")
    ));

    assert.ok(!calls.some((sql) => sql.startsWith("DELETE FROM")));
  });
});

test("admin dapat memulihkan konser yang diarsipkan", async () => {
  await withApi({}, async ({ baseUrl, cookie, calls }) => {
    const response = await request(
      baseUrl,
      "/api/admin/concerts/42/restore",
      {
        method: "POST",
        headers: adminHeaders(cookie),
      },
    );

    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.success, true);

    assert.ok(calls.some((sql) =>
      sql.startsWith("UPDATE concerts") &&
      sql.includes("archived_at=NULL")
    ));
  });
});
