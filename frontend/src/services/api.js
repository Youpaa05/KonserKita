const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

async function request(path, { method = "GET", body, signal } = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: "include",
      headers: {
        Accept: "application/json",
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
  { signal } = {},
) {
  return request("/api/bookings", {
    method: "POST",
    body: { customerName, customerEmail, ticketCategoryId, quantity },
    signal,
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

export function attemptPayment(bookingCode, outcome) {
  return request(`/api/payments/${encodeURIComponent(bookingCode)}/attempt`, {
    method: "POST", body: { outcome },
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

export function getAdminConcertAnalytics({ from = "", to = "", sort = "ticketQuantity", direction = "desc", page = 1, limit = 10, signal } = {}) {
  const params = new URLSearchParams({ sort, direction, page: String(page), limit: String(limit) });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return request(`/api/admin/analytics/concerts?${params}`, { signal });
}

export function getAdminTrends({ from, to, interval = "day", signal } = {}) {
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
