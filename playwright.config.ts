import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./backend/tests/browser",
  timeout: 30000, fullyParallel: false, workers: 1, retries: 0,
  reporter: "list", outputDir: ".local/playwright-results",
  use: { baseURL: "http://127.0.0.1:4173", channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true, screenshot: "only-on-failure", trace: "off" },
  projects: [
    { name: "375px", use: { viewport: { width: 375, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "390px", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "768px", use: { viewport: { width: 768, height: 1024 } } },
    { name: "1440px", use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: { command: "node --import tsx backend/scripts/browser-fixture.ts", url: "http://127.0.0.1:4173/healthz", reuseExistingServer: false, timeout: 30000 },
});
