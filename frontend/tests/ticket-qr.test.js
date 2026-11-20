import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeTicketQr } from "../src/utils/ticketQr.js";

test("QR hanya diberi kode tiket opaque, bukan nama atau email", async () => {
  const code = `KK-TKT-${"F".repeat(64)}`;
  let receivedPayload;
  const qrLibrary = { async toDataURL(payload) { receivedPayload = payload; return "data:image/png;base64,test"; } };
  const image = await encodeTicketQr(code, qrLibrary);
  assert.equal(receivedPayload, code);
  assert.doesNotMatch(receivedPayload, /@|Customer|email|phone/i);
  assert.match(image, /^data:image\/png;base64,/);
});

test("QR menolak identifier yang bukan ticket code", async () => {
  await assert.rejects(encodeTicketQr("KK-0123456789ABCDEF"), /Kode tiket tidak valid/);
});
