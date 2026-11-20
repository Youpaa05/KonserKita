import { sendError } from "../utils/apiResponse.js";

function normalizeOrigin(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

export function isTrustedOrigin(req) {
  const configuredOrigin =
    process.env.FRONTEND_URL?.trim() ||
    (process.env.NODE_ENV === "production"
      ? ""
      : "http://localhost:5173");
  const trustedOrigin = configuredOrigin ? normalizeOrigin(configuredOrigin) : null;
  const requestOrigin = req.get("origin")
    ? normalizeOrigin(req.get("origin"))
    : null;

  return Boolean(trustedOrigin && requestOrigin && trustedOrigin === requestOrigin);
}

export function requireTrustedOrigin(req, res, next) {
  if (!isTrustedOrigin(req)) {
    return sendError(res, 403, "Origin request tidak diizinkan.");
  }

  return next();
}
