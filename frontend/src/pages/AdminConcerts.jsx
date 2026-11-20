import AdminTicketCategories from "./AdminTicketCategories";
import { useCallback, useEffect, useState } from "react";
import {
  archiveAdminConcert,
  createAdminConcert,
  getAdminConcert,
  getAdminConcerts,
  restoreAdminConcert,
  updateAdminConcert,
} from "../services/api";

const EMPTY_FORM = {
  title: "",
  artist: "",
  category: "",
  city: "",
  venue: "",
  eventDate: "",
  eventTime: "19:00",
  accent: "#8b5cf6",
  imageUrl: "",
  description: "",
  ticketCategories: [{ name: "Regular", price: 100000, quota: 100 }],
};

const EMPTY_CATEGORY = { name: "Regular", price: 100000, quota: 100 };

export default function AdminConcerts() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("active");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getAdminConcerts({ status });
      setItems(Array.isArray(result) ? result : []);
    } catch (err) {
      setError(err.message || "Daftar konser gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  function changeField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function changeCategory(index, field, value) {
    setForm((current) => ({
      ...current,
      ticketCategories: current.ticketCategories.map((category, position) =>
        position === index
          ? {
              ...category,
              [field]: field === "name" ? value : Number(value),
            }
          : category
      ),
    }));
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  async function startEdit(id) {
    setError("");
    setMessage("");
    try {
      const concert = await getAdminConcert(id);
      setEditingId(id);
      setForm({
        title: concert.title,
        artist: concert.artist,
        category: concert.category,
        city: concert.city,
        venue: concert.venue,
        eventDate: concert.eventDate,
        eventTime: concert.eventTime,
        accent: concert.accent,
        imageUrl: concert.imageUrl,
        description: concert.description,
        ticketCategories: concert.ticketCategories || [],
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.message || "Detail konser gagal dimuat.");
    }
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    const payload = {
      title: form.title.trim(),
      artist: form.artist.trim(),
      category: form.category.trim(),
      city: form.city.trim(),
      venue: form.venue.trim(),
      eventDate: form.eventDate,
      eventTime: form.eventTime,
      accent: form.accent.trim(),
      imageUrl: form.imageUrl.trim(),
      description: form.description.trim(),
    };

    try {
      if (editingId) {
        // Kategori tiket yang sudah memiliki relasi booking tidak dihapus atau diubah.
        await updateAdminConcert(editingId, payload);
        setMessage("Informasi konser berhasil diperbarui. Kategori tiket tetap dipertahankan.");
      } else {
        payload.ticketCategories = form.ticketCategories.map((category) => ({
          name: category.name.trim(),
          price: Number(category.price),
          quota: Number(category.quota),
        }));
        await createAdminConcert(payload);
        setMessage("Konser berhasil dibuat.");
      }

      resetForm();
      await load();
    } catch (err) {
      setError(err.message || "Konser gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  async function archive(id) {
    if (!window.confirm("Arsipkan konser ini? Riwayat booking akan tetap dipertahankan.")) return;
    setError("");
    setMessage("");
    try {
      await archiveAdminConcert(id);
      setMessage("Konser berhasil diarsipkan.");
      await load();
    } catch (err) {
      setError(err.message || "Konser gagal diarsipkan.");
    }
  }

  async function restore(id) {
    setError("");
    setMessage("");
    try {
      await restoreAdminConcert(id);
      setMessage("Konser berhasil dipulihkan.");
      await load();
    } catch (err) {
      setError(err.message || "Konser gagal dipulihkan.");
    }
  }

  return (
    <section className="admin-concert-page container">
      <header className="admin-concert-heading">
        <span className="dashboard-eyebrow">CONCERT MANAGEMENT</span>
        <h1>Manajemen Konser</h1>
        <p>Kelola informasi konser dan status publikasinya.</p>
      </header>

      {error && <p className="admin-feedback admin-feedback-error" role="alert">{error}</p>}
      {message && <p className="admin-feedback admin-feedback-success" role="status">{message}</p>}

      <form className="admin-concert-form" onSubmit={submit}>
        <div className="admin-form-heading">
          <div>
            <span className="dashboard-eyebrow">{editingId ? "EDIT CONCERT" : "NEW CONCERT"}</span>
            <h2>{editingId ? "Perbarui konser" : "Tambah konser baru"}</h2>
          </div>
          {editingId && (
            <button type="button" className="admin-secondary-button" onClick={resetForm}>
              Batal edit
            </button>
          )}
        </div>

        <div className="admin-form-grid">
          <label>Nama konser
            <input name="title" value={form.title} onChange={changeField} maxLength={200} required />
          </label>
          <label>Artis
            <input name="artist" value={form.artist} onChange={changeField} maxLength={200} required />
          </label>
          <label>Kategori
            <input name="category" value={form.category} onChange={changeField} maxLength={80} required />
          </label>
          <label>Kota
            <input name="city" value={form.city} onChange={changeField} maxLength={100} required />
          </label>
          <label>Venue
            <input name="venue" value={form.venue} onChange={changeField} maxLength={200} required />
          </label>
          <label>Tanggal
            <input type="date" name="eventDate" value={form.eventDate} onChange={changeField} required />
          </label>
          <label>Waktu
            <input type="time" name="eventTime" value={form.eventTime} onChange={changeField} required />
          </label>
          <label>Accent warna
            <input name="accent" value={form.accent} onChange={changeField} maxLength={30} required />
          </label>
          <label className="admin-form-wide">URL gambar
            <input type="url" name="imageUrl" value={form.imageUrl} onChange={changeField} maxLength={10000} required />
          </label>
          <label className="admin-form-wide">Deskripsi
            <textarea name="description" value={form.description} onChange={changeField} maxLength={20000} rows={4} required />
          </label>
        </div>

        {!editingId && (
          <div className="admin-category-editor">
            <h3>Kategori tiket awal</h3>
            {form.ticketCategories.map((category, index) => (
              <div className="admin-category-row" key={index}>
                <label>Nama kategori
                  <input value={category.name} onChange={(event) => changeCategory(index, "name", event.target.value)} required />
                </label>
                <label>Harga
                  <input type="number" min="0" step="1" value={category.price} onChange={(event) => changeCategory(index, "price", event.target.value)} required />
                </label>
                <label>Kuota
                  <input type="number" min="0" step="1" value={category.quota} onChange={(event) => changeCategory(index, "quota", event.target.value)} required />
                </label>
                {form.ticketCategories.length > 1 && (
                  <button type="button" className="admin-danger-button" onClick={() => setForm((current) => ({
                    ...current,
                    ticketCategories: current.ticketCategories.filter((_, position) => position !== index),
                  }))}>Hapus</button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="admin-secondary-button"
              disabled={form.ticketCategories.length >= 20}
              onClick={() => setForm((current) => ({
                ...current,
                ticketCategories: [...current.ticketCategories, { ...EMPTY_CATEGORY }],
              }))}
            >Tambah kategori</button>
          </div>
        )}

        {editingId && (
          <p className="admin-preservation-note">
            Kategori tiket tidak diubah melalui formulir edit untuk melindungi relasi booking dan histori transaksi.
          </p>
        )}

        <button className="admin-primary-button" type="submit" disabled={saving}>
          {saving ? "Menyimpan..." : editingId ? "Simpan perubahan" : "Buat konser"}
        </button>
      </form>

      <section className="admin-concert-list">
        <div className="admin-list-heading">
          <div>
            <span className="dashboard-eyebrow">CONCERT DATABASE</span>
            <h2>Daftar konser</h2>
          </div>
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter status konser">
            <option value="active">Aktif</option>
            <option value="archived">Diarsipkan</option>
            <option value="all">Semua</option>
          </select>
        </div>

        {loading ? <p>Memuat daftar konser...</p> : items.length === 0 ? (
          <p className="admin-empty">Belum ada konser pada filter ini.</p>
        ) : (
          <div className="admin-concert-table-wrap">
            <table className="admin-concert-table">
              <thead>
                <tr>
                  <th>Konser</th>
                  <th>Lokasi</th>
                  <th>Tanggal</th>
                  <th>Kategori tiket</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.title}</strong><small>{item.artist}</small></td>
                    <td>{item.venue}<small>{item.city}</small></td>
                    <td>{item.eventDate} · {item.eventTime}</td>
                    <td>{item.categoryCount}<AdminTicketCategories concertId={item.id} /></td>
                    <td>{item.archivedAt ? "Diarsipkan" : "Aktif"}</td>
                    <td>
                      <div className="admin-row-actions">
                        {!item.archivedAt && (
                          <>
                            <button type="button" onClick={() => startEdit(item.id)}>Edit</button>
                            <button type="button" className="admin-danger-button" onClick={() => archive(item.id)}>Arsipkan</button>
                          </>
                        )}
                        {item.archivedAt && (
                          <button type="button" onClick={() => restore(item.id)}>Pulihkan</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}