# KonserKita

KonserKita adalah aplikasi web simulasi pemesanan tiket konser. Aplikasi menyediakan katalog konser, detail acara, kategori tiket, proses pemesanan, dan pencarian status pesanan.

## Teknologi

- Frontend: React, React DOM, React Router, dan Vite.
- Backend: Node.js dan Express.
- Database: PostgreSQL.
- Driver database: node-postgres (`pg`).
- Pengujian backend: Node.js Test Runner.

## Struktur proyek

```text
KonserKita/
├── backend/
│   ├── database/
│   │   ├── schema.sql
│   │   └── seed.sql
│   ├── src/
│   │   ├── config/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── app.js
│   │   └── server.js
│   ├── tests/
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   └── package.json
├── docs/
├── .gitignore
└── README.md
```

## Persyaratan

- Node.js dengan npm.
- PostgreSQL.
- Database PostgreSQL yang dapat diakses oleh backend.

Pastikan perintah `node`, `npm`, dan `psql` tersedia jika akan digunakan dari terminal.

## Konfigurasi

1. Siapkan database PostgreSQL.
2. Baca `backend/.env.example`.
3. Buat `backend/.env` berdasarkan contoh tersebut.
4. Isi konfigurasi lokal yang diperlukan sesuai database milikmu.
5. Jangan membagikan atau meng-commit isi `.env` karena file tersebut dapat berisi kredensial.

Nama variabel konfigurasi yang tersedia pada contoh:

- `PORT`
- `FRONTEND_URL`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

Jangan mengganti kredensial database dengan nilai contoh tanpa memastikan nilainya sesuai lingkungan lokal.

## Menyiapkan database

File SQL yang tersedia:

- `backend/database/schema.sql`: membuat tabel, constraint, dan indeks.
- `backend/database/seed.sql`: memasukkan data awal konser dan kategori tiket.

Jalankan skema sebelum seed. Petunjuk lengkap tersedia di [Panduan Setup Database](docs/database-setup.md).

## Menjalankan aplikasi

Buka dua terminal terpisah.

Terminal backend:

```powershell
cd D:\KonserKita\backend
npm install
npm run dev
```

Terminal frontend:

```powershell
cd D:\KonserKita\frontend
npm install
npm run dev
```

Buka alamat frontend yang ditampilkan oleh Vite di terminal. Konfigurasi alamat frontend dan backend harus sesuai dengan konfigurasi lokal.

Petunjuk lengkap tersedia di [Panduan Development Lokal](docs/local-development.md).

## Pengujian

Jalankan tes backend:

```powershell
cd D:\KonserKita\backend
npm test
```

Jalankan lint dan build frontend:

```powershell
cd D:\KonserKita\frontend
npm run lint
npm run build
```

Hasil tes yang pernah dicatat sebelum pembaruan dokumentasi: 19 tes backend lulus, frontend lint lulus, dan frontend build lulus. Jalankan kembali perintah di atas setelah perubahan untuk memperoleh bukti terbaru.

Tes transaksi backend menggunakan mock; hasilnya tidak dengan sendirinya membuktikan seluruh query berhasil dijalankan terhadap PostgreSQL nyata.

## Endpoint pemeriksaan

- `GET /api/health`: pemeriksaan kesehatan API.
- `GET /api/health/db`: pemeriksaan koneksi database.

Endpoint lain yang tersedia mencakup katalog konser, detail konser, kategori tiket, pembuatan pesanan, dan pencarian pesanan berdasarkan kode. Periksa implementasi route aktual jika membutuhkan kontrak request dan response secara terperinci.

## Keamanan dan batasan

- Jangan commit `.env`, password, token, atau kredensial.
- Gunakan query berparameter untuk input database.
- Validasi input dan tangani kegagalan transaksi.
- Jangan menganggap tes mock sebagai bukti pengujian integrasi database.
- Gunakan lingkungan lokal untuk pengujian.
- Perlakukan proses pemesanan sebagai simulasi; jangan mengklaim pembayaran nyata atau pemesanan pada penyelenggara konser sungguhan.
- Jangan melakukan tes pembuatan pesanan pada database yang kuotanya harus dipertahankan.

## Dokumentasi tambahan

- [Setup database](docs/database-setup.md)
- [Development lokal](docs/local-development.md)
- [Skenario demo](docs/demo-scenario.md)

