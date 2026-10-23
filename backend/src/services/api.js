
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

async function request(path, { signal } = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }

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
    throw new Error(
      typeof result?.message === "string"
        ? result.message
        : "Permintaan gagal diproses oleh server.",
    );
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
  const path = queryString
    ? `/api/concerts?${queryString}`
    : "/api/concerts";

  return request(path, { signal });
}

export function getConcert(idOrSlug, { signal } = {}) {
  if (
    typeof idOrSlug !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(idOrSlug)
  ) {
    return Promise.reject(new Error("ID atau slug konser tidak valid."));
  }

  return request(
    `/api/concerts/${encodeURIComponent(idOrSlug)}`,
    { signal },
  );
}
