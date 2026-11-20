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
