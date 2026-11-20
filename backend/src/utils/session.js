import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "kk_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function generateSessionToken() {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) {
    throw new Error("Session token tidak valid.");
  }

  return createHash("sha256").update(token).digest("hex");
}

export function resolveSessionSameSite(environment = process.env) {
  const sameSite = String(environment.SESSION_COOKIE_SAME_SITE || "lax")
    .trim()
    .toLowerCase();

  if (sameSite !== "lax" && sameSite !== "none") {
    throw new Error("SESSION_COOKIE_SAME_SITE must be Lax or None.");
  }

  if (sameSite === "none") {
    const frontendUrl = environment.FRONTEND_URL?.trim();
    let parsedFrontendUrl;

    try {
      parsedFrontendUrl = new URL(frontendUrl);
    } catch {
      throw new Error("Cross-site session cookies require an explicit HTTPS FRONTEND_URL origin.");
    }

    if (
      environment.NODE_ENV !== "production" ||
      parsedFrontendUrl.protocol !== "https:" ||
      parsedFrontendUrl.origin !== frontendUrl ||
      frontendUrl.includes("*") ||
      parsedFrontendUrl.username ||
      parsedFrontendUrl.password
    ) {
      throw new Error("Cross-site session cookies require production and an exact HTTPS FRONTEND_URL origin.");
    }
  }

  return sameSite;
}

export function getSessionCookieOptions(req, environment = process.env) {
  const sameSite = resolveSessionSameSite(environment);
  const isSecure =
    environment.NODE_ENV === "production" ||
    Boolean(req.secure) ||
    sameSite === "none";

  return {
    httpOnly: true,
    secure: isSecure,
    sameSite,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS * 1000,
  };
}

export function setSessionCookie(res, req, token) {
  res.cookie(
    SESSION_COOKIE_NAME,
    token,
    getSessionCookieOptions(req),
  );
}

export function clearSessionCookie(res, req) {
  const options = getSessionCookieOptions(req);

  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: options.secure,
    sameSite: options.sameSite,
    path: "/",
  });
}

export function readSessionToken(req) {
  const cookieHeader = req.headers.cookie || "";

  for (const item of cookieHeader.split(";")) {
    const separatorIndex = item.indexOf("=");

    if (separatorIndex === -1) continue;

    const name = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();

    if (name === SESSION_COOKIE_NAME) {
      try {
        return decodeURIComponent(value);
      } catch {
        return null;
      }
    }
  }

  return null;
}
