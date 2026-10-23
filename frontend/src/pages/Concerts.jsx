import { useEffect, useState } from "react";
import ConcertCard from "../components/ConcertCard";
import SearchBar from "../components/SearchBar";
import Loading from "../components/Loading";
import { getConcerts } from "../services/api";

export default function Concerts() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [concerts, setConcerts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadConcerts() {
      setLoading(true);
      setError("");

      try {
        const data = await getConcerts(
          { query, category, city },
          { signal: controller.signal },
        );

        if (!Array.isArray(data)) {
          throw new Error("Format data konser dari server tidak valid.");
        }

        setConcerts(data);
      } catch (requestError) {
        if (requestError.name === "AbortError") return;

        setError(requestError.message);
        setConcerts([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    const timeoutId = setTimeout(loadConcerts, 300);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [query, category, city, retryCount]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadFilterOptions() {
      try {
        const data = await getConcerts({}, { signal: controller.signal });

        if (!Array.isArray(data)) return;

        setCategories(
          [...new Set(data.map((concert) => concert.category).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, "id")),
        );

        setCities(
          [...new Set(data.map((concert) => concert.city).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, "id")),
        );
      } catch (requestError) {
        if (requestError.name !== "AbortError") {
          console.error("Gagal memuat opsi filter:", requestError.message);
        }
      }
    }

    loadFilterOptions();

    return () => controller.abort();
  }, []);

  function resetFilters() {
    setQuery("");
    setCategory("");
    setCity("");
  }

  const hasFilters = Boolean(query.trim() || category || city);

  return (
    <section className="catalog-section">
      <div className="container">
        <div className="catalog-heading">
          <span className="section-kicker">TEMUKAN PANGGUNGMU</span>
          <h1>
            Jelajahi <span>konser.</span>
          </h1>
          <p>Temukan acara, suasana, dan musisi yang ingin kamu saksikan.</p>
        </div>

        <SearchBar
          query={query}
          onQueryChange={setQuery}
          category={category}
          onCategoryChange={setCategory}
          city={city}
          onCityChange={setCity}
          categories={categories}
          cities={cities}
        />

        <div className="results-bar">
          <p>
            <strong>{loading ? "…" : concerts.length}</strong>{" "}
            {loading ? "memuat konser" : "konser ditemukan"}
          </p>

          {hasFilters && (
            <button
              className="reset-button"
              type="button"
              onClick={resetFilters}
            >
              Reset filter ×
            </button>
          )}
        </div>

        {loading ? (
          <Loading message="Memuat konser dari server..." />
        ) : error ? (
          <div className="empty-state" role="alert">
            <h2>Konser belum dapat dimuat</h2>
            <p>{error}</p>
            <button
              className="button button-primary"
              type="button"
              onClick={() => setRetryCount((count) => count + 1)}
            >
              Coba lagi
            </button>
          </div>
        ) : concerts.length > 0 ? (
          <div className="concert-grid">
            {concerts.map((concert) => (
              <ConcertCard key={concert.id} concert={concert} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span aria-hidden="true">⌕</span>
            <h2>Belum ada konser yang cocok</h2>
            <p>
              Coba kata kunci lain atau ubah filter kategori dan kota.
            </p>
            {hasFilters && (
              <button
                className="button button-primary"
                type="button"
                onClick={resetFilters}
              >
                Tampilkan semua konser
              </button>
            )}
          </div>
        )}

        <p className="data-disclaimer">
          Daftar acara dan harga merupakan data simulasi untuk keperluan demo.
        </p>
      </div>
    </section>
  );
}