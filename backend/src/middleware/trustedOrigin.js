import { sendError } from "../utils/apiResponse.js";

export const DEVELOPMENT_FRONTEND_ORIGIN = "http://localhost:5173";
export const DEVELOPMENT_FRONTEND_ORIGINS = Object.freeze([
  DEVELOPMENT_FRONTEND_ORIGIN,
  "http://127.0.0.1:5173",
]);

export function normalizeOrigin(value) {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

export function resolveTrustedOrigins(environment = process.env) {
  if (environment.NODE_ENV !== "production") {
    return [...DEVELOPMENT_FRONTEND_ORIGINS];
  }

  const configuredOrigin = environment.FRONTEND_URL?.trim();
  const normalizedOrigin = normalizeOrigin(configuredOrigin);
  if (
    !configuredOrigin ||
    configuredOrigin.includes("*") ||
    normalizedOrigin !== configuredOrigin ||
    !configuredOrigin.startsWith("https://")
  ) {
    throw new Error("FRONTEND_URL must be one exact HTTPS origin in production.");
  }

  return [configuredOrigin];
}

export function isTrustedOrigin(req) {
  const requestOrigin = normalizeOrigin(req.get("origin"));
  if (!requestOrigin) return false;

  const allowedOrigins = req.app?.locals?.trustedOrigins || resolveTrustedOrigins();
  return allowedOrigins.includes(requestOrigin);
}

export function requireTrustedOrigin(req, res, next) {
  if (!isTrustedOrigin(req)) {
    return sendError(res, 403, "Origin request tidak diizinkan.");
  }

  return next();
}
