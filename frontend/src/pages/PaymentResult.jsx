import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { getPayment } from "../services/api";
import TicketQr from "../components/TicketQr";

export default function PaymentResult() {
  const { bookingCode } = useParams(); const location=useLocation(); const [payment,setPayment]=useState(null); const [error,setError]=useState("");
  useEffect(()=>{const c=new AbortController();getPayment(bookingCode,{signal:c.signal}).then(setPayment).catch(e=>{if(e.name!=="AbortError")setError(e.message);});return()=>c.abort();},[bookingCode]);
  const tickets = payment?.tickets?.length
    ? payment.tickets
    : location.state?.tickets || [];
  return <section className="dashboard-page"><div className="dashboard-heading"><span className="dashboard-eyebrow">HASIL SIMULASI</span><h1>Hasil pembayaran</h1><p>Pembayaran ini merupakan simulasi, bukan transaksi nyata.</p></div>{error&&<p className="dashboard-error" role="alert">{error}</p>}{!payment&&!error&&<p role="status">Memuat hasil...</p>}{payment&&<article className="dashboard-card"><h2>{payment.paymentStatus === "paid" ? "Pembayaran berhasil" : payment.paymentStatus === "pending" ? "Menunggu pembayaran" : "Pembayaran tidak berhasil"}</h2><p>Kode booking: <strong>{payment.bookingCode}</strong></p><p>Status pembayaran: <strong>{payment.paymentStatus}</strong></p><p>Status booking: <strong>{payment.bookingStatus}</strong></p>{payment.paymentStatus === "paid" && <p>Tiket digital diterbitkan. QR Code di bawah adalah kode tiket acak; simpan untuk pemeriksaan masuk.</p>}<Link className="button button-primary" to="/booking-status">Cek status pesanan</Link></article>}{tickets.length > 0 && <div className="ticket-grid">{tickets.map((ticket)=><article className="ticket-card" key={ticket.ticketCode}><div><h2>{payment?.concertTitle || "Tiket KonserKita"}</h2><p>Kode booking: {bookingCode}</p><p>Tiket #{ticket.ticketNumber} · {ticket.ticketCode}</p></div><TicketQr ticketCode={ticket.ticketCode}/></article>)}</div>}{payment?.paymentStatus === "paid" && <Link className="button button-ghost" to="/customer/tickets">Buka daftar tiket akun</Link>}</section>;
}
