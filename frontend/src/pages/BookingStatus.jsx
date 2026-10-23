
import { useState } from "react";
import { Link } from "react-router-dom";
import Loading from "../components/Loading";
import { getBooking } from "../services/api";
import { formatPrice } from "../data/concerts";

export default function BookingStatus() {
  const [bookingCode, setBookingCode] = useState("");
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSearch(event) {
    event.preventDefault();
    setBooking(null);
    setError("");
    setLoading(true);

    try {
      const result = await getBooking(bookingCode);
      setBooking(result);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="container booking-status-section">
      <span className="section-kicker">KONSERKITA · DATA SIMULASI</span>
      <h1>Cek status pesanan</h1>
      <p>Masukkan kode pesanan yang diperoleh setelah pemesanan berhasil.</p>

      <form className="booking-form" onSubmit={handleSearch}>
        <label className="booking-field">
          Kode pesanan
          <input
            type="text"
            value={bookingCode}
            onChange={(event) => setBookingCode(event.target.value.toUpperCase())}
            placeholder="KK-0123456789ABCDEF"
            pattern="KK-[A-F0-9]{16}"
            title="Masukkan kode dengan format KK- diikuti 16 karakter heksadesimal."
            maxLength="19"
            required
          />
        </label>
        <button
          className="button button-primary"
          type="submit"
          disabled={loading}
        >
          {loading ? "Mencari pesanan..." : "Cari pesanan"}
        </button>
      </form>

      {loading && <Loading message="Memeriksa status pesanan..." />}

      {error && (
        <div className="booking-error" role="alert">
          {error}
        </div>
      )}

      {booking && (
        <div className="booking-result" role="status">
          <h2>{booking.concertTitle}</h2>
          <p>Kode: <strong>{booking.bookingCode}</strong></p>
          <p>Kategori: {booking.ticketCategory}</p>
          <p>Jumlah tiket: {booking.quantity}</p>
          <p>Tanggal acara: {booking.eventDate}</p>
          <p>Waktu acara: {booking.eventTime} WIB</p>
          <p>Total: <strong>{formatPrice(booking.totalPrice)}</strong></p>
          <p>Status pesanan: <strong>{booking.status}</strong></p>
          <p className="detail-note">
            Pembayaran masih berupa simulasi. Status ini berasal dari database
            dan bukan bukti pembayaran.
          </p>
          <Link
            className="button button-ghost"
            to={`/concerts/${booking.concertSlug}`}
          >
            Lihat detail konser
          </Link>
        </div>
      )}

      <p className="detail-note">
        Kode pesanan diperlukan untuk melihat detail pesanan. Jangan bagikan
        kode ini kepada orang lain.
      </p>
    </section>
  );
}
