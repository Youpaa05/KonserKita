import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";
import { createAuthRouter } from "../src/routes/auth.js";
import { hashPassword, verifyPassword } from "../src/utils/password.js";

const origin = "http://localhost:5173";
const validInput = {
  name: "Customer Test",
  email: "  CUSTOMER@example.test ",
  password: "Registration-Test-Password-2026",
};

function makePool({ failAt = null } = {}) {
  const state = {
    users: [],
    sessions: [],
    events: [],
    connectCalls: 0,
    released: 0,
    committed: false,
    customerRoleSql: false,
  };
  let snapshot = null;

  const client = {
    async query(sql, values = []) {
      const query = sql.replace(/\s+/g, " ").trim();

      if (query === "BEGIN") {
        state.events.push("BEGIN");
        snapshot = { users: [...state.users], sessions: [...state.sessions] };
        return { rows: [] };
      }

      if (query.startsWith("INSERT INTO users (")) {
        state.events.push("INSERT_USER");
        state.customerRoleSql = query.includes("WHERE name = 'customer'");
        if (failAt === "user") throw Object.assign(new Error("simulated user insert failure"), { code: "XX000" });
        if (failAt === "duplicate") throw Object.assign(new Error("simulated duplicate email"), { code: "23505" });
        const user = {
          id: "42",
          roleId: "1",
          name: values[0],
          email: values[1],
          passwordHash: values[2],
        };
        state.users.push(user);
        return { rows: [{ id: user.id, name: user.name, email: user.email }], rowCount: 1 };
      }

      if (query.startsWith("INSERT INTO user_sessions (")) {
        state.events.push("INSERT_SESSION");
        if (failAt === "session") throw Object.assign(new Error("simulated session insert failure"), { code: "XX001" });
        state.sessions.push({ tokenHash: values[0], userId: values[1] });
        return { rows: [], rowCount: 1 };
      }

      if (query === "COMMIT") {
        state.events.push("COMMIT");
        if (failAt === "commit") throw Object.assign(new Error("simulated commit failure"), { code: "XX002" });
        state.committed = true;
        snapshot = null;
        return { rows: [] };
      }

      if (query === "ROLLBACK") {
        state.events.push("ROLLBACK");
        if (snapshot) {
          state.users = snapshot.users;
          state.sessions = snapshot.sessions;
          snapshot = null;
        }
        return { rows: [] };
      }

      throw new Error("Unexpected transaction query");
    },
    release(error) {
      state.released += 1;
      state.releasedWithError = Boolean(error);
    },
  };

  const pool = {
    testState: state,
    async connect() {
      state.connectCalls += 1;
      return client;
    },
    async query() {
      throw new Error("Registration must use its checked-out transaction client");
    },
  };

  return { state, pool };
}

function makeAuthApp(pool) {
  const emptyRouter = () => express.Router();
  const authRouter = express.Router();
  authRouter.use((req, res, next) => {
    if (pool.testState) {
      const originalCookie = res.cookie.bind(res);
      res.cookie = (...args) => {
        pool.testState.cookieSetAfterCommit = pool.testState.committed;
        return originalCookie(...args);
      };
    }
    next();
  });
  authRouter.use(createAuthRouter({ pool }));

  return createApp({
    concertRouter: emptyRouter(),
    bookingRouter: emptyRouter(),
    authRouter,
    adminRouter: emptyRouter(),
    customerRouter: emptyRouter(),
    paymentRouter: emptyRouter(),
    customerTicketRouter: emptyRouter(),
    adminTicketRouter: emptyRouter(),
    databaseHealthCheck: async () => ({ connected: true }),
    logger: { error() {} },
  });
}

