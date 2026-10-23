
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Loading from "../components/Loading";
import {
  createBooking,
  getConcert,
  getTicketCategories,
} from "../services/api";
import { formatDate, formatPrice } from "../data/concerts";

export default function ConcertDetail() {
  const { id } = useParams();

  const [concert, setConcert] = useState(null);
  const [categories, setCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bookingError, setBookingError] = useState("");
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingResult, setBookingResult] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPage() {
      setLoading(true);
      setError("");
      setConcert(null);
      setCategories([]);
      setSelectedCategoryId("");

      try {
        const [concertData, categoryData] = await Promise.all([
          getConcert(id, { signal: controller.signal }),
          getTicketCategories(id, { signal: controller.signal }),
        ]);

        if (!concertData || !concertData.id || !Array.isArray(categoryData)) {
          throw new Error("Data konser atau kategori tiket tidak valid.");
        }

        setConcert(concertData);
        setCategories(categoryData);

        const availableCategory = categoryData.find(
          (category) => Number(category.quota) > 0,
        );

        setSelectedCategoryId(availableCategory?.id || "");
      } catch (requestError) {
        if (requestError.name !== "AbortError") {
          setError(requestError.message);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadPage();
    return () => controller.abort();
  }, [id]);

  const selectedCategory = categories.find(
    (category) => category.id === selectedCategoryId,
  );

  const quantityNumber = Number(quantity);
  const quantityValid =
    Number.isSafeInteger(quantityNumber) &&
    quantityNumber >= 1 &&
    quantityNumber <= 100 &&
    quantityNumber <= Number(selectedCategory?.quota || 0);

  const estimatedTotal = useMemo(() => {
    if (!selectedCategory || !quantityValid) return null;
    return Number(selectedCategory.price) * quantityNumber;
  }, [selectedCategory, quantityValid, quantityNumber]);

  async function handleBooking(event) {
    event.preventDefault();
    setBookingError("");
    setBookingResult(null);

    if (!selectedCategory) {
      setBookingError("Pilih kategori tiket yang tersedia.");
      return;
    }

    if (!quantityValid) {
      setBookingError("Jumlah tiket tidak valid atau melebihi kuota.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const customerName = String(formData.get("customerName") || "").trim();
    const customerEmail = String(formData.get("customerEmail") || "")
      .trim()
      .toLowerCase();

    if (customerName.length < 2 || customerName.length > 150) {
      setBookingError("Nama harus terdiri dari 2–150 karakter.");
      return;
    }

    if (
      customerEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)
    ) {
      setBookingError("Masukkan alamat email yang valid.");
      return;
    }

    setBookingLoading(true);

    try {
      const result = await createBooking({
        customerName,
        customerEmail,
        ticketCategoryId: selectedCategory.id,
        quantity: quantityNumber,
      });

      setBookingResult(result);
      setCategories((current) =>
        current.map((category) =>
          category.id === selectedCategory.id
            ? { ...category, quota: result.remainingQuota }
            : category,
        ),
      );
    } catch (requestError) {
      setBookingError(requestError.message);
    } finally {
      setBookingLoading(false);
    }
  }

  if (loading) {
    return (
      <section className="container detail-not-found">
        <Loading message="Memuat detail konser dan kategori tiket..." />
      </section>
    );
  }

  if (error || !concert) {
    return (
      <section className="container detail-not-found" role="alert">
        <h1>Konser belum dapat ditampilkan.</h1>
        <p>{error || "Data konser tidak ditemukan."}</p>
        <Link className="button button-primary" to="/concerts">
          Jelajahi konser
        </Link>
      </section>
    );
  }

  return (
    <section className="detail-section">
      <div className="container">
        <Link className="back-link" to="/concerts">
          ← Kembali ke katalog
        </Link>

        <div className="detail-layout">
          <div className={`detail-poster poster-${concert.accent || "violet"}`}>
            <img
              src={concert.image}
              alt={`Suasana ilustratif untuk ${concert.title}`}
            />
            <span className="poster-category">{concert.category}</span>
          </div>

          <div className="detail-copy">
            <span className="section-kicker">DETAIL ACARA · DATA SIMULASI</span>
            <h1>{concert.title}</h1>
            <p className="detail-artist">{concert.artist}</p>
            <p className="detail-description">{concert.description}</p>

            <div className="detail-facts">
              <div>
                <span>TANGGAL</span>
                <strong>{formatDate(concert.date)}</strong>
              </div>
              <div>
                <span>WAKTU</span>
                <strong>{concert.time} WIB</strong>
              </div>
              <div>
                <span>LOKASI</span>
                <strong>{concert.venue}</strong>
                <small>{concert.city}</small>
              </div>
            </div>

            <p className="detail-note">
              Harga, acara, dan pembayaran merupakan simulasi untuk demo.
              Tidak ada pembayaran uang sungguhan.
            </p>

            {bookingResult ? (
              <div className="booking-result" role="status">
                <h2>Pesanan berhasil dibuat</h2>
                <p>{bookingResult.message}</p>
                <p>
                  Kode pesanan:{" "}
                  <strong>{bookingResult.bookingCode}</strong>
                </p>
                <p>
                  {bookingResult.ticketCategory} · {bookingResult.quantity} tiket
                </p>
                <p>
                  Total: <strong>{formatPrice(bookingResult.totalPrice)}</strong>
                </p>
                <p>Status: {bookingResult.status}</p>
                <button
                  className="button button-ghost"
                  type="button"
                  onClick={() =>
                    navigator.clipboard?.writeText(bookingResult.bookingCode)
                  }
                >
                  Salin kode pesanan
                </button>
                <Link className="button button-primary" to="/booking-status">
                  Cek status pesanan
                </Link>
                <button
                  className="button button-ghost"
                  type="button"
                  onClick={() => {
                    setBookingResult(null);
                    setQuantity("1");
                  }}
                >
                  Tutup konfirmasi
                </button>
              </div>
            ) : (
              <form className="booking-form" onSubmit={handleBooking}>
                <h2>Pesan tiket simulasi</h2>

                <label className="booking-field">
                  Kategori tiket
                  <select
                    value={selectedCategoryId}
                    onChange={(event) =>
                      setSelectedCategoryId(event.target.value)
                    }
                    required
                  >
                    <option value="">Pilih kategori</option>
                    {categories.map((category) => (
                      <option
                        key={category.id}
                        value={category.id}
                        disabled={Number(category.quota) < 1}
                      >
                        {category.name} — {formatPrice(category.price)} (
                        tersedia: {category.quota})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="booking-field">
                  Jumlah tiket
                  <input
                    type="number"
                    min="1"
                    max={Math.min(100, Number(selectedCategory?.quota || 0))}
                    step="1"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    required
                  />
                </label>

                <p className="booking-total">
                  Estimasi total:{" "}
                  <strong>
                    {estimatedTotal === null
                      ? "—"
                      : formatPrice(estimatedTotal)}
                  </strong>
                </p>

                <label className="booking-field">
                  Nama pemesan
                  <input
                    name="customerName"
                    type="text"
                    minLength="2"
                    maxLength="150"
                    autoComplete="name"
                    required
                  />
                </label>

                <label className="booking-field">
                  Email pemesan
                  <input
                    name="customerEmail"
                    type="email"
                    maxLength="254"
                    autoComplete="email"
                    required
                  />
                </label>

                {bookingError && (
                  <p className="booking-error" role="alert">
                    {bookingError}
                  </p>
                )}

                {categories.length === 0 && (
                  <p role="status">Kategori tiket belum tersedia.</p>
                )}

                {categories.length > 0 &&
                  !categories.some((category) => Number(category.quota) > 0) && (
                    <p role="status">Maaf, tiket konser ini habis.</p>
                  )}

                <button
                  className="button button-primary"
                  type="submit"
                  disabled={
                    bookingLoading ||
                    !selectedCategory ||
                    !quantityValid ||
                    categories.length === 0
                  }
                >
                  {bookingLoading ? "Memproses pesanan..." : "Buat pesanan simulasi"}
                </button>
                <p className="detail-note">
                  Pembuatan pesanan mengurangi kuota tiket. Pembayaran tidak
                  dilakukan secara nyata.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
