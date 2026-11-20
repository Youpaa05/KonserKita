import { useEffect, useState } from "react";
import { encodeTicketQr } from "../utils/ticketQr";

export default function TicketQr({ ticketCode, size = 220 }) {
  const [image, setImage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setImage("");
    setError("");
    encodeTicketQr(ticketCode, undefined, size)
      .then((value) => { if (active) setImage(value); })
      .catch(() => { if (active) setError("QR Code gagal dibuat."); });
    return () => { active = false; };
  }, [ticketCode, size]);

  if (error) return <p role="alert">{error}</p>;
  if (!image) return <p aria-live="polite">Membuat QR Code...</p>;
  return <img className="ticket-qr" src={image} alt={`QR tiket ${ticketCode}`} width={size} height={size} />;
}
