import { defineConfig, devices } from '@playwright/test';

/**
 * MediLink — Playwright Test Configuration
 * Run: npx playwright test
 * Run specific suite: npx playwright test tests/regression/auth.spec.js
 * Run headed: npx playwright test --headed
 */

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    // Base URL — adjust if running on a different port
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Patient View',
      use: { ...devices['iPhone 14'] },
      // Only run login flow on mobile to verify responsive auth
      testMatch: '**/auth.spec.js',
    },
  ],

  // Start the Next.js dev server automatically before tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
