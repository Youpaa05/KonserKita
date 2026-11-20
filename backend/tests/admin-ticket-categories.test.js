import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createAdminRouter } from "../src/routes/admin.js";
import {
  generateSessionToken,
  SESSION_COOKIE_NAME,
} from "../src/utils/session.js";

async function withApi(options = {}, run) {
  const {
    role = "admin",
    authenticated = true,
    concertExists = true,
    categoryExists = true,
    duplicateOnCreate = false,
    duplicateOnEdit = false,
    categoryConcertId = "42",
    rollbackFails = false,
  } = options;

  const calls = [];
  const queryParameters = [];
  const rollbackLogs = [];
  const categoryState = {
    id: "7",
    concert_id: categoryConcertId,
    name: "Regular",
    price: 100000,
    quota: 100,
  };
  let released = 0;
  let releasedWithError = false;
  let connected = 0;

  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim().replace(/\s+/g, " ");
      calls.push(normalized);
      queryParameters.push({ sql: normalized, values: [...values] });

      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
        if (normalized === "ROLLBACK" && rollbackFails) {
          throw Object.assign(new Error("sensitive rollback detail"), { code: "XX999" });
        }
        return { rowCount: null, rows: [] };
      }

      if (normalized.startsWith("SELECT id FROM concerts")) {
        return {
          rowCount: concertExists ? 1 : 0,
          rows: concertExists ? [{ id: "42" }] : [],
        };
      }

      if (normalized.startsWith("SELECT id FROM ticket_categories")) {
        const duplicate = normalized.includes("id <>")
          ? duplicateOnEdit
          : duplicateOnCreate;

        return {
          rowCount: duplicate ? 1 : 0,
          rows: duplicate ? [{ id: "99" }] : [],
        };
      }

      if (normalized.startsWith("SELECT tc.id")) {
        const scopedUpdate = normalized.includes("WHERE c.id = $1::bigint");
        const belongsToConcert = scopedUpdate
          ? values[0] === categoryState.concert_id
          : true;
        const matchesCategory = values[scopedUpdate ? 1 : 0] === categoryState.id;
        const found = categoryExists && belongsToConcert && matchesCategory;
        return { rowCount: found ? 1 : 0, rows: found ? [{ id: categoryState.id, concert_id: categoryState.concert_id }] : [] };
      }

      if (normalized.startsWith("INSERT INTO ticket_categories")) {
        return {
          rowCount: 1,
          rows: [{
            id: "7",
            concertId: "42",
            name: "Regular",
            price: 100000,
            quota: 100,
            createdAt: "2027-01-01T00:00:00.000Z",
          }],
        };
      }

      if (normalized.startsWith("UPDATE ticket_categories")) {
        if (normalized.includes("SET archived_at = COALESCE")) {
          return { rowCount: 1, rows: [{ id: categoryState.id }] };
        }
        if (normalized.includes("SET archived_at = NULL")) {
          return { rowCount: 1, rows: [{ id: categoryState.id }] };
        }

        const idParameter = Number(normalized.match(/WHERE id = \$(\d+)::bigint/)?.[1]);
        const concertParameter = Number(normalized.match(/AND concert_id = \$(\d+)::bigint/)?.[1]);
        const matchesTarget = values[idParameter - 1] === categoryState.id &&
          values[concertParameter - 1] === categoryState.concert_id;
        if (!matchesTarget) return { rowCount: 0, rows: [] };

        const setClause = normalized.match(/SET (.+?) WHERE/)?.[1];
        const assignments = setClause?.split(", ") || [];
        for (const assignment of assignments) {
          const match = assignment.match(/^(name|price|quota) = \$(\d+)$/);
          if (!match) throw new Error(`Assignment kategori tidak menggunakan parameter: ${assignment}`);
          categoryState[match[1]] = values[Number(match[2]) - 1];
        }

        return {
          rowCount: 1,
          rows: [{
            id: categoryState.id,
            concertId: categoryState.concert_id,
            name: categoryState.name,
            price: categoryState.price,
            quota: categoryState.quota,
          }],
        };
      }

      throw new Error(`Client query mock tidak dikenal: ${normalized}`);
    },

    release() {
      released += 1;
      releasedWithError = arguments.length > 0 && Boolean(arguments[0]);
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
                name: "Admin Test",
                email: "admin@example.com",
                role,
              }]
            : [],
        };
      }

      throw new Error(`Pool query mock tidak dikenal: ${normalized}`);
    },

    async connect() {
      connected += 1;
      return client;
    },
  };
  const logger = {
    error(...values) {
      rollbackLogs.push(values);
    },
  };

  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminRouter({ pool, logger }));

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
      queryParameters,
      categoryState,
      rollbackLogs,
      getReleased: () => released,
      getReleasedWithError: () => releasedWithError,
      get connected() { return connected; },
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("admin dapat membuat kategori tiket", async () => {
  await withApi({}, async ({ baseUrl, cookie, calls, getReleased }) => {
    const response = await fetch(
      `${baseUrl}/api/admin/concerts/42/ticket-categories`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({
          name: "Regular",
          price: 100000,
          quota: 100,
        }),
      },
    );

    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.data.name, "Regular");
    assert.equal(body.data.concertId, "42");
    assert.ok(calls.includes("BEGIN"));
    assert.ok(calls.includes("COMMIT"));
    assert.equal(getReleased(), 1);
  });
});

