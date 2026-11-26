# Setup dan verifikasi database

## Ruang lingkup dan keselamatan

Dokumen ini menjelaskan bootstrap schema, migration yang tersedia di repository, dan persiapan sebelum migration production. Membaca atau mengikuti bagian persiapan tidak membuktikan bahwa schema database tertentu cocok dengan source.

- Gunakan database lokal khusus development/testing; jangan bereksperimen pada production atau database berisi data penting.
- Bootstrap, seed, dan migration dapat mengubah schema atau data.
- Jangan menjalankan reset, truncate, drop, seed, atau migration tanpa meninjau SQL, memastikan target, dan menyiapkan pemulihan.

## Bootstrap schema dan migration 001–012

Database disiapkan dalam dua tahap:

1. `backend/database/schema.sql` adalah bootstrap untuk tabel dasar `concerts`, `ticket_categories`, dan `bookings`. Migration 001–012 mengasumsikan tabel dasar ini sudah tersedia; rangkaian migration bukan bootstrap penuh untuk database kosong.
2. `backend/database/migrations/001`–`012` memperluas schema secara berurutan:

   - `001`: membuat `roles` dan `users`, menambahkan `bookings.user_id` nullable dan foreign key kepemilikan booking, serta memasukkan role customer/admin.
   - `002`: membuat `user_sessions` untuk hash token sesi, masa berlaku, pencabutan sesi, dan index terkait.
   - `003`: menambahkan `concerts.archived_at` dan index pengarsipan konser.
   - `004`: menambahkan `ticket_categories.archived_at` dan index kategori aktif/arsip.
   - `005`: membuat `payments` dan mengisi payment untuk booking yang sudah ada. Status `confirmed` dipetakan ke `paid`, `cancelled` ke `failed`, dan status lainnya ke `pending`; expiry awal dihitung dari waktu pembuatan booking.
   - `006`: membuat tabel `digital_tickets` beserta constraint kode tiket, nomor tiket per booking, status, dan waktu penggunaan. Migration ini membuat tabel; backfill tiket booking lama terdapat di migration 008.
   - `007`: membuat tabel favorit konser dan notifikasi customer.
   - `008`: membuat tabel `api_rate_limit_buckets` untuk counter shared rate limiting dan mencoba mengisi tiket digital yang belum tersedia untuk booking eligible.
   - `009`: mengunci booking eligible, merekonsiliasi tiket yang kurang, dan menggagalkan transaksi jika ditemukan data lintas status yang tidak konsisten, tiket di luar rentang, konflik kode, atau hasil akhir yang tidak lengkap.
   - `010`: menambahkan waktu/alasan pembatalan konser, constraint konsistensi, dan index; relasi booking, payment, serta tiket tidak dihapus.
   - `011`: membuat histori transisi payment mendatang dan audit perubahan role admin; histori lama tidak direka ulang.
   - `012`: mengubah `user_sessions.user_id` menjadi `BIGINT`, menyamakan kapasitasnya dengan `users.id`, dan mempertahankan foreign key `ON DELETE CASCADE`.

Migration 002 memakai `INTEGER` untuk `user_sessions.user_id`, sedangkan `users.id` pada migration 001 bertipe `BIGINT`. Migration 002 dipertahankan tanpa perubahan agar checksum database yang sudah mencatat migration lama tetap valid. Migration 012 memperbaiki tipe tersebut secara aditif: melepas FK yang ada, melebarkan kolom tanpa kehilangan nilai, lalu memasang kembali FK dengan perilaku `ON DELETE CASCADE`. Engine menjalankan setiap migration dalam transaksi; perubahan ini belum diuji pada PostgreSQL nyata.

### Migration 008: rate limit dan backfill tiket

`api_rate_limit_buckets` menyimpan scope, hash identitas, awal window, waktu reset, dan jumlah request. Source production memakai tabel PostgreSQL tersebut untuk menyimpan counter bersama antar-instance. Identitas di-HMAC menggunakan `RATE_LIMIT_SECRET`.

Backfill awal tiket pada migration 008 memilih booking yang berstatus `confirmed` dan payment-nya berstatus `paid`. Untuk setiap booking, SQL membentuk kandidat nomor dari 1 sampai kuantitas booking dan mengecualikan nomor yang sudah tercatat. Namun, `ON CONFLICT DO NOTHING` yang tidak menyebut constraint dapat mengabaikan konflik `ticket_code`, dan migration 008 tidak memvalidasi jumlah akhir atau menolak tiket bernomor di luar kuantitas.

Migration 008 dipertahankan tanpa perubahan agar checksum dan riwayat versi tetap utuh. Migration 009 menambahkan validasi dan rekonsiliasi dalam migration baru:

