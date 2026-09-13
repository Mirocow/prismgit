import { defineConfig } from '@playwright/test';
import * as os from 'os';
import * as path from 'path';

/**
 * Playwright config for PrismGit E2E tests.
 *
 * Tests launch the actual Electron app (not a browser). The Electron app
 * reads its userData from $PRISMGIT_USER_DATA (set per-test by helpers.ts)
 * so each test gets a fresh state — no leftover repos or settings.
 *
 * Tests live in tests/e2e/*.spec.ts and use the helpers in tests/e2e/helpers.ts.
 *
 * DISPLAY must be set for Electron to find the X server. We default to :99
 * (the Xvfb instance we start in CI) but respect the env if already set.
 */

// Ensure DISPLAY is set before any test runs — Playwright forks workers
// that may not inherit it from the shell.
process.env.DISPLAY = process.env.DISPLAY || ':99';

// Fixture repo location — helpers.ts computes FIXTURE_REPO from this env var,
// so it must be set HERE (config is loaded before any worker/helper import).
// global-setup.ts then (re)creates the fixture at that path before the run,
// making the suite self-sufficient on a fresh machine (empty /tmp etc.).
process.env.PRISMGIT_TEST_REPOS = process.env.PRISMGIT_TEST_REPOS || path.join(os.tmpdir(), 'prismgit-e2e-repos');

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
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
    // Pass env to the worker so Electron inherits it
    launchOptions: {
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY,
      },
    },
  },
});

