import { sendError } from "../utils/apiResponse.js";

const VALID_ROLES = new Set(["customer", "admin"]);

export function requireRole(...allowedRoles) {
  const roles = allowedRoles.flat();

  if (
    roles.length === 0 ||
    roles.some((role) => !VALID_ROLES.has(role))
  ) {
    throw new Error("Konfigurasi role otorisasi tidak valid.");
  }

  return function authorizeRole(req, res, next) {
    if (!req.user) {
      return sendError(
        res,
        401,
        "Silakan login terlebih dahulu.",
      );
    }

    if (!roles.includes(req.user.role)) {
      return sendError(
        res,
        403,
        "Anda tidak memiliki izin untuk mengakses resource ini.",
      );
    }

    return next();
  };
}