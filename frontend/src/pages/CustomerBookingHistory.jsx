import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getCustomerBookings } from "../services/api";

function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusLabel(status) {
  const labels = {
    pending: "Menunggu pembayaran",
    confirmed: "Dikonfirmasi",
    cancelled: "Dibatalkan",
  };

  return labels[status] || status;
}

export default function CustomerBookingHistory() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    getCustomerBookings({ signal: controller.signal })
      .then((response) => {
        setBookings(response?.bookings || []);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError(err.message || "Riwayat pesanan gagal dimuat.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  return (
    <section className="dashboard-page">
      <div className="dashboard-heading">
        <span className="dashboard-eyebrow">CUSTOMER AREA</span>
        <h1>Riwayat Pesanan</h1>
        <p>Lihat seluruh pesanan tiket yang terhubung dengan akun kamu.</p>
      </div>

      <div className="dashboard-actions">
        <Link className="button button-ghost" to="/customer/dashboard">
          Kembali ke dashboard
        </Link>
        <Link className="button button-primary" to="/concerts">
          Jelajahi konser
        </Link>
      </div>

      {loading && <p>Memuat riwayat pesanan...</p>}
      {error && <p className="dashboard-error" role="alert">{error}</p>}

      {!loading && !error && bookings.length === 0 && (
        <article className="dashboard-card">
          <h2>Belum ada pesanan</h2>
          <p>Pesanan yang kamu buat setelah login akan muncul di halaman ini.</p>
          <Link className="button button-primary" to="/concerts">
            Cari konser
          </Link>
        </article>
      )}

      {!loading && !error && bookings.length > 0 && (
        <div className="dashboard-grid">
          {bookings.map((booking) => (
            <article className="dashboard-card" key={booking.bookingCode}>
              <span>{booking.bookingCode}</span>
              <h2>{booking.concertTitle}</h2>
              <p>Kategori: {booking.ticketCategory}</p>
              <p>Tanggal acara: {booking.eventDate || "-"}</p>
              <p>Jumlah tiket: {booking.quantity}</p>
              <p>Total: {formatCurrency(booking.totalPrice)}</p>
              <p>Status: <strong>{statusLabel(booking.status)}</strong></p>
              <p>Pembayaran: <strong>{booking.paymentStatus || "-"}</strong></p>
              <p>Dibuat: {formatDate(booking.createdAt)}</p>
              <Link
                className="button button-primary"
                to={`/customer/bookings/${encodeURIComponent(booking.bookingCode)}`}
              >
                Lihat detail pesanan
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
