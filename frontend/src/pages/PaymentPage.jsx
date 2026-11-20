import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { attemptPayment, getPayment } from "../services/api";
import { formatPrice } from "../data/concerts";

export default function PaymentPage() {
  const { bookingCode } = useParams();
  const navigate = useNavigate();
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    getPayment(bookingCode, { signal: controller.signal }).then(setPayment)
      .catch(e => { if (e.name !== "AbortError") setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [bookingCode]);
  async function pay(outcome) {
    setBusy(true); setError("");
    try { const result = await attemptPayment(bookingCode, outcome); navigate(`/payment-result/${bookingCode}`, { replace: true, state: { tickets: result?.tickets || [] } }); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  return <section className="dashboard-page"><div className="dashboard-heading"><span className="dashboard-eyebrow">PEMBAYARAN SIMULASI</span><h1>Selesaikan pesanan</h1><p>Ini hanya simulasi dan tidak memproses pembayaran nyata.</p></div>
    {loading && <p role="status">Memuat pembayaran...</p>}{error && <p className="dashboard-error" role="alert">{error}</p>}
    {payment && <article className="dashboard-card"><h2>{payment.concertTitle}</h2><p>Kode booking: <strong>{payment.bookingCode}</strong></p><p>Kategori: {payment.ticketCategory}</p><p>Jumlah tiket: {payment.quantity}</p><p>Total pembayaran: <strong>{formatPrice(payment.amount)}</strong></p><p>Status: <strong>{payment.paymentStatus}</strong></p><p>Batas pembayaran: {new Date(payment.expiresAt).toLocaleString("id-ID")}</p>
      {payment.paymentStatus === "pending" ? <div className="dashboard-actions"><button className="button button-primary" disabled={busy} onClick={() => pay("success")}>Simulasikan berhasil</button><button className="button button-ghost" disabled={busy} onClick={() => pay("failure")}>Simulasikan gagal</button></div> : <Link className="button button-primary" to={`/payment-result/${bookingCode}`}>Lihat hasil</Link>}
    </article>}
  </section>;
}
