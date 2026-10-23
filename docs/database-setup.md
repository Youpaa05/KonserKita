# Panduan Setup Database

## Tujuan

Panduan ini menjelaskan cara menyiapkan PostgreSQL untuk KonserKita menggunakan file SQL yang tersedia di repository.

## File yang digunakan

- `backend/database/schema.sql`: tabel `concerts`, `ticket_categories`, dan `bookings`, beserta constraint dan indeks.
- `backend/database/seed.sql`: data awal enam konser beserta kategori tiket.

## 1. Siapkan database

Pastikan server PostgreSQL aktif dan kamu memiliki database serta akun yang diizinkan mengaksesnya.

Buat database melalui pgAdmin atau alat administrasi PostgreSQL yang biasa kamu gunakan. Nama database, username, dan password ditentukan oleh konfigurasi lokalmu.

Jangan mengirim password database ke chat atau menyimpannya di dokumentasi.

## 2. Konfigurasikan backend

Buat `backend/.env` berdasarkan `backend/.env.example`, lalu isi variabel yang sesuai dengan lingkungan lokal:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `PORT`
- `FRONTEND_URL`

Jangan menimpa `.env` yang sudah ada. Jangan menampilkan isi file tersebut pada log atau screenshot.

## 3. Jalankan skema

Dari root proyek, jalankan perintah berikut setelah mengganti placeholder dengan nama database dan username PostgreSQL milikmu:

```powershell
$PgUser = "username_postgres_milikmu"
$DbName = "nama_database_milikmu"
psql -U $PgUser -d $DbName -v ON_ERROR_STOP=1 -f ".\backend\database\schema.sql"
```

Jika `psql` tidak dikenali, gunakan SQL Query Tool di pgAdmin dan jalankan isi `schema.sql` pada database yang benar.

Periksa output untuk memastikan seluruh perintah selesai tanpa error.

## 4. Masukkan data awal

Jalankan seed hanya pada database pengembangan yang memang ingin diisi data contoh:

```powershell
$PgUser = "username_postgres_milikmu"
$DbName = "nama_database_milikmu"
psql -U $PgUser -d $DbName -v ON_ERROR_STOP=1 -f ".\backend\database\seed.sql"
```

Seed menggunakan `ON CONFLICT DO NOTHING` untuk konflik slug konser dan pasangan kategori-konser yang ditentukan dalam SQL. Ini bukan pengganti backup dan bukan jaminan bahwa seluruh data lama akan diperbarui.

Jangan menjalankan seed pada database yang datanya harus dipertahankan tanpa memahami dampaknya terlebih dahulu.

## 5. Verifikasi database

Setelah backend dijalankan, periksa endpoint `GET /api/health/db`. Respons HTTP 200 pernah diperoleh pada pengujian sebelumnya, tetapi hasil tersebut tidak membuktikan keadaan database saat ini.

Kamu juga dapat memeriksa keberadaan tabel melalui pgAdmin.

## Troubleshooting

- Koneksi ditolak: pastikan PostgreSQL aktif dan host serta port benar.
- Autentikasi gagal: periksa nama database, username, password, dan aturan akses PostgreSQL secara lokal.
- Database tidak ditemukan: buat database terlebih dahulu.
- Tabel tidak ditemukan: pastikan `schema.sql` dijalankan pada database yang sama dengan yang digunakan backend.
- Seed gagal: baca pesan PostgreSQL; jangan mengulang secara membabi buta jika tidak yakin perubahan yang sudah terjadi.

Jangan pernah menguji kegagalan database dengan membuat pesanan sungguhan atau mengubah kuota pada data yang harus dipertahankan.


