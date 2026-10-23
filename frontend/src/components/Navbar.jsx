import { NavLink, Link } from "react-router-dom";

export default function Navbar() {
  return (
    <header className="site-header">
      <nav className="navbar container" aria-label="Navigasi utama">
        <Link className="brand" to="/" aria-label="KonserKita beranda">
          <span className="brand-mark">K</span>
          <span>Konser<span className="brand-light">Kita</span></span>
        </Link>

        <div className="nav-links">
          <NavLink to="/" end>Beranda</NavLink>
          <NavLink to="/concerts">Jelajahi Konser</NavLink>
        </div>

        <Link className="nav-cta" to="/concerts">
          Cari Tiket <span aria-hidden="true">↗</span>
        </Link>
      </nav>
    </header>
  );
}
