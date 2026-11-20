import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getCustomerTickets } from "../services/api";
import TicketQr from "../components/TicketQr";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeStyle: "short" }).format(date);
}

export default function CustomerTickets() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    getCustomerTickets({ signal: controller.signal })
      .then((response) => setTickets(response?.tickets || []))
      .catch((requestError) => { if (requestError.name !== "AbortError") setError(requestError.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  return (
    <section className="dashboard-page">
      <div className="dashboard-heading">
        <span className="dashboard-eyebrow">CUSTOMER AREA</span>
        <h1>Tiket Digital</h1>
        <p>QR Code berisi kode tiket acak. Validitasnya diperiksa oleh petugas melalui server.</p>
      </div>
      {loading && <p role="status">Memuat tiket...</p>}
      {error && <p className="dashboard-error" role="alert">{error}</p>}
      {!loading && !error && tickets.length === 0 && (
        <article className="dashboard-card"><h2>Belum ada tiket</h2><p>Tiket muncul setelah pembayaran simulasi berhasil.</p><Link to="/customer/bookings">Lihat riwayat pesanan</Link></article>
      )}
      <div className="ticket-grid">
        {tickets.map((ticket) => (
          <article className="ticket-card" key={ticket.ticketCode}>
            <div>
              <span className={`ticket-state ticket-state-${ticket.ticketStatus}`}>{ticket.ticketStatus === "used" ? "Sudah digunakan" : "Siap digunakan"}</span>
              <h2>{ticket.concertTitle}</h2>
              <p>{ticket.eventDate} · {ticket.eventTime} WIB</p>
              <p>{ticket.venue}, {ticket.city}</p>
              <p>Kategori: {ticket.ticketCategory} · Tiket #{ticket.ticketNumber}</p>
              <p>Pemilik: {ticket.ownerName}</p>
              <p>Kode: <strong>{ticket.ticketCode}</strong></p>
              <p>Booking: {ticket.bookingCode}</p>
              {ticket.usedAt && <p>Digunakan: {formatDate(ticket.usedAt)}</p>}
            </div>
            <TicketQr ticketCode={ticket.ticketCode} />
          </article>
        ))}
      </div>
    </section>
  );
}
