
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

async function request(path, { method = "GET", body, signal } = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
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
  { query = "", category = "", city = "" } = {},
  { signal } = {},
) {
  const params = new URLSearchParams();
  const normalizedQuery = query.trim();

  if (normalizedQuery) params.set("q", normalizedQuery);
  if (category) params.set("category", category);
  if (city) params.set("city", city);

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
