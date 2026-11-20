# Checklist QA manual KonserKita

Gunakan hanya server lokal dan database test yang jelas identitasnya serta boleh diubah. Catat hasil, browser/viewport, waktu, dan apakah database PostgreSQL nyata atau mock. Jangan menyalin email/customer data atau kode tiket ke bukti publik.

## UI dan aksesibilitas

Periksa dengan DevTools responsive mode pada 1440 px, 768 px, 390 px, dan 320 px:

- [ ] Header/menu, hero, katalog, dashboard, tabel admin dan filter tidak terpotong.
- [ ] Menu navigasi dapat dibuka/ditutup dan semua link tetap terlihat di mobile/tablet.
- [ ] Tidak ada page-level horizontal overflow; tabel lebar boleh di-scroll dalam wadahnya.
- [ ] Tab/Shift+Tab mencapai navigasi, form, tombol, pagination, dan aksi; focus ring terlihat.
- [ ] Enter mengaktifkan link/tombol; zoom 200% dan reduced-motion diperiksa.
- [ ] Link “Lewati ke konten utama” tampak saat fokus dan menuju main content.
- [ ] Error/loading/status dapat diumumkan; label terhubung ke input; gambar bermakna memiliki alt.
- [ ] Kontras teks, placeholder, batas input, focus ring, dan status diverifikasi dengan alat kontras.

## Customer dan alur pesanan

Gunakan database fixture/test atau akun yang boleh dibuat dan diubah. Jangan gunakan akun nyata.

- [ ] Registrasi input valid; email/password invalid mendapat feedback.
- [ ] Login, muat ulang halaman privat, logout, lalu akses ulang halaman privat.
- [ ] Cari konser dengan kata, kategori, lokasi, tanggal, availability, sorting, dan pagination.
- [ ] Buka detail, pilih kategori/quantity tersedia, dan buat booking pada fixture.
- [ ] Booking pending membuat payment pending dan mengurangi kuota sebanyak quantity.
- [ ] Simulasikan success: payment paid, booking confirmed, tiket dan QR tampil.
- [ ] Customer berbeda tidak dapat membuka tiket customer lain.
- [ ] Simulasikan failure/expiry pada fixture: status dan pemulihan kuota tepat.
- [ ] Cek booking guest menggunakan kode yang valid; jangan bagikan kode tersebut.
- [ ] Tambah/hapus favorit dan verifikasi ownership.
- [ ] Update profil; password saat ini salah ditolak, perubahan valid mencabut sesi sesuai kebijakan.
- [ ] Baca notifikasi, tandai dibaca, dan cek jumlah unread.

## Admin dan keamanan akses

- [ ] Guest ditolak dari dashboard, laporan, manajemen konser, dan validasi tiket.
- [ ] Customer ditolak dari seluruh halaman dan endpoint admin.
- [ ] Dashboard memakai angka database; booking dan quantity tiket dibedakan, nominal hanya payment paid.
- [ ] Filter order/payment, tanggal, sorting, dan pagination menghasilkan data sesuai.
- [ ] Report tidak mengirim hash password, session token, atau field internal sensitif.
- [ ] Validasi tiket terbit berhasil satu kali; validasi ulang ditolak.
- [ ] Kode tiket tak dikenal ditolak tanpa mengubah status tiket.
- [ ] Rate limit ditinjau di test environment, bukan dengan membebani layanan eksternal.

## Regression dan bukti

- [ ] Jalankan backend tests, frontend tests, lint, dan build sesuai README.
- [ ] Migration hanya diverifikasi setelah target test aman dipastikan; runner mengubah schema.
- [ ] PG integration/concurrency mencatat identitas DB secara aman, fixture, dan cleanup non-destruktif.
- [ ] Scan QR fisik hanya jika kamera, browser secure context, dan perangkat tersedia. QR image bukan bukti scan kamera.

| Alur | Hasil (PASS/FAIL/NOT RUN) | Browser/DB | Catatan tanpa data pribadi |
|---|---|---|---|
| UI keyboard/mobile |  |  |  |
| Customer booking/payment/ticket |  |  |  |
| Admin reporting/validation |  |  |  |
| PostgreSQL integration/concurrency |  |  |  |
| QR camera |  |  |  |
