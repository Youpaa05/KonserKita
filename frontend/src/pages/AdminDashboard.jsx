import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { downloadAdminCsv, getAdminDashboard, getAdminConcertAnalytics, getAdminTrends } from "../services/api";

const formatNumber = (value) => typeof value === "string" && /^\d+$/.test(value) ? BigInt(value).toLocaleString("id-ID") : Number(value || 0).toLocaleString("id-ID");
const formatCurrency = (value) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 2 }).format(Number(value) || 0);
const dateInput = (date) => date.toISOString().slice(0, 10);
const formatPeriod = (value) => new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

function TrendChart({ trends }) {
  const maximum = Math.max(1, ...trends.map((item) => Number(item.bookingCount) || 0), ...trends.map((item) => Number(item.paidPaymentCount) || 0));
  const hasActivity = trends.some((item) => Number(item.bookingCount) > 0 || Number(item.paidPaymentCount) > 0);
  if (!hasActivity) return <div className="admin-chart-empty">Belum ada booking atau pembayaran pada rentang ini.</div>;
  return <>
    <div className="admin-chart-legend"><span><i className="admin-chart-key admin-chart-key-bookings" /> Booking dibuat</span><span><i className="admin-chart-key admin-chart-key-paid" /> Pembayaran paid</span></div>
    <div className="admin-trend-chart" role="img" aria-label="Grafik jumlah booking dan pembayaran berstatus paid per hari selama 30 hari terakhir">
      {trends.map((item, index) => {
        const bookings = Number(item.bookingCount) || 0;
        const paid = Number(item.paidPaymentCount) || 0;
        const height = (value) => value === 0 ? 2 : Math.max(5, (value / maximum) * 100);
        return <div className="admin-trend-day" key={item.period} title={`${formatPeriod(item.period)} · ${formatNumber(bookings)} booking · ${formatNumber(paid)} paid`}>
          <span className="admin-trend-bars" aria-hidden="true"><i className="admin-trend-bar admin-trend-bar-bookings" style={{ height: `${height(bookings)}%` }} /><i className="admin-trend-bar admin-trend-bar-paid" style={{ height: `${height(paid)}%` }} /></span>
          {(index % 5 === 0 || index === trends.length - 1) && <small>{formatPeriod(item.period)}</small>}
        </div>;
      })}
    </div>
  </>;
}

