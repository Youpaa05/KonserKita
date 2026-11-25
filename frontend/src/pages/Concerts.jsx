import { useEffect, useState } from "react";
import ConcertCard from "../components/ConcertCard";
import SearchBar from "../components/SearchBar";
import Loading from "../components/Loading";
import { useSearchParams } from "react-router-dom";
import { getConcerts } from "../services/api";

export default function Concerts() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("q") || "");
  const [category, setCategory] = useState(() => searchParams.get("category") || "");
  const [city, setCity] = useState("");
  const [artist, setArtist] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState("date");
  const [direction, setDirection] = useState("asc");
  const [availability, setAvailability] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalConcerts, setTotalConcerts] = useState(0);
  const [concerts, setConcerts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [filterRetry, setFilterRetry] = useState(0);
  const [filterOptionsError, setFilterOptionsError] = useState("");

  useEffect(() => {
    setQuery(searchParams.get("q") || "");
    setCategory(searchParams.get("category") || "");
  }, [searchParams]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const nextParams = new URLSearchParams(searchParams);
      if (query.trim()) nextParams.set("q", query.trim());
      else nextParams.delete("q");
      if (category) nextParams.set("category", category);
      else nextParams.delete("category");
      if (nextParams.toString() !== searchParams.toString()) setSearchParams(nextParams, { replace: true });
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [query, category, searchParams, setSearchParams]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadConcerts() {
      setLoading(true);
      setError("");

      try {
        const data = await getConcerts(
          { query, category, city, artist, dateFrom, dateTo, availability, sort, direction, page, limit: 12 },
          { signal: controller.signal },
        );

        if (!Array.isArray(data?.concerts) || !Number.isSafeInteger(data.totalPages)) {
          throw new Error("Format data konser dari server tidak valid.");
        }

        setConcerts(data.concerts);
        setTotalPages(Math.max(data.totalPages, 1));
        setTotalConcerts(data.total);
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
  }, [query, category, city, artist, dateFrom, dateTo, availability, sort, direction, page, retryCount]);

  useEffect(() => { setPage(1); }, [query, category, city, artist, dateFrom, dateTo, availability, sort, direction]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadFilterOptions() {
      setFilterOptionsError("");
      try {
        const data = await getConcerts({}, { signal: controller.signal });

        if (!Array.isArray(data)) throw new Error("Format opsi filter dari server tidak valid.");

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
          setFilterOptionsError(requestError.message || "Opsi filter belum dapat dimuat.");
        }
      }
    }

    loadFilterOptions();

    return () => controller.abort();
  }, [filterRetry]);

  function resetFilters() {
    setQuery("");
    setCategory("");
    setCity("");
    setArtist("");
    setDateFrom("");
    setDateTo("");
    setSort("date");
    setDirection("asc");
    setAvailability("");
    setPage(1);
  }

  const hasFilters = Boolean(query.trim() || category || city || artist.trim() || dateFrom || dateTo || availability || sort !== "date" || direction !== "asc");

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
          artist={artist}
          onArtistChange={setArtist}
          dateFrom={dateFrom}
          onDateFromChange={setDateFrom}
          dateTo={dateTo}
          onDateToChange={setDateTo}
          sort={sort}
          onSortChange={setSort}
          direction={direction}
          onDirectionChange={setDirection}
          availability={availability}
          onAvailabilityChange={setAvailability}
        />

        {filterOptionsError && (
          <p className="filter-options-note" role="status">
            Opsi kategori dan kota belum tersedia. {" "}
            <button className="text-button" type="button" onClick={() => setFilterRetry((value) => value + 1)}>
              Muat ulang opsi
            </button>
          </p>
        )}

        <div className="results-bar">
          <p>
            <strong>{loading ? "…" : totalConcerts}</strong>{" "}
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

        <div className="catalog-results" aria-busy={loading}>
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
        </div>

        {!loading && !error && totalPages > 1 && (
          <nav className="concert-pagination" aria-label="Halaman hasil konser">
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Sebelumnya</button>
            <span>Halaman {page} dari {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Berikutnya</button>
          </nav>
        )}

        <p className="data-disclaimer">
          Informasi jadwal, harga, dan ketersediaan mengikuti data konser yang tersedia di katalog.
        </p>
      </div>
    </section>
  );
}
