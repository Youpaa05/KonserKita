import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getCustomerBookings } from "../services/api";

function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusLabel(status) {
  const labels = {
    pending: "Menunggu pembayaran",
    confirmed: "Dikonfirmasi",
    cancelled: "Dibatalkan",
  };

  return labels[status] || status;
}

export default function CustomerBookingHistory() {
  const [bookings, setBookings] = useState([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError("");
    getCustomerBookings({ signal: controller.signal })
      .then((response) => {
        setBookings(response?.bookings || []);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError(err.message || "Riwayat pesanan gagal dimuat.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [retry]);

  const filteredBookings = useMemo(() => bookings.filter((booking) => {
    const text = `${booking.bookingCode} ${booking.concertTitle} ${booking.ticketCategory}`.toLocaleLowerCase("id");
    return (!status || booking.status === status) && text.includes(query.trim().toLocaleLowerCase("id"));
  }).sort((a, b) => sort === "eventDate" ? String(a.eventDate || "").localeCompare(String(b.eventDate || "")) : new Date(b.createdAt) - new Date(a.createdAt)), [bookings, query, status, sort]);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredBookings.length / pageSize));
  const visibleBookings = filteredBookings.slice((page - 1) * pageSize, page * pageSize);

  return (
    <section className="dashboard-page">
      <div className="dashboard-heading">
        <span className="dashboard-eyebrow">CUSTOMER AREA</span>
        <h1>Riwayat Pesanan</h1>
        <p>Lihat seluruh pesanan tiket yang terhubung dengan akun kamu.</p>
      </div>

      <div className="customer-order-tools">
        <label className="customer-order-search"><span aria-hidden="true">⌕</span><span className="visually-hidden">Cari pesanan</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Cari kode pesanan atau konser" /></label>
        <label className="customer-order-status">Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">Semua status</option><option value="pending">Menunggu pembayaran</option><option value="confirmed">Dikonfirmasi</option><option value="cancelled">Dibatalkan</option></select></label>
        <label className="customer-order-status">Urutkan<select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="newest">Pesanan terbaru</option><option value="eventDate">Tanggal konser</option></select></label>
        <Link className="button button-primary" to="/concerts">Jelajahi konser</Link>
      </div>

      {loading && <p className="workspace-loading" role="status">Memuat riwayat pesanan…</p>}
      {error && <div className="dashboard-error" role="alert"><p>{error}</p><button className="button button-ghost" type="button" onClick={() => setRetry((value) => value + 1)}>Coba lagi</button></div>}

      {!loading && !error && bookings.length === 0 && (
        <article className="dashboard-card">
          <h2>Belum ada pesanan</h2>
          <p>Pesanan yang kamu buat setelah login akan muncul di halaman ini.</p>
          <Link className="button button-primary" to="/concerts">
            Cari konser
          </Link>
        </article>
      )}

      {!loading && !error && bookings.length > 0 && visibleBookings.length === 0 && <div className="empty-state"><h2>Tidak ada pesanan yang cocok</h2><p>Ubah kata kunci atau status untuk melihat pesanan lain.</p><button className="button button-ghost" type="button" onClick={() => { setQuery(""); setStatus(""); setPage(1); }}>Reset pencarian</button></div>}

      {!loading && !error && visibleBookings.length > 0 && <div className="customer-order-list">
        {visibleBookings.map((booking) => (
          <article className="customer-order-card" key={booking.bookingCode}>
            <div className="customer-order-card-heading"><div><span className="section-kicker">{booking.bookingCode}</span><h2>{booking.concertTitle}</h2><p>{booking.ticketCategory} · {booking.quantity} tiket</p></div><span className={`booking-status-pill booking-status-${booking.paymentStatus || booking.status}`}>{booking.paymentStatus === "pending" ? "Menunggu pembayaran" : statusLabel(booking.status)}</span></div>
            <div className="customer-order-card-facts"><div><span>Tanggal acara</span><strong>{booking.eventDate || "Jadwal belum tersedia"}</strong></div><div><span>Total pesanan</span><strong>{formatCurrency(booking.totalPrice)}</strong></div><div><span>Dibuat</span><strong>{formatDate(booking.createdAt)}</strong></div></div>
            <div className="customer-order-card-actions"><Link className="button button-ghost" to={`/customer/bookings/${encodeURIComponent(booking.bookingCode)}`}>Detail pesanan</Link>{booking.paymentStatus === "pending" && booking.status === "pending" && <Link className="button button-primary" to={`/payments/${encodeURIComponent(booking.bookingCode)}`}>Lanjutkan simulasi pembayaran</Link>}</div>
          </article>
        ))}
      </div>}
      {!loading && !error && totalPages > 1 && <nav className="concert-pagination" aria-label="Halaman pesanan"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Sebelumnya</button><span>Halaman {page} dari {totalPages} · {filteredBookings.length} pesanan</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Berikutnya</button></nav>}
    </section>
  );
}
