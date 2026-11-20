import { randomBytes } from "node:crypto";

const CODE_ATTEMPTS = 5;

export function generateTicketCode() {
  return `KK-TKT-${randomBytes(32).toString("hex").toUpperCase()}`;
}

export function isValidTicketCode(value) {
  return typeof value === "string" && /^KK-TKT-[A-F0-9]{64}$/.test(value);
}

/** Caller owns the transaction; booking/payment rows are locked by this query. */
export async function issueBookingTickets(
  client,
  bookingId,
  { createCode = generateTicketCode } = {},
) {
  const booking = await client.query(
    `SELECT b.id::text AS id, b.quantity, b.status AS "bookingStatus",
            p.status AS "paymentStatus"
     FROM bookings b
     JOIN payments p ON p.booking_id = b.id
     WHERE b.id = $1::bigint
     FOR UPDATE OF b, p`,
    [bookingId],
  );

  if (
    booking.rowCount !== 1 ||
    booking.rows[0].bookingStatus !== "confirmed" ||
    booking.rows[0].paymentStatus !== "paid"
  ) {
    return [];
  }

  const { quantity } = booking.rows[0];
  const current = await client.query(
    `SELECT ticket_code AS "ticketCode", ticket_number AS "ticketNumber"
     FROM digital_tickets WHERE booking_id=$1::bigint`,
    [bookingId],
  );
  const existingNumbers = new Set(current.rows.map((ticket) => ticket.ticketNumber));

  for (let ticketNumber = 1; ticketNumber <= quantity; ticketNumber += 1) {
    if (existingNumbers.has(ticketNumber)) continue;
    let inserted = false;
    for (let attempt = 0; attempt < CODE_ATTEMPTS && !inserted; attempt += 1) {
      const code = createCode();
      const result = await client.query(
        `INSERT INTO digital_tickets (booking_id, ticket_number, ticket_code)
         VALUES ($1::bigint, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING ticket_code AS "ticketCode", ticket_number AS "ticketNumber"`,
        [bookingId, ticketNumber, code],
      );

      if (result.rowCount === 1) {
        inserted = true;
        continue;
      }

      const existing = await client.query(
        `SELECT ticket_code AS "ticketCode", ticket_number AS "ticketNumber"
         FROM digital_tickets
         WHERE booking_id = $1::bigint AND ticket_number = $2`,
        [bookingId, ticketNumber],
      );
      if (existing.rowCount === 1) inserted = true;
    }

    if (!inserted) {
      throw new Error("Kode tiket tidak dapat dibuat secara unik.");
    }
  }

  const tickets = await client.query(
    `SELECT ticket_code AS "ticketCode", ticket_number AS "ticketNumber",
            status, issued_at AS "issuedAt", used_at AS "usedAt"
     FROM digital_tickets
     WHERE booking_id = $1::bigint
     ORDER BY ticket_number`,
    [bookingId],
  );
  return tickets.rows;
}