test("pembuatan kategori menolak harga dan kuota tidak valid", async () => {
  await withApi({}, async ({ baseUrl, cookie, connected }) => {
    const invalidPayloads = [
      { name: "Regular", price: -1, quota: 10 },
      { name: "Regular", price: 100.123, quota: 10 },
      { name: "Regular", price: 100, quota: -1 },
      { name: "Regular", price: 100, quota: 1.5 },
      { name: "   ", price: 100, quota: 10 },
      { name: "A".repeat(81), price: 100, quota: 10 },
    ];

    for (const payload of invalidPayloads) {
      const response = await fetch(
        `${baseUrl}/api/admin/concerts/42/ticket-categories`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
          },
          body: JSON.stringify(payload),
        },
      );

      assert.equal(response.status, 400);
    }

    assert.equal(connected, 0);
  });
});

test("pembuatan kategori menolak nama duplikat", async () => {
  await withApi(
    { duplicateOnCreate: true },
    async ({ baseUrl, cookie, calls }) => {
      const response = await fetch(
        `${baseUrl}/api/admin/concerts/42/ticket-categories`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
          },
          body: JSON.stringify({
            name: "regular",
            price: 100000,
            quota: 100,
          }),
        },
      );

      const body = await response.json();

      assert.equal(response.status, 409);
      assert.equal(body.success, false);
      assert.ok(calls.includes("ROLLBACK"));
      assert.ok(!calls.some((sql) => sql.startsWith("INSERT INTO ticket_categories")));
    },
  );
});

test("pembuatan kategori menolak konser yang tidak aktif atau tidak ditemukan", async () => {
  await withApi(
    { concertExists: false },
    async ({ baseUrl, cookie, calls }) => {
      const response = await fetch(
        `${baseUrl}/api/admin/concerts/42/ticket-categories`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
          },
          body: JSON.stringify({
            name: "Regular",
            price: 100000,
            quota: 100,
          }),
        },
      );

      assert.equal(response.status, 404);
      assert.ok(calls.includes("ROLLBACK"));
    },
  );
});

test("admin dapat mengubah nama kategori tanpa mengubah harga dan kuota", async () => {
  await withApi({}, async ({ baseUrl, cookie, calls, queryParameters, categoryState, getReleased }) => {
    const response = await fetch(
      `${baseUrl}/api/admin/concerts/42/ticket-categories/7`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({ name: "Premium" }),
      },
    );

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.name, "Premium");
    assert.equal(body.data.price, 100000);
    assert.equal(body.data.quota, 100);
    assert.deepEqual(categoryState, {
      id: "7",
      concert_id: "42",
      name: "Premium",
      price: 100000,
      quota: 100,
    });

    const updateQuery = calls.find((sql) =>
      sql.startsWith("UPDATE ticket_categories"),
    );

    assert.ok(updateQuery);
    assert.match(updateQuery, /SET name = \$1 WHERE id = \$2::bigint\s+AND concert_id = \$3::bigint/);
    assert.deepEqual(
      queryParameters.find(({ sql }) => sql.startsWith("UPDATE ticket_categories")).values,
      ["Premium", "7", "42"],
    );
    assert.ok(!updateQuery.includes("price ="));
    assert.ok(!updateQuery.includes("quota ="));
    assert.ok(calls.includes("COMMIT"));
    assert.equal(getReleased(), 1);
  });
});

