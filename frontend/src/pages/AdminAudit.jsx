import { useEffect, useState } from "react";
import { getAdminRoleChangeAudit } from "../services/api";

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(date);
}

export default function AdminAudit() {
  const [result, setResult] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getAdminRoleChangeAudit({ page, limit: 20, signal: controller.signal })
      .then(setResult)
      .catch((requestError) => { if (requestError.name !== "AbortError") setError(requestError.message || "Audit perubahan role gagal dimuat."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, retry]);

  const events = result?.events || [];

  return (
    <section className="dashboard-page admin-audit-page">
      <header className="dashboard-heading">
        <span className="dashboard-eyebrow">ADMINISTRATION · AUDIT</span>
        <h1>Riwayat perubahan role</h1>
        <p>Catatan perubahan role admin dan customer, termasuk jumlah sesi yang dicabut saat perubahan dibuat.</p>
      </header>

      <div className="admin-audit-scope"><strong>Cakupan catatan</strong><span>Hanya perubahan role yang tercatat. Aktivitas lain tidak ditampilkan di halaman ini.</span></div>

      {error && <div className="dashboard-error" role="alert"><p>{error}</p><button className="button button-ghost" type="button" onClick={() => setRetry((value) => value + 1)}>Coba lagi</button></div>}
      {loading ? <p className="workspace-loading" role="status">Memuat catatan audit…</p> : !error && !events.length ? (
        <div className="empty-state"><h2>Belum ada perubahan role</h2><p>Catatan akan muncul setelah admin mengubah role pengguna.</p></div>
      ) : !error && (
        <>
          <div className="admin-audit-summary"><strong>{Number(result?.total || 0).toLocaleString("id-ID")}</strong><span>perubahan tercatat</span></div>
          <div className="admin-concert-table-wrap">
            <table className="admin-concert-table admin-audit-table">
              <thead><tr><th>Waktu (WIB)</th><th>Administrator</th><th>Pengguna</th><th>Perubahan</th><th>Sesi dicabut</th></tr></thead>
              <tbody>{events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDate(event.changedAt)}</td>
                  <td><strong>{event.actorName || "Akun tidak tersedia"}</strong>{event.actorEmail && <small>{event.actorEmail}</small>}</td>
                  <td><strong>{event.targetName || "Akun tidak tersedia"}</strong>{event.targetEmail && <small>{event.targetEmail}</small>}</td>
                  <td><span className="audit-role">{event.previousRole}</span><span className="audit-arrow" aria-label="menjadi"> → </span><span className="audit-role">{event.newRole}</span></td>
                  <td>{Number(event.affectedSessions).toLocaleString("id-ID")}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {result && result.totalPages > 1 && <nav className="concert-pagination" aria-label="Halaman audit perubahan role"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Sebelumnya</button><span>Halaman {page} dari {result.totalPages} · {result.total} catatan</span><button type="button" disabled={page >= result.totalPages} onClick={() => setPage((value) => value + 1)}>Berikutnya</button></nav>}
        </>
      )}
    </section>
  );
}
