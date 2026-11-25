import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getCustomerTickets } from "../services/api";

const FILTERS = [["all", "Semua"], ["ready", "Siap digunakan"], ["used", "Sudah digunakan"], ["cancelled", "Konser dibatalkan"]];

function formatDate(value) {
  if (!value) return "Jadwal belum tersedia";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(date);
}

export default function CustomerTickets() {
  const [tickets, setTickets] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getCustomerTickets({ signal: controller.signal })
      .then((response) => setTickets(Array.isArray(response?.tickets) ? response.tickets : []))
      .catch((requestError) => { if (requestError.name !== "AbortError") setError(requestError.message || "Tiket gagal dimuat."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  const counts = useMemo(() => ({
    all: tickets.length,
    ready: tickets.filter((ticket) => !ticket.concertCancelledAt && ticket.ticketStatus !== "used").length,
    used: tickets.filter((ticket) => !ticket.concertCancelledAt && ticket.ticketStatus === "used").length,
    cancelled: tickets.filter((ticket) => Boolean(ticket.concertCancelledAt)).length,
  }), [tickets]);

  const visibleTickets = useMemo(() => tickets.filter((ticket) => {
    if (filter === "cancelled") return Boolean(ticket.concertCancelledAt);
    if (filter === "used") return !ticket.concertCancelledAt && ticket.ticketStatus === "used";
    if (filter === "ready") return !ticket.concertCancelledAt && ticket.ticketStatus !== "used";
    return true;
  }), [tickets, filter]);

  return (
    <section className="dashboard-page customer-tickets-page">
      <header className="dashboard-heading">
        <span className="dashboard-eyebrow">AKUN PELANGGAN · TIKET</span>
        <h1>Tiket digital</h1>
        <p>Tiket terbit setelah pembayaran simulasi berhasil. Buka detail untuk menampilkan QR saat pemeriksaan.</p>
      </header>
      {!loading && !error && tickets.length > 0 && <div className="ticket-filter-bar" role="group" aria-label="Filter status tiket">
        {FILTERS.map(([key, label]) => <button key={key} type="button" className={filter === key ? "active" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<span>{counts[key]}</span></button>)}
      </div>}
      {loading && <p className="workspace-loading" role="status">Memuat tiket digital…</p>}
      {error && <div className="dashboard-error" role="alert"><p>{error}</p><button className="button button-ghost" type="button" onClick={() => setRetry((value) => value + 1)}>Coba lagi</button></div>}
      {!loading && !error && tickets.length === 0 && <div className="empty-state"><h2>Belum ada tiket digital</h2><p>Tiket akan muncul setelah pesanan dikonfirmasi dan pembayaran simulasi berhasil.</p><Link className="button button-primary" to="/customer/bookings">Lihat pesanan</Link></div>}
      {!loading && !error && tickets.length > 0 && visibleTickets.length === 0 && <div className="empty-state ticket-filter-empty"><h2>Tidak ada tiket pada status ini</h2><p>Pilih status tiket lain untuk melihat tiket yang tersedia.</p></div>}
      {!loading && !error && visibleTickets.length > 0 && <div className="ticket-list">
        {visibleTickets.map((ticket) => {
          const cancelled = Boolean(ticket.concertCancelledAt);
          const used = ticket.ticketStatus === "used";
          const status = cancelled ? "Konser dibatalkan" : used ? "Sudah digunakan" : "Siap digunakan";
          return <article className={`ticket-list-card${cancelled ? " ticket-list-card-cancelled" : ""}`} key={ticket.ticketCode}>
            <div className="ticket-list-date"><strong>{ticket.eventDate ? new Date(`${ticket.eventDate}T00:00:00`).getDate() : "—"}</strong><span>{ticket.eventDate ? new Intl.DateTimeFormat("id-ID", { month: "short" }).format(new Date(`${ticket.eventDate}T00:00:00`)) : "TBA"}</span></div>
            <div className="ticket-list-info"><span className={`ticket-state${cancelled ? " ticket-state-cancelled" : used ? " ticket-state-used" : ""}`}>{status}</span><h2>{ticket.concertTitle}</h2><p>{formatDate(ticket.eventDate)} · {ticket.eventTime || "Waktu menyusul"} WIB</p><p>{ticket.venue}, {ticket.city} · {ticket.ticketCategory}</p></div>
            <div className="ticket-list-meta"><span>Tiket #{ticket.ticketNumber}</span><small>{ticket.ticketCode}</small><Link to={`/customer/tickets/${encodeURIComponent(ticket.ticketCode)}`}>Buka tiket <span aria-hidden="true">→</span></Link></div>
          </article>;
        })}
      </div>}
    </section>
  );
}
