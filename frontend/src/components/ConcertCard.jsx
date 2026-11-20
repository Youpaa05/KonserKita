import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDate, formatPrice } from "../data/concerts";
import { useAuth } from "../context/AuthContext";
import { addCustomerFavorite } from "../services/api";

export default function ConcertCard({ concert, showFavoriteAction = true }) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [favoriteMessage, setFavoriteMessage] = useState("");
  async function addFavorite() {
    setSaving(true); setFavoriteMessage("");
    try { await addCustomerFavorite(concert.id); setFavoriteMessage("Tersimpan di favorit."); }
    catch (error) { setFavoriteMessage(error.message || "Favorit gagal disimpan."); }
    finally { setSaving(false); }
  }
  return (
    <article className="concert-card">
      <Link className={`concert-poster poster-${concert.accent}`} to={`/concerts/${concert.id}`} aria-label={`Lihat detail ${concert.title}`}>
        <img src={concert.image} alt="" loading="lazy" />
        <span className="poster-category">{concert.category}</span>
        <span className="poster-arrow" aria-hidden="true">↗</span>
      </Link>
      <div className="concert-card-body">
        <p className="concert-date">{formatDate(concert.date)} <span>·</span> {concert.city}</p>
        <h3><Link to={`/concerts/${concert.id}`}>{concert.title}</Link></h3>
        <p className="concert-artist">{concert.artist}</p>
        <div className="concert-card-bottom"><div><span className="price-label">Mulai dari</span><strong>{formatPrice(concert.price)}</strong></div><Link className="card-link" to={`/concerts/${concert.id}`} aria-label={`Detail ${concert.title}`}>Detail <span aria-hidden="true">→</span></Link></div>
        {showFavoriteAction && user?.role === "customer" && <div className="concert-favorite-action"><button type="button" disabled={saving} onClick={addFavorite}>{saving ? "Menyimpan..." : "♡ Simpan favorit"}</button>{favoriteMessage && <small role="status">{favoriteMessage}</small>}</div>}
      </div>
    </article>
  );
}
