import { useState } from "react";
import { validateAdminTicket } from "../services/api";

export default function AdminTicketCheck() {
  const [ticketCode, setTicketCode] = useState("");
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true); setError(""); setTicket(null);
    try {
      const result = await validateAdminTicket(ticketCode.trim().toUpperCase());
      setTicket(result.ticket);
    } catch (requestError) {
      setError(requestError.message || "Tiket tidak dapat divalidasi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-page">
      <div className="dashboard-heading">
        <span className="dashboard-eyebrow">ADMINISTRATION</span>
        <h1>Pemeriksaan Tiket</h1>
        <p>Masukkan kode dari hasil pemindaian QR. Server akan memvalidasi dan menandai tiket sebagai digunakan.</p>
      </div>
      <form className="ticket-check-form" onSubmit={handleSubmit}>
        <label htmlFor="ticket-code">Kode tiket</label>
        <input id="ticket-code" value={ticketCode} onChange={(event) => setTicketCode(event.target.value.toUpperCase())} placeholder="KK-TKT-..." autoComplete="off" required />
        <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Memeriksa..." : "Validasi dan gunakan tiket"}</button>
      </form>
      {error && <p className="dashboard-error" role="alert">{error}</p>}
      {ticket && (
        <article className="dashboard-card ticket-check-result" role="status">
          <span className="ticket-state ticket-state-used">Valid · sudah ditandai digunakan</span>
          <h2>{ticket.concertTitle}</h2>
          <p>{ticket.eventDate} · {ticket.eventTime} WIB</p>
          <p>{ticket.venue}, {ticket.city}</p>
          <p>Pemilik: {ticket.ownerName}</p>
          <p>Kategori: {ticket.ticketCategory} · Tiket #{ticket.ticketNumber}</p>
          <p>Booking: {ticket.bookingCode}</p>
          <p>Waktu validasi: {new Date(ticket.usedAt).toLocaleString("id-ID")}</p>
        </article>
      )}
    </section>
  );
}
