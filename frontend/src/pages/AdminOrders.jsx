import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getAdminOrder, getAdminOrders } from "../services/api";

function formatCurrency(value) { return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 2 }).format(Number(value) || 0); }
function formatDate(value) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(date); }

export function AdminOrders() {
  const [filters, setFilters] = useState({ status: "", bookingCode: "", customer: "", concertId: "", from: "", to: "", sort: "createdAt", direction: "desc" });
  const [draft, setDraft] = useState(filters); const [page, setPage] = useState(1); const [result, setResult] = useState(null);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    getAdminOrders({ ...filters, page, limit: 20, signal: controller.signal }).then(setResult)
      .catch((err) => { if (err.name !== "AbortError") { setError(err.message); setResult(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, page]);
  function submit(event) { event.preventDefault(); setPage(1); setFilters({ ...draft }); }
  const orders = result?.orders || [];
  return <section className="dashboard-page">
    <div className="dashboard-heading"><span className="dashboard-eyebrow">ADMINISTRATION</span><h1>Laporan pesanan</h1><p>Booking per pesanan; quantity tiket dijumlahkan dari booking, bukan jumlah row.</p></div>
    <form className="admin-report-filters" onSubmit={submit}>
      <label>Kode booking<input maxLength="40" value={draft.bookingCode} onChange={(e) => setDraft({ ...draft, bookingCode: e.target.value.toUpperCase() })} placeholder="KK-..." /></label>
      <label>Customer<input maxLength="100" value={draft.customer} onChange={(e) => setDraft({ ...draft, customer: e.target.value })} placeholder="Nama atau email" /></label>
      <label>Status booking<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}><option value="">Semua status</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option></select></label>
      <label>ID konser<input inputMode="numeric" maxLength="19" value={draft.concertId} onChange={(e) => setDraft({ ...draft, concertId: e.target.value })} /></label>
      <label>Dari tanggal<input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
      <label>Sampai tanggal<input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
      <label>Urutkan<select value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: e.target.value })}><option value="createdAt">Waktu booking</option><option value="bookingCode">Kode booking</option><option value="totalPrice">Total</option></select></label>
      <label>Arah<select value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value })}><option value="desc">Terbaru / terbesar</option><option value="asc">Terlama / terkecil</option></select></label>
      <div className="admin-report-filter-actions"><button className="admin-primary-button" type="submit">Terapkan filter</button><button className="admin-secondary-button" type="button" onClick={() => { const empty = { status: "", bookingCode: "", customer: "", concertId: "", from: "", to: "", sort: "createdAt", direction: "desc" }; setDraft(empty); setFilters(empty); setPage(1); }}>Reset</button></div>
    </form>
    {error && <p className="dashboard-error" role="alert">{error}</p>}
    {loading ? <p role="status">Memuat laporan pesanan...</p> : !orders.length ? <div className="empty-state"><h2>Tidak ada pesanan</h2><p>Ubah filter atau periksa kembali rentang tanggal.</p></div> : <div className="admin-concert-table-wrap"><table className="admin-concert-table"><thead><tr><th>Booking</th><th>Customer</th><th>Konser</th><th>Kategori / quantity</th><th>Total</th><th>Status</th><th>Waktu</th><th></th></tr></thead><tbody>{orders.map((order) => <tr key={order.bookingCode}><td>{order.bookingCode}</td><td>{order.customerName}<small>{order.customerType}</small></td><td>{order.concertTitle}<small>{order.city} · {order.eventDate}</small></td><td>{order.ticketCategory}<small>{order.quantity} tiket</small></td><td>{formatCurrency(order.totalPrice)}</td><td>{order.bookingStatus}<small>payment: {order.paymentStatus || "tidak tersedia"}</small></td><td>{formatDate(order.createdAt)}</td><td><Link to={`/admin/orders/${encodeURIComponent(order.bookingCode)}`}>Detail</Link></td></tr>)}</tbody></table></div>}
    {result && result.total > result.limit && <nav className="concert-pagination" aria-label="Halaman laporan pesanan"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</button><span>Halaman {page} dari {result.totalPages} · {result.total} booking</span><button disabled={page >= result.totalPages} onClick={() => setPage(page + 1)}>Berikutnya</button></nav>}
  </section>;
}

export function AdminOrderDetail() {
  const { bookingCode } = useParams(); const [order, setOrder] = useState(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  useEffect(() => { const controller = new AbortController(); setLoading(true); getAdminOrder(bookingCode, { signal: controller.signal }).then(setOrder).catch((err) => { if (err.name !== "AbortError") setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [bookingCode]);
  return <section className="dashboard-page"><div className="dashboard-heading"><span className="dashboard-eyebrow">ADMINISTRATION</span><h1>Detail pesanan</h1></div>{error && <p className="dashboard-error" role="alert">{error}</p>}{loading ? <p role="status">Memuat detail pesanan...</p> : order && <article className="dashboard-card"><h2>{order.concertTitle}</h2><p>Kode booking: {order.bookingCode}</p><p>Customer: {order.customerName} ({order.customerEmail})</p><p>Kategori: {order.ticketCategory}</p><p>Jumlah tiket: {order.quantity}</p><p>Total: {formatCurrency(order.totalPrice)}</p><p>Status booking: {order.bookingStatus}</p><p>Status pembayaran: {order.paymentStatus}</p><p>Waktu transaksi: {formatDate(order.createdAt)}</p></article>}</section>;
}
