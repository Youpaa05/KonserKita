import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getConcertLineup } from "../src/data/lineup.js";

test("lineup multi-performer hanya memakai data eksplisit dari API", () => {
  assert.deepEqual(
    getConcertLineup({ artist: "Band Utama; Bintang Tamu", lineup: ["Band Utama", "Bintang Tamu"] }),
    ["Band Utama", "Bintang Tamu"],
  );
});

test("data lama tanpa lineup tetap memakai artist sebagai satu performer", () => {
  assert.deepEqual(getConcertLineup({ artist: "Band Lama" }), ["Band Lama"]);
});

test("lineup kosong tidak mengarang performer", () => {
  assert.deepEqual(getConcertLineup({ artist: "", lineup: [] }), []);
});

test("halaman detail dan concert card memakai lineup dengan fallback data lama", () => {
  const detail = readFileSync(new URL("../src/pages/ConcertDetail.jsx", import.meta.url), "utf8");
  const card = readFileSync(new URL("../src/components/ConcertCard.jsx", import.meta.url), "utf8");
  assert.match(detail, /getConcertLineup\(concert\)/);
  assert.match(detail, /lineup\.map\(\(performer\)/);
  assert.match(card, /getConcertLineup\(concert\)/);
  assert.match(card, /lineup\.join\(" · "\)/);
});
