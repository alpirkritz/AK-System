import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 90_000,
  reporter: 'html',
  use: {
    // Port 3002 — 3000=web dev, 3001=whatsapp-bridge
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3002',
    trace: 'on-first-retry',
    locale: 'he-IL',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3002',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: process.env.PORT ?? '3002',
      DATABASE_PATH: './data/e2e.sqlite',
    },
  },
})
