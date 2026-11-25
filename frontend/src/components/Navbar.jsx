import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getUnreadNotificationCount } from "../services/api";

export default function Navbar() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const navigationRef = useRef(null);
  const menuToggleRef = useRef(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState("");
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

  useEffect(() => {
    setMenuOpen(false);
    setLogoutError("");
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function handleOutsideClick(event) {
      if (!navigationRef.current?.contains(event.target)) setMenuOpen(false);
    }
    function handleEscape(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuToggleRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  async function handleLogout() {
    setLogoutError("");
    try {
      await logout();
      setMenuOpen(false);
    } catch (error) {
      setLogoutError(error.message || "Logout gagal. Silakan coba kembali.");
    }
  }

  return (
    <header className="site-header">
      <nav ref={navigationRef} className="navbar container" aria-label="Navigasi utama">
        <Link className="brand" to="/" aria-label="KonserKita beranda">
          <span className="brand-mark" aria-hidden="true">K</span>
          <span>Konser<span className="brand-light">Kita</span></span>
        </Link>

        <button
          ref={menuToggleRef}
          type="button"
          className="nav-menu-toggle"
          aria-label={menuOpen ? "Tutup menu navigasi" : "Buka menu navigasi"}
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
                <NavLink to={user.role === "admin" ? "/admin/dashboard" : "/customer/dashboard"}>
                  {user.name}
                </NavLink>
                {user.role === "customer" && (
                  <NavLink to="/customer/notifications" aria-label={unreadCount > 0 ? `Notifikasi, ${unreadCount} belum dibaca` : "Notifikasi"}>
                    <span className="nav-notification-label">Notifikasi</span>{unreadCount > 0 && <span className="nav-notification-count" aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</span>}
                  </NavLink>
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
          {logoutError && <p className="nav-error" role="alert">{logoutError}</p>}
        </div>
      </nav>
    </header>
  );
}
