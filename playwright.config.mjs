import { defineConfig, devices } from '@playwright/test'

// Isolated UI E2E: neither auth nor API points to production.
// No credentials and no operational data are required or sent.
const baseURL = 'http://127.0.0.1:4178'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 20_000,
  },
  projects: [
    { name: 'chromium-desktop', testMatch: '**/*.desktop.spec.mjs',
      use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', testMatch: '**/*.mobile.spec.mjs',
      use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4178 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: 'https://sgq-auth.qa.invalid',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sgq-synthetic-test-key',
      VITE_API_URL: 'https://sgq-api.qa.invalid',
    },
  },
})
