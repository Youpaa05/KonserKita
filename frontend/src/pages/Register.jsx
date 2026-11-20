import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Register() {
  const { register, user, loading } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    return <Navigate to="/profile" replace />;
  }

  function updateField(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (form.password !== form.confirmPassword) {
      setError("Konfirmasi password tidak sama.");
      return;
    }

    setSubmitting(true);

    try {
      await register({
        name: form.name,
        email: form.email,
        password: form.password,
      });

      navigate("/profile", { replace: true });
    } catch (requestError) {
      setError(requestError.message || "Registrasi gagal.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-page">
      <div className="auth-card">
        <div className="auth-heading">
          <span className="auth-eyebrow">MULAI BERSAMA KONSERKITA</span>
          <h1>Buat akun baru</h1>
          <p>Daftar untuk menikmati pengalaman pemesanan tiket konser.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="register-name">Nama lengkap</label>
          <input
            id="register-name"
            name="name"
            type="text"
            autoComplete="name"
            minLength={2}
            maxLength={80}
            value={form.name}
            onChange={updateField}
            required
          />

          <label htmlFor="register-email">Email</label>
          <input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            value={form.email}
            onChange={updateField}
            required
          />

          <label htmlFor="register-password">Password</label>
          <input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            value={form.password}
            onChange={updateField}
            required
          />
          <small className="auth-hint">Gunakan minimal 10 karakter.</small>

          <label htmlFor="register-confirm-password">Konfirmasi password</label>
          <input
            id="register-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            value={form.confirmPassword}
            onChange={updateField}
            required
          />

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? "Memproses..." : "Buat Akun"}
          </button>
        </form>

        <p className="auth-switch">
          Sudah memiliki akun? <Link to="/login">Login di sini</Link>
        </p>
      </div>
    </section>
  );
}