# Kesiapan Deployment KonserKita

Dokumen ini memisahkan konfigurasi yang ada di source dari hasil pengujian dan status production. Keberadaan konfigurasi tidak membuktikan deployment berjalan atau production siap.

## Implementasi yang tersedia di source

### Netlify dan Express Function

`netlify.toml` mengatur:

- Build command: `npm --prefix backend ci && npm --prefix frontend ci && npm --prefix frontend run build`.
- Publish directory: `frontend/dist`.
- Direktori Netlify Functions: `backend/netlify/functions`.
- Bundler: esbuild; `express` dikonfigurasi sebagai external module.
- Redirect `/api/*` ke `/.netlify/functions/api/:splat`.
- Fallback `/*` ke `/index.html` untuk SPA.
- `backend/netlify/functions/expire-bookings.js` adalah Scheduled Function setiap menit. Ia memproses expiry dalam batch terbatas dan menggunakan konfigurasi PostgreSQL yang sama. Scheduled Function hanya berjalan pada published deploy; eksekusi production belum diverifikasi.

`backend/netlify/functions/api.js` mengimpor Express app dan membungkusnya dengan `serverless-http`. Frontend membentuk request dari `VITE_API_BASE_URL` (kosong secara default) dan path `/api/...`; request menggunakan `credentials: "include"`. Untuk konfigurasi default, frontend dan API memakai origin Netlify yang sama.

