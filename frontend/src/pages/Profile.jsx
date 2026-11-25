import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { changeCustomerPassword, getCustomerProfile, updateCustomerProfile } from "../services/api";

const EMPTY_PASSWORDS = { currentPassword: "", newPassword: "", confirmPassword: "" };

export default function Profile() {
  const { user, loading: authLoading, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ name: "", email: "" });
  const [passwords, setPasswords] = useState(EMPTY_PASSWORDS);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    getCustomerProfile({ signal: controller.signal })
      .then((data) => { setProfile(data); setForm({ name: data.name || "", email: data.email || "" }); })
      .catch((error) => { if (error.name !== "AbortError") setLoadError(error.message || "Profil gagal dimuat."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  async function saveProfile(event) {
    event.preventDefault();
    setProfileError("");
    setProfileMessage("");
    setProfileSaving(true);
    try {
      const updated = await updateCustomerProfile(form);
      setProfile((current) => ({ ...current, ...updated }));
      await refreshUser();
      setProfileMessage("Informasi profil berhasil diperbarui.");
    } catch (error) { setProfileError(error.message || "Profil gagal diperbarui."); }
    finally { setProfileSaving(false); }
  }

  async function savePassword(event) {
    event.preventDefault();
    setPasswordError("");
    if (passwords.newPassword !== passwords.confirmPassword) {
      setPasswordError("Konfirmasi password baru tidak cocok.");
      return;
    }
    setPasswordSaving(true);
    try {
      await changeCustomerPassword(passwords);
      setPasswords(EMPTY_PASSWORDS);
      await refreshUser();
      navigate("/login", { replace: true, state: { passwordChanged: true } });
    } catch (error) { setPasswordError(error.message || "Password gagal diperbarui."); }
    finally { setPasswordSaving(false); }
  }

  if (authLoading || loading) return <section className="dashboard-page"><p className="workspace-loading" role="status">Memuat profil…</p></section>;
  if (!user || !profile) return <section className="dashboard-page profile-load-state"><div className="dashboard-error" role={loadError ? "alert" : undefined}><h1>Profil belum tersedia</h1><p>{loadError || "Data profil tidak dapat dimuat."}</p><button className="button button-ghost" type="button" onClick={() => setRetry((value) => value + 1)}>Coba lagi</button></div></section>;

  return <section className="dashboard-page profile-page">
    <header className="dashboard-heading"><span className="dashboard-eyebrow">PENGATURAN AKUN</span><h1>Profil & keamanan</h1><p>Kelola informasi akun yang digunakan untuk pesanan dan akses masuk.</p></header>
    <div className="profile-panels">
      <form className="profile-form profile-panel" onSubmit={saveProfile}>
        <div className="profile-panel-heading"><span className="profile-panel-icon" aria-hidden="true">♙</span><div><h2>Informasi profil</h2><p>Perbarui nama dan alamat email akunmu.</p></div></div>
        {profileError && <p className="dashboard-error" role="alert">{profileError}</p>}
        {profileMessage && <p className="profile-success" role="status">{profileMessage}</p>}
        <label htmlFor="profile-name">Nama lengkap<input id="profile-name" name="name" autoComplete="name" required minLength="2" maxLength="80" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
        <label htmlFor="profile-email">Email<input id="profile-email" name="email" type="email" autoComplete="email" required maxLength="254" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
        <p className="profile-role">Role akun <strong>{user.role}</strong></p>
        <button className="button button-primary" type="submit" disabled={profileSaving}>{profileSaving ? "Menyimpan…" : "Simpan perubahan"}</button>
      </form>

      <form className="profile-form profile-panel" onSubmit={savePassword}>
        <div className="profile-panel-heading"><span className="profile-panel-icon" aria-hidden="true">⌑</span><div><h2>Keamanan akun</h2><p>Perubahan password akan mengeluarkan semua sesi aktif.</p></div></div>
        {passwordError && <p className="dashboard-error" role="alert">{passwordError}</p>}
        <label htmlFor="profile-current-password">Password saat ini<input id="profile-current-password" type="password" autoComplete="current-password" required maxLength="128" value={passwords.currentPassword} onChange={(event) => setPasswords((current) => ({ ...current, currentPassword: event.target.value }))} /></label>
        <label htmlFor="profile-new-password">Password baru<input id="profile-new-password" type="password" autoComplete="new-password" minLength="10" maxLength="128" required value={passwords.newPassword} onChange={(event) => setPasswords((current) => ({ ...current, newPassword: event.target.value }))} /><small>Gunakan minimal 10 karakter.</small></label>
        <label htmlFor="profile-confirm-password">Konfirmasi password baru<input id="profile-confirm-password" type="password" autoComplete="new-password" minLength="10" maxLength="128" required value={passwords.confirmPassword} onChange={(event) => setPasswords((current) => ({ ...current, confirmPassword: event.target.value }))} /></label>
        <button className="button button-primary" type="submit" disabled={passwordSaving}>{passwordSaving ? "Memperbarui…" : "Ubah password"}</button>
      </form>
    </div>
    <Link className="profile-favorites-link" to="/customer/favorites">Lihat konser favorit <span aria-hidden="true">→</span></Link>
  </section>;
}
