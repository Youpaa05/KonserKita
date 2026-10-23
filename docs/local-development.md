# Panduan Development Lokal

## Prasyarat

- Node.js dan npm.
- PostgreSQL.
- Database lokal yang sudah disiapkan.
- File `backend/.env` yang dikonfigurasi secara lokal.

## 1. Instalasi dependency

Backend:

```powershell
cd D:\KonserKita\backend
npm install
```

Frontend, pada terminal terpisah:

```powershell
cd D:\KonserKita\frontend
npm install
```

Jangan menghapus lockfile hanya untuk menyelesaikan masalah instalasi.

## 2. Jalankan backend

```powershell
cd D:\KonserKita\backend
npm run dev
```

Backend menggunakan `src/server.js` sebagai entry point dan `src/app.js` untuk konfigurasi aplikasi Express.

Periksa pesan startup di terminal. Jangan menyalin nilai rahasia dari environment ke log.

## 3. Jalankan frontend

Pada terminal lain:

```powershell
cd D:\KonserKita\frontend
npm run dev
```

Buka URL lokal yang dicetak Vite. Port aktual dapat berbeda jika port default sedang digunakan.

Pastikan frontend dapat mengakses API sesuai konfigurasi lokal dan `FRONTEND_URL` backend.

## 4. Pemeriksaan dasar API

Gunakan browser atau alat HTTP untuk memeriksa:

- `GET /api/health`
- `GET /api/health/db`
- `GET /api/concerts`

Gunakan base URL backend dan port aktual dari konfigurasi lokal. Respons endpoint harus diperiksa, bukan diasumsikan.

## 5. Pemeriksaan kualitas

Backend:

```powershell
cd D:\KonserKita\backend
npm test
```

Frontend:

```powershell
cd D:\KonserKita\frontend
npm run lint
npm run build
```

Catat exit code dan pesan kegagalan jika ada. Jangan menyatakan pemeriksaan lulus apabila perintah tidak dijalankan.

## 6. Batasan pengujian

Tes backend saat ini mencakup validasi dan skenario transaksi berbasis mock. Jangan menyimpulkan seluruh alur database nyata sudah lolos hanya berdasarkan tes tersebut.

Hindari mengirim request POST pemesanan ke database yang kuotanya ingin dipertahankan. Gunakan database pengujian terpisah jika kelak diperlukan pengujian integrasi yang mengubah data.

