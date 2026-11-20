import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ConcertCard from "../components/ConcertCard";
import Loading from "../components/Loading";
import { getConcerts } from "../services/api";

export default function Home() {
  const [featured, setFeatured] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getConcerts({ page: 1, limit: 3, sort: "date", direction: "asc" }, { signal: controller.signal })
      .then((data) => setFeatured(Array.isArray(data?.concerts) ? data.concerts : []))
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setError(requestError.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retryCount]);

  return (
    <>
      <section className="hero">
        <div className="hero-glow hero-glow-one" />
        <div className="hero-glow hero-glow-two" />
        <div className="container hero-layout">
          <div className="hero-copy">
            <div className="eyebrow"><span className="live-dot" /> PANGGUNG BERIKUTNYA MENANTIMU</div>
            <h1>Musik menyatukan.<br /><span>Momen jadi cerita.</span></h1>
            <p>Temukan konser favoritmu, pilih pengalaman yang kamu suka, dan mulai rencanakan momen yang tak terlupakan.</p>
            <div className="hero-actions">
              <Link className="button button-primary" to="/concerts">Jelajahi Konser <span>→</span></Link>
              <a className="button button-ghost" href="#featured">Lihat pilihan</a>
            </div>
            <div className="hero-proof">
              <div className="proof-avatars" aria-hidden="true"><span>K</span><span>♫</span><span>♪</span></div>
              <p><strong>Temukan musikmu</strong><br /><span>Mulai dari satu panggung.</span></p>
            </div>
          </div>

          <div className="hero-visual">
            <div className="hero-image-main">
              <img src="https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1100&q=90" alt="Panggung konser dengan pencahayaan dramatis" />
              <div className="hero-image-shade" />
              <div className="hero-image-caption"><span>LIVE · LOUD · TOGETHER</span><strong>Feel every beat.</strong></div>
            </div>
            <div className="floating-note"><span className="note-icon">♫</span><div><strong>Find your sound</strong><small>Pengalaman dimulai di sini</small></div></div>
            <div className="visual-orbit orbit-one" />
            <div className="visual-orbit orbit-two" />
          </div>
        </div>
        <div className="container hero-bottom"><span>DISCOVER YOUR NEXT LIVE EXPERIENCE</span><span>01 / MUSIC · PEOPLE · MOMENTS</span></div>
      </section>

      <section className="section featured-section" id="featured">
        <div className="container">
          <div className="section-heading">
            <div><span className="section-kicker">PILIHAN UNTUKMU</span><h2>Panggung yang <span>memanggil.</span></h2><p>Beberapa pengalaman musik yang layak masuk rencanamu.</p></div>
            <Link className="text-link" to="/concerts">Lihat semua konser <span>↗</span></Link>
          </div>
          {loading ? <Loading message="Memuat konser pilihan..." /> : error ? (
            <div className="empty-state" role="alert">
              <h3>Konser pilihan belum dapat dimuat</h3>
              <p>{error}</p>
              <button className="button button-primary" type="button" onClick={() => setRetryCount((count) => count + 1)}>Coba lagi</button>
            </div>
          ) : featured.length ? (
            <div className="concert-grid">
              {featured.map((concert) => <ConcertCard key={concert.id} concert={concert} />)}
            </div>
          ) : <div className="empty-state"><h3>Belum ada konser aktif</h3><p>Konser yang tersedia akan tampil di sini.</p></div>}
        </div>
      </section>

      <section className="experience-section">
        <div className="container experience-inner">
          <div><span className="section-kicker">MUDAH DIMULAI</span><h2>Satu panggung.<br /><span>Banyak cerita.</span></h2></div>
          <div className="experience-steps">
            <div><span>01</span><p><strong>Temukan konser</strong><small>Jelajahi acara sesuai seleramu.</small></p></div>
            <div><span>02</span><p><strong>Pilih pengalaman</strong><small>Lihat detail acara dan pilihan tiket.</small></p></div>
            <div><span>03</span><p><strong>Siap untuk musik</strong><small>Simpan tiket digital dan tunjukkan QR saat masuk.</small></p></div>
          </div>
        </div>
      </section>
    </>
  );
}
