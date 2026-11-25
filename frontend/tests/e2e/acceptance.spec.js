import { test, expect } from "@playwright/test";
import { Buffer } from "node:buffer";

const concertTitle = "Batch 05 Acceptance Concert";
const categoryName = "Batch Test Category";
const viewports = [
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1366", width: 1366, height: 900 },
  { name: "desktop-1440", width: 1440, height: 1000 },
];

async function expectNoHorizontalOverflow(page) {
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(width.document, JSON.stringify(width)).toBeLessThanOrEqual(width.viewport + 1);
  expect(width.body, JSON.stringify(width)).toBeLessThanOrEqual(width.viewport + 1);
}

test.describe("Public platform responsive acceptance", () => {
  for (const viewport of viewports) {
    test(`${viewport.name}: discovery, filters, detail, login/register, and navigation`, async ({ page }, testInfo) => {
      const pageErrors = [];
      const consoleErrors = [];
      const failedRequests = [];
      const httpErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || "failed"}`));
      page.on("response", (response) => {
        if (response.status() >= 400) httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() });
      });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await page.goto("/");
      await expect(page.getByRole("heading", { name: /Temukan konser yang/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: concertTitle })).toBeVisible();
      await expect(page.getByRole("link", { name: categoryName })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-home.png`), fullPage: true });

      const menuToggle = page.getByRole("button", { name: "Buka menu navigasi" });
      if (await menuToggle.isVisible()) {
        await menuToggle.click();
        await expect(page.getByRole("button", { name: "Tutup menu navigasi" })).toHaveAttribute("aria-expanded", "true");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: "Buka menu navigasi" })).toHaveAttribute("aria-expanded", "false");
      }

      await page.locator("#home-concert-search").fill(concertTitle);
      await page.getByRole("button", { name: "Cari konser" }).click();
      await expect(page).toHaveURL(/\/concerts\?q=/);
      await page.getByLabel("Kategori konser").selectOption({ label: categoryName });
      const detailLink = page.getByRole("link", { name: `Lihat detail ${concertTitle}` }).first();
      await expect(detailLink).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-catalog.png`), fullPage: true });
      await detailLink.click();

      await expect(page.getByRole("heading", { name: concertTitle })).toBeVisible();
      const poster = page.locator(".detail-poster img");
      await expect(poster).toBeVisible();
      await expect.poll(() => poster.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
      await expect(page.getByText("Acceptance Test Venue")).toBeVisible();
      await expect(page.locator(".booking-total strong")).toContainText("45.000");
      await expect(page.getByLabel("Kategori tiket")).toContainText(categoryName);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-detail.png`), fullPage: true });

      await page.goto("/login");
      await expect(page.getByRole("heading", { name: "Login akun" })).toBeVisible();
      await expect(page.locator("#login-email")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-login.png`), fullPage: true });
      await page.goto("/register");
      await expect(page.getByRole("heading", { name: "Buat akun baru" })).toBeVisible();
      await expect(page.locator("#register-password")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-register.png`), fullPage: true });

      await testInfo.attach("browser-diagnostics", {
        body: Buffer.from(JSON.stringify({ pageErrors, consoleErrors, failedRequests, httpErrors }, null, 2)),
        contentType: "application/json",
      });
      expect(pageErrors, "uncaught browser errors").toEqual([]);
      expect(consoleErrors.filter((message) => !message.startsWith("Failed to load resource:")), "JavaScript console errors").toEqual([]);
      expect(httpErrors.filter(({ path, status }) => status >= 500 || (status === 404 && path !== "/favicon.ico") || (status === 401 && path !== "/api/auth/me")), "unexpected HTTP errors").toEqual([]);
    });
  }
});