- Hanya pasangan `bookings.status = 'confirmed'` dan `payments.status = 'paid'` yang menerima tiket.
- Pasangan booking/payment yang hilang atau memiliki status lintas tabel yang tidak sesuai dihentikan dengan diagnostik. Migration tidak mengubah status booking maupun payment; kondisi tersebut perlu rekonsiliasi manual.
- Baris booking eligible yang masih memiliki nomor tiket hilang dikunci dengan `FOR UPDATE` menurut ID booking. Booking adalah lock bersama pada payment transition dan penerbitan tiket aplikasi; mengunci hanya booking yang perlu diperbaiki mengurangi lock contention dan menghindari migration mengambil lock payment/ticket dengan urutan yang berpotensi deadlock. Tiket bernomor di luar `1..quantity` tidak dihapus atau diubah; kondisi itu menggagalkan migration.
- Migration mengisi nomor yang benar-benar belum tersedia dengan konflik target `(booking_id, ticket_number)`. Konflik `ticket_code` tidak diabaikan dan menggagalkan transaksi.
- Pemeriksaan akhir memastikan jumlah row dan nomor berbeda tepat `quantity`, serta rentang nomor adalah `1..quantity`. Kegagalan melempar error agar transaksi migration rollback.
- Ticket yang sudah ada, termasuk status `used`, tidak diubah. Booking/payment non-eligible tidak menerima tiket.

Validasi ini menjamin kondisi yang diperiksa oleh migration, bukan bukti data aktual pada target. Migration 008 tidak aman dijalankan ulang langsung karena membuat tabel/index tanpa `IF NOT EXISTS`. Migration 009 mengisi nomor yang kurang dan memvalidasi keadaan akhir, tetapi tetap harus diterapkan melalui runner agar tracking versi/checksum konsisten; jangan menjalankannya manual untuk melewati riwayat migration.

Migration 008 menggunakan `gen_random_uuid()` dan `generate_series()`; pastikan versi PostgreSQL target mendukung fungsi tersebut saat menyiapkan pengujian.

`backend/database/seed.sql` berisi data demo dan bukan bagian dari migration. Tinjau data seed secara terpisah sebelum menggunakannya.

## Database lokal

Untuk database lokal baru, tinjau `backend/database/schema.sql` dan terapkan sebagai bootstrap satu kali pada database kosong. Jika membutuhkan data demo, tinjau `backend/database/seed.sql` secara terpisah.

Runner lokal terdaftar pada script `db:migrate` di `backend/package.json`:

```powershell
npm --prefix backend run db:migrate
```

Perintah tersebut **mengubah database** dan bukan pemeriksaan status read-only. Jangan jalankan pada target yang belum dipastikan khusus untuk development/testing. Jangan mengulang bootstrap atau seed pada database yang sudah berisi schema/data tanpa peninjauan dan backup yang sesuai.

`backend/scripts/migrate.js` membatasi target pada database `konserkita_db`, user `postgres`, port `5432`, alamat loopback IPv4/IPv6, dan koneksi read-write. Runner memakai advisory lock dan tabel `schema_migrations`, lalu memeriksa nama file serta checksum migration. Guard ini ditujukan untuk database lokal dan menolak server remote; jangan mengubah atau melewatinya untuk mengarah ke Neon.

Untuk Neon staging, tersedia runner terpisah `backend/scripts/migrate-neon.js` melalui `npm --prefix backend run db:migrate:neon`. Target KonserKitah dipatok ke project `silent-hat-21218854`, branch staging `br-quiet-river-bda1sb4d`, database `neondb`, dan pasangan hostname pooled/direct yang di-allowlist secara exact. Hostname pooler hanya mengidentifikasi target; koneksi migrasi memakai direct endpoint dengan TLS terverifikasi. Host sembarang, suffix palsu, dan hostname staging Neon lama ditolak oleh runner baru; resource Neon lama tidak diubah atau dihapus. Sebelum migrasi pertama, verifikasi melalui Neon Console bahwa project ID, branch ID, database, serta pasangan endpoint tersebut benar-benar cocok. Runner tidak memanggil Neon untuk memverifikasi branch ID saat runtime. Runner tidak membaca `backend/.env`, mewajibkan role `neondb_owner`, memeriksa `USAGE` dan `CREATE` pada schema `public`, dan melacak baseline serta migration 001–012 dengan checksum.

