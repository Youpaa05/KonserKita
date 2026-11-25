import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPayment } from "../services/api";
import TicketQr from "../components/TicketQr";
import { getConfirmedPaymentTickets, isPaymentConfirmed } from "../utils/paymentResult";

export default function PaymentResult() {
  const { bookingCode } = useParams(); const [payment,setPayment]=useState(null); const [error,setError]=useState("");
  useEffect(()=>{const c=new AbortController();getPayment(bookingCode,{signal:c.signal}).then(setPayment).catch(e=>{if(e.name!=="AbortError")setError(e.message);});return()=>c.abort();},[bookingCode]);
  const paymentConfirmed = isPaymentConfirmed(payment);
  const tickets = getConfirmedPaymentTickets(payment);
  return <section className="dashboard-page"><div className="dashboard-heading"><span className="dashboard-eyebrow">STATUS TRANSAKSI</span><h1>Status pembayaran</h1><p>{payment?.paymentSimulation ? "Status ini berasal dari simulasi. Tidak ada uang sungguhan yang diproses." : "Simulasi pembayaran tidak aktif pada environment ini. Status ini bukan bukti transaksi dana nyata."}</p></div>{error&&<p className="dashboard-error" role="alert">{error}</p>}{!payment&&!error&&<p role="status">Memuat hasil...</p>}{payment&&<article className="dashboard-card"><h2>{paymentConfirmed ? "Pembayaran simulasi berhasil dan pesanan dikonfirmasi" : payment.paymentStatus === "paid" ? "Pembayaran tercatat, konfirmasi pesanan belum tersedia" : payment.paymentStatus === "pending" ? "Menunggu pembayaran" : "Status pembayaran tidak berhasil"}</h2><p>Kode booking: <strong>{payment.bookingCode}</strong></p><p>Status pembayaran: <strong>{payment.paymentStatus}</strong></p><p>Status booking: <strong>{payment.bookingStatus}</strong></p>{paymentConfirmed && <p>Tiket tersedia untuk pesanan terkonfirmasi. Kode ini bukan pengganti tiket resmi dari penyelenggara.</p>}<Link className="button button-primary" to="/booking-status">Cek status pesanan</Link></article>}{tickets.length > 0 && <div className="ticket-grid">{tickets.map((ticket)=><article className="ticket-card" key={ticket.ticketCode}><div><h2>{payment?.concertTitle || "Tiket KonserKita"}</h2><p>Kode booking: {bookingCode}</p><p>Tiket #{ticket.ticketNumber} · {ticket.ticketCode}</p></div><TicketQr ticketCode={ticket.ticketCode}/></article>)}</div>}{paymentConfirmed && <Link className="button button-ghost" to="/customer/tickets">Buka daftar tiket akun</Link>}</section>;
}
