import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getCustomerBookings, getCustomerDashboard } from "../services/api";

function formatEventDate(value) {
  if (!value) return "Jadwal belum tersedia";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(date);
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function CustomerDashboard() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");

    Promise.all([
      getCustomerDashboard({ signal: controller.signal }),
      getCustomerBookings({ signal: controller.signal }),
    ])
      .then(([summary, bookingResult]) => {
        setDashboard(summary);
        setBookings(Array.isArray(bookingResult?.bookings) ? bookingResult.bookings : []);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message || "Ringkasan akun gagal dimuat.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });

    return () => controller.abort();
  }, [reloadKey]);

  const upcoming = useMemo(() => {
    const today = localDateKey(new Date());
    return bookings
      .filter((booking) => booking.eventDate && booking.eventDate >= today && booking.status !== "cancelled" && !booking.concertCancelledAt)
      .sort((a, b) => String(a.eventDate).localeCompare(String(b.eventDate)))
      .slice(0, 3);
  }, [bookings]);

  const pendingCount = bookings.filter((booking) => booking.paymentStatus === "pending").length;

  return (
    <section className="dashboard-page customer-overview">
      <header className="dashboard-heading">
        <span className="dashboard-eyebrow">RINGKASAN AKUN</span>
        <h1>Halo, {user?.name || "Pelanggan"}</h1>
        <p>Kelola rencana konser dan pantau pesananmu dari satu tempat.</p>
      </header>

      {loading && <p className="workspace-loading" role="status">Memuat aktivitas akun…</p>}
      {error && (
        <div className="dashboard-error" role="alert">
          <p>{error}</p>
          <button className="button button-ghost" type="button" onClick={() => setReloadKey((value) => value + 1)}>Coba lagi</button>
        </div>
      )}

      {!loading && !error && dashboard && <>
        <div className="dashboard-grid customer-metrics">
          <article className="dashboard-card customer-metric-card">
            <span>Total pesanan</span><strong>{dashboard.totalBookings}</strong>
            <p>Pesanan yang terhubung dengan akunmu.</p>
            <Link to="/customer/bookings">Lihat semua pesanan <span aria-hidden="true">→</span></Link>
          </article>
          <article className="dashboard-card customer-metric-card">
            <span>Menunggu pembayaran</span><strong>{pendingCount}</strong>
            <p>Periksa status dan lanjutkan pesanan yang masih tertunda.</p>
            <Link to="/customer/bookings">Periksa pesanan <span aria-hidden="true">→</span></Link>
          </article>
          <article className="dashboard-card customer-metric-card">
            <span>Status akun</span><strong className="customer-account-status">Aktif</strong>
            <p>{dashboard.user?.email || user?.email || "Akun pelanggan terverifikasi"}</p>
            <Link to="/profile">Kelola profil <span aria-hidden="true">→</span></Link>
          </article>
        </div>

        <section className="customer-upcoming" aria-labelledby="upcoming-title">
          <div className="customer-section-heading">
            <div><span className="section-kicker">RENCANA BERIKUTNYA</span><h2 id="upcoming-title">Konser mendatang</h2></div>
            <Link className="text-link" to="/customer/bookings">Semua pesanan <span aria-hidden="true">→</span></Link>
          </div>
          {upcoming.length ? (
            <div className="upcoming-list">
              {upcoming.map((booking) => (
                <article className="upcoming-card" key={booking.bookingCode}>
                  <div className="upcoming-date"><strong>{new Date(`${booking.eventDate}T00:00:00`).getDate()}</strong><span>{new Intl.DateTimeFormat("id-ID", { month: "short" }).format(new Date(`${booking.eventDate}T00:00:00`))}</span></div>
                  <div className="upcoming-info"><h3>{booking.concertTitle}</h3><p>{formatEventDate(booking.eventDate)} <span aria-hidden="true">·</span> {booking.ticketCategory}</p></div>
                  <span className={`booking-status-pill booking-status-${booking.paymentStatus || booking.status}`}>{booking.paymentStatus === "pending" ? "Menunggu pembayaran" : booking.status === "confirmed" ? "Dikonfirmasi" : booking.paymentStatus || booking.status}</span>
                  <Link className="upcoming-detail-link" to={`/customer/bookings/${encodeURIComponent(booking.bookingCode)}`} aria-label={`Lihat pesanan ${booking.bookingCode}`}>Lihat pesanan <span aria-hidden="true">→</span></Link>
                </article>
              ))}
            </div>
          ) : (
            <article className="customer-upcoming-empty">
              <div><h3>Belum ada konser terjadwal</h3><p>Pesanan konser mendatang akan muncul di sini setelah kamu membuatnya.</p></div>
              <Link className="button button-primary" to="/concerts">Jelajahi konser</Link>
            </article>
          )}
        </section>
      </>}

      <div className="customer-quick-links" aria-label="Akses cepat">
        <Link to="/customer/tickets"><span aria-hidden="true">▣</span><span><strong>Tiket digital</strong><small>Lihat QR tiketmu</small></span><b aria-hidden="true">→</b></Link>
        <Link to="/customer/payments"><span aria-hidden="true">▥</span><span><strong>Pembayaran</strong><small>Status dan riwayat simulasi</small></span><b aria-hidden="true">→</b></Link>
        <Link to="/customer/favorites"><span aria-hidden="true">♡</span><span><strong>Konser favorit</strong><small>Koleksi acara tersimpan</small></span><b aria-hidden="true">→</b></Link>
        <Link to="/customer/notifications"><span aria-hidden="true">◉</span><span><strong>Notifikasi</strong><small>Pembaruan pesanan</small></span><b aria-hidden="true">→</b></Link>
      </div>
    </section>
  );
}
