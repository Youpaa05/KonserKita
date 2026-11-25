import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import TicketQr from "../components/TicketQr";
import { getCustomerTicket } from "../services/api";

function formatDate(value) {
  if (!value) return "Jadwal belum tersedia";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("id-ID", { dateStyle: "full" }).format(date);
}

export default function CustomerTicketDetail() {
  const { ticketCode } = useParams();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getCustomerTicket(ticketCode, { signal: controller.signal })
      .then(setTicket)
      .catch((requestError) => { if (requestError.name !== "AbortError") setError(requestError.message || "Detail tiket gagal dimuat."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ticketCode, retry]);

  const cancelled = Boolean(ticket?.concertCancelledAt);
  const used = ticket?.ticketStatus === "used";

  return (
    <section className="dashboard-page customer-ticket-detail-page">
      <div className="customer-detail-backlinks"><Link to="/customer/tickets">← Semua tiket</Link>{ticket && <Link to={`/customer/bookings/${encodeURIComponent(ticket.bookingCode)}`}>Detail pesanan →</Link>}</div>
      {loading && <p className="workspace-loading" role="status">Memuat detail tiket…</p>}
      {error && <div className="dashboard-error" role="alert"><p>{error}</p><button className="button button-ghost" type="button" onClick={() => setRetry((value) => value + 1)}>Coba lagi</button></div>}
      {!loading && !error && ticket && <article className="ticket-detail-card">
        <div className="ticket-detail-main">
          <span className={`ticket-state${cancelled ? " ticket-state-cancelled" : used ? " ticket-state-used" : ""}`}>{cancelled ? "Konser dibatalkan · tiket tidak dapat digunakan" : used ? "Tiket sudah digunakan" : "Tiket siap digunakan"}</span>
          <span className="section-kicker">TIKET DIGITAL · #{ticket.ticketNumber}</span>
          <h1>{ticket.concertTitle}</h1>
          <p className="ticket-detail-date">{formatDate(ticket.eventDate)} · {ticket.eventTime || "Waktu menyusul"} WIB</p>
          <div className="ticket-detail-facts"><div><span>Lokasi</span><strong>{ticket.venue}, {ticket.city}</strong></div><div><span>Kategori</span><strong>{ticket.ticketCategory}</strong></div><div><span>Nama pemegang</span><strong>{ticket.ownerName}</strong></div><div><span>Kode tiket</span><strong>{ticket.ticketCode}</strong></div><div><span>Kode pesanan</span><strong>{ticket.bookingCode}</strong></div></div>
          {cancelled && <div className="ticket-cancellation-notice" role="alert"><strong>Informasi pembatalan</strong><p>{ticket.cancellationReason || "Konser ini dibatalkan oleh penyelenggara."}</p><span>Hubungi penyelenggara untuk informasi lanjutan terkait kebijakan pembatalan.</span></div>}
          {used && ticket.usedAt && <p className="ticket-used-note">Tiket ini telah digunakan pada {new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(ticket.usedAt))}.</p>}
        </div>
        <aside className="ticket-detail-qr"><TicketQr ticketCode={ticket.ticketCode} /><strong>QR Code tiket</strong><p>Tampilkan QR ini kepada petugas untuk pemeriksaan. Kode divalidasi melalui server.</p></aside>
      </article>}
    </section>
  );
}