test("customer can register, favorite, book, simulate payment, inspect orders/payments/tickets, and is denied admin routes", async ({ page }, testInfo) => {
  const pageErrors = [];
  const consoleErrors = [];
  const httpErrors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || "failed"}`));
  page.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `acceptance-${unique}@example.test`;
  const password = `E2e-Only-${unique}-Pass!`;
  await page.goto("/register");
  await page.getByLabel("Nama lengkap").fill("Acceptance Customer");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Konfirmasi password").fill(password);
  await page.getByRole("button", { name: "Buat Akun" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { name: "Profil & keamanan" })).toBeVisible();
  await expect(page.locator("#profile-email")).toHaveValue(email);

  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Login akun" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.locator("#profile-email")).toHaveValue(email);

  await page.goto("/customer/favorites");
  await expect(page.getByText("Belum ada konser favorit")).toBeVisible();
  await page.goto(`/concerts?q=${encodeURIComponent(concertTitle)}`);
  const concertCard = page.locator(".concert-card").filter({ hasText: concertTitle });
  await expect(concertCard).toBeVisible();
  await concertCard.getByRole("button", { name: /Simpan favorit/ }).click();
  await expect(concertCard.getByRole("status")).toHaveText("Tersimpan di favorit.");
  await page.goto("/customer/favorites");
  await expect(page.locator(".favorite-card").filter({ hasText: concertTitle })).toBeVisible();
  await page.getByRole("button", { name: "Hapus favorit" }).click();
  await expect(page.getByText("Belum ada konser favorit")).toBeVisible();

  await page.goto("/concerts/batch05-acceptance-concert");
  await expect(page.getByRole("heading", { name: concertTitle })).toBeVisible();
  await page.locator('input[name="customerName"]').fill("Acceptance Customer");
  await page.locator('input[name="customerEmail"]').fill(email);
  await page.getByRole("button", { name: "Buat pesanan" }).click();
  const bookingResult = page.getByRole("status").filter({ hasText: "Pesanan berhasil dibuat" });
  await expect(bookingResult).toBeVisible();
  const bookingText = await bookingResult.textContent();
  const bookingCode = bookingText.match(/KK-[A-F0-9]{16}/)?.[0];
  expect(bookingCode).toBeTruthy();
  await bookingResult.getByRole("link", { name: "Lihat informasi pembayaran" }).click();
  await expect(page.getByText(/Simulasi pembayaran untuk pengujian alur aplikasi/)).toBeVisible();
  await expect(page.getByText(/Rp\s*45\.000/)).toBeVisible();
  await page.getByRole("button", { name: "Simulasikan berhasil" }).click();
  await page.getByRole("link", { name: "Lihat status pesanan" }).click();
  await expect(page.getByRole("heading", { name: "Pembayaran simulasi berhasil dan pesanan dikonfirmasi" })).toBeVisible();
  await expect(page.getByText("Status pembayaran: paid")).toBeVisible();
  const paymentResultQr = page.getByRole("img", { name: /QR tiket/ });
  await expect(paymentResultQr).toBeVisible();
  await expect(paymentResultQr).toHaveAttribute("src", /^data:image\//);

  await page.goto("/customer/dashboard");
  await expect(page.getByRole("heading", { name: /Halo, Acceptance Customer/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: concertTitle })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("customer-dashboard-desktop.png"), fullPage: true });

  await page.goto("/customer/bookings");
  await expect(page.getByRole("heading", { name: "Riwayat Pesanan" })).toBeVisible();
  await expect(page.getByText(bookingCode)).toBeVisible();
  await expect(page.locator(".customer-order-card").filter({ hasText: bookingCode }).getByText("Dikonfirmasi", { exact: true })).toBeVisible();
  await page.goto(`/customer/bookings/${bookingCode}`);
  await expect(page.getByRole("heading", { name: concertTitle })).toBeVisible();
  await expect(page.locator(".customer-detail-statuses")).toContainText("Dikonfirmasi");
  await page.goto("/customer/payments");
  await expect(page.getByRole("heading", { name: "Riwayat pembayaran" })).toBeVisible();
  await expect(page.locator(".payment-history-heading .booking-status-pill")).toHaveText("Berhasil (simulasi)");
  await expect(page.getByText(/bukan bukti transaksi atau penerimaan dana sungguhan/)).toBeVisible();
  await page.goto("/customer/tickets");
  await expect(page.getByRole("heading", { name: "Tiket digital" })).toBeVisible();
  const ticketDetailLink = page.getByRole("link", { name: "Buka tiket" });
  await expect(ticketDetailLink).toBeVisible();
  const ticketDetailHref = await ticketDetailLink.getAttribute("href");
  await ticketDetailLink.click();
  await expect(page.getByRole("heading", { name: concertTitle })).toBeVisible();
  await expect(page.getByRole("img", { name: /QR tiket/ })).toBeVisible();
  await expect(page.locator(".ticket-detail-facts")).toContainText(bookingCode);

  await page.goto("/profile");
  await page.locator("#profile-name").fill("Acceptance Customer Updated");
  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Informasi profil berhasil diperbarui." })).toBeVisible();
  await page.goto("/customer/notifications");
  await expect(page.getByRole("heading", { name: "Notifikasi" })).toBeVisible();

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/customer/dashboard");
    await expect(page.getByRole("heading", { name: /Halo, Acceptance Customer Updated/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`customer-${viewport.name}.png`), fullPage: true });
    for (const route of ["/customer/bookings", `/customer/bookings/${bookingCode}`, "/customer/payments", "/customer/tickets", ticketDetailHref, "/customer/favorites", "/customer/notifications", "/profile"]) {
      await page.goto(route);
      await expect(page.locator("main#main-content")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (route === ticketDetailHref) {
        const qr = page.getByRole("img", { name: /QR tiket/ });
        await expect(qr).toBeVisible();
        const bounds = await qr.evaluate((image) => {
          const rect = image.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width, viewport: window.innerWidth };
        });
        expect(bounds.width).toBeGreaterThanOrEqual(180);
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1);
        await page.screenshot({
          path: testInfo.outputPath(`ticket-${viewport.name}.png`),
          fullPage: true,
          mask: [page.locator(".ticket-detail-qr"), page.locator(".ticket-detail-main .section-kicker"), page.locator(".ticket-detail-facts")],
          maskColor: "#8b5cf6",
        });
      }
    }
  }

  await page.goto("/admin/dashboard");
  await expect(page).toHaveURL(/\/customer\/dashboard$/);
  await expect(page.getByRole("heading", { name: /Halo, Acceptance Customer Updated/ })).toBeVisible();

  await testInfo.attach("browser-diagnostics", {
    body: Buffer.from(JSON.stringify({ pageErrors, consoleErrors, failedRequests, httpErrors }, null, 2)),
    contentType: "application/json",
  });
  expect(pageErrors, "uncaught browser errors").toEqual([]);
  expect(consoleErrors.filter((message) => !message.startsWith("Failed to load resource:")), "JavaScript console errors").toEqual([]);
  expect(httpErrors.filter(({ path, status }) => status >= 500 || (status === 404 && path !== "/favicon.ico") || (status === 401 && path !== "/api/auth/me")), "unexpected HTTP errors").toEqual([]);
});

test("catalog presents an actionable error when the API is unavailable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/concerts**", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ success: false, message: "Acceptance test API unavailable" }),
  }));
  await page.goto("/concerts");
  await expect(page.getByRole("heading", { name: "Konser belum dapat dimuat" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Acceptance test API unavailable");
  await expect(page.getByRole("button", { name: "Coba lagi" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
