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
        <small>© {new Date().getFullYear()} KonserKita · Platform pemesanan tiket konser.</small>
      </div>
      <div className="container simulation-note">
        Informasi acara dan harga mengikuti data yang tersedia di platform. Pembayaran
        belum terhubung ke payment gateway dan tidak memproses transaksi nyata. Kode tiket
        KonserKita bukan pengganti tiket resmi dari penyelenggara.
      </div>
    </footer>
  );
}
