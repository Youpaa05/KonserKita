import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getCustomerBookingDetail } from "../services/api";

function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function statusLabel(status) {
  const labels = {
    pending: "Menunggu pembayaran",
    confirmed: "Dikonfirmasi",
    cancelled: "Dibatalkan",
  };

  return labels[status] || status;
}

export default function CustomerBookingDetail() {
  const { bookingCode } = useParams();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    getCustomerBookingDetail(bookingCode, { signal: controller.signal })
      .then(setBooking)
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError(err.message || "Detail pesanan gagal dimuat.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [bookingCode]);

  return (
    <section className="dashboard-page">
      <div className="dashboard-heading">
        <span className="dashboard-eyebrow">CUSTOMER AREA</span>
        <h1>Detail Pesanan</h1>
        <p>Informasi pesanan tiket KonserKita.</p>
      </div>

      <div className="dashboard-actions">
        <Link className="button button-ghost" to="/customer/bookings">
          Kembali ke riwayat
        </Link>
      </div>

      {loading && <p>Memuat detail pesanan...</p>}
      {error && <p className="dashboard-error" role="alert">{error}</p>}

      {!loading && !error && booking && (
        <article className="dashboard-card">
          <h2>{booking.concertTitle}</h2>
          <p><strong>Kode pesanan:</strong> {booking.bookingCode}</p>
          <p><strong>Nama pemesan:</strong> {booking.customerName}</p>
          <p><strong>Email:</strong> {booking.customerEmail}</p>
          <p><strong>Kategori tiket:</strong> {booking.ticketCategory}</p>
          <p><strong>Tanggal acara:</strong> {booking.eventDate || "-"}</p>
          <p><strong>Waktu acara:</strong> {booking.eventTime || "-"}</p>
          <p><strong>Jumlah tiket:</strong> {booking.quantity}</p>
          <p><strong>Harga satuan:</strong> {formatCurrency(booking.unitPrice)}</p>
          <p><strong>Total pesanan:</strong> {formatCurrency(booking.totalPrice)}</p>
          <p><strong>Status:</strong> {statusLabel(booking.status)}</p>
          <p><strong>Pembayaran:</strong> Simulasi, bukan transaksi pembayaran nyata.</p>
          <p><strong>Status pembayaran:</strong> {booking.paymentStatus || "-"}</p>
          {booking.paymentStatus === "pending" && <Link className="button button-primary" to={`/payments/${booking.bookingCode}`}>Bayar simulasi</Link>}
          <p><strong>Dibuat:</strong> {booking.createdAt ? new Date(booking.createdAt).toLocaleString("id-ID") : "-"}</p>
        </article>
      )}
    </section>
  );
}
