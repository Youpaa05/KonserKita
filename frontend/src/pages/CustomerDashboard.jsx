import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getCustomerDashboard } from "../services/api";

export default function CustomerDashboard() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    getCustomerDashboard({ signal: controller.signal })
      .then(setDashboard)
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError(err.message || "Dashboard gagal dimuat.");
        }
      });

    return () => controller.abort();
  }, []);

  return (
    <section className="dashboard-page">
      <div className="dashboard-heading">
        <span className="dashboard-eyebrow">CUSTOMER AREA</span>
        <h1>Halo, {user?.name || "Customer"}</h1>
        <p>Selamat datang di dashboard KonserKita.</p>
      </div>

      {error && <p className="dashboard-error" role="alert">{error}</p>}

      <div className="dashboard-grid">
        <article className="dashboard-card">
          <span>Total pesanan akun</span>
          <strong>{dashboard ? dashboard.totalBookings : "?"}</strong>
          <p>Jumlah pesanan yang terhubung dengan akun ini.</p>
        </article>

        <article className="dashboard-card">
          <span>Status akun</span>
          <strong>Aktif</strong>
          <p>Role: customer</p>
        </article>
      </div>

      <div className="dashboard-actions">
        <Link className="button button-primary" to="/concerts">
          Jelajahi konser
        </Link>
        <Link className="button button-ghost" to="/customer/bookings">
          Riwayat pesanan
        </Link>
        <Link className="button button-ghost" to="/customer/tickets">
          Tiket digital
        </Link>
        <Link className="button button-ghost" to="/customer/favorites">Konser favorit</Link>
        <Link className="button button-ghost" to="/customer/notifications">Notifikasi</Link>
        <Link className="button button-ghost" to="/profile">
          Lihat profil
        </Link>
      </div>
    </section>
  );
}
