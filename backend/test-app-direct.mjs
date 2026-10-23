import app from "./src/app.js";

const server = app.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    for (const path of [
      "/api/health",
      "/api/concerts",
      "/api/concerts/symphony-of-lights",
      "/api/concerts/symphony-of-lights/ticket-categories",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      const body = await response.text();

      console.log(`\n${response.status} ${path}`);
      console.log(body.slice(0, 700));
    }
  } catch (error) {
    console.error("Pengujian gagal:", error.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
