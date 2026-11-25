import express from "express";
import cors from "cors";
import { checkDatabaseConnection } from "./config/database.js";
import concertRouterDefault from "./routes/concerts.js";
import bookingRouterDefault from "./routes/bookings.js";
import authRouterDefault from "./routes/auth.js";
import adminRouterDefault from "./routes/admin.js";
import customerRouterDefault from "./routes/customer.js";
import paymentRouterDefault from "./routes/payments.js";
import customerTicketRouterDefault from "./routes/customerTickets.js";
import adminTicketRouterDefault from "./routes/adminTickets.js";
import { sendError, sendSuccess } from "./utils/apiResponse.js";
import { resolveSessionSameSite } from "./utils/session.js";
import {
  normalizeOrigin,
  resolveTrustedOrigins,
} from "./middleware/trustedOrigin.js";

export function resolveCorsOrigin(environment = process.env) {
  return resolveTrustedOrigins(environment)[0];
}

export function resolveCorsOrigins(environment = process.env) {
  return resolveTrustedOrigins(environment);
}

export function isCorsOriginAllowed(origin, allowedOrigins = resolveCorsOrigins()) {
  const normalizedOrigin = normalizeOrigin(origin);
  return Boolean(normalizedOrigin && allowedOrigins.includes(normalizedOrigin));
}

export function createApp({
  concertRouter = concertRouterDefault,
  bookingRouter = bookingRouterDefault,
  authRouter = authRouterDefault,
  adminRouter = adminRouterDefault,
  customerRouter = customerRouterDefault,
  paymentRouter = paymentRouterDefault,
  customerTicketRouter = customerTicketRouterDefault,
  adminTicketRouter = adminTicketRouterDefault,
  databaseHealthCheck = checkDatabaseConnection,
  logger = console,
} = {}) {
  resolveSessionSameSite();
  const corsOrigins = resolveCorsOrigins();
  const app = express();
  app.locals.trustedOrigins = corsOrigins;

  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https:",
    );
    if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000");
    next();
  });

  app.use(
    cors({
      origin: (origin, callback) => {
        callback(
          null,
          isCorsOriginAllowed(origin, corsOrigins)
            ? normalizeOrigin(origin)
            : false,
        );
      },
      credentials: true,
      exposedHeaders: ["Content-Disposition", "X-Export-Truncated"],
    }),
  );

  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => {
    return sendSuccess(
      res,
      200,
      "KonserKita API berjalan.",
      undefined,
      { service: "konserkita-backend" },
    );
  });

  app.get("/api/health/db", async (_req, res, next) => {
    try {
      const result = await databaseHealthCheck();

      if (!result.connected) {
        return sendError(
          res,
          503,
          "Database belum dapat dihubungi.",
          { database: "unavailable" },
        );
      }

      return sendSuccess(
        res,
        200,
        "Koneksi database berhasil.",
        undefined,
        { database: "connected" },
      );
    } catch (error) {
      return next(error);
    }
  });

  app.use("/api/concerts", concertRouter);
  app.use("/api/bookings", bookingRouter);
  app.use("/api/payments", paymentRouter);
  app.use("/api/customer/tickets", customerTicketRouter);
  app.use("/api/admin/tickets", adminTicketRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/customer", customerRouter);

  app.use((err, _req, res, _next) => {
    if (res.headersSent) return;

    if (err?.type === "entity.parse.failed") {
      return sendError(res, 400, "Format JSON tidak valid.");
    }

    if (err?.type === "entity.too.large") {
      return sendError(res, 413, "Ukuran request terlalu besar.");
    }

    if (err?.type === "request.aborted") {
      return sendError(res, 400, "Request tidak selesai dikirim.");
    }

    if (
      err instanceof SyntaxError &&
      Object.prototype.hasOwnProperty.call(err, "body")
    ) {
      return sendError(res, 400, "Format JSON tidak valid.");
    }

    logger.error("API request failed:", { name: err?.name || "Error", code: err?.code || "unknown" });

    return sendError(
      res,
      500,
      "Terjadi kesalahan pada server.",
    );
  });

  app.use((_req, res) => {
    return sendError(res, 404, "Endpoint tidak ditemukan.");
  });

  return app;
}

const app = createApp();

export default app;
