import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { attemptPayment, getPayment } from "../services/api";
import { formatPrice } from "../data/concerts";

export default function PaymentPage() {
  const { bookingCode } = useParams();
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const loadPayment = useCallback(async (signal) => {
    setError("");
    try {
      setPayment(await getPayment(bookingCode, { signal }));
    } catch (loadError) {
      if (loadError.name !== "AbortError") setError(loadError.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [bookingCode]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPayment(controller.signal);
    return () => controller.abort();
  }, [loadPayment]);

  async function handleSimulation(outcome) {
    if (submitting || payment?.paymentStatus !== "pending" || !payment.paymentSimulation) return;
    setSubmitting(true);
    setError("");
    try {
      await attemptPayment(bookingCode, outcome);
      await loadPayment();
    } catch (attemptError) {
      setError(attemptError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="dashboard-page">
      <div className="dashboard-heading">
        <span className="dashboard-eyebrow">INFORMASI PEMBAYARAN</span>
        <h1>Selesaikan pesanan</h1>
        <p>
          {payment?.paymentSimulation
            ? "Simulasi pembayaran untuk pengujian alur aplikasi. Tidak ada uang sungguhan yang diproses."
            : "Simulasi pembayaran tidak aktif pada environment ini. Tidak ada transaksi uang sungguhan."}
        </p>
      </div>
      {loading && <p role="status">Memuat pembayaran...</p>}
      {error && <p className="dashboard-error" role="alert">{error}</p>}
      {!loading && error && !payment && <button type="button" className="button button-ghost" onClick={() => { setLoading(true); void loadPayment(); }}>Coba lagi</button>}
      {payment && (
        <article className="dashboard-card">
          <h2>{payment.concertTitle}</h2>
          <p>Kode booking: <strong>{payment.bookingCode}</strong></p>
          <p>Kategori: {payment.ticketCategory}</p>
          <p>Jumlah tiket: {payment.quantity}</p>
          <p>Total simulasi: <strong>{formatPrice(payment.amount)}</strong></p>
          <p>Status: <strong>{payment.paymentStatus}</strong></p>
          <p>Batas pembayaran: {new Date(payment.expiresAt).toLocaleString("id-ID")}</p>
          {payment.paymentStatus === "pending" && payment.paymentSimulation ? (
            <div className="button-row">
              <button type="button" className="button button-primary" disabled={submitting} onClick={() => handleSimulation("success")}>
                {submitting ? "Memproses simulasi..." : "Simulasikan berhasil"}
              </button>
              <button type="button" className="button button-ghost" disabled={submitting} onClick={() => handleSimulation("failure")}>
                Simulasikan gagal
              </button>
            </div>
          ) : payment.paymentStatus === "pending" ? (
            <p className="dashboard-note">Simulasi tidak tersedia. Status pesanan tidak berubah.</p>
          ) : (
            <Link className="button button-primary" to={`/payment-result/${bookingCode}`}>Lihat status pesanan</Link>
          )}
        </article>
      )}
    </section>
  );
}
