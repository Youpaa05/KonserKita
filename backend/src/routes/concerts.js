import express from "express";
import { pool as defaultPool } from "../config/database.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";

const MAX_FILTER_LENGTH = 100;
const MAX_BIGINT = 9223372036854775807n;

function readFilter(value) {
  if (value === undefined) {
    return { valid: true, value: "" };
  }

  if (typeof value !== "string") {
    return { valid: false };
  }

  const normalized = value.trim();

  if (
    normalized.length > MAX_FILTER_LENGTH ||
    /[\u0000-\u001F\u007F]/.test(normalized)
  ) {
    return { valid: false };
  }

  return { valid: true, value: normalized };
}

function isValidConcertIdentifier(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  if (/^\d+$/.test(value)) {
    try {
      const numericId = BigInt(value);
      return numericId <= MAX_BIGINT;
    } catch {
      return false;
    }
  }

  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value);
}

function isNumericId(value) {
  return /^\d+$/.test(value);
}

const concertSelect = `
  SELECT
    c.id::text AS id,
    c.slug,
    c.title,
    c.artist,
    c.category,
    c.city,
    c.venue,
    to_char(c.event_date, 'YYYY-MM-DD') AS date,
    to_char(c.event_time, 'HH24:MI') AS time,
    (
      SELECT MIN(tc.price)::double precision
      FROM ticket_categories AS tc
      WHERE tc.concert_id = c.id
        AND tc.archived_at IS NULL
    ) AS price,
    c.accent,
    c.image_url AS image,
    c.description
  FROM concerts AS c
`;

