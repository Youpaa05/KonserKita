import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { pool as defaultPool } from "../config/database.js";
import { sendError } from "../utils/apiResponse.js";

const MAX_BUCKETS = 10_000;
const configuredIdentityHashKey = process.env.RATE_LIMIT_SECRET?.trim();
if (
  process.env.NODE_ENV === "production" &&
  (!configuredIdentityHashKey || Buffer.byteLength(configuredIdentityHashKey) < 32)
) {
  throw new Error("RATE_LIMIT_SECRET harus berisi minimal 32 byte pada production.");
}
const IDENTITY_HASH_KEY = configuredIdentityHashKey
  ? Buffer.from(configuredIdentityHashKey)
  : randomBytes(32);
let lastExpiredBucketCleanup = 0;

export function getClientIp(req) {
  const event = req.apiGateway?.event;
  const candidates = event
    ? [
        event.requestContext?.http?.sourceIp,
        event.requestContext?.identity?.sourceIp,
        req.ip,
        req.headers?.["x-nf-client-connection-ip"],
      ]
    : [req.ip, req.socket?.remoteAddress];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const address = candidate.trim();
      if (isIP(address)) return address;
    }
  }

  return null;
}

export function createRateLimiter({
  windowMs,
  max,
  scope = "default",
  keyGenerator = getClientIp,
  now = Date.now,
  pool = defaultPool,
  store = process.env.NODE_ENV === "production" ? "postgres" : "memory",
} = {}) {
  if (!Number.isSafeInteger(windowMs) || windowMs < 1 || !Number.isSafeInteger(max) || max < 1) {
    throw new Error("Konfigurasi rate limit tidak valid.");
  }
  if (!["memory", "postgres"].includes(store)) {
    throw new Error("Penyimpanan rate limit tidak valid.");
  }
  if (typeof scope !== "string" || !/^[a-z0-9-]{1,80}$/.test(scope)) {
    throw new Error("Scope rate limit tidak valid.");
  }

  const buckets = new Map();

  return function rateLimit(req, res, next) {
    const currentTime = now();
    const generatedKey = keyGenerator(req);
    if (
      generatedKey === null ||
      generatedKey === undefined ||
      String(generatedKey).trim() === ""
    ) {
      return sendError(res, 503, "Alamat client tidak tersedia untuk rate limiting.");
    }
    const key = String(generatedKey);

    if (store === "postgres") {
      return applyPostgresLimit({
        currentTime,
        key,
        max,
        next,
        pool,
        res,
        scope,
        windowMs,
      }).catch(next);
    }

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= currentTime) {
      bucket = { count: 0, resetAt: currentTime + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (buckets.size > MAX_BUCKETS) {
      for (const [storedKey, storedBucket] of buckets) {
        if (storedBucket.resetAt <= currentTime || (buckets.size > MAX_BUCKETS && storedKey !== key)) buckets.delete(storedKey);
        if (buckets.size <= MAX_BUCKETS) break;
      }
    }

    const remaining = Math.max(0, max - bucket.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000));
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return sendError(res, 429, "Terlalu banyak permintaan. Silakan coba kembali nanti.", { retryAfterSeconds });
    }

    return next();
  };
}

async function applyPostgresLimit({
  currentTime,
  key,
  max,
  next,
  pool,
  res,
  scope,
  windowMs,
}) {
  if (currentTime - lastExpiredBucketCleanup >= 60 * 60 * 1000) {
    await pool.query(
      "DELETE FROM public.api_rate_limit_buckets WHERE reset_at <= clock_timestamp()",
    );
    lastExpiredBucketCleanup = currentTime;
  }

  const windowStart = Math.floor(currentTime / windowMs) * windowMs;
  const resetAt = new Date(windowStart + windowMs);
  const identityHash = hashRateLimitIdentity(key);
  const result = await pool.query(
    `WITH expired AS (
       DELETE FROM public.api_rate_limit_buckets
       WHERE scope = $1 AND identity_hash = $2 AND window_start < $3
       RETURNING 1
     ),
     updated AS (
       INSERT INTO public.api_rate_limit_buckets
       (scope, identity_hash, window_start, reset_at, request_count)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (scope, identity_hash, window_start)
       DO UPDATE SET request_count = api_rate_limit_buckets.request_count + 1
       RETURNING request_count, reset_at
     )
     SELECT request_count, reset_at FROM updated`,
    [scope, identityHash, new Date(windowStart), resetAt],
  );
  const bucket = result.rows[0];
  if (!bucket) {
    throw new Error("Penyimpanan rate limit tidak mengembalikan counter.");
  }

  const remaining = Math.max(0, max - Number(bucket.request_count));
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((new Date(bucket.reset_at).getTime() - currentTime) / 1000),
  );
  res.setHeader("RateLimit-Limit", String(max));
  res.setHeader("RateLimit-Remaining", String(remaining));
  res.setHeader(
    "RateLimit-Reset",
    String(Math.ceil(new Date(bucket.reset_at).getTime() / 1000)),
  );

  if (Number(bucket.request_count) > max) {
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return sendError(res, 429, "Terlalu banyak permintaan. Silakan coba kembali nanti.", { retryAfterSeconds });
  }

  return next();
}

export function hashRateLimitIdentity(value) {
  return createHmac("sha256", IDENTITY_HASH_KEY).update(String(value).trim().toLowerCase()).digest("hex");
}
