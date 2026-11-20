import { Router } from "express";
import { pool as defaultPool } from "../config/database.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import {
  generateSessionToken,
  hashSessionToken,
  readSessionToken,
  setSessionCookie,
  clearSessionCookie,
  SESSION_MAX_AGE_SECONDS,
} from "../utils/session.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { ROLES } from "../constants/roles.js";
import { createRateLimiter, getClientIp, hashRateLimitIdentity } from "../middleware/rateLimit.js";
import { requireTrustedOrigin } from "../middleware/trustedOrigin.js";

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
  };
}

async function rollbackTransaction(client, logger, operation, primaryError) {
  try {
    await client.query("ROLLBACK");
    return false;
  } catch (rollbackError) {
    const details = {
      operation,
      name: rollbackError?.name || "Error",
      code: rollbackError?.code || "unknown",
    };
    logger.error("Authentication transaction rollback failed.", details);
    if (primaryError && typeof primaryError === "object") {
      primaryError.rollbackError = details;
    }
    return true;
  }
}

async function createSession(database, userId, req, res, { setCookie = true } = {}) {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);

  await database.query(
    `INSERT INTO user_sessions (
       session_token_hash,
       user_id,
       expires_at
     )
     VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 second'))`,
    [tokenHash, userId, SESSION_MAX_AGE_SECONDS],
  );

  if (setCookie) setSessionCookie(res, req, token);
  return token;
}

