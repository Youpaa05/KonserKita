import express from "express";
import { pool } from "../config/database.js";

const router = express.Router();

const MAX_FILTER_LENGTH = 100;

function readFilter(value, name) {
  if (value === undefined) {
    return { valid: true, value: "" };
  }

  if (typeof value !== "string") {
    return { valid: false };
  }

  const normalized = value.trim();

  if (normalized.length > MAX_FILTER_LENGTH) {
    return { valid: false };
  }

  return { valid: true, value: normalized };
}

function invalidFilterResponse(res) {
  return res.status(400).json({
    success: false,
    message: "Parameter pencarian atau filter tidak valid.",
  });
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
    ) AS price,
    c.accent,
    c.image_url AS image,
    c.description
  FROM concerts AS c
`;

// Task 101 dan 103: daftar, pencarian, dan filter konser.
router.get("/", async (req, res) => {
  const q = readFilter(req.query.q, "q");
  const category = readFilter(req.query.category, "category");
  const city = readFilter(req.query.city, "city");

  if (!q.valid || !category.valid || !city.valid) {
    return invalidFilterResponse(res);
  }

  const conditions = [];
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

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const result = await pool.query(
    `${concertSelect}
     ${whereClause}
     ORDER BY c.event_date ASC, c.id ASC`,
    values,
  );

  return res.status(200).json({
    success: true,
    data: result.rows,
  });
});

// Task 104: kategori tiket berdasarkan ID atau slug konser.
router.get("/:idOrSlug/ticket-categories", async (req, res) => {
  const { idOrSlug } = req.params;

  const isNumericId = /^\d+$/.test(idOrSlug);

  if (!isNumericId && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(idOrSlug)) {
    return res.status(400).json({
      success: false,
      message: "ID atau slug konser tidak valid.",
    });
  }

  const concertResult = isNumericId
    ? await pool.query(
        "SELECT id FROM concerts WHERE id = $1::bigint",
        [idOrSlug],
      )
    : await pool.query(
        "SELECT id FROM concerts WHERE slug = $1",
        [idOrSlug],
      );

  if (concertResult.rowCount === 0) {
    return res.status(404).json({
      success: false,
      message: "Konser tidak ditemukan.",
    });
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
     ORDER BY price ASC, id ASC`,
    [concertId],
  );

  return res.status(200).json({
    success: true,
    data: result.rows,
  });
});

// Task 102: detail konser berdasarkan ID atau slug.
router.get("/:idOrSlug", async (req, res) => {
  const { idOrSlug } = req.params;

  const isNumericId = /^\d+$/.test(idOrSlug);

  if (!isNumericId && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(idOrSlug)) {
    return res.status(400).json({
      success: false,
      message: "ID atau slug konser tidak valid.",
    });
  }

  const result = isNumericId
    ? await pool.query(
        `${concertSelect} WHERE c.id = $1::bigint`,
        [idOrSlug],
      )
    : await pool.query(
        `${concertSelect} WHERE c.slug = $1`,
        [idOrSlug],
      );

  if (result.rowCount === 0) {
    return res.status(404).json({
      success: false,
      message: "Konser tidak ditemukan.",
    });
  }

  return res.status(200).json({
    success: true,
    data: result.rows[0],
  });
});

export default router;
