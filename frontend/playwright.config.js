import { defineConfig } from "@playwright/test";
import process from "node:process";

const chromePath = process.env.PLAYWRIGHT_CHROME_PATH ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "./artifacts/batch08/playwright-results",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:5173",
    browserName: "chromium",
    headless: true,
    launchOptions: { executablePath: chromePath },
    screenshot: "off",
    trace: "off",
  },
});
