import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getCustomerBookingDetail } from "../services/api";

const formatCurrency = (value) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value) || 0);
const formatDate = (value) => {
  if (!value) return "Jadwal belum tersedia";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("id-ID", { dateStyle: "full" }).format(date);
};
const BOOKING_STATUS = { pending: "Menunggu pembayaran", confirmed: "Dikonfirmasi", cancelled: "Dibatalkan" };
const PAYMENT_STATUS = { pending: "Menunggu", paid: "Berhasil (simulasi)", failed: "Gagal", expired: "Kedaluwarsa" };

export default function CustomerBookingDetail() {
  const { bookingCode } = useParams();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getCustomerBookingDetail(bookingCode, { signal: controller.signal })
      .then(setBooking)
      .catch((requestError) => { if (requestError.name !== "AbortError") setError(requestError.message || "Detail pesanan gagal dimuat."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [bookingCode, retry]);

  return (
    <section className="dashboard-page customer-booking-detail-page">
      <div className="customer-detail-backlinks"><Link to="/customer/bookings">← Semua pesanan</Link><Link to="/customer/payments">Riwayat pembayaran →</Link></div>
      {loading && <p className="workspace-loading" role="status">Memuat detail pesanan…</p>}
      {error && <div className="dashboard-error" role="alert"><p>{error}</p><button className="button button-ghost" type="button" onClick={() => setRetry((value) => value + 1)}>Coba lagi</button></div>}
      {!loading && !error && booking && <>
        <header className="customer-detail-heading"><span className="section-kicker">PESANAN · {booking.bookingCode}</span><h1>{booking.concertTitle}</h1><div className="customer-detail-statuses"><span className={`booking-status-pill booking-status-${booking.status}`}>{BOOKING_STATUS[booking.status] || booking.status}</span><span className={`booking-status-pill booking-status-${booking.paymentStatus}`}>Pembayaran: {PAYMENT_STATUS[booking.paymentStatus] || booking.paymentStatus}</span></div></header>
        {booking.concertCancelledAt && <div className="ticket-cancellation-notice" role="alert"><strong>Konser dibatalkan</strong><p>{booking.cancellationReason || "Konser ini dibatalkan oleh penyelenggara."}</p></div>}
        <div className="booking-detail-grid">
          <article className="booking-detail-panel">
            <h2>Informasi acara</h2>
            <dl className="booking-detail-facts"><div><dt>Tanggal</dt><dd>{formatDate(booking.eventDate)}</dd></div><div><dt>Waktu</dt><dd>{booking.eventTime || "Waktu menyusul"} WIB</dd></div><div><dt>Lokasi</dt><dd>{booking.venue || "Venue belum tersedia"}{booking.city ? `, ${booking.city}` : ""}</dd></div><div><dt>Kategori</dt><dd>{booking.ticketCategory}</dd></div></dl>
            {booking.concertSlug && <Link className="payment-order-link" to={`/concerts/${encodeURIComponent(booking.concertSlug)}`}>Lihat halaman konser <span aria-hidden="true">→</span></Link>}
          </article>
          <article className="booking-detail-panel booking-total-panel">
            <h2>Ringkasan pesanan</h2>
            <dl className="booking-detail-facts"><div><dt>Nama pemesan</dt><dd>{booking.customerName}</dd></div><div><dt>Email</dt><dd>{booking.customerEmail}</dd></div><div><dt>Jumlah tiket</dt><dd>{booking.quantity}</dd></div><div><dt>Harga satuan</dt><dd>{formatCurrency(booking.unitPrice)}</dd></div><div className="booking-total-row"><dt>Total</dt><dd>{formatCurrency(booking.totalPrice)}</dd></div><div><dt>Dibuat</dt><dd>{booking.createdAt ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(booking.createdAt)) : "—"}</dd></div></dl>
            <div className="customer-order-card-actions">{booking.paymentStatus === "pending" && booking.status === "pending" && <Link className="button button-primary" to={`/payments/${encodeURIComponent(booking.bookingCode)}`}>Lanjutkan pembayaran simulasi</Link>}{booking.paymentStatus === "paid" && booking.status === "confirmed" && <Link className="button button-primary" to="/customer/tickets">Buka tiket digital</Link>}</div>
          </article>
        </div>
        <p className="payment-history-disclaimer">Pembayaran KonserKita bersifat simulasi, tidak terhubung ke payment gateway, dan bukan bukti transaksi sungguhan.</p>
      </>}
    </section>
  );
}
