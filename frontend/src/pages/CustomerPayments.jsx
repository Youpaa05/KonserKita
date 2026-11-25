import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getCustomerPaymentHistory } from "../services/api";

const STATUS_LABELS = { pending: "Menunggu", paid: "Berhasil (simulasi)", failed: "Gagal", expired: "Kedaluwarsa" };
const formatCurrency = (value) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value) || 0);
const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(date);
};

export default function CustomerPayments() {
  const [result, setResult] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getCustomerPaymentHistory({ page, limit: 20, signal: controller.signal })
      .then(setResult)
      .catch((requestError) => { if (requestError.name !== "AbortError") setError(requestError.message || "Riwayat pembayaran gagal dimuat."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, retry]);

  const payments = result?.payments || [];

  return (
    <section className="dashboard-page customer-payments-page">
      <header className="dashboard-heading">
        <span className="dashboard-eyebrow">AKUN PELANGGAN · PEMBAYARAN</span>
        <h1>Riwayat pembayaran</h1>
        <p>Pantau status pembayaran dan transisi yang tercatat untuk pesanan milik akunmu.</p>
      </header>
      <div className="payment-simulation-note" role="note"><strong>Pembayaran simulasi</strong><span>Catatan ini berasal dari sistem simulasi KonserKita dan bukan bukti transaksi atau penerimaan dana sungguhan.</span></div>

      {loading && <p className="workspace-loading" role="status">Memuat riwayat pembayaran…</p>}
      {error && <div className="dashboard-error" role="alert"><p>{error}</p><button className="button button-ghost" type="button" onClick={() => setRetry((value) => value + 1)}>Coba lagi</button></div>}
      {!loading && !error && payments.length === 0 && <div className="empty-state"><h2>Belum ada pembayaran</h2><p>Pembayaran terkait pesanan akunmu akan tercatat di sini.</p><Link className="button button-primary" to="/concerts">Jelajahi konser</Link></div>}

      {!loading && !error && payments.length > 0 && <div className="payment-history-list">
        {payments.map((payment) => (
          <article className="payment-history-card" key={payment.paymentId}>
            <div className="payment-history-heading">
              <div><span className="section-kicker">{payment.bookingCode}</span><h2>{payment.concertTitle}</h2><p>{payment.ticketCategory} · dibuat {formatDate(payment.createdAt)}</p></div>
              <span className={`booking-status-pill booking-status-${payment.paymentStatus}`}>{STATUS_LABELS[payment.paymentStatus] || payment.paymentStatus}</span>
            </div>
            <dl className="payment-history-facts">
              <div><dt>Nominal pesanan</dt><dd>{formatCurrency(payment.amount)}</dd></div>
              <div><dt>Metode simulasi</dt><dd>{payment.paymentMethod || "—"}</dd></div>
              <div><dt>Status saat ini</dt><dd>{STATUS_LABELS[payment.paymentStatus] || payment.paymentStatus}</dd></div>
              <div><dt>Terakhir diperbarui</dt><dd>{formatDate(payment.paidAt || payment.failedAt || payment.expiredAt)}</dd></div>
            </dl>
            <details className="payment-history-timeline">
              <summary>Riwayat perubahan status ({payment.history?.length || 0})</summary>
              {payment.history?.length ? <ol>{payment.history.map((event, index) => <li key={`${event.changedAt}-${index}`}><span className="payment-timeline-dot" aria-hidden="true" /><div><strong>{STATUS_LABELS[event.previousStatus] || event.previousStatus} <span aria-hidden="true">→</span> {STATUS_LABELS[event.newStatus] || event.newStatus}</strong><time dateTime={event.changedAt}>{formatDate(event.changedAt)}</time></div></li>)}</ol> : <p>Belum ada transisi status yang tercatat untuk pembayaran ini.</p>}
            </details>
            <Link className="payment-order-link" to={`/customer/bookings/${encodeURIComponent(payment.bookingCode)}`}>Lihat detail pesanan <span aria-hidden="true">→</span></Link>
          </article>
        ))}
      </div>}
      {result && result.totalPages > 1 && !loading && !error && <nav className="concert-pagination" aria-label="Halaman riwayat pembayaran"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Sebelumnya</button><span>Halaman {page} dari {result.totalPages} · {result.total} pembayaran</span><button type="button" disabled={page >= result.totalPages} onClick={() => setPage((value) => value + 1)}>Berikutnya</button></nav>}
      <p className="payment-history-disclaimer">Riwayat transisi tidak mencakup perubahan yang terjadi sebelum pencatatan histori tersedia.</p>
    </section>
  );
}
