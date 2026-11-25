import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ConfirmDialog from "../components/ConfirmDialog";
import { useAuth } from "../context/AuthContext";
import { changeAdminUserRole, getAdminUsers } from "../services/api";

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function AdminUsers() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [draft, setDraft] = useState({ q: "", role: "" });
  const [filters, setFilters] = useState(draft);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (signal) => {
    setLoading(true); setError("");
    try { setResult(await getAdminUsers({ ...filters, page, limit: 20, signal })); }
    catch (err) { if (err.name !== "AbortError") { setError(err.message); setResult(null); } }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [filters, page]);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);

  async function updateRole() {
    if (!target) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const changed = await changeAdminUserRole(target.id, target.newRole);
      setMessage(`Role diperbarui; ${changed.revokedSessions} sesi dicabut.`);
      const selfChanged = String(user?.id) === String(target.id);
      setTarget(null);
      if (selfChanged) { await logout(); navigate("/login", { replace: true }); return; }
      await load();
    } catch (err) { setError(err.message || "Role gagal diperbarui."); }
    finally { setBusy(false); }
  }

  const users = result?.users || [];
  return <section className="dashboard-page">
    <div className="dashboard-heading"><span className="dashboard-eyebrow">ADMINISTRATION</span><h1>Manajemen pengguna</h1><p>Pencarian dan perubahan role. Password serta hash tidak ditampilkan.</p></div>
    {error && <p className="dashboard-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <form className="admin-report-filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setFilters({ ...draft }); }}>
      <label>Cari nama atau email<input maxLength={100} value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} /></label>
      <label>Role<select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })}><option value="">Semua</option><option value="customer">Customer</option><option value="admin">Admin</option></select></label>
      <div className="admin-report-filter-actions"><button className="admin-primary-button">Cari pengguna</button></div>
    </form>
    {loading ? <p role="status">Memuat pengguna...</p> : !users.length ? <div className="empty-state"><h2>Pengguna tidak ditemukan</h2><p>Ubah pencarian atau filter role.</p></div> : <div className="admin-concert-table-wrap"><table className="admin-concert-table"><thead><tr><th>Pengguna</th><th>Role</th><th>Terdaftar</th><th>Aksi</th></tr></thead><tbody>{users.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.email}</small></td><td>{item.role}</td><td>{formatDate(item.createdAt)}</td><td><button type="button" className="admin-secondary-button" onClick={() => setTarget({ ...item, newRole: item.role === "admin" ? "customer" : "admin" })}>{item.role === "admin" ? "Turunkan ke customer" : "Jadikan admin"}</button></td></tr>)}</tbody></table></div>}
    {result && result.total > result.limit && <nav className="concert-pagination" aria-label="Halaman pengguna"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</button><span>Halaman {page} dari {result.totalPages} · {result.total} pengguna</span><button type="button" disabled={page >= result.totalPages} onClick={() => setPage(page + 1)}>Berikutnya</button></nav>}
    <ConfirmDialog open={Boolean(target)} title={`Ubah role ${target?.name || "pengguna"}?`} description={`Akun akan berubah dari ${target?.role} menjadi ${target?.newRole}. Semua sesi aktif akun tersebut akan dicabut. Admin terakhir tidak dapat diturunkan.`} confirmLabel="Ubah role" busy={busy} onConfirm={updateRole} onCancel={() => { if (!busy) setTarget(null); }} />
  </section>;
}
