import test from "node:test";
import assert from "node:assert/strict";
import { getConfirmedPaymentTickets, isPaymentConfirmed } from "../src/utils/paymentResult.js";

test("payment result only exposes tickets for paid, confirmed bookings", () => {
  const tickets = [{ ticketCode: "KK-TKT-123" }];
  const payment = { paymentStatus: "paid", bookingStatus: "confirmed", tickets };

  assert.equal(isPaymentConfirmed(payment), true);
  assert.equal(getConfirmedPaymentTickets(payment), tickets);
});

test("payment result withholds tickets when payment or booking is not confirmed", () => {
  assert.equal(isPaymentConfirmed({ paymentStatus: "pending", bookingStatus: "confirmed" }), false);
  assert.equal(isPaymentConfirmed({ paymentStatus: "paid", bookingStatus: "pending" }), false);
  assert.deepEqual(getConfirmedPaymentTickets({ paymentStatus: "paid", bookingStatus: "pending", tickets: [{ ticketCode: "forged" }] }), []);
  assert.deepEqual(getConfirmedPaymentTickets({ paymentStatus: "paid", bookingStatus: "confirmed", tickets: { ticketCode: "malformed" } }), []);
});
