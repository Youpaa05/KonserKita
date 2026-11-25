export function isPaymentConfirmed(payment) {
  return payment?.paymentStatus === "paid" && payment?.bookingStatus === "confirmed";
}

export function getConfirmedPaymentTickets(payment) {
  if (!isPaymentConfirmed(payment) || !Array.isArray(payment.tickets)) return [];
  return payment.tickets;
}
