import { defineConfig } from '@playwright/test';

/**
 * Playwright config for PrismGit E2E tests.
 *
 * Tests launch the actual Electron app (not a browser). The Electron app
 * reads its userData from $PRISMGIT_USER_DATA (set per-test by helpers.ts)
 * so each test gets a fresh state — no leftover repos or settings.
 *
 * Tests live in tests/e2e/*.spec.ts and use the helpers in tests/e2e/helpers.ts.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // single-window app — can't run multiple instances against the same DISPLAY
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
