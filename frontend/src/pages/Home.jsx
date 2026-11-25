import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ConcertCard from "../components/ConcertCard";
import Loading from "../components/Loading";
import { getConcerts } from "../services/api";

export default function Home() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [featured, setFeatured] = useState([]);
  const [categories, setCategories] = useState([]);
  const [heroImageFailed, setHeroImageFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getConcerts(
      { sort: "date", direction: "asc" },
      { signal: controller.signal },
    )
      .then((data) => {
        if (!Array.isArray(data)) {
          throw new Error("Format daftar konser dari server tidak valid.");
        }
        const today = new Date();
        const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        setFeatured(data.filter((concert) => concert.date >= todayKey).slice(0, 3));
        setCategories([...new Set(data.map((concert) => concert.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id")));
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retryCount]);

  return (
    <>
      <section className="hero" aria-labelledby="home-title">
        <div className="hero-glow hero-glow-one" aria-hidden="true" />
        <div className="hero-glow hero-glow-two" aria-hidden="true" />
        <div className="container hero-layout">
          <div className="hero-copy">
            <p className="eyebrow"><span className="live-dot" aria-hidden="true" /> MUSIK LIVE, MOMEN YANG BERARTI</p>
            <h1 id="home-title">Temukan konser yang <span>akan jadi ceritamu.</span></h1>
            <p>
              Jelajahi acara dari berbagai kota, bandingkan kategori tiket, dan
              rencanakan pengalaman musik berikutnya.
            </p>
            <form className="home-search" role="search" onSubmit={(event) => { event.preventDefault(); const value = search.trim(); navigate(value ? `/concerts?q=${encodeURIComponent(value)}` : "/concerts"); }}>
              <label className="visually-hidden" htmlFor="home-concert-search">Cari konser atau musisi</label>
              <span aria-hidden="true">⌕</span>
              <input id="home-concert-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari konser, musisi, atau kota" />
              <button type="submit" aria-label="Cari konser">Cari <span aria-hidden="true">→</span></button>
            </form>
            <div className="hero-actions">
              <Link className="button button-primary" to="/concerts">
                Jelajahi konser <span aria-hidden="true">→</span>
              </Link>
              <a className="button button-ghost" href="#featured">Lihat pilihan</a>
            </div>
            <ul className="hero-highlights" aria-label="Informasi layanan">
              <li><span aria-hidden="true">01</span><span>Informasi acara dari katalog</span></li>
              <li><span aria-hidden="true">02</span><span>Pilihan kategori dan kuota</span></li>
              <li><span aria-hidden="true">03</span><span>Alur pemesanan yang jelas</span></li>
            </ul>
          </div>

          <div className="hero-visual">
            <div className="hero-image-main">
              {heroImageFailed ? (
                <div className="hero-image-fallback" role="img" aria-label="Ilustrasi panggung konser dengan sorot lampu" />
              ) : (
                <img
                  src="/concert-stage.svg"
                  alt="Ilustrasi panggung konser bernuansa violet"
                  fetchPriority="high"
                  onError={() => setHeroImageFailed(true)}
                />
              )}
              <div className="hero-image-shade" aria-hidden="true" />
              <div className="hero-image-caption">
                <span>LIVE MUSIC · GOOD COMPANY</span>
                <strong>Rencanakan malam berikutnya.</strong>
              </div>
            </div>
            <div className="floating-note">
              <span className="note-icon" aria-hidden="true">♫</span>
              <div><strong>Temukan panggungmu</strong><small>Mulai dari katalog konser</small></div>
            </div>
          </div>
        </div>
        <div className="container hero-bottom">
          <span>JELAJAHI · PILIH · RENCANAKAN</span>
          <span>PEMBAYARAN BELUM TERHUBUNG KE PAYMENT GATEWAY</span>
        </div>
      </section>

      <section className="section featured-section" id="featured" aria-labelledby="featured-title">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="section-kicker">DARI KATALOG KONSER</span>
              <h2 id="featured-title">Konser <span>mendatang.</span></h2>
              <p>Jadwal acara berikutnya dari konser aktif di katalog.</p>
            </div>
            <Link className="text-link" to="/concerts">Lihat semua konser <span aria-hidden="true">↗</span></Link>
          </div>
          {loading ? (
            <Loading message="Memuat konser dari server..." />
          ) : error ? (
            <div className="empty-state" role="alert">
              <h3>Konser pilihan belum dapat dimuat</h3>
              <p>{error}</p>
              <button className="button button-primary" type="button" onClick={() => setRetryCount((count) => count + 1)}>
                Coba lagi
              </button>
            </div>
          ) : featured.length ? (
            <div className="concert-grid">
              {featured.map((concert) => <ConcertCard key={concert.id} concert={concert} />)}
            </div>
          ) : (
            <div className="empty-state">
              <span aria-hidden="true">♫</span>
              <h3>Belum ada konser mendatang</h3>
              <p>Konser aktif dengan jadwal berikutnya akan muncul di sini.</p>
              <Link className="button button-ghost" to="/concerts">Buka katalog</Link>
            </div>
          )}
        </div>
      </section>

      {!loading && !error && categories.length > 0 && <section className="home-category-section" aria-labelledby="home-category-title">
        <div className="container"><div className="home-category-heading"><div><span className="section-kicker">JELAJAHI BERDASARKAN GENRE</span><h2 id="home-category-title">Pilih suasana musikmu</h2><p>Kategori dari konser yang tersedia di katalog.</p></div><Link className="text-link" to="/concerts">Buka semua kategori <span aria-hidden="true">→</span></Link></div>
          <div className="home-category-list">{categories.map((category) => <Link key={category} to={`/concerts?category=${encodeURIComponent(category)}`}><span aria-hidden="true">♫</span>{category}<span aria-hidden="true">↗</span></Link>)}</div>
        </div>
      </section>}

      <section className="experience-section" aria-labelledby="experience-title">
        <div className="container experience-inner">
          <div>
            <span className="section-kicker">MUDAH DIMULAI</span>
            <h2 id="experience-title">Dari pencarian<br /><span>ke panggung.</span></h2>
            <p className="experience-intro">Semua informasi utama ada sebelum kamu memilih tiket.</p>
          </div>
          <ol className="experience-steps">
            <li><span>01</span><p><strong>Jelajahi konser</strong><small>Cari acara berdasarkan nama, artis, tanggal, kota, dan kategori.</small></p></li>
            <li><span>02</span><p><strong>Bandingkan tiket</strong><small>Lihat kategori, harga, serta kuota yang tersedia.</small></p></li>
            <li><span>03</span><p><strong>Rencanakan kunjungan</strong><small>Periksa detail acara dan simpan informasi pesananmu.</small></p></li>
          </ol>
        </div>
      </section>
    </>
  );
}
