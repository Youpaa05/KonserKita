import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const CUSTOMER_LINKS = [
  ["/customer/dashboard", "Ringkasan", "⌂", true],
  ["/customer/bookings", "Pesanan saya", "▤"],
  ["/customer/payments", "Pembayaran", "▥"],
  ["/customer/tickets", "Tiket digital", "▣"],
  ["/customer/favorites", "Konser favorit", "♡"],
  ["/customer/notifications", "Notifikasi", "◉"],
  ["/profile", "Profil & keamanan", "◌"],
];

const ADMIN_LINKS = [
  ["/admin/dashboard", "Ringkasan", "⌂", true],
  ["/admin/concerts", "Manajemen konser", "♫"],
  ["/admin/users", "Pengguna", "♙"],
  ["/admin/orders", "Pesanan", "▤"],
  ["/admin/payments", "Pembayaran & laporan", "▥"],
  ["/admin/ticket-check", "Validasi tiket", "✓"],
  ["/admin/audit", "Audit perubahan role", "◷"],
];

function WorkspaceLayout({ mode, links, eyebrow, description }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const activeLink = links.find(([to, , , exact]) => exact ? pathname === to : pathname.startsWith(to));
  const title = activeLink?.[1] || "Ruang kerja";

  return (
    <div className={`workspace-layout workspace-layout--${mode}`}>
      <div className="workspace-topline">
        <div className="workspace-topline-inner">
          <span className="workspace-context"><span className="workspace-context-mark" aria-hidden="true">K</span>{mode === "admin" ? "KonserKita Admin" : "KonserKita Saya"}</span>
          <div className="workspace-account">
            <span className="workspace-avatar" aria-hidden="true">{user?.name?.trim()?.charAt(0)?.toUpperCase() || "K"}</span>
            <span><strong>{user?.name || "Pengguna"}</strong><small>{mode === "admin" ? "Administrator" : "Akun pelanggan"}</small></span>
          </div>
        </div>
      </div>

      <div className="workspace-frame">
        <aside className="workspace-sidebar">
          <div className="workspace-sidebar-intro">
            <span className="section-kicker">{eyebrow}</span>
            <p>{description(user?.name)}</p>
          </div>
          <nav className="workspace-nav" aria-label={`Navigasi ${mode}`}>
            <span className="workspace-nav-label">MENU UTAMA</span>
            {links.map(([to, label, icon, exact]) => (
              <NavLink key={to} to={to} end={exact}>
                <span className="workspace-nav-icon" aria-hidden="true">{icon}</span>
                <span>{label}</span>
                <span className="workspace-nav-arrow" aria-hidden="true">›</span>
              </NavLink>
            ))}
          </nav>
          <LinkBackToCatalog />
        </aside>

        <div className="workspace-main">
          <div className="workspace-breadcrumb" aria-label="Breadcrumb">
            <span>{mode === "admin" ? "Administrasi" : "Akun"}</span>
            <span aria-hidden="true">/</span>
            <strong>{title}</strong>
          </div>
          <Outlet />
        </div>
      </div>
    </div>
  );
}

function LinkBackToCatalog() {
  return <Link className="workspace-back-link" to="/concerts"><span aria-hidden="true">←</span> Kembali ke katalog konser</Link>;
}

export function CustomerLayout() {
  return <WorkspaceLayout mode="customer" links={CUSTOMER_LINKS} eyebrow="RUANG PELANGGAN" description={(name) => `Selamat datang${name ? `, ${name}` : ""}. Semua rencana konsermu ada di sini.`} />;
}

export function AdminLayout() {
  return <WorkspaceLayout mode="admin" links={ADMIN_LINKS} eyebrow="WORKSPACE ADMIN" description={(name) => `Operasional KonserKita${name ? ` · ${name}` : ""}.`} />;
}
