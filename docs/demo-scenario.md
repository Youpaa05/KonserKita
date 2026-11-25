# Skenario demo KonserKita

Panduan ini menunjukkan pemeriksaan aplikasi pada lingkungan lokal terisolasi. Jangan memakai production atau database yang datanya perlu dipertahankan.

## Persiapan aman

1. Jalankan aplikasi lokal dan gunakan PostgreSQL test/development yang sudah dipastikan aman serta memiliki schema yang kompatibel.
2. Jika schema/migration belum disiapkan, hentikan sebelum membuat akun atau booking. Jangan menjalankan migration hanya demi demo sebelum memastikan target DB dan dampak.
3. Gunakan akun customer/admin test yang disiapkan secara lokal. Jangan menulis credential demo ke dokumentasi atau screenshot.
4. Pastikan /api/health berfungsi. Pemeriksaan database dan status migration harus mengikuti panduan setup database.

## Alur customer

1. Mulai di Home; konser pilihan dimuat dari API.
2. Buka katalog, coba pencarian/filter, dan buka detail konser.
3. Daftar/login dengan akun test, lalu coba favorit dan profil jika sesuai demo.
4. Pilih kategori dan jumlah tiket yang tersedia, lalu buat booking pada database test.
5. Catat kode booking secara lokal untuk demo singkat saja. Jangan unggah kode aktif ke portfolio.
6. Buka halaman pembayaran. Secara default simulasi dinonaktifkan dan percobaan pembayaran ditolak tanpa mengubah booking/payment atau menerbitkan tiket. Untuk demo lokal saja, simulasi dapat diaktifkan secara eksplisit dengan `PAYMENT_SIMULATION_ENABLED=true` pada `NODE_ENV=development`; hasilnya tetap simulasi tanpa dana nyata. Pastikan memakai database test terisolasi sebelum mengaktifkannya.
7. Buka tiket, tunjukkan QR. QR memuat kode tiket acak; hanya backend yang memutuskan tiket valid.

## Alur admin

1. Login sebagai admin test.
2. Buka dashboard, laporan pesanan, dan laporan pembayaran; jelaskan metrik berasal dari endpoint database.
3. Masukkan kode tiket test pada halaman pemeriksaan tiket. Validasi pertama menandai tiket used.
4. Coba kode yang sama kembali; backend harus menolak pemakaian ulang.

## Cleanup dan bukti

Jangan menjalankan cleanup destruktif otomatis. Setelah demo, hapus fixture/test data hanya melalui prosedur database test yang telah ditinjau oleh pemilik environment. Jangan lakukan cleanup di database bersama/production.

Untuk screenshot, gunakan data sintetis dan sembunyikan email, nama nyata, booking code aktif, token, dan detail environment. Simpan hasil di lokasi dokumentasi yang disetujui. Jangan membuat mockup dan mengklaimnya sebagai screenshot aplikasi yang berjalan.

Jika database test, akun admin, browser automation, atau perangkat QR tidak tersedia, tandai alur yang terkait NOT RUN. Lihat checklist QA manual.
