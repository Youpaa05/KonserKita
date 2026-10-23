import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <section className="not-found container">
      <span className="not-found-code">404</span>
      <h1>Sepertinya kamu salah panggung.</h1>
      <p>Halaman yang kamu cari tidak ditemukan.</p>
      <Link className="button button-primary" to="/">Kembali ke beranda</Link>
    </section>
  );
}
