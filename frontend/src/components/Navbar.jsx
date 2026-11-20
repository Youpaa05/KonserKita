import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getUnreadNotificationCount } from "../services/api";

export default function Navbar() {
  const { user, loading, logout } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!user || user.role !== "customer") {
      setUnreadCount(0);
      return undefined;
    }

    const controller = new AbortController();
    getUnreadNotificationCount({ signal: controller.signal })
      .then((result) => setUnreadCount(result.count))
      .catch(() => {});

    return () => controller.abort();
  }, [user]);

  async function handleLogout() {
    try {
      await logout();
    } catch (error) {
      window.alert(error.message || "Logout gagal. Silakan coba kembali.");
    }
  }

  return (
    <header className="site-header">
      <nav className="navbar container" aria-label="Navigasi utama">
        <Link className="brand" to="/" aria-label="KonserKita beranda">
          <span className="brand-mark" aria-hidden="true">K</span>
          <span>Konser<span className="brand-light">Kita</span></span>
        </Link>

        <button
          type="button"
          className="nav-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="primary-navigation-links"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span>{menuOpen ? "Tutup menu" : "Buka menu"}</span>
          <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span>
        </button>

        <div
          id="primary-navigation-links"
          className={`navbar-menu${menuOpen ? " navbar-menu-open" : ""}`}
          onClick={(event) => {
            if (event.target.closest("a")) setMenuOpen(false);
          }}
        >
          <div className="nav-links nav-public-links">
            <NavLink to="/" end>Beranda</NavLink>
            <NavLink to="/concerts">Jelajahi Konser</NavLink>
          </div>

          <div className="nav-links nav-account-links">
            {!loading && user ? (
              <>
                <Link to={user.role === "admin" ? "/admin/dashboard" : "/customer/dashboard"}>
                  {user.name}
                </Link>
                {user.role === "admin" && (
                  <>
                    <NavLink to="/admin/concerts">Manajemen Konser</NavLink>
                    <NavLink to="/admin/orders">Pesanan</NavLink>
                    <NavLink to="/admin/payments">Pembayaran</NavLink>
                    <NavLink to="/admin/ticket-check">Periksa Tiket</NavLink>
                  </>
                )}
                {user.role === "customer" && (
                  <>
                    <NavLink to="/customer/bookings">Pesanan saya</NavLink>
                    <NavLink to="/customer/tickets">Tiket Saya</NavLink>
                    <NavLink to="/customer/favorites">Favorit</NavLink>
                    <NavLink to="/customer/notifications">
                      Notifikasi{unreadCount > 0 ? ` (${unreadCount})` : ""}
                    </NavLink>
                    <NavLink to="/profile">Profil</NavLink>
                  </>
                )}
                <button type="button" className="nav-cta" onClick={handleLogout}>
                  Logout
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login">Login</NavLink>
                <Link className="nav-cta" to="/register">
                  Daftar <span aria-hidden="true">↗</span>
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}
