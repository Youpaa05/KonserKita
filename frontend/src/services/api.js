const API_BASE_URL = import.meta.env?.DEV
  ? ""
  : (import.meta.env?.VITE_API_BASE_URL || "").replace(/\/+$/, "");

function isValidDateOnly(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

async function request(path, { method = "GET", body, signal, idempotencyKey } = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      "Tidak dapat menghubungi server. Pastikan backend KonserKita sedang berjalan.",
    );
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("json")) {
    const error = new Error(
      `Server mengirim respons non-JSON (HTTP ${response.status}). Periksa koneksi API dan konfigurasi proxy.`,
    );
    error.status = response.status;
    error.contentType = contentType;
    throw error;
  }

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error("Server mengirim respons yang tidak dapat dibaca.");
  }

  if (!response.ok || result?.success !== true) {
    const error = new Error(
      typeof result?.message === "string"
        ? result.message
        : "Permintaan gagal diproses oleh server.",
    );
    error.status = response.status;
    error.details = result;
    throw error;
  }

  return result.data;
}

export function getConcerts(
  { query = "", category = "", city = "", artist = "", dateFrom = "", dateTo = "", availability = "", sort = "date", direction = "asc", page, limit } = {},
  { signal } = {},
) {
  const params = new URLSearchParams();
  const normalizedQuery = query.trim();

  if (normalizedQuery) params.set("q", normalizedQuery);
  if (category) params.set("category", category);
  if (city) params.set("city", city);
  if (artist) params.set("artist", artist);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  if (availability) params.set("availability", availability);
  if (sort) params.set("sort", sort);
  if (direction) params.set("direction", direction);
  if (page !== undefined) params.set("page", String(page));
  if (limit !== undefined) params.set("limit", String(limit));

  const queryString = params.toString();
  const path = queryString ? `/api/concerts?${queryString}` : "/api/concerts";

  return request(path, { signal });
}

export function getConcert(idOrSlug, { signal } = {}) {
  if (
    typeof idOrSlug !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(idOrSlug)
  ) {
    return Promise.reject(new Error("ID atau slug konser tidak valid."));
  }

  return request(`/api/concerts/${encodeURIComponent(idOrSlug)}`, { signal });
}

export function getTicketCategories(idOrSlug, { signal } = {}) {
  if (
    typeof idOrSlug !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(idOrSlug)
  ) {
    return Promise.reject(new Error("ID atau slug konser tidak valid."));
  }

  return request(
    `/api/concerts/${encodeURIComponent(idOrSlug)}/ticket-categories`,
    { signal },
  );
}

export function createBooking(
  { customerName, customerEmail, ticketCategoryId, quantity },
  { signal, idempotencyKey } = {},
) {
  return request("/api/bookings", {
    method: "POST",
    body: { customerName, customerEmail, ticketCategoryId, quantity },
    signal,
    idempotencyKey,
  });
}

export function getBooking(bookingCode, { signal } = {}) {
  const normalizedCode =
    typeof bookingCode === "string" ? bookingCode.trim().toUpperCase() : "";

  if (!/^KK-[A-F0-9]{16}$/.test(normalizedCode)) {
    return Promise.reject(new Error("Format kode pesanan tidak valid."));
  }

  return request(`/api/bookings/${encodeURIComponent(normalizedCode)}`, {
    signal,
  });
}

export function register({ name, email, password }, { signal } = {}) {
  return request("/api/auth/register", {
    method: "POST",
    body: { name, email, password },
    signal,
  });
}

export function login({ email, password }, { signal } = {}) {
  return request("/api/auth/login", {
    method: "POST",
    body: { email, password },
    signal,
  });
}

export function logout({ signal } = {}) {
  return request("/api/auth/logout", {
    method: "POST",
    signal,
  });
}

export function getCurrentUser({ signal } = {}) {
  return request("/api/auth/me", { signal });
}

export function getCustomerFavorites({ signal } = {}) {
  return request("/api/customer/favorites", { signal });
}