Pemeriksaan bootstrap menggunakan inventaris terdefinisi atas schema `public` dan beberapa kategori objek aplikasi/database, termasuk relasi, routine, type, operator, object database-level, large object, dan privilege default. Ini bukan jaminan bahwa seluruh kategori katalog PostgreSQL/cluster kosong; keadaan tak dikenal harus diperiksa melalui prosedur read-only yang disetujui. Dua default ACL Neon diabaikan hanya jika owner, schema, jenis objek, dan ACL persis cocok dengan definisi di engine. Role/privilege aktual pada branch belum diverifikasi. Pastikan credential yang dipakai adalah role migrasi yang disetujui sebelum penggunaan.

Runner production terpisah tersedia melalui `backend/scripts/migrate-neon-production.js`, dengan allowlist serta konfirmasi eksplisit `NEON_PRODUCTION_MIGRATION_TARGET=production` yang terpisah dari konfirmasi staging. Allowlist-nya masih menunjuk ke infrastruktur Neon lama. Endpoint production KonserKitah belum diberikan atau dikonfigurasi; jangan gunakan runner production lama terhadap branch baru. Lihat [panduan Neon staging migrations](./neon-staging-migrations.md) untuk prosedur dan pemisahan target. Tidak satu pun runner tersebut dijalankan atau diverifikasi terhadap PostgreSQL nyata dalam audit ini.

### Data demo Neon Production

`backend/scripts/seed-neon-production.ps1` berisi mekanisme untuk menambahkan delapan konser fixture dan 24 kategori melalui transaksi pada target Production lama yang di-allowlist. Jangan menjalankan seed dalam pemulihan ini atau menganggap target tersebut sebagai branch production KonserKitah. Guard yang didokumentasikan untuk database, role, versi PostgreSQL, checksum baseline/migration 001–012, dan konflik bukan bukti bahwa role/privilege atau data target sudah diverifikasi; seed maupun pemeriksaan terhadap target tidak dijalankan di sini. Keberadaan fixture bukan bukti bahwa data tersebut layak untuk katalog produk.

## Status migration

- Migration 001–007 **pernah dilaporkan telah diterapkan pada database lokal**, tetapi status database saat ini tidak diverifikasi dalam dokumentasi ini. Laporan sebelumnya bukan bukti bahwa database lokal sekarang memiliki schema yang cocok.
- Migration 008 tersedia di source tetapi **belum dijalankan**.
- Migration 009 tersedia di source tetapi **belum dijalankan atau diuji terhadap PostgreSQL nyata**.
- Migration 010–011 tersedia di source tetapi **belum dijalankan atau diuji pada database target**.
- Migration 012 ditambahkan untuk menyamakan tipe `user_sessions.user_id` dengan `users.id`; migration ini **belum dijalankan atau diuji pada PostgreSQL nyata**.
- Migration production **belum dijalankan atau diverifikasi**.
- Keberadaan file SQL atau tabel tracking tidak membuktikan bahwa migration telah diterapkan pada database yang dimaksud.

Dokumen ini tidak melakukan koneksi atau pemeriksaan terhadap database.

## Persiapan migration production (tanpa menjalankannya)

Repository menyediakan runner migration production Neon yang terpisah, tetapi runner tersebut masih dibatasi pada target infrastruktur lama dan memakai konfirmasi production tersendiri. Endpoint production KonserKitah belum dikonfigurasi. Jangan menggunakan runner lokal atau runner staging pada target production, dan jangan menggunakan runner production lama pada branch production KonserKitah.

Sebelum migration production dipertimbangkan:

1. Pastikan identitas database dan schema target melalui pemeriksaan read-only yang disetujui. Jika tabel `schema_migrations` tersedia, cocokkan riwayat versi, nama file, dan checksum dengan source; jangan menganggap tabel tersebut selalu ada.
2. Tinjau bootstrap dan urutan 001–012 terhadap schema serta data target. Perhatikan backfill payment pada 005, batasan backfill awal pada 008, precondition/validasi 009, perubahan pembatalan dan histori pada 010–011, serta pelebaran tipe user session pada 012.
3. Siapkan salinan staging PostgreSQL yang terisolasi dan dapat dipulihkan. Pastikan penulisan aplikasi tidak berjalan selama uji migration, jalankan prosedur migration yang disetujui untuk lingkungan tersebut, lalu verifikasi jumlah dan rentang tiket per booking eligible.
4. Uji kasus booking tanpa tiket, tiket lengkap, nomor hilang, nomor ekstra, konflik kode, payment/status tidak eligible, status tiket `used`, serta rollback saat validasi gagal. Jangan menganggap mock/static test membuktikan perilaku SQL atau concurrency PostgreSQL.
5. Pastikan PostgreSQL target mendukung fungsi yang digunakan migration 008, termasuk `gen_random_uuid()` dan `generate_series()`.
6. Siapkan backup yang dapat dipulihkan, rencana pemulihan, pemantauan, persetujuan perubahan, dan jadwal yang sesuai.
7. Tentukan prosedur production yang disetujui sebelum penggunaan. Repository menyediakan runner production Neon dengan allowlist yang masih terikat ke infrastruktur lama; endpoint KonserKitah production belum diverifikasi atau dikonfigurasi. Jangan arahkan atau jalankan runner tersebut pada target baru sebelum identitas endpoint diberikan, diverifikasi, dan ditinjau.

