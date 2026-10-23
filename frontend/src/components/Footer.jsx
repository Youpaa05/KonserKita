import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <Link className="brand footer-brand" to="/">
          <span className="brand-mark">K</span>
          <span>Konser<span className="brand-light">Kita</span></span>
        </Link>
        <p>Temukan momen, rasakan musik, buat cerita.</p>
        <small>© {new Date().getFullYear()} KonserKita. Proyek akademik.</small>
      </div>
      <div className="container simulation-note">
        Konser dan harga pada situs ini adalah data simulasi. Pemesanan dan pembayaran
        belum mewakili transaksi tiket sungguhan.
      </div>
    </footer>
  );
}
