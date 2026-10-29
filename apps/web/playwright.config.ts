import { defineConfig, devices } from "@playwright/test";

const port = 4323;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "es-ES",
    javaScriptEnabled: false,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Playwright's frozen WebKit build for macOS 12 is incompatible with
    // recent Playwright releases. Enable this project on a newer macOS.
    ...(process.env.PLAYWRIGHT_WEBKIT === "1"
      ? [{ name: "webkit", use: { ...devices["Desktop Safari"] } }]
      : []),
  ],
  webServer: {
    command: "pnpm build && node ./dist/server/entry.mjs",
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { HOST: "127.0.0.1", PORT: String(port) },
    stdout: "ignore",
    stderr: "pipe",
  },
});
