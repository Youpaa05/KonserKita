import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import app from "../src/app.js";

let server;
let baseUrl;

before(async () => {
  server = createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

const invalidPayloads = [
  {
    name: "body kosong",
    body: {},
  },
  {
    name: "nama terlalu pendek",
    body: {
      customerName: "A",
      customerEmail: "test@example.com",
      ticketCategoryId: "1",
      quantity: 1,
    },
  },
  {
    name: "email tidak valid",
    body: {
      customerName: "Pengguna Tes",
      customerEmail: "bukan-email",
      ticketCategoryId: "1",
      quantity: 1,
    },
  },
  {
    name: "kategori tiket tidak valid",
    body: {
      customerName: "Pengguna Tes",
      customerEmail: "test@example.com",
      ticketCategoryId: "0",
      quantity: 1,
    },
  },
  {
    name: "jumlah tiket nol",
    body: {
      customerName: "Pengguna Tes",
      customerEmail: "test@example.com",
      ticketCategoryId: "1",
      quantity: 0,
    },
  },
  {
    name: "jumlah tiket pecahan",
    body: {
      customerName: "Pengguna Tes",
      customerEmail: "test@example.com",
      ticketCategoryId: "1",
      quantity: 1.5,
    },
  },
];

for (const scenario of invalidPayloads) {
  test(`POST booking menolak ${scenario.name}`, async () => {
    const response = await fetch(`${baseUrl}/api/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scenario.body),
    });

    assert.equal(response.status, 400);

    const result = await response.json();
    assert.equal(result.success, false);
    assert.equal(typeof result.message, "string");
  });
}

test("GET booking menolak format kode yang tidak valid", async () => {
  const response = await fetch(`${baseUrl}/api/bookings/INVALID`);

  assert.equal(response.status, 400);

  const result = await response.json();
  assert.equal(result.success, false);
  assert.equal(typeof result.message, "string");
});

test("endpoint yang tidak tersedia mengembalikan 404", async () => {
  const response = await fetch(`${baseUrl}/api/endpoint-tidak-ada`);

  assert.equal(response.status, 404);

  const result = await response.json();
  assert.equal(result.success, false);
});
