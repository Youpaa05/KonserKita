# Skenario Demo KonserKita

## Tujuan

Memeriksa alur antarmuka dari halaman awal hingga konfirmasi pesanan tanpa menganggap demo sebagai transaksi nyata.

## Persiapan

1. Jalankan PostgreSQL dan backend.
2. Jalankan frontend.
3. Pastikan endpoint kesehatan API dan database dapat diakses.
4. Gunakan lingkungan lokal dan data contoh yang sudah disiapkan.
5. Jangan menjalankan skenario pembuatan pesanan jika database menggunakan kuota yang harus dipertahankan.

## Alur pemeriksaan antarmuka

1. Buka halaman awal dan pastikan layout tampil.
2. Buka daftar konser dan periksa daftar acara.
3. Pilih salah satu konser untuk membuka halaman detail.
4. Periksa informasi acara dan kategori tiket yang ditampilkan.
5. Periksa validasi formulir pemesanan tanpa mengirim pesanan.
6. Buka halaman pencarian status pesanan dan periksa validasi format kode.
7. Gunakan kode pengujian yang sudah tersedia jika ada untuk memeriksa tampilan hasil pencarian.
8. Periksa halaman 404 melalui URL yang tidak tersedia.
9. Periksa tampilan desktop dan mobile serta console browser.

## Konfirmasi pesanan

Untuk menguji konfirmasi end-to-end, gunakan database pengujian terpisah dengan data yang boleh diubah. Catat kode pesanan yang dikembalikan server dan cocokkan dengan tampilan konfirmasi serta hasil lookup.

Jangan mengarang kode pesanan, menyatakan pembayaran berhasil, atau menganggap pesanan nyata telah dibuat tanpa bukti dari server.

## Bukti hasil demo

Catat untuk setiap langkah:

- Status PASS, FAIL, atau NOT RUN.
- Langkah yang dijalankan.
- Hasil yang terlihat.
- Error browser atau backend jika ada.
- Apakah database pengujian terpisah digunakan.

Jika tidak ada database pengujian terpisah, tandai pengujian pembuatan pesanan sebagai NOT RUN.
