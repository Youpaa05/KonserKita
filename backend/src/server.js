
import "dotenv/config";
import app from "./app.js";
import { pool } from "./config/database.js";

const PORT = Number(process.env.PORT) || 3000;

const server = app.listen(PORT, () => {
  console.log(`KonserKita API berjalan di http://localhost:${PORT}`);
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;

  shuttingDown = true;
  console.log(`${signal} diterima. Menghentikan server...`);

  server.close(async (error) => {
    try {
      await pool.end();
    } catch (dbError) {
      console.error("Gagal menutup koneksi database:", dbError.message);
      process.exitCode = 1;
    }

    if (error) {
      console.error("Gagal menghentikan server:", error.message);
      process.exitCode = 1;
    }

    process.exit();
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
