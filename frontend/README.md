# KonserKita frontend

Frontend KonserKita menggunakan React, React Router, dan Vite. Setup lengkap, konfigurasi API, backend, serta database lokal dijelaskan di [README repository](../README.md) dan [panduan development lokal](../docs/local-development.md).

## Menjalankan pemeriksaan frontend

Jalankan dari folder repository:

```powershell
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
```

Untuk development, jalankan `npm --prefix frontend run dev`. Secara default, request `/api` diteruskan ke backend lokal oleh konfigurasi Vite. `VITE_API_BASE_URL` dapat dipakai untuk menentukan API origin; jangan menaruh rahasia backend pada variabel yang diawali `VITE_` karena nilainya masuk ke bundle browser.
