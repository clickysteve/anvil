import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  // the live-audio verification records in real time: on CI, one test at a time
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4321',
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'node e2e/serve.mjs',
    port: 4321,
    reuseExistingServer: !process.env.CI,
  },
});
