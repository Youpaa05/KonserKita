import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { changeCustomerPassword, getCustomerProfile, updateCustomerProfile } from "../services/api";

export default function Profile() {
  const { user, loading: authLoading, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null); const [form, setForm] = useState({ name: "", email: "" });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); getCustomerProfile({ signal: controller.signal }).then((data) => { setProfile(data); setForm({ name: data.name, email: data.email }); }).catch((err) => { if (err.name !== "AbortError") setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, []);
  if (authLoading || loading) return <section className="auth-page"><p role="status">Memuat profil...</p></section>;
  if (!user || !profile) return <section className="auth-page"><div className="auth-card"><p>{error || "Profil tidak dapat dimuat."}</p></div></section>;
  async function saveProfile(event) { event.preventDefault(); setError(""); setMessage(""); setSaving(true); try { const updated = await updateCustomerProfile(form); setProfile({ ...profile, ...updated }); await refreshUser(); setMessage("Profil berhasil diperbarui."); } catch (err) { setError(err.message); } finally { setSaving(false); } }
  async function savePassword(event) { event.preventDefault(); setError(""); setMessage(""); if (passwords.newPassword !== passwords.confirmPassword) { setError("Konfirmasi password baru tidak cocok."); return; } setSaving(true); try { await changeCustomerPassword(passwords); setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" }); await refreshUser(); navigate("/login", { replace: true, state: { passwordChanged: true } }); } catch (err) { setError(err.message); } finally { setSaving(false); } }
  return <section className="auth-page"><div className="auth-card profile-card"><div className="auth-heading"><span className="auth-eyebrow">AKUN KONSERKITA</span><h1>Profil saya</h1><p>Perbarui informasi dan keamanan akunmu.</p></div>
    {error && <p className="booking-error" role="alert">{error}</p>}{message && <p className="profile-success" role="status">{message}</p>}
    <form className="profile-form" onSubmit={saveProfile}><label>Nama<input required minLength="2" maxLength="80" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Email<input type="email" required maxLength="254" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><p className="profile-role">Role akun: <strong>{user.role}</strong></p><button className="auth-submit" disabled={saving}>Simpan profil</button></form>
    <form className="profile-form" onSubmit={savePassword}><h2>Ubah password</h2><label>Password saat ini<input type="password" autoComplete="current-password" required maxLength="128" value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} /></label><label>Password baru<input type="password" autoComplete="new-password" minLength="10" maxLength="128" required value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} /></label><label>Konfirmasi password baru<input type="password" autoComplete="new-password" minLength="10" maxLength="128" required value={passwords.confirmPassword} onChange={(event) => setPasswords({ ...passwords, confirmPassword: event.target.value })} /></label><small>Password minimal 10 karakter dan sesi aktif akan dicabut setelah perubahan.</small><button className="auth-submit" disabled={saving}>Ubah password</button></form>
    <Link className="auth-secondary" to="/customer/favorites">Konser favorit</Link>
  </div></section>;
}
