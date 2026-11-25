import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createConcertRouter } from "../src/routes/concerts.js";

async function withApi(pool, run) {
  const app = express(); app.use("/api/concerts", createConcertRouter({ pool }));
  const server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("pencarian mendukung filter artist/tanggal, sorting whitelist dan pagination terbatas", async () => {
  const calls = [];
  const pool = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql.includes("COUNT(*)")) return { rowCount: 1, rows: [{ total: 23 }] };
    return { rowCount: 1, rows: [{ id: "2", title: "Konser" }] };
  } };
  await withApi(pool, async (base) => {
    const response = await fetch(`${base}/api/concerts?q=%25_%27&artist=Band&dateFrom=2027-01-01&dateTo=2027-12-31&availability=available&sort=price&direction=desc&page=2&limit=10`);
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.data.page, 2); assert.equal(body.data.totalPages, 3); assert.equal(body.data.concerts.length, 1);
    assert.match(calls[0].sql, /ORDER BY price DESC NULLS LAST/); assert.equal(calls[0].values.at(-2), 10); assert.equal(calls[0].values.at(-1), 10);
    assert.match(calls[0].sql, /available_tc\.quota > 0/);
    assert.equal(calls[0].values.includes("%Band%"), true); assert.equal(calls[0].sql.includes("%_%"), false);
  });
});

test("parameter pagination, tanggal dan sorting yang invalid ditolak", async () => withApi({ async query() { throw new Error("query seharusnya tidak dipanggil"); } }, async (base) => {
  for (const query of ["page=0", "limit=500", "sort=title%3BDROP%20TABLE", "dateFrom=2027-02-30", "availability=maybe", "dateFrom=2027-12-01&dateTo=2027-01-01"]) {
    const response = await fetch(`${base}/api/concerts?${query}`); assert.equal(response.status, 400, query);
  }
}));

test("pemanggil lama tetap menerima array bounded tanpa parameter pagination", async () => withApi({ async query(sql) { assert.match(sql, /LIMIT \$1/); return { rowCount: 0, rows: [] }; } }, async (base) => {
  const response = await fetch(`${base}/api/concerts`); const body = await response.json(); assert.equal(response.status, 200); assert.deepEqual(body.data, []);
}));

test("katalog handler mengembalikan beberapa konser aktif dan total pagination", async () => {
  const activeConcerts = [
    { id: "11", slug: "concert-one", title: "Concert One" },
    { id: "12", slug: "concert-two", title: "Concert Two" },
    { id: "13", slug: "concert-three", title: "Concert Three" },
  ];
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("COUNT(*)")) {
        return { rowCount: 1, rows: [{ total: activeConcerts.length }] };
      }
      return { rowCount: activeConcerts.length, rows: activeConcerts };
    },
  };

  const router = createConcertRouter({ pool });
  const route = router.stack.find((layer) => layer.route?.path === "/");
  assert.ok(route, "GET catalog route should be registered");
  const handler = route.route.stack.find((layer) => layer.method === "get")?.handle;
  assert.equal(typeof handler, "function");
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler(
    { query: { page: "1", limit: "50" } },
    response,
    (error) => { throw error; },
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data.concerts.map(({ id }) => id), ["11", "12", "13"]);
  assert.equal(response.body.data.total, 3);
  assert.equal(response.body.data.totalPages, 1);

  const listQuery = calls.find(({ sql }) => !sql.includes("COUNT(*)"));
  const countQuery = calls.find(({ sql }) => sql.includes("COUNT(*)"));
  for (const { sql } of [listQuery, countQuery]) {
    assert.match(sql, /c\.archived_at IS NULL/);
    assert.match(sql, /c\.cancelled_at IS NULL/);
    assert.doesNotMatch(sql, /\bJOIN\b/i);
    assert.doesNotMatch(sql, /category\s+ILIKE/i);
  }
  assert.deepEqual(listQuery.values, [50, 0]);
});

test("detail konser dan kategori mengembalikan lineup, venue, harga, dan kuota aktif dari API", async () => {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("SELECT id FROM concerts WHERE slug")) {
        return { rowCount: 1, rows: [{ id: "7" }] };
      }
      if (sql.includes("name,") && sql.includes("quota") && sql.includes("FROM ticket_categories")) {
        return {
          rowCount: 1,
          rows: [{ id: "12", name: "Festival", price: 250000, quota: 4 }],
        };
      }
      const legacy = values[0] === "old-concert";
      return {
        rowCount: 1,
        rows: [legacy
          ? { id: "8", slug: "old-concert", title: "Konser Lama", artist: "The Solo", lineup: ["The Solo"], venue: "Gedung Lama", city: "Bandung" }
          : { id: "7", slug: "band-live", title: "Band Live", artist: "The Band; Guest Artist", lineup: ["The Band", "Guest Artist"], venue: "Arena Utama", city: "Jakarta" }],
      };
    },
  };

  await withApi(pool, async (base) => {
    const detailResponse = await fetch(`${base}/api/concerts/band-live`);
    const detail = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(detail.data.artist, "The Band; Guest Artist");
    assert.deepEqual(detail.data.lineup, ["The Band", "Guest Artist"]);
    assert.equal(detail.data.venue, "Arena Utama");

    const categoryResponse = await fetch(`${base}/api/concerts/band-live/ticket-categories`);
    const categories = await categoryResponse.json();
    assert.equal(categoryResponse.status, 200);
    assert.deepEqual(categories.data, [{ id: "12", name: "Festival", price: 250000, quota: 4 }]);

    const legacyResponse = await fetch(`${base}/api/concerts/old-concert`);
    const legacy = await legacyResponse.json();
    assert.equal(legacyResponse.status, 200);
    assert.equal(legacy.data.artist, "The Solo");
    assert.deepEqual(legacy.data.lineup, ["The Solo"]);
  });

  assert.ok(calls.some(({ sql }) => sql.includes("c.artist")));
  assert.ok(calls.some(({ sql }) => sql.includes("string_to_array(c.artist, ';')")));
  assert.ok(calls.some(({ sql }) => sql.includes("AND archived_at IS NULL")));
});