export function createConcertRouter({
  pool = defaultPool,
} = {}) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const q = readFilter(req.query.q);
    const category = readFilter(req.query.category);
    const city = readFilter(req.query.city);
    const artist = readFilter(req.query.artist);
    const dateFrom = readFilter(req.query.dateFrom);
    const dateTo = readFilter(req.query.dateTo);
    const availability = readFilter(req.query.availability);
    const paginated = req.query.page !== undefined || req.query.limit !== undefined;
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const limit = req.query.limit === undefined ? 12 : Number(req.query.limit);
    const sort = req.query.sort === undefined ? "date" : req.query.sort;
    const direction = req.query.direction === undefined ? "asc" : req.query.direction;

    const validDate = (value) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
    if (!q.valid || !category.valid || !city.valid || !artist.valid || !dateFrom.valid || !dateTo.valid || !availability.valid ||
        !["", "available", "sold-out"].includes(availability.value) ||
        !validDate(dateFrom.value) || !validDate(dateTo.value) ||
        (dateFrom.value && dateTo.value && dateFrom.value > dateTo.value) ||
        !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
        !Number.isSafeInteger((page - 1) * limit) ||
        !["date", "title", "price"].includes(sort) || !["asc", "desc"].includes(direction)) {
      return sendError(
        res,
        400,
        "Parameter pencarian atau filter tidak valid.",
      );
    }

    const conditions = ["c.archived_at IS NULL"];
    const values = [];

    if (q.value) {
      values.push(`%${q.value}%`);
      const parameter = `$${values.length}`;

      conditions.push(`(
        c.title ILIKE ${parameter}
        OR c.artist ILIKE ${parameter}
        OR c.venue ILIKE ${parameter}
      )`);
    }

    if (category.value) {
      values.push(category.value);
      conditions.push(`c.category ILIKE $${values.length}`);
    }

    if (city.value) {
      values.push(city.value);
      conditions.push(`c.city ILIKE $${values.length}`);
    }

    if (artist.value) {
      values.push(`%${artist.value}%`);
      conditions.push(`c.artist ILIKE $${values.length}`);
    }

    if (dateFrom.value) {
      values.push(dateFrom.value);
      conditions.push(`c.event_date >= $${values.length}::date`);
    }

    if (dateTo.value) {
      values.push(dateTo.value);
      conditions.push(`c.event_date <= $${values.length}::date`);
    }

    if (availability.value === "available") {
      conditions.push(`EXISTS (SELECT 1 FROM ticket_categories available_tc
        WHERE available_tc.concert_id=c.id AND available_tc.archived_at IS NULL AND available_tc.quota > 0)`);
    } else if (availability.value === "sold-out") {
      conditions.push(`EXISTS (SELECT 1 FROM ticket_categories active_tc
        WHERE active_tc.concert_id=c.id AND active_tc.archived_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM ticket_categories available_tc
        WHERE available_tc.concert_id=c.id AND available_tc.archived_at IS NULL AND available_tc.quota > 0)`);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const orderBy = {
      date: `c.event_date ${direction.toUpperCase()}, c.id ${direction.toUpperCase()}`,
      title: `c.title ${direction.toUpperCase()}, c.id ASC`,
      price: `price ${direction.toUpperCase()} NULLS LAST, c.id ASC`,
    }[sort];
    const resultValues = [...values];
    let pagination = "LIMIT $" + (resultValues.push(paginated ? limit : 100));
    if (paginated) {
      resultValues.push((page - 1) * limit);
      pagination += ` OFFSET $${resultValues.length}`;
    }
    const result = await pool.query(
      `${concertSelect} ${whereClause} ORDER BY ${orderBy} ${pagination}`,
      resultValues,
    );

    if (paginated) {
      const count = await pool.query(`SELECT COUNT(*)::int AS total FROM concerts c ${whereClause}`, values);
      const total = count.rows[0].total;
      return sendSuccess(res, 200, "Daftar konser berhasil dimuat.", {
        concerts: result.rows, page, limit, total, totalPages: Math.ceil(total / limit),
      });
    }

    return sendSuccess(
      res,
      200,
      "Daftar konser berhasil dimuat.",
      result.rows,
    );
  });

  router.get("/:idOrSlug/ticket-categories", async (req, res) => {
    const { idOrSlug } = req.params;

    if (!isValidConcertIdentifier(idOrSlug)) {
      return sendError(
        res,
        400,
        "ID atau slug konser tidak valid.",
      );
    }

    const concertResult = isNumericId(idOrSlug)
      ? await pool.query(
          "SELECT id FROM concerts WHERE id = $1::bigint AND archived_at IS NULL",
          [idOrSlug],
        )
      : await pool.query(
          "SELECT id FROM concerts WHERE slug = $1 AND archived_at IS NULL",
          [idOrSlug],
        );

    if (concertResult.rowCount === 0) {
      return sendError(
        res,
        404,
        "Konser tidak ditemukan.",
      );
    }

    const concertId = concertResult.rows[0].id;

    const result = await pool.query(
      `SELECT
         id::text AS id,
         name,
         price::double precision AS price,
         quota
       FROM ticket_categories
       WHERE concert_id = $1
        AND archived_at IS NULL
      ORDER BY price ASC, id ASC`,
      [concertId],
    );

    return sendSuccess(
      res,
      200,
      "Kategori tiket berhasil dimuat.",
      result.rows,
    );
  });

  router.get("/:idOrSlug", async (req, res) => {
    const { idOrSlug } = req.params;

    if (!isValidConcertIdentifier(idOrSlug)) {
      return sendError(
        res,
        400,
        "ID atau slug konser tidak valid.",
      );
    }

    const result = isNumericId(idOrSlug)
      ? await pool.query(
          `${concertSelect} WHERE c.id = $1::bigint AND c.archived_at IS NULL`,
          [idOrSlug],
        )
      : await pool.query(
          `${concertSelect} WHERE c.slug = $1 AND c.archived_at IS NULL`,
          [idOrSlug],
        );

    if (result.rowCount === 0) {
      return sendError(
        res,
        404,
        "Konser tidak ditemukan.",
      );
    }

    return sendSuccess(
      res,
      200,
      "Detail konser berhasil dimuat.",
      result.rows[0],
    );
  });

  return router;
}

export default createConcertRouter();
