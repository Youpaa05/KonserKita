# Panduan Development Lokal

## Prasyarat

- Node.js dan npm.
- PostgreSQL.
- Database lokal yang sudah disiapkan sesuai [panduan database](database-setup.md).
- File environment lokal `backend/.env`.

Semua perintah di bawah dijalankan dari root repository, kecuali disebutkan lain.

## 1. Instalasi dependency

```powershell
npm --prefix backend ci
npm --prefix frontend ci
```

Jangan menghapus lockfile hanya untuk menyelesaikan masalah instalasi.

## 2. Konfigurasi environment

```powershell
Copy-Item backend\.env.example backend\.env
```

Isi `backend/.env` dengan konfigurasi PostgreSQL lokal. Gunakan `DATABASE_URL` atau konfigurasi terpisah `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, dan `DB_PASSWORD`. Koneksi loopback `DB_*` di development memakai non-TLS; koneksi remote selalu memakai TLS terverifikasi. `DATABASE_SSL=false` hanya diizinkan untuk koneksi lokal di luar production. Jangan menaruh nilai environment nyata dalam dokumentasi atau Git. `FRONTEND_URL` default ke origin Vite lokal, cookie session memakai `SameSite=Lax`, dan backend menggunakan `PORT` atau default 3000.

Siapkan schema sesuai [panduan database](database-setup.md). Jangan menjalankan migration sebelum memastikan database lokal yang dituju dan memahami perubahan schema.

## 3. Jalankan backend

Di terminal pertama:

```powershell
npm --prefix backend run dev
```

Backend memakai `backend/src/server.js` sebagai entry point dan `backend/src/app.js` untuk konfigurasi Express. Jangan menyalin nilai rahasia dari environment ke log.

## 4. Jalankan frontend

Di terminal kedua:

```powershell
npm --prefix frontend run dev
```

Buka URL lokal yang dicetak Vite. Port aktual dapat berbeda jika port default sedang digunakan.

Vite memproxy `/api` ke backend lokal. Pastikan origin frontend cocok dengan `FRONTEND_URL` backend.

## 5. Pemeriksaan dasar API

Gunakan browser atau alat HTTP untuk memeriksa:

- `GET /api/health`
- `GET /api/health/db`
- `GET /api/concerts`

Respons endpoint harus diperiksa, bukan diasumsikan.

## 6. Pemeriksaan kualitas

```powershell
npm --prefix backend test
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
```

Catat exit code dan pesan kegagalan jika ada. Jangan menyatakan pemeriksaan lulus apabila perintah tidak dijalankan.

## 7. Batasan pengujian

Tes backend saat ini mencakup validasi dan skenario transaksi berbasis mock. Jangan menyimpulkan seluruh alur database nyata sudah lolos hanya berdasarkan tes tersebut.

Hindari mengirim request POST pemesanan ke database yang kuotanya ingin dipertahankan. Gunakan database pengujian terpisah jika kelak diperlukan pengujian integrasi yang mengubah data. Jangan menjalankan `npm --prefix backend run db:migrate` terhadap database production atau Neon; lihat [panduan database](database-setup.md).