function MetricGroup({ title, metrics }) {
  return <section className="admin-metric-group"><h3>{title}</h3><div className="admin-metric-strip">{metrics.map(([label, value, tone]) => <article className="admin-metric-item" key={label}><span>{label}</span><strong className={tone ? `metric-${tone}` : ""}>{value}</strong></article>)}</div></section>;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [concerts, setConcerts] = useState([]);
  const [trends, setTrends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState(false);
  const dates = useMemo(() => {
    const to = new Date();
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 29);
    return { from: dateInput(from), to: dateInput(to) };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      getAdminDashboard({ signal: controller.signal }),
      getAdminConcertAnalytics({ ...dates, limit: 5, signal: controller.signal }),
      getAdminTrends({ ...dates, interval: "day", signal: controller.signal }),
    ])
      .then(([overview, concertStats, trendStats]) => {
        setSummary(overview);
        setConcerts(concertStats.concerts || []);
        setTrends(trendStats.points || []);
      })
      .catch((requestError) => { if (requestError.name !== "AbortError") setError(requestError.message || "Dashboard gagal dimuat."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [dates, reload]);

  async function exportPerformance() {
    setExporting(true);
    setError("");
    setExportMessage("");
    try {
      const truncated = await downloadAdminCsv("/api/admin/exports/concert-performance.csv", dates);
      setExportMessage(truncated ? "Export dibatasi 10.000 baris. Persempit periode untuk mengambil seluruh hasil." : "Laporan performa konser berhasil diunduh.");
    } catch (requestError) { setError(requestError.message || "Export gagal diunduh."); }
    finally { setExporting(false); }
  }

  const statusGroups = summary ? [
    ["Status konser", [["Aktif", summary.activeConcerts, "success"], ["Dibatalkan", summary.cancelledConcerts, "danger"], ["Diarsipkan", summary.archivedConcerts, "muted"]]],
    ["Status booking", [["Menunggu", summary.pendingBookings, "warning"], ["Dikonfirmasi", summary.confirmedBookings, "success"], ["Dibatalkan", summary.cancelledBookings, "muted"]]],
    ["Status pembayaran", [["Pending", summary.paymentCounts.pending, "warning"], ["Paid · simulasi", summary.paymentCounts.paid, "success"], ["Gagal", summary.paymentCounts.failed, "danger"], ["Kedaluwarsa", summary.paymentCounts.expired, "muted"]]],
    ["Tiket digital", [["Diterbitkan", summary.issuedTickets, "brand"], ["Sudah digunakan", summary.usedTickets, "muted"]]],
  ] : [];

  return <section className="dashboard-page admin-dashboard-page">
    <header className="admin-dashboard-heading"><div><span className="dashboard-eyebrow">OVERVIEW · DATA DATABASE</span><h1>Dashboard administrator</h1><p>Halo, {user?.name}. Ringkasan operasional KonserKita.</p></div><span className="admin-dashboard-period">30 hari terakhir · UTC</span></header>
    {error && <div className="dashboard-error" role="alert"><p>{error}</p><button className="button button-ghost" type="button" onClick={() => setReload((value) => value + 1)}>Coba muat ulang</button></div>}
    {loading ? <p className="workspace-loading" role="status">Memuat statistik operasional…</p> : summary && <>
      <section className="admin-kpi-grid" aria-label="Indikator utama">
        <article className="admin-kpi-card"><span>Pengguna terdaftar</span><strong>{formatNumber(summary.totalUsers)}</strong><small>Seluruh akun dalam database</small></article>
        <article className="admin-kpi-card"><span>Konser aktif</span><strong>{formatNumber(summary.activeConcerts)}</strong><small>{formatNumber(summary.totalConcerts)} konser tercatat</small></article>
        <article className="admin-kpi-card"><span>Total booking</span><strong>{formatNumber(summary.totalBookings)}</strong><small>Termasuk status pending dan cancelled</small></article>
        <article className="admin-kpi-card admin-kpi-card-emphasis"><span>Nominal payment berstatus paid</span><strong>{formatCurrency(summary.paidAmount)}</strong><small>Simulasi · bukan settlement dana</small></article>
      </section>

      <section className="admin-dashboard-section"><div className="admin-dashboard-section-heading"><div><span className="section-kicker">STATUS SAAT INI</span><h2>Ringkasan operasional</h2></div></div><div className="admin-status-groups">{statusGroups.map(([title, metrics]) => <MetricGroup key={title} title={title} metrics={metrics.map(([label, value, tone]) => [label, formatNumber(value), tone])} />)}</div></section>

      <section className="admin-dashboard-section admin-dashboard-section-panel"><div className="admin-dashboard-section-heading"><div><span className="section-kicker">TREN AKTIVITAS</span><h2>Booking dan pembayaran</h2><p>Perubahan dikelompokkan menurut tanggal pembuatan booking.</p></div><button type="button" className="admin-secondary-button" disabled={exporting} onClick={exportPerformance}>{exporting ? "Menyiapkan CSV…" : "Unduh performa CSV"}</button></div>
        {exportMessage && <p className="admin-feedback admin-feedback-success" role="status">{exportMessage}</p>}
        <TrendChart trends={trends} />
        <details className="admin-trend-data"><summary>Lihat data harian</summary>{trends.length ? <div className="admin-concert-table-wrap"><table className="admin-concert-table"><thead><tr><th>Tanggal (UTC)</th><th>Booking dibuat</th><th>Quantity tiket</th><th>Payment paid</th><th>Nominal paid</th></tr></thead><tbody>{trends.map((item) => <tr key={item.period}><td>{item.period}</td><td>{formatNumber(item.bookingCount)}</td><td>{formatNumber(item.ticketQuantity)}</td><td>{formatNumber(item.paidPaymentCount)}</td><td>{formatCurrency(item.paidAmount)}</td></tr>)}</tbody></table></div> : <p>Tidak ada data harian pada periode ini.</p>}</details>
        <p className="admin-definition-note">{summary.definitions?.paidAmount} {summary.definitions?.issuedTickets} Nilai paid adalah data simulasi, bukan bukti penerimaan dana.</p>
      </section>

      <section className="admin-dashboard-section admin-dashboard-section-panel"><div className="admin-dashboard-section-heading"><div><span className="section-kicker">KATALOG</span><h2>Konser dengan tiket terbanyak</h2><p>Jumlah booking dan pembayaran mengikuti periode 30 hari.</p></div><Link className="text-link" to="/admin/concerts">Kelola konser →</Link></div>
        {concerts.length ? <div className="admin-concert-table-wrap"><table className="admin-concert-table"><thead><tr><th>Konser</th><th>Booking</th><th>Quantity booking</th><th>Kuota tersisa</th><th>Payment paid</th><th>Nominal paid</th></tr></thead><tbody>{concerts.map((item) => <tr key={item.concertId}><td><strong>{item.concertTitle}</strong><small>{item.artist}</small></td><td>{formatNumber(item.bookingCount)}</td><td>{formatNumber(item.ticketQuantity)}</td><td>{formatNumber(item.availableQuota)}</td><td>{formatNumber(item.paidPaymentCount)}</td><td>{formatCurrency(item.paidAmount)}</td></tr>)}</tbody></table></div> : <div className="admin-chart-empty">Belum ada data konser pada periode ini.</div>}
      </section>
      <nav className="admin-dashboard-actions" aria-label="Akses cepat admin"><Link to="/admin/orders">Kelola pesanan <span aria-hidden="true">→</span></Link><Link to="/admin/payments">Laporan pembayaran <span aria-hidden="true">→</span></Link><Link to="/admin/ticket-check">Validasi tiket <span aria-hidden="true">→</span></Link><Link to="/admin/audit">Audit perubahan role <span aria-hidden="true">→</span></Link></nav>
      <p className="admin-definition-note">Statistik keseluruhan berasal dari database. Grafik dan performa konser memakai booking yang dibuat dalam rentang 30 hari UTC; paid amount hanya menjumlah record berstatus paid.</p>
    </>}
  </section>;
}
