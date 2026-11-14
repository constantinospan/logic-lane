import { defineConfig, devices } from '@playwright/test';

const PORT = 4174; // not 4173 (used for manual play), so a stray server never gets reused by mistake

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/logic-lane/`, // trailing slash: tests use goto('./')
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `node tests/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}/logic-lane/`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], browserName: 'chromium', viewport: { width: 390, height: 844 } },
    },
    {
      name: 'tablet', // WebKit = Safari's engine, the closest we get to her iPad without a device
      use: {
        browserName: 'webkit',
        viewport: { width: 820, height: 1180 },
        hasTouch: true,
        isMobile: false,
      },
    },
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
    },
  ],
});
