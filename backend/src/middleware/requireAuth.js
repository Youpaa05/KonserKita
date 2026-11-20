import { pool as defaultPool } from "../config/database.js";
import {
  hashSessionToken,
  readSessionToken,
} from "../utils/session.js";
import { sendError } from "../utils/apiResponse.js";
import { isTrustedOrigin } from "./trustedOrigin.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function createRequireAuth({ pool = defaultPool } = {}) {
  return async function requireAuth(req, res, next) {
    if (
      !SAFE_METHODS.has(req.method) &&
      (req.get("origin")
        ? !isTrustedOrigin(req)
        : process.env.NODE_ENV === "production")
    ) {
      return sendError(res, 403, "Origin request tidak diizinkan.");
    }
    const token = readSessionToken(req);

    if (!token) {
      return sendError(res, 401, "Silakan login terlebih dahulu.");
    }

    let tokenHash;

    try {
      tokenHash = hashSessionToken(token);
    } catch {
      return sendError(res, 401, "Session tidak valid.");
    }

    try {
      const result = await pool.query(
        `SELECT
           u.id,
           u.name,
           u.email,
           r.name AS role
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         JOIN roles r ON r.id = u.role_id
         WHERE s.session_token_hash = $1
           AND s.revoked_at IS NULL
           AND s.expires_at > NOW()
         LIMIT 1`,
        [tokenHash],
      );

      if (result.rows.length === 0) {
        return sendError(res, 401, "Session sudah tidak berlaku. Silakan login kembali.");
      }

      req.user = result.rows[0];
      return next();
    } catch (error) {
      return next(error);
    }
  };
}