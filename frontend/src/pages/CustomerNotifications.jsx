import { useCallback, useEffect, useState } from "react";
import { getCustomerNotifications, markCustomerNotificationRead } from "../services/api";

export default function CustomerNotifications() {
  const [page, setPage] = useState(1); const [data, setData] = useState(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const load = useCallback(async (signal) => { setLoading(true); setError(""); try { setData(await getCustomerNotifications({ page, limit: 20, signal })); } catch (err) { if (err.name !== "AbortError") setError(err.message); } finally { if (!signal?.aborted) setLoading(false); } }, [page]);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);
  async function markRead(id) { try { await markCustomerNotificationRead(id); setData((value) => ({ ...value, items: value.items.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item) })); } catch (err) { setError(err.message); } }
  return <section className="customer-extra-page container"><header className="customer-extra-heading"><span className="section-kicker">PEMBARUAN AKUN</span><h1>Notifikasi</h1><p>Pembaruan status pesanan dan tiketmu.</p></header>
    {error && <p className="booking-error" role="alert">{error}</p>}{loading ? <p role="status">Memuat notifikasi...</p> : !data?.items?.length ? <div className="empty-state"><h2>Belum ada notifikasi</h2><p>Pembaruan pesanan akan tampil di sini.</p></div> : <div className="notification-list">{data.items.map((item) => <article className={`notification-card ${item.readAt ? "" : "notification-unread"}`} key={item.id}><div><strong>{item.title}</strong><p>{item.message}</p><small>{new Date(item.createdAt).toLocaleString("id-ID")}{item.bookingCode ? ` · ${item.bookingCode}` : ""}</small></div>{!item.readAt && <button type="button" onClick={() => markRead(item.id)}>Tandai dibaca</button>}</article>)}</div>}
    {data?.total > data?.limit && <nav className="concert-pagination" aria-label="Halaman notifikasi"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</button><span>Halaman {page} dari {Math.ceil(data.total / data.limit)}</span><button type="button" disabled={page >= Math.ceil(data.total / data.limit)} onClick={() => setPage(page + 1)}>Berikutnya</button></nav>}
  </section>;
}
