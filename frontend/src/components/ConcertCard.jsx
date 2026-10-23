import { Link } from "react-router-dom";
import { formatDate, formatPrice } from "../data/concerts";

export default function ConcertCard({ concert }) {
  return (
    <article className="concert-card">
      <Link
        className={`concert-poster poster-${concert.accent}`}
        to={`/concerts/${concert.id}`}
        aria-label={`Lihat detail ${concert.title}`}
      >
        <img src={concert.image} alt="" loading="lazy" />
        <span className="poster-category">{concert.category}</span>
        <span className="poster-arrow" aria-hidden="true">↗</span>
      </Link>

      <div className="concert-card-body">
        <p className="concert-date">{formatDate(concert.date)} <span>·</span> {concert.city}</p>
        <h3><Link to={`/concerts/${concert.id}`}>{concert.title}</Link></h3>
        <p className="concert-artist">{concert.artist}</p>
        <div className="concert-card-bottom">
          <div>
            <span className="price-label">Mulai dari</span>
            <strong>{formatPrice(concert.price)}</strong>
          </div>
          <Link className="card-link" to={`/concerts/${concert.id}`} aria-label={`Detail ${concert.title}`}>
            Detail <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </article>
  );
}