export function createAuthRouter({
  pool = defaultPool,
  logger = console,
} = {}) {
  const router = Router();
  const requireAuth = createRequireAuth({ pool });
  const registrationLimit = createRateLimiter({ scope: "auth-register", windowMs: 60 * 60 * 1000, max: 8, pool });
  const loginIpLimit = createRateLimiter({ scope: "auth-login-ip", windowMs: 15 * 60 * 1000, max: 50, pool });
  const loginIdentityLimit = createRateLimiter({
    scope: "auth-login-identity",
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => hashRateLimitIdentity(
      typeof req.body?.email === "string" ? req.body.email : `invalid:${getClientIp(req) ?? ""}`,
    ),
    pool,
  });
  const passwordChangeLimit = createRateLimiter({
    scope: "auth-password-change",
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyGenerator: (req) => req.user?.id || getClientIp(req),
    pool,
  });

  router.post("/register", requireTrustedOrigin, registrationLimit, async (req, res, next) => {
    const name =
      typeof req.body?.name === "string" ? req.body.name.trim() : "";

    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password =
      typeof req.body?.password === "string" ? req.body.password : "";

    if (name.length < 2 || name.length > 80) {
      return sendError(res, 400, "Nama harus terdiri dari 2 sampai 80 karakter.");
    }

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return sendError(res, 400, "Format email tidak valid.");
    }

    if (password.length < 10 || password.length > 128) {
      return sendError(res, 400, "Password harus terdiri dari 10 sampai 128 karakter.");
    }

    let client;
    let transactionStarted = false;
    let rollbackFailed = false;

    try {
      const passwordHash = await hashPassword(password);
      client = await pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;

      // Role selalu customer. Role dari body tidak pernah digunakan.
      const userResult = await client.query(
        `INSERT INTO users (
           role_id,
           name,
           email,
           password_hash
         )
         SELECT id, $1, $2, $3
         FROM roles
         WHERE name = 'customer'
         RETURNING id, name, email`,
        [name, email, passwordHash],
      );

      if (userResult.rows.length === 0) {
        throw new Error("Role customer belum tersedia. Jalankan migration database.");
      }

      const user = {
        ...userResult.rows[0],
        role: "customer",
      };

      const sessionToken = await createSession(
        client,
        user.id,
        req,
        res,
        { setCookie: false },
      );

      await client.query("COMMIT");
      transactionStarted = false;
      setSessionCookie(res, req, sessionToken);

      return sendSuccess(
        res,
        201,
        "Registrasi berhasil.",
        publicUser(user),
      );
    } catch (error) {
      if (client && transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          rollbackFailed = true;
          logger.error("Registrasi gagal melakukan rollback:", {
            name: rollbackError?.name || "Error",
            code: rollbackError?.code || "unknown",
          });
        }
      }

      if (!rollbackFailed && error.code === "23505") {
        return sendError(res, 409, "Email sudah terdaftar.");
      }

      return next(error);
    } finally {
      if (client) {
        if (rollbackFailed) {
          client.release(new Error("Registration transaction rollback failed."));
        } else {
          client.release();
        }
      }
    }
  });

  router.post("/login", requireTrustedOrigin, loginIpLimit, loginIdentityLimit, async (req, res, next) => {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password =
      typeof req.body?.password === "string" ? req.body.password : "";

    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !password ||
      password.length > 128
    ) {
      return sendError(res, 400, "Email atau password tidak valid.");
    }

    try {
      const result = await pool.query(
        `SELECT
           u.id,
           u.name,
           u.email,
           u.password_hash,
           r.name AS role
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE LOWER(u.email) = LOWER($1)
         LIMIT 1`,
        [email],
      );

      const user = result.rows[0];

      if (!user || !(await verifyPassword(password, user.password_hash))) {
        // Pesan dibuat sama agar tidak membocorkan keberadaan email.
        return sendError(res, 401, "Email atau password salah.");
      }

      await createSession(pool, user.id, req, res);

      return sendSuccess(
        res,
        200,
        "Login berhasil.",
        publicUser(user),
      );
    } catch (error) {
      return next(error);
    }
  });

  router.post("/logout", requireTrustedOrigin, async (req, res, next) => {
    try {
      const token = readSessionToken(req);

      if (token) {
        let tokenHash = null;

  try {
    tokenHash = hashSessionToken(token);
  } catch {
    // Token malformed tidak dapat digunakan untuk autentikasi.
  }

  if (tokenHash) {
    await pool.query(
      `UPDATE user_sessions
       SET revoked_at = NOW()
       WHERE session_token_hash = $1
         AND revoked_at IS NULL`,
      [tokenHash],
    );
  }
      }

      clearSessionCookie(res, req);

      return sendSuccess(res, 200, "Logout berhasil.", null);
    } catch (error) {
      return next(error);
    }
  });

  router.get("/me", requireAuth, (req, res) => {
    return sendSuccess(
      res,
      200,
      "Data pengguna berhasil diambil.",
      publicUser(req.user),
    );
  });

  router.post("/password/change", requireTrustedOrigin, requireAuth, requireRole(ROLES.CUSTOMER), passwordChangeLimit, async (req, res, next) => {
    const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (Object.keys(req.body || {}).some((key) => !["currentPassword", "newPassword"].includes(key)) || currentPassword.length < 1 || currentPassword.length > 128 || newPassword.length < 10 || newPassword.length > 128 || currentPassword === newPassword) {
      return sendError(res, 400, "Data perubahan password tidak valid.");
    }
    let client;
    let rollbackFailed = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      const selected = await client.query("SELECT password_hash FROM users WHERE id=$1 FOR UPDATE", [req.user.id]);
      if (!selected.rowCount || !(await verifyPassword(currentPassword, selected.rows[0].password_hash))) {
        rollbackFailed = await rollbackTransaction(client, logger, "change-password");
        if (rollbackFailed) return next(new Error("Password-change transaction rollback failed."));
        return sendError(res, 400, "Password saat ini tidak sesuai.");
      }
      const passwordHash = await hashPassword(newPassword);
      await client.query("UPDATE users SET password_hash=$1, updated_at=clock_timestamp() WHERE id=$2", [passwordHash, req.user.id]);
      await client.query("UPDATE user_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL", [req.user.id]);
      await client.query("COMMIT");
      clearSessionCookie(res, req);
      return sendSuccess(res, 200, "Password berhasil diubah. Silakan login kembali.", null);
    } catch (error) {
      if (client) rollbackFailed = await rollbackTransaction(client, logger, "change-password", error);
      return next(error);
    } finally {
      if (client) {
        if (rollbackFailed) client.release(new Error("Password-change transaction rollback failed."));
        else client.release();
      }
    }
  });

  return router;
}

export default createAuthRouter();
