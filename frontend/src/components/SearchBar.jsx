
export default function SearchBar({
  query,
  onQueryChange,
  category,
  onCategoryChange,
  city,
  onCityChange,
  categories = [],
  cities = [],
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
