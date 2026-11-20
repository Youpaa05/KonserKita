
export default function SearchBar({
  query,
  onQueryChange,
  category,
  onCategoryChange,
  city,
  onCityChange,
  categories = [],
  cities = [],
  artist,
  onArtistChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  sort,
  onSortChange,
  availability,
  onAvailabilityChange,
}) {
  return (
    <div className="search-panel">
      <label className="search-field">
        <span className="field-icon" aria-hidden="true">⌕</span>
        <span className="visually-hidden">Cari konser atau artis</span>
        <input
          type="search"
          placeholder="Cari konser atau artis..."
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>

      <label className="filter-field">
        <span className="visually-hidden">Kategori konser</span>
        <select
          value={category}
          onChange={(event) => onCategoryChange(event.target.value)}
        >
          <option value="">Semua kategori</option>
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        <span className="visually-hidden">Filter artis</span>
        <input type="search" placeholder="Artis / performer" value={artist} onChange={(event) => onArtistChange(event.target.value)} />
      </label>
      <label className="filter-field">
        <span className="visually-hidden">Tanggal mulai konser</span>
        <input type="date" value={dateFrom} onChange={(event) => onDateFromChange(event.target.value)} />
      </label>
      <label className="filter-field">
        <span className="visually-hidden">Tanggal akhir konser</span>
        <input type="date" value={dateTo} onChange={(event) => onDateToChange(event.target.value)} />
      </label>
      <label className="filter-field">
        <span className="visually-hidden">Ketersediaan tiket</span>
        <select value={availability} onChange={(event) => onAvailabilityChange(event.target.value)}><option value="">Semua ketersediaan</option><option value="available">Tiket tersedia</option><option value="sold-out">Tiket habis</option></select>
      </label>
      <label className="filter-field">
        <span className="visually-hidden">Urutkan konser</span>
        <select value={sort} onChange={(event) => onSortChange(event.target.value)}>
          <option value="date">Tanggal terdekat</option><option value="title">Nama konser</option><option value="price">Harga tiket</option>
        </select>
      </label>

      <label className="filter-field">
        <span className="visually-hidden">Kota konser</span>
        <select
          value={city}
          onChange={(event) => onCityChange(event.target.value)}
        >
          <option value="">Semua kota</option>
          {cities.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
