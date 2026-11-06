import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

const BASE_URL = process.env.BASE_URL || 'https://www.daosense.org';

export default defineConfig({
  testDir: './tests',
  // The storefront is a shared live system — keep load low and avoid flaky cart races.
  fullyParallel: false,
  // One worker: the live store answers bursts with HTTP 429 + a bot-verification page.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'en-GB',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    // Manual one-off login of the test member: `npm run auth:member` (opens a real browser window).
    {
      name: 'member-login',
      testMatch: /(member|customer)\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], headless: false, viewport: { width: 1280, height: 900 } },
    },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
});
