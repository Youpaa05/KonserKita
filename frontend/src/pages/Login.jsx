import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({
    email: "",
    password: "",
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
    setSubmitting(true);

    try {
      await login(form);

      const destination = location.state?.from || "/profile";
      navigate(destination, { replace: true });
    } catch (requestError) {
      setError(requestError.message || "Login gagal.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-page">
      <div className="auth-card">
        <div className="auth-heading">
          <span className="auth-eyebrow">SELAMAT DATANG KEMBALI</span>
          <h1>Login akun</h1>
          <p>Masuk untuk melanjutkan pengalaman konser Anda.</p>
          {location.state?.passwordChanged && <p className="profile-success" role="status">Password berhasil diubah. Silakan login kembali.</p>}
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            value={form.email}
            onChange={updateField}
            required
          />

          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            value={form.password}
            onChange={updateField}
            required
          />

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? "Memproses..." : "Login"}
          </button>
        </form>

        <p className="auth-switch">
          Belum memiliki akun? <Link to="/register">Daftar sekarang</Link>
        </p>
      </div>
    </section>
  );
}