export function addCustomerFavorite(concertId) {
  return request(`/api/customer/favorites/${encodeURIComponent(concertId)}`, { method: "POST" });
}

export function removeCustomerFavorite(concertId) {
  return request(`/api/customer/favorites/${encodeURIComponent(concertId)}`, { method: "DELETE" });
}

export function getCustomerProfile({ signal } = {}) {
  return request("/api/customer/profile", { signal });
}

export function updateCustomerProfile(data) {
  return request("/api/customer/profile", { method: "PATCH", body: data });
}

export function changeCustomerPassword({ currentPassword, newPassword }) {
  return request("/api/auth/password/change", { method: "POST", body: { currentPassword, newPassword } });
}

export function getCustomerNotifications({ page = 1, limit = 20, signal } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  return request(`/api/customer/notifications?${params}`, { signal });
}

export function getUnreadNotificationCount({ signal } = {}) {
  return request("/api/customer/notifications/unread-count", { signal });
}

export function markCustomerNotificationRead(id) {
  return request(`/api/customer/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH", body: {} });
}
// Fase 04: role-specific dashboard APIs.
export function getAdminDashboard({ signal } = {}) {
  return request("/api/admin/dashboard", { signal });
}

export function getCustomerDashboard({ signal } = {}) {
  return request("/api/customer/dashboard", { signal });
}

// Fase 05: administrator concert management.
export function getAdminConcerts({ status = "active", signal } = {}) {
  const query = new URLSearchParams({ status });
  return request("/api/admin/concerts?" + query.toString(), { signal });
}

export function getAdminConcert(id, { signal } = {}) {
  return request("/api/admin/concerts/" + encodeURIComponent(id), { signal });
}

export function createAdminConcert(data) {
  return request("/api/admin/concerts", { method: "POST", body: data });
}

export function updateAdminConcert(id, data) {
  return request("/api/admin/concerts/" + encodeURIComponent(id), {
    method: "PUT",
    body: data,
  });
}

export function archiveAdminConcert(id) {
  return request("/api/admin/concerts/" + encodeURIComponent(id), {
    method: "DELETE",
  });
}

export function cancelAdminConcert(id, reason) {
  return request(`/api/admin/concerts/${encodeURIComponent(id)}/cancel`, {
    method: "POST", body: { reason },
  });
}

export function restoreAdminConcert(id) {
  return request("/api/admin/concerts/" + encodeURIComponent(id) + "/restore", {
    method: "POST",
  });
}

// Fase 06: administrator ticket category management.
export function createAdminTicketCategory(concertId, data) {
  return request(
    `/api/admin/concerts/${encodeURIComponent(concertId)}/ticket-categories`,
    { method: "POST", body: data },
  );
}

export function updateAdminTicketCategory(concertId, categoryId, data) {
  return request(
    `/api/admin/concerts/${encodeURIComponent(concertId)}/ticket-categories/${encodeURIComponent(categoryId)}`,
    { method: "PUT", body: data },
  );
}

export function archiveAdminTicketCategory(categoryId) {
  return request(
    `/api/admin/ticket-categories/${encodeURIComponent(categoryId)}`,
    { method: "DELETE" },
  );
}

export function restoreAdminTicketCategory(categoryId) {
  return request(
    `/api/admin/ticket-categories/${encodeURIComponent(categoryId)}/restore`,
    { method: "POST" },
  );
}


// Riwayat booking milik customer yang sedang login.
export function getCustomerBookings({ signal } = {}) {
  return request("/api/customer/bookings", { signal });
}

export function getCustomerPaymentHistory({ page = 1, limit = 20, signal } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  return request(`/api/customer/payments/history?${params}`, { signal });
}

// Detail booking hanya dapat diakses oleh pemilik akun.
export function getCustomerBookingDetail(bookingCode, { signal } = {}) {
  return request(
    `/api/customer/bookings/${encodeURIComponent(bookingCode)}`,
    { signal },
  );
}

export function getPayment(bookingCode, { signal } = {}) {
  return request(`/api/payments/${encodeURIComponent(bookingCode)}`, { signal });
}

export function attemptPayment(bookingCode, outcome, { signal } = {}) {
  if (!/^KK-[A-F0-9]{16}$/i.test(String(bookingCode || ""))) {
    return Promise.reject(new Error("Format kode pesanan tidak valid."));
  }
  if (outcome !== "success" && outcome !== "failure") {
    return Promise.reject(new Error("Hasil simulasi tidak valid."));
  }
  return request(`/api/payments/${encodeURIComponent(bookingCode)}/attempt`, {
    method: "POST", body: { outcome }, signal,
  });
}

export function getAdminOrders({ status = "", bookingCode = "", customer = "", concertId = "", from = "", to = "", sort = "createdAt", direction = "desc", page = 1, limit = 20, signal } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit), sort, direction });
  for (const [key, value] of Object.entries({ status, bookingCode, customer, concertId, from, to })) if (value) params.set(key, value);
  return request(`/api/admin/orders?${params}`, { signal });
}

export function getAdminOrder(bookingCode, { signal } = {}) {
  return request(`/api/admin/orders/${encodeURIComponent(bookingCode)}`, { signal });
}

export function getAdminPaymentHistory(bookingCode, { signal } = {}) {
  return request(`/api/admin/payments/${encodeURIComponent(bookingCode)}/history`, { signal });
}

export function getAdminUsers({ q = "", role = "", page = 1, limit = 20, signal } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (q) params.set("q", q);
  if (role) params.set("role", role);
  return request(`/api/admin/users?${params}`, { signal });
}

export function getAdminRoleChangeAudit({ page = 1, limit = 20, signal } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  return request(`/api/admin/audit/role-changes?${params}`, { signal });
}

export function changeAdminUserRole(userId, role) {
  return request(`/api/admin/users/${encodeURIComponent(userId)}/role`, { method: "PATCH", body: { role } });
}

export async function downloadAdminCsv(path, filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== "" && value !== undefined) params.set(key, String(value));
  const response = await fetch(`${API_BASE_URL}${path}${params.size ? `?${params}` : ""}`, { credentials: "include", headers: { Accept: "text/csv" } });
  if (!response.ok) {
    let message = "CSV gagal diunduh.";
    try { message = (await response.json()).message || message; } catch { /* non-JSON error */ }
    throw new Error(message);
  }
  const blob = await response.blob();
  const filename = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || "konserkita-report.csv";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return response.headers.get("X-Export-Truncated") === "true";
}

export function getAdminConcertAnalytics({ from = "", to = "", sort = "ticketQuantity", direction = "desc", page = 1, limit = 10, signal } = {}) {
  const params = new URLSearchParams({ sort, direction, page: String(page), limit: String(limit) });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return request(`/api/admin/analytics/concerts?${params}`, { signal });
}

export function getAdminTrends({ from = "", to = "", interval = "day", signal } = {}) {
  if (!isValidDateOnly(from) || !isValidDateOnly(to) || from > to || !["day", "month"].includes(interval)) {
    return Promise.reject(new Error("Periode tren tidak valid."));
  }
  const params = new URLSearchParams({ from, to, interval });
  return request(`/api/admin/analytics/trends?${params}`, { signal });
}

export function getAdminPaymentReport({ status = "", bookingCode = "", concertId = "", from = "", to = "", sort = "createdAt", direction = "desc", page = 1, limit = 20, signal } = {}) {
  const params = new URLSearchParams({ sort, direction, page: String(page), limit: String(limit) });
  for (const [key, value] of Object.entries({ status, bookingCode, concertId, from, to })) if (value) params.set(key, value);
  return request(`/api/admin/reports/payments?${params}`, { signal });
}

export function getCustomerTickets({ signal } = {}) {
  return request("/api/customer/tickets", { signal });
}

export function getCustomerTicket(ticketCode, { signal } = {}) {
  return request(`/api/customer/tickets/${encodeURIComponent(ticketCode)}`, { signal });
}

export function validateAdminTicket(ticketCode) {
  return request("/api/admin/tickets/validate", {
    method: "POST",
    body: { ticketCode },
  });
}