Function API saat ini memakai handler Lambda-compatible melalui `serverless-http`. [Dokumentasi Netlify](https://docs.netlify.com/build/functions/lambda-compatibility/) menyatakan mode Lambda compatibility deprecated dan deploy dengan mode tersebut tidak diterima mulai 1 Juli 2027. Migrasi ke Netlify Functions API modern belum dilakukan.

### Security headers, CSP, CORS, dan session

- `netlify.toml` menetapkan Content-Security-Policy pada path `/*`; `backend/src/app.js` juga menetapkan policy pada response Express.
- Policy membatasi script ke `'self'`; tidak mengizinkan inline style; mengizinkan stylesheet/font Google yang ditentukan, gambar dari origin sendiri, `data:` dan HTTPS, serta koneksi same-origin dan HTTPS. Source frontend tidak menggunakan inline style pada saat perubahan ini. Jika menambahkan asset atau integrasi, uji kembali CSP.
- CORS Express mengizinkan satu origin dari `FRONTEND_URL` dan mengaktifkan credentials. Fallback `http://localhost:5173` hanya berlaku di non-production; aplikasi menolak startup production bila `FRONTEND_URL` tidak berupa origin HTTPS eksplisit atau berisi wildcard.
- `backend/src/middleware/trustedOrigin.js` membandingkan origin request dengan `FRONTEND_URL`. Route autentikasi memakai pemeriksaan Origin; `requireAuth` menerapkannya pada mutasi terautentikasi. Di production, mutasi terautentikasi menolak Origin yang hilang atau tidak cocok.
- Cookie sesi disetel `httpOnly`, `Path=/`, dan memiliki masa berlaku tujuh hari. Default `SameSite=Lax` mendukung origin yang sama dan deployment same-site; cookie menjadi `Secure` ketika `NODE_ENV=production` atau request secure. Express menetapkan HSTS saat `NODE_ENV=production`.
- Frontend dan API pada subdomain dengan registrable domain serta skema yang sama (misalnya `app.example.com` dan `api.example.com`) tetap same-site; `Lax` dapat dipertahankan dengan `credentials: include` dan CORS origin yang tepat. Untuk site berbeda (misalnya domain registrable berbeda), set `SESSION_COOKIE_SAME_SITE=none` hanya pada production, gunakan API/frontend HTTPS, dan set `FRONTEND_URL` ke satu origin frontend HTTPS yang eksplisit (tanpa wildcard atau path). CORS mengirim origin tersebut dengan credentials; `trustedOrigin` harus menggunakan nilai yang sama. Pengaturan `none` ditolak di development atau bila origin HTTPS eksplisit tidak tersedia. Default yang direkomendasikan tetap frontend dan API same-origin melalui Netlify.

### Environment variables yang dibaca source

Atur nilai deployment melalui Netlify Environment Variables yang sesuai. Jangan menyimpan secret di repository atau menaruhnya pada variabel `VITE_*`.

| Variabel | Penggunaan dan batas source |
|---|---|
| `DATABASE_URL` | URL PostgreSQL. Source memverifikasi sertifikat TLS secara default. Gunakan jalur ini untuk Neon. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Alternatif konfigurasi database terpisah. `DB_NAME`, `DB_USER`, dan `DB_PASSWORD` diwajibkan jika `DATABASE_URL` tidak digunakan. Host remote memakai TLS dengan verifikasi sertifikat; loopback lokal memakai non-TLS di development secara default. |
| `DATABASE_SSL` | Hanya menerima `true` atau `false`. TLS remote tidak dapat dimatikan; `false` hanya diizinkan untuk database lokal di luar production. Production selalu memverifikasi sertifikat. |
| `DATABASE_SSL_CA` | PEM CA tepercaya opsional untuk validasi sertifikat pada koneksi `DATABASE_URL` maupun `DB_*`. |
| `FRONTEND_URL` | Satu origin frontend tanpa path; dipakai untuk CORS dan pemeriksaan Origin. Wajib HTTPS, eksplisit, tanpa wildcard, dan cocok dengan origin aktual di production. |
| `SESSION_COOKIE_SAME_SITE` | Default `lax`. `none` hanya didukung pada production dengan `FRONTEND_URL` HTTPS eksplisit; cookie menjadi `Secure`. Jangan gunakan wildcard CORS. |
| `NODE_ENV` | Tetapkan `production` pada runtime production. Source menggunakannya untuk Secure cookie, HSTS, shared PostgreSQL rate limiter, dan pembatasan TLS. |
| `RATE_LIMIT_SECRET` | Kunci HMAC identitas rate limit. Wajib saat `NODE_ENV=production` dan harus minimal 32 byte. Jika tidak ada atau terlalu pendek, source melempar error. Simpan hanya sebagai secret environment. |
| `VITE_API_BASE_URL` | Prefix API opsional saat build frontend. Jika kosong, frontend memakai `/api` same-origin. Jika mengarah ke origin eksternal, nilai masuk ke bundle; koneksi harus HTTPS dan sesuai CSP/CORS. |
| `PORT` | Digunakan server Node lokal; konfigurasi Netlify Functions ini tidak memerlukannya. |

### Rate limiting

- Di development/non-production, `createRateLimiter` menggunakan `Map` di memory. Counter tidak dibagi antar-process dan hilang saat proses dimulai ulang.
- Saat `NODE_ENV=production`, limiter menggunakan tabel PostgreSQL `api_rate_limit_buckets`, dengan upsert counter berdasarkan scope, HMAC identitas, dan window.
- Tabel tersebut dibuat oleh migration 008; nilai `RATE_LIMIT_SECRET` yang sama diperlukan oleh semua instance agar hash identitas konsisten.
- Untuk request melalui `serverless-http`, limiter memilih IP yang valid dari source IP event/request adapter atau header Netlify `x-nf-client-connection-ip`; header tersebut hanya dipertimbangkan pada request yang memiliki event adapter. Di server Express lokal, source memakai `req.ip` atau socket peer dan mengabaikan `X-Forwarded-For`. Jika tidak ada alamat IP valid, rate-limited request ditolak dengan HTTP 503 alih-alih memakai satu bucket `unknown`.
- Source implementation ini belum membuktikan PostgreSQL production, kinerja multi-instance, atau keamanan concurrency pada target nyata. Tabel dan secret harus tersedia sebelum limiter production dapat berfungsi.
- Mapping IP pada event/header Netlify dan pengoperasian scheduled expiry belum diuji pada deployment aktual.

## Migration dan PostgreSQL

Bootstrap `backend/database/schema.sql` menyediakan tabel dasar `concerts`, `ticket_categories`, dan `bookings`. Migration 001–009 memperluas bootstrap tersebut:

| Migration | Perubahan utama |
|---|---|
| 001 | Roles/users dan relasi optional booking ke user. |
| 002 | Tabel session user. |
| 003–004 | Pengarsipan konser dan kategori tiket. |
| 005 | Tabel payment dan backfill payment untuk booking yang sudah ada. |
| 006 | Tabel digital ticket dan constraint-nya. |
| 007 | Favorit dan notifikasi customer. |
| 008 | Tabel shared rate limit PostgreSQL dan backfill awal ticket untuk booking `confirmed` dengan payment `paid` yang belum memiliki nomor tiket. |
| 009 | Mengunci booking eligible yang tiketnya kurang, melengkapi nomor yang hilang, dan memvalidasi rentang serta jumlah akhir tanpa mengubah status ticket yang sudah ada. |

Migration 008 tidak diubah agar riwayat/checksum tetap utuh. Backfill awalnya memakai `ON CONFLICT DO NOTHING` tanpa target konflik dan tidak memvalidasi jumlah akhir, sehingga dapat meninggalkan tiket yang kurang atau mempertahankan nomor ekstra. Migration 009 menangani rekonsiliasi tersebut: konflik ditargetkan hanya pada `(booking_id, ticket_number)`, konflik kode tiket menggagalkan transaksi, nomor di luar `1..quantity` menghentikan migration untuk rekonsiliasi manual, dan post-validation memeriksa jumlah serta rentang nomor.

Migration 009 juga menghentikan eksekusi jika booking tidak memiliki payment atau status booking/payment tidak selaras. Tidak ada status booking, payment, atau ticket yang otomatis diubah; status `used` tetap dipertahankan. Status lintas tabel yang tidak konsisten perlu ditinjau dan direkonsiliasi secara manual sebelum mencoba ulang.

Source SQL tidak membuktikan data target konsisten. Migration 009 belum dijalankan atau divalidasi pada PostgreSQL nyata. Jangan menganggapnya production-ready berdasarkan static/mock tests saja.

`backend/scripts/migrate.js` adalah runner lokal dengan target statis database `konserkita_db`, user `postgres`, port `5432`, loopback, dan read-write. Runner menolak server remote. Repository tidak menyediakan runner production untuk Neon; jangan mengubah guard lokal atau menggunakannya pada database remote.

### Persiapan production migration (tanpa menjalankannya)

Migration production **belum dijalankan atau diverifikasi**. Persiapan yang masih diperlukan:

1. Verifikasi identitas database dan schema secara read-only menggunakan prosedur yang disetujui.
2. Cocokkan riwayat migration, jika tersedia, dengan source dan checksum; tinjau asumsi bootstrap serta dampak backfill 005/008/009.
3. Siapkan clone PostgreSQL staging yang terisolasi, dengan snapshot yang dapat dipulihkan dan tanpa traffic penulisan aplikasi selama migration.
4. Uji pada clone: booking tanpa tiket, tiket lengkap, nomor hilang, nomor di luar kuantitas, konflik kode, status booking/payment tidak konsisten, payment non-paid, tiket `used`, dan rollback pasca-validasi. Verifikasi setiap booking eligible memiliki tepat nomor `1..quantity`.
5. Gunakan prosedur migration yang disetujui untuk target staging. Runner repository hanya mengizinkan PostgreSQL lokal; jangan mengubah guard atau menggunakannya pada Neon.
6. Siapkan backup yang dapat dipulihkan, rencana pemulihan, persetujuan, pemantauan, dan jadwal perubahan.
7. Tentukan prosedur/runner production yang disetujui di luar runner lokal repository ini.

Daftar tersebut bukan prosedur eksekusi, bukan jaminan aman, dan tidak menyatakan migration sudah diterapkan. Jangan menjalankan migration production hanya berdasarkan dokumen ini.

## Status verifikasi

### Source implementation

Konfigurasi Netlify/Function, CSP, CORS, Origin validation, session cookie, serta pilihan limiter production PostgreSQL tersedia di source. Migration 001–009 tersedia sebagai file SQL.

### Local testing

Migration 001–007 pernah dilaporkan telah diterapkan pada database lokal, tetapi status saat ini belum diverifikasi. Migration 008 **belum dijalankan**; migration 009 **belum dijalankan atau diuji pada PostgreSQL nyata**. Test static/mock bukan bukti integrasi PostgreSQL nyata atau pengujian concurrency.

### Production verification

Deployment Netlify production, nilai environment production, status migration production, koneksi PostgreSQL/Neon dari Function, backfill, perilaku rate limiter multi-instance, mapping IP Netlify, scheduled expiry, CSP pada deployment, dan backup/pemulihan **belum dijalankan atau diverifikasi**.

## Kesimpulan

**KonserKita belum dinyatakan siap deploy ke production.** Source memuat konfigurasi deployment dan security terkait, tetapi production migration dan verifikasi Netlify/Neon belum dilakukan. Jangan menganggap source implementation sebagai bukti kesiapan production.