Langkah di atas adalah checklist persiapan, bukan instruksi untuk menjalankan migration dan bukan bukti bahwa migration aman atau sudah diterapkan.

## Environment database dan limiter

Backend menerima `DATABASE_URL` atau konfigurasi terpisah `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, dan `DB_PASSWORD`.

- Pada konfigurasi `DB_*`, `DB_NAME`, `DB_USER`, dan `DB_PASSWORD` wajib; source memberi default `localhost` dan port `5432` untuk host/port yang tidak diatur.
- Koneksi `DB_*` ke loopback memakai koneksi lokal tanpa TLS secara default pada development. Koneksi `DB_*` ke host remote memakai TLS dengan verifikasi sertifikat secara default.
- `DATABASE_URL` juga memakai TLS terverifikasi secara default. Jika diperlukan, `DATABASE_SSL_CA` menerima PEM CA tepercaya untuk kedua jalur konfigurasi.
- `DATABASE_SSL` hanya menerima `true` atau `false`. `false` diabaikan pada production dan ditolak untuk host remote; pada non-production, nilai itu hanya dapat mematikan TLS untuk database lokal. `DATABASE_SSL=true` mengaktifkan TLS terverifikasi, termasuk koneksi lokal.
- Untuk Neon dan database remote lain, gunakan TLS terverifikasi. Source code menyediakan konfigurasi tersebut, tetapi koneksi TLS ke Neon belum dibuktikan melalui koneksi runtime pada lingkungan staging.
- Di development, limiter menggunakan `Map` in-memory; counter tidak dibagi antar-process dan hilang saat proses dimulai ulang.
- Saat `NODE_ENV=production`, limiter memakai PostgreSQL dan membutuhkan tabel `api_rate_limit_buckets` dari migration 008.
- Saat `NODE_ENV=production`, `RATE_LIMIT_SECRET` wajib tersedia dan minimal 32 byte. Source melempar error saat konfigurasi tidak memenuhi syarat. Gunakan secret acak dari environment yang disetujui; jangan menaruh nilainya di repository atau variabel frontend `VITE_*`.

Lihat `backend/.env.example` untuk nama variabel lokal. Contoh tersebut sengaja tidak berisi nilai secret production.

## Expiry booking dan pengembalian kuota

Payment baru memiliki masa berlaku 15 menit. GET payment dan Netlify Scheduled Function `backend/netlify/functions/expire-bookings.js` memproses expiry. Payment attempt tidak mengubah status karena payment gateway belum tersedia.

Pembersihan memproses paling banyak 100 booking per batch dan lima batch per invocation. Dalam satu transaksi, source mengunci payment serta booking yang masih `pending` dan sudah kedaluwarsa dengan `FOR UPDATE ... SKIP LOCKED`, mengubah payment menjadi `expired`, membatalkan booking, lalu mengunci kategori tiket secara berurutan dan mengembalikan kuota. Perubahan status dan kuota di-commit bersama; kegagalan menyebabkan rollback. Payment `paid` dan booking yang sudah tidak `pending` tidak dipilih, dan riwayat transaksi tidak dihapus.

Netlify menyatakan [scheduled function](https://docs.netlify.com/build/functions/scheduled-functions/) hanya berjalan pada published deploy dan memiliki batas eksekusi 30 detik. Karena itu pembersihan memakai batch terbatas. Source dan test mock tidak membuktikan jadwal aktif pada site, keberhasilan koneksi production, atau concurrency PostgreSQL nyata. Verifikasi tersebut belum dilakukan. Implementasi ini tidak memerlukan migration baru.

## Pemeriksaan dan batas bukti

- `GET /api/health/db` hanya memeriksa koneksi dengan `SELECT 1`; endpoint ini tidak memverifikasi versi migration atau kecocokan schema.
- Backend test suite menggunakan mock/test harness; hasilnya bukan bukti bahwa SQL berjalan pada PostgreSQL nyata atau bahwa concurrency production telah teruji.
- Jangan menggunakan runner migration sebagai pemeriksaan read-only karena runner dapat menerapkan migration.