async function requestRegistration(pool, input = validInput, requestOrigin = origin) {
  const app = makeAuthApp(pool);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    return await fetch(`http://127.0.0.1:${server.address().port}/api/auth/register`, {
      method: "POST",
      headers: { Origin: requestOrigin, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function requestLogin(
  pool,
  input = { email: validInput.email, password: validInput.password },
  requestOrigin = origin,
) {
  const app = makeAuthApp(pool);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const headers = { "Content-Type": "application/json" };
    if (requestOrigin !== null) headers.Origin = requestOrigin;

    return await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("registrasi valid membuat akun dan sesi dalam satu transaksi lalu memasang cookie", async () => {
  const { pool, state } = makePool();
  const response = await requestRegistration(pool, { ...validInput, role: "admin" });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(state.events, ["BEGIN", "INSERT_USER", "INSERT_SESSION", "COMMIT"]);
  assert.equal(state.connectCalls, 1);
  assert.equal(state.committed, true);
  assert.equal(state.users.length, 1);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].userId, state.users[0].id);
  assert.equal(state.users[0].email, "customer@example.test");
  assert.equal(state.customerRoleSql, true);
  assert.equal(await verifyPassword(validInput.password, state.users[0].passwordHash), true);
  assert.notEqual(state.users[0].passwordHash, validInput.password);
  assert.equal(body.data.role, "customer");
  assert.equal(Object.hasOwn(body.data, "passwordHash"), false);
  assert.equal(JSON.stringify(body).includes(state.users[0].passwordHash), false);
  assert.equal(response.headers.get("set-cookie")?.includes("HttpOnly"), true);
  assert.equal(state.cookieSetAfterCommit, true);
  assert.equal(state.released, 1);
});

test("registrasi menolak Origin asing sebelum mengakses database", async () => {
  const { pool, state } = makePool();
  const response = await requestRegistration(pool, validInput, "https://attacker.example");
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.message, "Origin request tidak diizinkan.");
  assert.equal(state.connectCalls, 0);
});

test("registrasi menerima origin loopback alternatif lokal", async () => {
  const { pool, state } = makePool();
  const response = await requestRegistration(
    pool,
    { ...validInput, email: "loopback@example.test" },
    "http://127.0.0.1:5173",
  );

  assert.equal(response.status, 201);
  assert.equal(state.connectCalls, 1);
});

for (const [name, input] of [
  ["nama kosong", { ...validInput, name: " " }],
  ["email tidak valid", { ...validInput, email: "bukan-email" }],
  ["password terlalu pendek", { ...validInput, password: "short" }],
]) {
  test(`registrasi menolak ${name} sebelum membuka koneksi`, async () => {
    const { pool, state } = makePool();
    const response = await requestRegistration(pool, input);
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(state.connectCalls, 0);
    assert.equal(state.users.length, 0);
    assert.equal(state.sessions.length, 0);
  });
}

test("email duplikat melakukan rollback dan tetap mengembalikan konflik", async () => {
  const { pool, state } = makePool({ failAt: "duplicate" });
  const response = await requestRegistration(pool);
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.message, "Email sudah terdaftar.");
  assert.deepEqual(state.events, ["BEGIN", "INSERT_USER", "ROLLBACK"]);
  assert.equal(state.users.length, 0);
  assert.equal(state.sessions.length, 0);
  assert.equal(state.released, 1);
  assert.equal(response.headers.has("set-cookie"), false);
});

test("gagal insert akun melakukan rollback, tidak membuat sesi, dan melepas koneksi", async () => {
  const { pool, state } = makePool({ failAt: "user" });
  const response = await requestRegistration(pool);
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.message, "Terjadi kesalahan pada server.");
  assert.deepEqual(state.events, ["BEGIN", "INSERT_USER", "ROLLBACK"]);
  assert.equal(state.users.length, 0);
  assert.equal(state.sessions.length, 0);
  assert.equal(state.released, 1);
  assert.equal(response.headers.has("set-cookie"), false);
});

test("gagal insert sesi me-rollback akun dan tidak mengirim cookie", async () => {
  const { pool, state } = makePool({ failAt: "session" });
  const response = await requestRegistration(pool);
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.message, "Terjadi kesalahan pada server.");
  assert.deepEqual(state.events, ["BEGIN", "INSERT_USER", "INSERT_SESSION", "ROLLBACK"]);
  assert.equal(state.users.length, 0);
  assert.equal(state.sessions.length, 0);
  assert.equal(state.committed, false);
  assert.equal(state.released, 1);
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(JSON.stringify(body).includes(validInput.password), false);
});

