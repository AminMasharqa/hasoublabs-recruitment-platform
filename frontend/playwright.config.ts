import { defineConfig, devices } from '@playwright/test'

// End-to-end and accessibility runner (Requirement 1 AC12, Requirement 20 AC13).
// Journeys run against a served Web_Client bundle and a running Backend_Api.
const port = Number(process.env.E2E_PORT ?? 5173)
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`
const isCI = Boolean(process.env.CI)
// The Web_Client this config starts must call the same Backend_Api the journeys'
// own API helpers do (e2e/support/backend.ts). There is no dev proxy, so without
// this the bundle falls back to a relative /api/v1 and every request reaches Vite.
// An explicit VITE_API_BASE_URL still wins. The a11y mocks match any host.
const apiBaseUrl =
  process.env.VITE_API_BASE_URL ?? process.env.E2E_API_BASE_URL ?? 'http://localhost:8000/api/v1'

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.(spec|test)\.ts/,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL,
    locale: 'en',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 120_000,
        env: { VITE_API_BASE_URL: apiBaseUrl },
      },
})
