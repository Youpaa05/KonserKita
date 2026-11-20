import { useState } from "react";
import {
  getAdminConcert,
  createAdminTicketCategory,
  updateAdminTicketCategory,
  archiveAdminTicketCategory,
  restoreAdminTicketCategory,
} from "../services/api";

const EMPTY_FORM = { name: "", price: "", quota: "" };
const MAX_PRICE = 9999999999.99;
const MAX_QUOTA = 2147483647;

function isArchived(category) {
  return Boolean(category.archivedAt ?? category.archived_at);
}

function formatPrice(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

export default function AdminTicketCategories({ concertId }) {
  const [expanded, setExpanded] = useState(false);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadCategories() {
    setLoading(true);
    setError("");

    try {
      const concert = await getAdminConcert(concertId);
      setCategories(
        Array.isArray(concert.ticketCategories)
          ? concert.ticketCategories
          : [],
      );
    } catch (err) {
      setError(err.message || "Kategori tiket gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }

  async function togglePanel() {
    if (expanded) {
      setExpanded(false);
      return;
    }

    setExpanded(true);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setMessage("");
    await loadCategories();
  }

  function startEdit(category) {
    setEditingId(category.id);
    setForm({
      name: category.name ?? "",
      price: String(category.price ?? ""),
      quota: String(category.quota ?? ""),
    });
    setError("");
    setMessage("");
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    const name = form.name.trim();
    const price = Number(form.price);
    const quota = Number(form.quota);

    if (!name || name.length > 80 || Array.from(name).some((char) => { const code = char.charCodeAt(0); return code <= 31 || code === 127; })) {
      setError("Nama kategori wajib diisi dan maksimal 80 karakter.");
      return;
    }

    if (
      form.price.trim() === "" ||
      !Number.isFinite(price) ||
      price < 0 ||
      price > MAX_PRICE ||
      Math.abs(price * 100 - Math.round(price * 100)) > 0.000001
    ) {
      setError("Harga harus 0 sampai 9.999.999.999,99 dengan maksimal 2 desimal.");
      return;
    }

    if (
      form.quota.trim() === "" ||
      !Number.isInteger(quota) ||
      quota < 0 ||
      quota > MAX_QUOTA
    ) {
      setError("Kuota harus bilangan bulat 0 sampai 2.147.483.647.");
      return;
    }

    setSaving(true);

    try {
      const payload = { name, price, quota };

      if (editingId !== null) {
        await updateAdminTicketCategory(concertId, editingId, payload);
        setMessage("Kategori tiket berhasil diperbarui.");
      } else {
        await createAdminTicketCategory(concertId, payload);
        setMessage("Kategori tiket berhasil ditambahkan.");
      }

      setEditingId(null);
      setForm(EMPTY_FORM);
      await loadCategories();
    } catch (err) {
      setError(err.message || "Kategori tiket gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  async function archive(category) {
    if (!window.confirm(`Nonaktifkan kategori "${category.name}"? Riwayat booking tetap dipertahankan.`)) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await archiveAdminTicketCategory(category.id);
      setMessage("Kategori berhasil dinonaktifkan.");
      await loadCategories();
    } catch (err) {
      setError(err.message || "Kategori gagal dinonaktifkan.");
    }
  }

  async function restore(category) {
    setError("");
    setMessage("");

    try {
      await restoreAdminTicketCategory(category.id);
      setMessage("Kategori berhasil dipulihkan.");
      await loadCategories();
    } catch (err) {
      setError(err.message || "Kategori gagal dipulihkan.");
    }
  }

  const activeCategories = categories.filter((item) => !isArchived(item));
  const archivedCategories = categories.filter(isArchived);

  return (
    <div className="admin-ticket-manager">
      <button
        type="button"
        className="admin-secondary-button admin-category-toggle"
        onClick={togglePanel}
        aria-expanded={expanded}
      >
        {expanded ? "Tutup pengelolaan" : "Kelola kategori tiket"}
      </button>

      {expanded && (
        <section className="admin-ticket-panel" aria-label="Pengelolaan kategori tiket">
          <div className="admin-ticket-panel-heading">
            <strong>Kategori tiket</strong>
            <span>{activeCategories.length} aktif · {archivedCategories.length} diarsipkan</span>
          </div>

          {error && <p className="admin-feedback admin-feedback-error" role="alert">{error}</p>}
          {message && <p className="admin-feedback admin-feedback-success" role="status">{message}</p>}

          {loading ? (
            <p className="admin-empty">Memuat kategori tiket...</p>
          ) : (
            <>
              <div className="admin-ticket-list">
                {activeCategories.length === 0 && (
                  <p className="admin-empty">Belum ada kategori aktif.</p>
                )}

                {activeCategories.map((category) => (
                  <article className="admin-ticket-item" key={category.id}>
                    <div className="admin-ticket-info">
                      <strong>{category.name}</strong>
                      <span>{formatPrice(category.price)}</span>
                      <small>Sisa kuota: {category.quota}</small>
                    </div>
                    <div className="admin-row-actions">
                      <button type="button" onClick={() => startEdit(category)}>Edit</button>
                      <button
                        type="button"
                        className="admin-danger-button"
                        onClick={() => archive(category)}
                      >
                        Nonaktifkan
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              {archivedCategories.length > 0 && (
                <div className="admin-archived-categories">
                  <h4>Kategori diarsipkan</h4>
                  {archivedCategories.map((category) => (
                    <article className="admin-ticket-item" key={category.id}>
                      <div className="admin-ticket-info">
                        <strong>{category.name}</strong>
                        <span>{formatPrice(category.price)}</span>
                        <small>Diarsipkan · Kuota tersimpan: {category.quota}</small>
                      </div>
                      <div className="admin-row-actions">
                        <button type="button" onClick={() => restore(category)}>
                          Pulihkan
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}

          <form className="admin-ticket-form" onSubmit={submit}>
            <h4>{editingId !== null ? "Edit kategori tiket" : "Tambah kategori tiket"}</h4>

            <div className="admin-ticket-form-grid">
              <label>
                Nama kategori
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  maxLength={80}
                  required
                />
              </label>
              <label>
                Harga (Rp)
                <input
                  type="number"
                  min="0"
                  max={MAX_PRICE}
                  step="0.01"
                  value={form.price}
                  onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
                  required
                />
              </label>
              <label>
                Kuota
                <input
                  type="number"
                  min="0"
                  max={MAX_QUOTA}
                  step="1"
                  value={form.quota}
                  onChange={(event) => setForm((current) => ({ ...current, quota: event.target.value }))}
                  required
                />
              </label>
            </div>

            <p className="admin-ticket-hint">
              Kuota yang ditampilkan adalah sisa inventori tiket, bukan alokasi awal.
            </p>

            <div className="admin-row-actions">
              <button type="submit" className="admin-primary-button" disabled={saving}>
                {saving ? "Menyimpan..." : editingId !== null ? "Simpan perubahan" : "Tambah kategori"}
              </button>
              {editingId !== null && (
                <button type="button" className="admin-secondary-button" onClick={resetForm}>
                  Batal edit
                </button>
              )}
            </div>
          </form>
        </section>
      )}
    </div>
  );
}