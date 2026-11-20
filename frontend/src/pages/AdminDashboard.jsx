import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getAdminDashboard, getAdminConcertAnalytics, getAdminTrends } from "../services/api";

const formatNumber = (value) => typeof value === "string" && /^\d+$/.test(value) ? BigInt(value).toLocaleString("id-ID") : Number(value || 0).toLocaleString("id-ID");
const formatCurrency = (value) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 2 }).format(Number(value) || 0);
function dateInput(date) { return date.toISOString().slice(0, 10); }

export default function AdminDashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null); const [concerts, setConcerts] = useState([]); const [trends, setTrends] = useState([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); const to = new Date(); const from = new Date(to); from.setUTCDate(from.getUTCDate() - 29);
    Promise.all([
      getAdminDashboard({ signal: controller.signal }),
      getAdminConcertAnalytics({ from: dateInput(from), to: dateInput(to), limit: 5, signal: controller.signal }),
      getAdminTrends({ from: dateInput(from), to: dateInput(to), interval: "day", signal: controller.signal }),
    ]).then(([overview, concertStats, trendStats]) => { setSummary(overview); setConcerts(concertStats.concerts || []); setTrends(trendStats.points || []); })
      .catch((err) => { if (err.name !== "AbortError") setError(err.message || "Dashboard gagal dimuat."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const metrics = summary ? [
    ["Total pengguna", summary.totalUsers], ["Konser aktif", summary.activeConcerts], ["Konser diarsipkan", summary.archivedConcerts],
    ["Semua booking", summary.totalBookings], ["Booking menunggu", summary.pendingBookings], ["Booking confirmed", summary.confirmedBookings], ["Booking cancelled", summary.cancelledBookings],
    ["Pembayaran pending", summary.paymentCounts.pending], ["Pembayaran paid", summary.paymentCounts.paid], ["Pembayaran failed", summary.paymentCounts.failed], ["Pembayaran expired", summary.paymentCounts.expired],
    ["Pendapatan simulasi paid", formatCurrency(summary.paidAmount)], ["Tiket diterbitkan", summary.issuedTickets], ["Tiket digunakan", summary.usedTickets],
  ] : [];

  return <section className="dashboard-page">
    <div className="dashboard-heading"><span className="dashboard-eyebrow">ADMINISTRATION</span><h1>Dashboard Administrator</h1><p>Halo, {user?.name}. Statistik berasal dari booking, payment, konser, dan tiket tersimpan.</p></div>
    {error && <p className="dashboard-error" role="alert">{error}</p>}
    {loading ? <p role="status">Memuat statistik admin...</p> : summary && <>
      <div className="dashboard-grid">{metrics.map(([label, value]) => <article className="dashboard-card" key={label}><span>{label}</span><strong>{label === "Pendapatan simulasi paid" ? value : formatNumber(value)}</strong><p>Data agregat database.</p></article>)}</div>
      <p className="dashboard-note">{summary.definitions?.paidAmount} Booking dan jumlah tiket adalah metrik terpisah; pendapatan hanya menjumlah pembayaran paid.</p>
      <section className="admin-report-panel"><h2>Konser dengan tiket terbanyak</h2>{concerts.length ? <div className="admin-concert-table-wrap"><table className="admin-concert-table"><thead><tr><th>Konser</th><th>Booking</th><th>Quantity booking</th><th>Kuota tersisa</th><th>Payment paid</th><th>Nominal paid</th></tr></thead><tbody>{concerts.map((item) => <tr key={item.concertId}><td><strong>{item.concertTitle}</strong><small>{item.artist}</small></td><td>{formatNumber(item.bookingCount)}</td><td>{formatNumber(item.ticketQuantity)}</td><td>{formatNumber(item.availableQuota)}</td><td>{formatNumber(item.paidPaymentCount)}</td><td>{formatCurrency(item.paidAmount)}</td></tr>)}</tbody></table></div> : <p>Belum ada data konser untuk periode ini.</p>}</section>
      <section className="admin-report-panel"><h2>Tren pemesanan 30 hari (UTC)</h2>{trends.length ? <div className="admin-concert-table-wrap"><table className="admin-concert-table"><thead><tr><th>Tanggal</th><th>Booking dibuat</th><th>Quantity</th><th>Payment paid</th><th>Nominal paid</th></tr></thead><tbody>{trends.map((item) => <tr key={item.period}><td>{item.period}</td><td>{formatNumber(item.bookingCount)}</td><td>{formatNumber(item.ticketQuantity)}</td><td>{formatNumber(item.paidPaymentCount)}</td><td>{formatCurrency(item.paidAmount)}</td></tr>)}</tbody></table></div> : <p>Belum ada aktivitas pada periode ini.</p>}<p>Jumlah paid mengikuti status pembayaran saat query, dikelompokkan menurut tanggal booking dibuat.</p></section>
    </>}
    <div className="dashboard-actions"><Link className="button button-primary" to="/admin/orders">Laporan pesanan</Link><Link className="button button-ghost" to="/admin/payments">Laporan pembayaran</Link><Link className="button button-ghost" to="/admin/ticket-check">Pemeriksaan tiket</Link></div>
    <p className="dashboard-note">Statistik payment memakai tabel payments. Pendapatan simulasi hanya menghitung status paid; data ini bukan settlement payment gateway.</p>
  </section>;
}
