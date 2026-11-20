import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ConcertCard from "../components/ConcertCard";
import Loading from "../components/Loading";
import { getCustomerFavorites, removeCustomerFavorite } from "../services/api";

export default function CustomerFavorites() {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const load = useCallback(async (signal) => {
    setLoading(true); setError("");
    try { setFavorites(await getCustomerFavorites({ signal })); }
    catch (err) { if (err.name !== "AbortError") setError(err.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);
  async function remove(id) {
    setBusyId(id); setError("");
    try { await removeCustomerFavorite(id); setFavorites((items) => items.filter((item) => item.id !== id)); }
    catch (err) { setError(err.message); }
    finally { setBusyId(""); }
  }
  return <section className="customer-extra-page container">
    <header className="customer-extra-heading"><span className="section-kicker">PILIHANMU</span><h1>Konser favorit</h1><p>Konser yang kamu simpan untuk nanti.</p></header>
    {loading ? <Loading message="Memuat konser favorit..." /> : error && favorites.length === 0 ? <div className="empty-state" role="alert"><h2>Favorit belum dapat dimuat</h2><p>{error}</p><button className="button button-primary" onClick={() => load()}>Coba lagi</button></div> : favorites.length === 0 ? <div className="empty-state"><h2>Belum ada konser favorit</h2><p>Simpan konser yang ingin kamu ikuti.</p><Link className="button button-primary" to="/concerts">Jelajahi konser</Link></div> : <>
      {error && <p className="booking-error" role="alert">{error}</p>}
      <div className="concert-grid">{favorites.map((concert) => <div className="favorite-card" key={concert.id}><ConcertCard concert={concert} showFavoriteAction={false} /><button className="favorite-remove" type="button" disabled={busyId === concert.id} onClick={() => remove(concert.id)}>{busyId === concert.id ? "Menghapus..." : "Hapus favorit"}</button></div>)}</div>
    </>}
  </section>;
}
