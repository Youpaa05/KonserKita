import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createPaymentRouter } from "../src/routes/payments.js";
import { generateSessionToken, hashSessionToken, SESSION_COOKIE_NAME } from "../src/utils/session.js";
import { isPaymentSimulationEnabled } from "../src/config/paymentSimulation.js";

const code = "KK-0123456789ABCDEF";

async function harness(options = {}, run) {
  const state = {
    paymentStatus: options.paymentStatus || "pending",
    bookingStatus: options.bookingStatus || "pending",
    expired: Boolean(options.expired),
    cancelled: Boolean(options.cancelled),
    amountMatches: options.amountMatches !== false,
    quota: 2,
    tickets: [],
    restores: 0,
  };
  const calls = [];
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  let tail = Promise.resolve();
  const snapshots = [];

  const pool = {
    async query(sql, values = []) {
      if (sql.includes("FROM user_sessions")) {
        const valid = values[0] === tokenHash && options.userId !== "other";
        return { rowCount: valid ? 1 : 0, rows: valid ? [{ id: options.userId || "12", name: "Customer", email: "customer@example.test", role: options.role || "customer" }] : [] };
      }
      throw new Error("Unexpected pool query in simulation test.");
    },
    async connect() {
      let unlock = null;
      return {
        async query(sql, values = []) {
          const q = sql.trim().replace(/\s+/g, " ");
          calls.push(q);
          if (q === "BEGIN") {
            snapshots.push(structuredClone(state));
            return { rowCount: null, rows: [] };
          }
          if (q === "COMMIT") {
            snapshots.pop();
            unlock?.(); unlock = null;
            return { rowCount: null, rows: [] };
          }
          if (q === "ROLLBACK") {
            const snapshot = snapshots.pop();
            if (snapshot) Object.assign(state, snapshot);
            unlock?.(); unlock = null;
            return { rowCount: null, rows: [] };
          }
          if (q.startsWith("SELECT b.id::text AS booking_id")) {
            let release;
            const previous = tail;
            tail = new Promise((resolve) => { release = resolve; });
            await previous;
            unlock = release;
            if (options.ownerId === "other") return { rowCount: 0, rows: [] };
            return { rowCount: 1, rows: [{ booking_id: "8", quantity: 2, booking_status: state.bookingStatus, ticket_category_id: "2", total_price: "200.00", amount_matches_total: state.amountMatches, payment_id: "9", payment_status: state.paymentStatus, payment_method: "simulation", expired: state.expired }] };
          }
          if (q.startsWith("SELECT tc.id AS ticket_category_id")) {
            return { rowCount: 1, rows: [{ ticket_category_id: "2", cancelled_at: state.cancelled ? new Date() : null }] };
          }
          if (q.startsWith("UPDATE payments SET status='paid'")) {
            state.paymentStatus = "paid";
            return { rowCount: 1, rows: [{ id: "9" }] };
          }
          if (q.startsWith("UPDATE payments SET status='failed'")) {
            state.paymentStatus = "failed";
            state.restores += 1;
            return { rowCount: 1, rows: [{ id: "9" }] };
          }
          if (q.startsWith("UPDATE payments SET status='expired'")) {
            state.paymentStatus = "expired";
            state.restores += 1;
            return { rowCount: 1, rows: [{ id: "9" }] };
          }
          if (q.startsWith("UPDATE bookings SET status='confirmed'")) {
            state.bookingStatus = "confirmed";
            return { rowCount: 1, rows: [{ id: "8" }] };
          }
          if (q.startsWith("UPDATE bookings SET status='cancelled'")) {
            state.bookingStatus = "cancelled";
            return { rowCount: 1, rows: [] };
          }
          if (q.startsWith("UPDATE ticket_categories SET quota=quota+")) {
            state.quota += Number(values[0]);
            return { rowCount: 1, rows: [] };
          }
          if (q.startsWith("SELECT b.id::text AS id")) {
            return { rowCount: 1, rows: [{ id: "8", quantity: 2, bookingStatus: state.bookingStatus, paymentStatus: state.paymentStatus }] };
          }
          if (q.startsWith("SELECT ticket_code AS \"ticketCode\", ticket_number AS \"ticketNumber\"")) {
            return { rowCount: state.tickets.length, rows: state.tickets.map(({ ticketCode, ticketNumber }) => ({ ticketCode, ticketNumber })) };
          }
          if (q.startsWith("INSERT INTO digital_tickets")) {
            if (options.failTicketInsert && state.tickets.length === 1) throw new Error("ticket insert failure");
            const [bookingId, ticketNumber, ticketCode] = values;
            state.tickets.push({ bookingId, ticketNumber, ticketCode, status: "issued", issuedAt: new Date().toISOString(), usedAt: null });
            return { rowCount: 1, rows: [{ ticketCode, ticketNumber }] };
          }
          if (q.startsWith("SELECT ticket_code AS \"ticketCode\", ticket_number AS \"ticketNumber\", status")) {
            return { rowCount: state.tickets.length, rows: state.tickets };
          }
          throw new Error(`Unexpected client query: ${q}`);
        },
        release() { unlock?.(); unlock = null; },
      };
    },
  };

  const app = express();
  app.use(express.json());
  app.use("/api/payments", createPaymentRouter({
    pool,
    environment: options.environment || { NODE_ENV: "development", PAYMENT_SIMULATION_ENABLED: "true" },
  }));
  app.use((error, _req, res, _next) => res.status(500).json({ success: false, message: "internal error" }));
  const server = createServer(app);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    await run(`http://127.0.0.1:${server.address().port}`, { state, calls, token, cookie: `${SESSION_COOKIE_NAME}=${token}` });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("payment simulation only enables with explicit development gate", () => {
  assert.equal(isPaymentSimulationEnabled({ NODE_ENV: "development", PAYMENT_SIMULATION_ENABLED: "true" }), true);
  assert.equal(isPaymentSimulationEnabled({ NODE_ENV: "production", PAYMENT_SIMULATION_ENABLED: "true" }), false);
  assert.equal(isPaymentSimulationEnabled({ NODE_ENV: "development" }), false);
});

test("simulated success confirms only the owned booking and issues tickets atomically", async () => harness({}, async (base, db) => {
  const response = await fetch(`${base}/api/payments/${code}/attempt`, { method: "POST", headers: { Cookie: db.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ outcome: "success" }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.paymentStatus, "paid");
  assert.equal(body.data.bookingStatus, "confirmed");
  assert.equal(body.data.tickets.length, 2);
  assert.equal(db.state.tickets.length, 2);
  assert.equal(db.state.quota, 2);
  assert.ok(db.calls.includes("COMMIT"));
  assert.equal(db.calls.some((query) => query.includes("amount") && query.includes("$")), true);
}));

test("duplicate success attempts are idempotent and do not duplicate tickets", async () => harness({}, async (base, db) => {
  const attempt = () => fetch(`${base}/api/payments/${code}/attempt`, { method: "POST", headers: { Cookie: db.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ outcome: "success" }) });
  const responses = await Promise.all([attempt(), attempt()]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(db.state.tickets.length, 2);
  assert.equal(db.state.paymentStatus, "paid");
  assert.equal(db.state.bookingStatus, "confirmed");
}));

test("failure and expiry cancel the booking and restore quota once", async () => harness({}, async (base, db) => {
  const failure = await fetch(`${base}/api/payments/${code}/attempt`, { method: "POST", headers: { Cookie: db.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ outcome: "failure" }) });
  assert.equal(failure.status, 200);
  assert.equal(db.state.paymentStatus, "failed");
  assert.equal(db.state.bookingStatus, "cancelled");
  assert.equal(db.state.restores, 1);
  assert.equal(db.state.tickets.length, 0);
}));

test("expired, cancelled, wrong-owner, unauthenticated, and mismatched amount attempts are rejected", async () => {
  for (const options of [{ expired: true }, { cancelled: true }, { ownerId: "other" }, { amountMatches: false }]) {
    await harness(options, async (base, db) => {
      const response = await fetch(`${base}/api/payments/${code}/attempt`, { method: "POST", headers: { Cookie: db.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ outcome: "success" }) });
      assert.equal(response.status, options.ownerId === "other" ? 404 : 409);
      if (options.expired) {
        assert.equal(db.state.paymentStatus, "expired");
        assert.equal(db.state.bookingStatus, "cancelled");
        assert.equal(db.state.restores, 1);
        assert.equal(db.state.quota, 4);
      }
      if (options.cancelled || options.ownerId || options.amountMatches === false) assert.equal(db.state.paymentStatus, "pending");
      assert.equal(db.state.tickets.length, 0);
    });
  }
  await harness({}, async (base, db) => {
    const response = await fetch(`${base}/api/payments/${code}/attempt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outcome: "success" }) });
    assert.equal(response.status, 401);
  });
  await harness({ role: "admin" }, async (base, db) => {
    const response = await fetch(`${base}/api/payments/${code}/attempt`, { method: "POST", headers: { Cookie: db.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ outcome: "success" }) });
    assert.equal(response.status, 403);
  });
});

test("ticket issue failure rolls payment and booking state back", async () => harness({ failTicketInsert: true }, async (base, db) => {
  const response = await fetch(`${base}/api/payments/${code}/attempt`, { method: "POST", headers: { Cookie: db.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ outcome: "success" }) });
  assert.equal(response.status, 500);
  assert.equal(db.state.paymentStatus, "pending");
  assert.equal(db.state.bookingStatus, "pending");
  assert.equal(db.state.tickets.length, 0);
  assert.ok(db.calls.includes("ROLLBACK"));
}));

test("production payment simulation gate refuses payment mutation", async () => harness({ environment: { NODE_ENV: "production", PAYMENT_SIMULATION_ENABLED: "true" } }, async (base, db) => {
  const response = await fetch(`${base}/api/payments/${code}/attempt`, { method: "POST", headers: { Cookie: db.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ outcome: "success" }) });
  assert.equal(response.status, 503);
  assert.equal(db.state.paymentStatus, "pending");
  assert.equal(db.calls.length, 0);
}));