test("commit gagal ditangani dengan rollback tanpa akun atau sesi parsial", async () => {
  const { pool, state } = makePool({ failAt: "commit" });
  const response = await requestRegistration(pool);
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.message, "Terjadi kesalahan pada server.");
  assert.deepEqual(state.events, ["BEGIN", "INSERT_USER", "INSERT_SESSION", "COMMIT", "ROLLBACK"]);
  assert.equal(state.users.length, 0);
  assert.equal(state.sessions.length, 0);
  assert.equal(state.committed, false);
  assert.equal(state.released, 1);
  assert.equal(response.headers.has("set-cookie"), false);
});

test("login tetap membuat sesi melalui pool dan tidak mengembalikan hash password", async () => {
  const passwordHash = await hashPassword(validInput.password);
  const state = { sessionInserted: false };
  const pool = {
    async query(sql) {
      if (sql.includes("FROM users u")) {
        return { rows: [{ id: "42", name: "Customer Test", email: "customer@example.test", password_hash: passwordHash, role: "customer" }] };
      }
      if (sql.includes("INSERT INTO user_sessions")) {
        state.sessionInserted = true;
        return { rows: [], rowCount: 1 };
      }
      throw new Error("Unexpected login query");
    },
  };
  const response = await requestLogin(pool, { email: "CUSTOMER@example.test", password: validInput.password });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(state.sessionInserted, true);
  assert.equal(body.data.role, "customer");
  assert.equal(Object.hasOwn(body.data, "password_hash"), false);
  assert.equal(JSON.stringify(body).includes(passwordHash), false);
  assert.equal(response.headers.get("set-cookie")?.includes("HttpOnly"), true);
});

test("login menolak Origin asing sebelum memeriksa kredensial", async () => {
  const { pool } = makePool();
  const response = await requestLogin(
    pool,
    { email: validInput.email, password: validInput.password },
    "https://attacker.example",
  );
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.message, "Origin request tidak diizinkan.");
});

test("login menerima origin loopback alternatif lokal", async () => {
  const passwordHash = await hashPassword(validInput.password);
  const pool = {
    async query(sql) {
      if (sql.includes("FROM users u")) {
        return { rows: [{ id: "42", name: "Customer Test", email: "customer@example.test", password_hash: passwordHash, role: "customer" }] };
      }
      if (sql.includes("INSERT INTO user_sessions")) return { rows: [], rowCount: 1 };
      throw new Error("Unexpected login query");
    },
  };
  const response = await requestLogin(
    pool,
    { email: validInput.email, password: validInput.password },
    "http://127.0.0.1:5173",
  );

  assert.equal(response.status, 200);
});

test("login menerima kedua origin development dan mengirim cookie sesi", async () => {
  const passwordHash = await hashPassword(validInput.password);

  for (const requestOrigin of [origin, "http://127.0.0.1:5173"]) {
    let sessionInserted = false;
    const pool = {
      async query(sql) {
        if (sql.includes("FROM users u")) {
          return {
            rows: [{
              id: "42",
              name: "Customer Test",
              email: validInput.email,
              password_hash: passwordHash,
              role: "customer",
            }],
          };
        }
        if (sql.includes("INSERT INTO user_sessions")) {
          sessionInserted = true;
          return { rows: [], rowCount: 1 };
        }
        throw new Error("Unexpected login query");
      },
    };
    const response = await requestLogin(
      pool,
      { email: validInput.email, password: validInput.password },
      requestOrigin,
    );

    assert.equal(response.status, 200, requestOrigin);
    assert.equal(sessionInserted, true, requestOrigin);
    assert.match(response.headers.get("set-cookie") || "", /kk_session=.*HttpOnly/);
    assert.equal(response.headers.get("access-control-allow-origin"), requestOrigin);
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  }
});

test("login tanpa Origin ditolak sebelum memeriksa kredensial", async () => {
  let queried = false;
  const pool = {
    async query() {
      queried = true;
      throw new Error("Login must not query credentials without an Origin");
    },
  };
  const response = await requestLogin(
    pool,
    { email: validInput.email, password: validInput.password },
    null,
  );
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.message, "Origin request tidak diizinkan.");
  assert.equal(queried, false);
  assert.equal(response.headers.has("set-cookie"), false);
});
