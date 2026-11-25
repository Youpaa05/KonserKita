import { useState } from "react";
import { Link } from "react-router-dom";
import { formatPrice } from "../data/concerts";
import { getConcertLineup } from "../data/lineup";
import { useAuth } from "../context/AuthContext";
import { addCustomerFavorite } from "../services/api";

export default function ConcertCard({ concert, showFavoriteAction = true }) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [favoriteMessage, setFavoriteMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const eventDate = new Date(`${concert.date}T12:00:00`);
  const readableDate = Number.isNaN(eventDate.getTime())
    ? concert.date
    : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(eventDate);
  const lineup = getConcertLineup(concert);

  async function addFavorite() {
    setSaving(true);
    setFavoriteMessage("");
    try {
      await addCustomerFavorite(concert.id);
      setSaved(true);
      setFavoriteMessage("Tersimpan di favorit.");
    } catch (error) {
      setFavoriteMessage(error.message || "Favorit gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="concert-card surface-card">
      <Link
        className={`concert-poster poster-${concert.accent || "default"}`}
        to={`/concerts/${concert.id}`}
        aria-label={`Lihat detail ${concert.title}`}
      >
        {concert.image && !imageFailed ? <img src={concert.image} alt="" loading="lazy" onError={() => setImageFailed(true)} /> : <span className="concert-poster-fallback" aria-hidden="true"><span>{concert.category || "KONSER LIVE"}</span><strong>{concert.title}</strong></span>}
        <span className="poster-category">{concert.category}</span>
        <span className="poster-arrow" aria-hidden="true">↗</span>
      </Link>
      <div className="concert-card-body">
        <p className="concert-date">
          <time dateTime={concert.date}>{readableDate}</time>
          <span aria-hidden="true">·</span>
          {concert.time || "Waktu menyusul"}
        </p>
        <h3><Link to={`/concerts/${concert.id}`}>{concert.title}</Link></h3>
        <p className="concert-artist">{lineup.join(" · ")}</p>
        <p className="concert-venue">
          {concert.venue || "Venue menyusul"}
          <span aria-hidden="true"> · </span>
          {concert.city}
        </p>
        <div className="concert-card-bottom">
          <div>
            <span className="price-label">Harga mulai</span>
            <strong>{concert.price == null ? "Harga menyusul" : formatPrice(concert.price)}</strong>
          </div>
          <Link className="card-link" to={`/concerts/${concert.id}`} aria-label={`Lihat detail ${concert.title}`}>
            Detail <span aria-hidden="true">→</span>
          </Link>
        </div>
        {showFavoriteAction && user?.role === "customer" && (
          <div className="concert-favorite-action">
            <button type="button" aria-pressed={saved} disabled={saving || saved} onClick={addFavorite}>
              {saving ? "Menyimpan..." : saved ? "✓ Tersimpan" : "♡ Simpan favorit"}
            </button>
            {favoriteMessage && <small role={saved ? "status" : "alert"}>{favoriteMessage}</small>}
          </div>
        )}
      </div>
    </article>
  );
}