test("perubahan nama kategori menolak nama duplikat", async () => {
  await withApi(
    { duplicateOnEdit: true },
    async ({ baseUrl, cookie, calls }) => {
      const response = await fetch(
        `${baseUrl}/api/admin/concerts/42/ticket-categories/7`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
          },
          body: JSON.stringify({ name: "regular" }),
        },
      );

      assert.equal(response.status, 409);
      assert.ok(calls.includes("ROLLBACK"));
      assert.ok(!calls.some((sql) => sql.startsWith("UPDATE ticket_categories")));
    },
  );
});

test("perubahan nama kategori menolak kategori yang tidak ditemukan", async () => {
  await withApi(
    { categoryExists: false },
    async ({ baseUrl, cookie, calls }) => {
      const response = await fetch(
        `${baseUrl}/api/admin/concerts/42/ticket-categories/7`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
          },
          body: JSON.stringify({ name: "Premium" }),
        },
      );

      assert.equal(response.status, 404);
      assert.ok(calls.includes("ROLLBACK"));
    },
  );
});

test("endpoint kategori menolak pengguna yang belum login", async () => {
  await withApi(
    { authenticated: false },
    async ({ baseUrl }) => {
      const response = await fetch(
        `${baseUrl}/api/admin/concerts/42/ticket-categories`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Regular",
            price: 100000,
            quota: 100,
          }),
        },
      );

      assert.equal(response.status, 401);
    },
  );
});

test("endpoint kategori menolak pengguna non-admin", async () => {
  await withApi(
    { role: "customer" },
    async ({ baseUrl, cookie }) => {
      const response = await fetch(
        `${baseUrl}/api/admin/concerts/42/ticket-categories`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
          },
          body: JSON.stringify({
            name: "Regular",
            price: 100000,
            quota: 100,
          }),
        },
      );

      assert.equal(response.status, 403);
    },
  );
});

test("endpoint kategori menolak ID yang tidak valid", async () => {
  await withApi({}, async ({ baseUrl, cookie, connected }) => {
    const response = await fetch(
      `${baseUrl}/api/admin/concerts/invalid/ticket-categories`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({
          name: "Regular",
          price: 100000,
          quota: 100,
        }),
      },
    );

    assert.equal(response.status, 400);
    assert.equal(connected, 0);
  });
});
// Bench C regression tests: Tasks 067-069.
test("admin dapat memperbarui harga kategori tiket", async () => {
  await withApi({}, async ({ baseUrl, cookie, calls, categoryState, queryParameters }) => {
    const response = await fetch(
      `${baseUrl}/api/admin/concerts/42/ticket-categories/7`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({ price: 250000 }),
      },
    );

    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.price, 250000);
    assert.equal(categoryState.price, 250000);
    assert.ok(calls.some((call) => call.startsWith("UPDATE ticket_categories")));
    assert.deepEqual(
      queryParameters.find(({ sql }) => sql.startsWith("UPDATE ticket_categories")).values,
      [250000, "7", "42"],
    );
  });
});

test("admin dapat memperbarui kuota kategori tiket", async () => {
  await withApi({}, async ({ baseUrl, cookie, calls, categoryState, queryParameters }) => {
    const response = await fetch(
      `${baseUrl}/api/admin/concerts/42/ticket-categories/7`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({ quota: 50 }),
      },
    );

    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.quota, 50);
    assert.equal(categoryState.quota, 50);
    assert.ok(calls.some((call) => call.startsWith("UPDATE ticket_categories")));
    assert.deepEqual(
      queryParameters.find(({ sql }) => sql.startsWith("UPDATE ticket_categories")).values,
      [50, "7", "42"],
    );
  });
});

test("update kategori menyimpan nama, harga, dan kuota dari parameter terikat", async () => {
  await withApi({}, async ({ baseUrl, cookie, categoryState, queryParameters }) => {
    const response = await fetch(
      `${baseUrl}/api/admin/concerts/42/ticket-categories/7`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({ name: "VIP", price: 275000.5, quota: 37 }),
      },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(
      {
        name: body.data.name,
        price: body.data.price,
        quota: body.data.quota,
      },
      { name: "VIP", price: 275000.5, quota: 37 },
    );
    assert.deepEqual(
      {
        name: categoryState.name,
        price: categoryState.price,
        quota: categoryState.quota,
      },
      { name: "VIP", price: 275000.5, quota: 37 },
    );
    assert.deepEqual(
      queryParameters.find(({ sql }) => sql.startsWith("UPDATE ticket_categories")).values,
      ["VIP", 275000.5, 37, "7", "42"],
    );
  });
});

