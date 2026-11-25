import { useEffect, useState } from "react";
import { downloadAdminCsv, getAdminPaymentHistory, getAdminPaymentReport } from "../services/api";

const formatCurrency = (value) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 2 }).format(Number(value) || 0);
const formatDate = (value) => { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(date); };

export default function AdminPaymentReports() {
  const empty = { status: "", bookingCode: "", concertId: "", from: "", to: "", sort: "createdAt", direction: "desc" };
  const [draft, setDraft] = useState(empty); const [filters, setFilters] = useState(empty); const [page, setPage] = useState(1); const [result, setResult] = useState(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [history, setHistory] = useState({}); const [historyLoading, setHistoryLoading] = useState("");
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError(""); getAdminPaymentReport({ ...filters, page, limit: 20, signal: controller.signal }).then(setResult).catch((err) => { if (err.name !== "AbortError") { setError(err.message); setResult(null); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [filters, page]);
  function submit(event) { event.preventDefault(); setPage(1); setFilters({ ...draft }); }
  async function toggleHistory(code) {
    if (history[code]) { setHistory((value) => { const next = { ...value }; delete next[code]; return next; }); return; }
    setHistoryLoading(code); setError("");
    try { const data = await getAdminPaymentHistory(code); setHistory((value) => ({ ...value, [code]: data })); }
    catch (err) { setError(err.message); }
    finally { setHistoryLoading(""); }
  }
  async function exportCsv() { try { const truncated = await downloadAdminCsv("/api/admin/exports/payments.csv", filters); if (truncated) setError("Export dibatasi 10.000 baris. Persempit filter untuk mengambil seluruh hasil."); } catch (err) { setError(err.message); } }
  const payments = result?.payments || [];
  return <section className="dashboard-page"><div className="dashboard-heading"><span className="dashboard-eyebrow">ADMINISTRATION</span><h1>Laporan pembayaran</h1><p>Status dan nominal dibaca dari payments. Nilai berstatus paid bukan settlement dari payment gateway.</p></div>
    <form className="admin-report-filters" onSubmit={submit}>
      <label>Status payment<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}><option value="">Semua status</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="failed">Failed</option><option value="expired">Expired</option></select></label>
      <label>Kode booking<input maxLength="40" value={draft.bookingCode} onChange={(e) => setDraft({ ...draft, bookingCode: e.target.value.toUpperCase() })} /></label>
      <label>ID konser<input inputMode="numeric" maxLength="19" value={draft.concertId} onChange={(e) => setDraft({ ...draft, concertId: e.target.value })} /></label>
      <label>Dari waktu dibuat<input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
      <label>Sampai waktu dibuat<input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
      <label>Urutkan<select value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: e.target.value })}><option value="createdAt">Waktu dibuat</option><option value="paidAt">Waktu dibayar</option><option value="amount">Nominal</option></select></label>
      <label>Arah<select value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value })}><option value="desc">Terbaru / terbesar</option><option value="asc">Terlama / terkecil</option></select></label>
      <div className="admin-report-filter-actions"><button className="admin-primary-button" type="submit">Terapkan filter</button><button className="admin-secondary-button" type="button" onClick={() => { setDraft(empty); setFilters(empty); setPage(1); }}>Reset</button></div>
    </form>
    <button className="admin-secondary-button" type="button" onClick={exportCsv}>Unduh CSV sesuai filter</button>
    {error && <p className="dashboard-error" role="alert">{error}</p>}
    {loading ? <p role="status">Memuat laporan pembayaran...</p> : !payments.length ? <div className="empty-state"><h2>Tidak ada pembayaran</h2><p>Tidak ada pembayaran yang sesuai dengan filter.</p></div> : <div className="admin-concert-table-wrap"><table className="admin-concert-table"><thead><tr><th>Payment ID</th><th>Booking</th><th>Konser</th><th>Status / histori</th><th>Nominal</th><th>Metode</th><th>Dibuat</th><th>Dibayar</th><th>Kedaluwarsa</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.paymentId}><td>{payment.paymentId}</td><td>{payment.bookingCode}</td><td>{payment.concertTitle}</td><td>{payment.paymentStatus}<br /><button type="button" className="admin-secondary-button" onClick={() => toggleHistory(payment.bookingCode)}>{historyLoading === payment.bookingCode ? "Memuat..." : history[payment.bookingCode] ? "Tutup histori" : "Histori status"}</button>{history[payment.bookingCode] && <ol>{history[payment.bookingCode].events.length ? history[payment.bookingCode].events.map((event, index) => <li key={`${event.changedAt}-${index}`}>{event.previousStatus} → {event.newStatus} · {formatDate(event.changedAt)}</li>) : <li>Belum ada transisi yang tercatat. {history[payment.bookingCode].availableSince}</li>}</ol>}</td><td>{formatCurrency(payment.amount)}</td><td>{payment.paymentMethod}</td><td>{formatDate(payment.createdAt)}</td><td>{formatDate(payment.paidAt)}</td><td>{formatDate(payment.expiresAt)}</td></tr>)}</tbody></table></div>}
    {result && result.total > result.limit && <nav className="concert-pagination" aria-label="Halaman laporan pembayaran"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</button><span>Halaman {page} dari {result.totalPages} · {result.total} payment</span><button disabled={page >= result.totalPages} onClick={() => setPage(page + 1)}>Berikutnya</button></nav>}
    <p className="dashboard-note">Periode memakai waktu pembayaran record dibuat (created_at). Laporan ini tidak mengubah status pembayaran dan tidak terhubung ke payment gateway nyata.</p>
  </section>;
}
