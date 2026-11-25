import test from "node:test";
import assert from "node:assert/strict";
import {
  attemptPayment,
  getAdminTrends,
  getConcerts,
  getCurrentUser,
  login,
  logout,
} from "../src/services/api.js";

test("auth API requests include cookies for login, session checks, and logout", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ success: true, data: { id: "user-1" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await login({ email: "customer@example.test", password: "example-test-password" });
    await getCurrentUser();
    await logout();

    assert.deepEqual(requests.map(({ url }) => new URL(url, "http://localhost").pathname), [
      "/api/auth/login",
      "/api/auth/me",
      "/api/auth/logout",
    ]);
    assert.ok(requests.every(({ options }) => options.credentials === "include"));
    assert.equal(requests[0].options.method, "POST");
    assert.equal(requests[2].options.method, "POST");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("concert API preserves every returned row and requests the chosen pagination", async () => {
  const originalFetch = globalThis.fetch;
  const concerts = [
    { id: "11", title: "Concert One" },
    { id: "12", title: "Concert Two" },
    { id: "13", title: "Concert Three" },
  ];
  let requestUrl = "";
  let requestOptions;
  globalThis.fetch = async (url, options) => {
    requestUrl = String(url);
    requestOptions = options;
    return new Response(JSON.stringify({
      success: true,
      data: { concerts, page: 1, limit: 50, total: 3, totalPages: 1 },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await getConcerts({ page: 1, limit: 50 });
    assert.deepEqual(result.concerts.map(({ id }) => id), ["11", "12", "13"]);
    assert.equal(result.total, 3);
    const url = new URL(requestUrl, "http://localhost");
    assert.equal(url.pathname, "/api/concerts");
    assert.equal(url.searchParams.get("page"), "1");
    assert.equal(url.searchParams.get("limit"), "50");
    assert.equal(requestOptions.credentials, "include");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin trend request mengirim rentang tanggal valid sesuai kontrak API", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestOptions;
  globalThis.fetch = async (url, options) => {
    requestUrl = String(url);
    requestOptions = options;
    return new Response(JSON.stringify({ success: true, data: { points: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await getAdminTrends({
      from: "2026-11-01",
      to: "2026-11-30",
      interval: "day",
    });
    assert.deepEqual(result, { points: [] });
    const url = new URL(requestUrl, "http://localhost");
    assert.equal(url.pathname, "/api/admin/analytics/trends");
    assert.equal(url.searchParams.get("from"), "2026-11-01");
    assert.equal(url.searchParams.get("to"), "2026-11-30");
    assert.equal(url.searchParams.get("interval"), "day");
    assert.equal(requestOptions.credentials, "include");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin trend request tidak mengirim nilai undefined atau tanggal malformed", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    throw new Error("fetch seharusnya tidak dipanggil");
  };

  try {
    await assert.rejects(getAdminTrends(), /Periode tren tidak valid/);
    await assert.rejects(
      getAdminTrends({ from: "2026-02-30", to: "2026-03-01" }),
      /Periode tren tidak valid/,
    );
    await assert.rejects(
      getAdminTrends({ from: "2026-11-02", to: "2026-11-01" }),
      /Periode tren tidak valid/,
    );
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("payment simulation sends only an explicit outcome to the server", async () => {
  const originalFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ success: true, data: { paymentStatus: "paid" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await attemptPayment("KK-0123456789ABCDEF", "success");
    assert.deepEqual(body, { outcome: "success" });
    await assert.rejects(attemptPayment("KK-0123456789ABCDEF", "paid"), /Hasil simulasi tidak valid/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("API error response without JSON content type reports the HTTP and proxy context", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("proxy unavailable", {
    status: 502,
    headers: { "Content-Type": "text/plain" },
  });

  try {
    await assert.rejects(getConcerts(), (error) => {
      assert.match(error.message, /non-JSON \(HTTP 502\)/);
      assert.match(error.message, /proxy/);
      assert.equal(error.status, 502);
      assert.equal(error.contentType, "text/plain");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("API response declared as JSON but containing invalid JSON remains a parse error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html>bad gateway</html>", {
    status: 502,
    headers: { "Content-Type": "application/json" },
  });

  try {
    await assert.rejects(getConcerts(), /respons yang tidak dapat dibaca/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
