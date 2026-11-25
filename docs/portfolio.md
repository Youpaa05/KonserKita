# KonserKita — materi portofolio

## Ringkasan proyek

KonserKita adalah platform web untuk menemukan konser, mengelola pemesanan tiket, serta menyediakan perangkat administrasi dan validasi tiket.

## Masalah dan pengguna

Customer dapat mencari konser, membuat dan meninjau pesanan, serta mengakses tiket QR yang validitasnya diperiksa oleh backend. Admin mengelola acara, meninjau laporan, dan memeriksa tiket.

## Fitur yang dapat didemokan

- Katalog konser, pencarian, filter, detail, dan kategori tiket.
- Authentication berbasis session untuk role customer/admin.
- Booking dengan pengurangan kuota dalam transaksi database.
- Pemantauan status pembayaran dan expiry; pembayaran online belum tersedia karena payment gateway belum terhubung.
- E-ticket dengan kode acak dan QR; server memvalidasi dan menolak pemakaian ulang.
- Favorit, profil, perubahan password, dan notifikasi aplikasi.
- Dashboard dan laporan admin berbasis database.

## Teknologi dan arsitektur

- **React + Vite:** UI modular dan build statis.
- **Express:** API HTTP dengan middleware auth/role.
- **PostgreSQL:** transaksi, foreign key, constraint, locking, dan agregasi.
- **Node.js Test Runner:** backend dan frontend tests tanpa framework test besar tambahan.

React Router merender halaman customer/admin dan API client mengirim request `/api` (atau `VITE_API_BASE_URL`). Express memvalidasi payload, sesi, role, dan ownership sebelum mengakses PostgreSQL melalui `pg`. Migration bernomor mengembangkan schema. QR berisi kode tiket acak, tetapi backend tetap menentukan validitas.

```text
Browser (React)
  └── HTTP + HttpOnly session cookie
      └── Express routes / middleware
          └── PostgreSQL (users, concerts, bookings, payments, tickets, notifications)
```

## Alur booking, payment, tiket

1. Customer/guest memilih konser, kategori, dan jumlah tiket.
2. Backend membuat booking dan payment pending serta mengurangi kuota dalam transaksi.
3. Halaman payment menampilkan status dan instruksi yang tersedia; tidak ada pembayaran sungguhan atau gateway terhubung.
4. Tiket hanya tersedia untuk booking yang memenuhi status pembayaran yang tercatat di database.
5. QR berisi kode acak; endpoint admin memeriksa dan menandai tiket used secara atomik.

Pembayaran bukan gateway atau transaksi sungguhan.

## Keamanan dan tantangan teknis

Password di-hash, cookie sesi HttpOnly, role/ownership checks di backend, parameterized SQL, transaksi dan row locking pada operasi penting, rate limiting in-memory di luar production dan PostgreSQL shared limiter pada production, serta validasi tiket satu kali pakai.

Tantangan yang dapat dijelaskan: menjaga kuota saat booking dibatalkan/expiry; mencegah race payment expiry dan scan tiket; menghindari double counting report akibat JOIN; serta membedakan test mock dari integrasi PostgreSQL nyata.

## Batasan dan pengembangan berikutnya

- Tidak ada gateway/settlement. Simulasi dapat diaktifkan secara eksplisit hanya pada development; konfigurasi default dan production menolak mutasi pembayaran. Simulasi bukan transaksi dana.
- Status migration pada database lokal/staging/production tidak diverifikasi dalam batch ini. Keberadaan file migration tidak membuktikan migration sudah diterapkan; verifikasi target harus dilakukan dengan prosedur read-only yang aman sebelum demo yang memakai database tersebut.
- PostgreSQL integration/concurrency dan browser E2E belum dijalankan pada lingkungan terisolasi.
- QR camera fisik belum diuji.
- Rate limiter production memakai PostgreSQL shared limiter, tetapi belum diuji lintas instance; konfigurasi development memakai in-memory limiter.
- Production deployment belum dilakukan; masih perlu validasi migration pada staging terisolasi, secret management, backup/recovery, dan verifikasi deployment.

## Screenshot

Belum ada screenshot browser aktual yang diverifikasi. Ambil screenshot hanya dari lingkungan lokal terisolasi dan data uji; jangan tampilkan email nyata, credential, token, booking code aktif, atau data rahasia. Ikuti [checklist QA](manual-qa-checklist.md).