test("update kategori menolak kategori yang bukan milik konser pada route", async () => {
  await withApi({}, async ({ baseUrl, cookie, calls, categoryState }) => {
    const before = { ...categoryState };
    const response = await fetch(
      `${baseUrl}/api/admin/concerts/99/ticket-categories/7`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({ price: 500000 }),
      },
    );

    assert.equal(response.status, 404);
    assert.deepEqual(categoryState, before);
    assert.ok(!calls.some((sql) => sql.startsWith("UPDATE ticket_categories")));
  });
});

test("update kategori menolak harga, kuota, dan nama di luar batas", async () => {
  await withApi({}, async ({ baseUrl, cookie, connected }) => {
    const invalidPayloads = [
      { price: "100" },
      { price: 100.001 },
      { price: 10000000000 },
      { price: null },
      { quota: "10" },
      { quota: -1 },
      { quota: 1.5 },
      { quota: 2147483648 },
      { name: " " },
      { name: "A".repeat(81) },
      { name: "bad\u0000name" },
    ];

    for (const payload of invalidPayloads) {
      const response = await fetch(
        `${baseUrl}/api/admin/concerts/42/ticket-categories/7`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
          },
          body: JSON.stringify(payload),
        },
      );
      assert.equal(response.status, 400);
    }

    assert.equal(connected, 0);
  });
});

test("rollback kategori yang gagal dicatat tanpa detail sensitif dan client dibuang", async () => {
  await withApi(
    { duplicateOnEdit: true, rollbackFails: true },
    async ({ baseUrl, cookie, rollbackLogs, getReleasedWithError }) => {
      const response = await fetch(
        `${baseUrl}/api/admin/concerts/42/ticket-categories/7`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
          },
          body: JSON.stringify({ name: "Regular" }),
        },
      );
      const body = await response.json();

      assert.equal(response.status, 500);
      assert.equal(body.message, "Internal server error.");
      assert.equal(rollbackLogs.length, 1);
      assert.deepEqual(rollbackLogs[0][1], {
        operation: "update-ticket-category",
        name: "Error",
        code: "XX999",
      });
      assert.equal(JSON.stringify(rollbackLogs).includes("sensitive"), false);
      assert.equal(JSON.stringify(body).includes("sensitive"), false);
      assert.equal(getReleasedWithError(), true);
    },
  );
});

test("harga kategori negatif ditolak", async () => {
  await withApi({}, async ({ baseUrl, cookie, getReleased }) => {
    const response = await fetch(
      `${baseUrl}/api/admin/concerts/42/ticket-categories/7`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({ price: -1 }),
      },
    );

    assert.equal(response.status, 400);
    assert.equal(getReleased(), 0);
  });
});

test("kuota kategori pecahan ditolak", async () => {
  await withApi({}, async ({ baseUrl, cookie, getReleased }) => {
    const response = await fetch(
      `${baseUrl}/api/admin/concerts/42/ticket-categories/7`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({ quota: 2.5 }),
      },
    );

    assert.equal(response.status, 400);
    assert.equal(getReleased(), 0);
  });
});

test("admin dapat menonaktifkan kategori tanpa menghapus record", async () => {
  await withApi({}, async ({ baseUrl, cookie, calls }) => {
    const response = await fetch(
      `${baseUrl}/api/admin/ticket-categories/7`,
      {
        method: "DELETE",
        headers: { Cookie: cookie },
      },
    );

    assert.equal(response.status, 200);
    assert.ok(calls.some((call) =>
      call.includes("SET archived_at = COALESCE(archived_at, NOW())")
    ));
  });
});

test("admin dapat memulihkan kategori yang diarsipkan", async () => {
  await withApi({}, async ({ baseUrl, cookie, calls }) => {
    const response = await fetch(
      `${baseUrl}/api/admin/ticket-categories/7/restore`,
      {
        method: "POST",
        headers: { Cookie: cookie },
      },
    );

    assert.equal(response.status, 200);
    assert.ok(calls.some((call) =>
      call.includes("SET archived_at = NULL")
    ));
  });
});