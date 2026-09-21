import { defineConfig, devices } from '@playwright/test';

// The e2e suite drives the real built page in a local Chromium.
//  - locally (`npm run test:e2e`) it builds the bundle and serves it with
//    `vite preview`;
//  - in the Compose `verify` service E2E_BASE_URL points at the already running
//    nginx app container over an internal-only network, so no local server is
//    started and nothing can reach the internet.
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    launchOptions: {
      // In the offline verification image Chromium runs unprivileged inside a
      // container; --no-sandbox is required there and harmless locally.
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      // PW_CHROMIUM_PATH lets the environment pin a specific binary (e.g. the
      // headless shell provisioned without system package access).
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    },
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173',
        url: 'http://127.0.0.1:4173/',
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
