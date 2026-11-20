import QRCode from "qrcode";

const TICKET_CODE_PATTERN = /^KK-TKT-[A-F0-9]{64}$/;

export function encodeTicketQr(ticketCode, qrLibrary = QRCode, width = 220) {
  if (typeof ticketCode !== "string" || !TICKET_CODE_PATTERN.test(ticketCode)) {
    return Promise.reject(new Error("Kode tiket tidak valid."));
  }
  return qrLibrary.toDataURL(ticketCode, {
    errorCorrectionLevel: "M",
    margin: 2,
    width,
    color: { dark: "#101426", light: "#ffffff" },
  });
}
