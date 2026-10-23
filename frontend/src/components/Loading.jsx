export default function Loading({ message = "Memuat konser..." }) {
  return <p className="loading-state" role="status">{message}</p>;
}
