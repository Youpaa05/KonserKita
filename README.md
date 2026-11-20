# KonserKita

KonserKita adalah aplikasi web pemesanan tiket konser untuk kebutuhan demonstrasi dan portofolio. Customer dapat mencari konser, membuat booking sebagai guest atau customer, mencoba pembayaran simulasi, dan mengakses tiket digital. Administrator dapat mengelola konser, melihat laporan, serta memvalidasi tiket.

> Konser, booking, pembayaran, dan tiket dalam aplikasi ini adalah simulasi. Tidak ada payment gateway atau penjualan tiket sungguhan.

## Fitur utama

**Customer:** katalog dengan pencarian dan filter, registrasi/login, booking, pembayaran simulasi dengan batas waktu, riwayat pesanan, e-ticket ber-QR, favorit, profil, perubahan password, dan notifikasi.

**Admin:** manajemen konser dan kategori tiket, ringkasan statistik database, laporan pesanan dan payment, serta pemeriksaan QR/kode tiket satu kali pakai.

## Teknologi dan arsitektur

- Frontend: React 19, React Router, Vite, CSS.
- Backend: Node.js (ES modules), Express 5, PostgreSQL melalui `pg`.
- Authentication: password hashing `scrypt`, session token acak pada cookie HttpOnly; hanya hash token sesi yang disimpan di PostgreSQL.
- Payment/ticket: payment simulation; kode tiket acak dan QR, dengan validasi final di backend.
- Testing: Node.js Test Runner, backend dan frontend.

Frontend mengirim request `/api` dengan cookie. Saat development Vite meneruskan `/api` ke backend lokal. Production API origin dapat diatur melalui `VITE_API_BASE_URL`. Backend memeriksa sesi dan role untuk endpoint privat; ownership data diperiksa di backend.

## Struktur repository

```text
backend/
  database/migrations/   Migration SQL bernomor 001–009
  scripts/migrate.js     Runner migration dengan pemeriksaan target database
  src/routes/            API concert, auth, booking, payment, customer, admin, ticket
  src/middleware/        Auth, authorization, dan rate limiting
  tests/                 Backend tests
frontend/
  src/pages/              Halaman customer dan admin
  src/components/         Komponen UI
  src/services/api.js     API client
  tests/                  Frontend tests
docs/                     Setup, QA, deployment readiness, dan portfolio
```

## Persyaratan

- Node.js/npm yang mendukung versi dependency project.
- PostgreSQL untuk menjalankan alur aplikasi yang memerlukan persistence.

## Menyiapkan environment lokal

Jalankan perintah berikut dari root repository:

```powershell
npm --prefix backend ci
npm --prefix frontend ci
Copy-Item backend\.env.example backend\.env
```

Isi `backend/.env` hanya dengan konfigurasi database lokal yang kamu kelola. Backend menerima `DATABASE_URL` atau konfigurasi `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, dan `DB_PASSWORD`; koneksi remote memakai TLS dengan verifikasi sertifikat. `SESSION_COOKIE_SAME_SITE` default ke `lax`; gunakan `none` hanya untuk cross-site production dengan `FRONTEND_URL` HTTPS yang eksplisit. File `.env` bersifat lokal dan tidak boleh dimasukkan ke Git.

Frontend mengenali `VITE_API_BASE_URL`; jika kosong, API memakai path relatif `/api`. Pada development, Vite meneruskan request tersebut ke backend lokal. Jangan menaruh credential backend pada variabel frontend berawalan `VITE_`.

Untuk menyiapkan schema database lokal, baca [setup database](docs/database-setup.md) terlebih dahulu. Panduan menjalankan aplikasi dan test tersedia di [development lokal](docs/local-development.md). Jangan gunakan contoh lokal sebagai konfigurasi production.

## Menjalankan aplikasi

Jalankan kedua perintah berikut dari root repository pada terminal terpisah:

```powershell
npm --prefix backend run dev
```

```powershell
npm --prefix frontend run dev
```

Backend production entry point adalah `node src/server.js` (`npm start`). Server mendengarkan pada `0.0.0.0` menggunakan `PORT` atau default aplikasi. Endpoint health tersedia di `/api/health` dan `/api/health/db`.

## Database dan migration

Migration berurutan yang tersedia:

1. `001_create_users_roles.sql` — user, role, dan kepemilikan booking.
2. `002_create_user_sessions.sql` — sesi.
3. `003_concert_management.sql` — pengarsipan konser.
4. `004_ticket_category_inventory.sql` — inventory dan pengarsipan kategori tiket.
5. `005_create_payments.sql` — payment simulasi.
6. `006_create_digital_tickets.sql` — tiket digital.
7. `007_customer_experience.sql` — favorit dan notifikasi.
8. `008_rate_limits_and_ticket_backfill.sql` — counter shared rate limit PostgreSQL dan backfill awal tiket.
9. `009_reconcile_digital_tickets.sql` — melengkapi nomor tiket yang hilang dan memvalidasi jumlah/rentang tiket booking eligible.

Ketersediaan file tidak membuktikan migration telah diterapkan. Status lokal 001–007 pernah dilaporkan diterapkan tetapi belum diverifikasi saat ini; migration 008 dan 009 belum dijalankan atau diuji terhadap PostgreSQL nyata. Runner lokal dijalankan dari root dengan `npm --prefix backend run db:migrate`; perintah ini mengubah schema dan hanya mengizinkan target lokal tertentu. Jangan menjalankannya sebelum identitas database lokal dan dampak migration dipastikan. `backend/database/schema.sql` adalah bootstrap untuk tabel dasar; jangan menggabungkannya tanpa meninjau urutan migration. Lihat [setup database](docs/database-setup.md) untuk prasyarat, batas runner, dan rencana validasi staging.

## Testing dan pemeriksaan kualitas

```powershell
npm --prefix backend test
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
```

Test backend transaksi menggunakan test harness/mock dan tidak membuktikan integrasi PostgreSQL nyata. Belum ada browser E2E tooling di dependency project. Lihat [checklist QA manual](docs/manual-qa-checklist.md) untuk alur yang memerlukan browser dan database test aman.

## Dokumentasi

- [Setup database](docs/database-setup.md)
- [Development lokal](docs/local-development.md)
- [Skenario demo](docs/demo-scenario.md)
- [Checklist QA manual](docs/manual-qa-checklist.md)
- [Deployment readiness](docs/deployment-readiness.md)
- [Materi portofolio](docs/portfolio.md)

## Batasan dan status deployment

Payment tidak terhubung ke gateway nyata. Pemilihan kursi dan scan kamera perangkat bukan fitur yang dapat diklaim teruji. PostgreSQL integration/concurrency dan deployment production belum diverifikasi. Rate limiter memakai memory per proses di luar production; production menggunakan shared PostgreSQL limiter yang memerlukan migration 008. Konfigurasi source bukan bukti layanan production telah diuji.
