/**
 * PrismGit E2E Test Harness
 * =========================
 *
 * Helpers for launching the Electron app via Playwright and driving the UI.
 *
 * Used by all tests in tests/e2e/.
 *
 * Key design:
 *   - Launches Electron with Playwright's `_electron` helper
 *   - The app reads its known-repos list from a settings JSON file under
 *     the userData dir. We override the userData path via PRISMGIT_USER_DATA
 *     env var so each test session gets a fresh app state (no leftover
 *     repos, settings, etc.)
 *   - The fixture repo at /home/z/my-project/repos/test-repo is added to
 *     the known repos BEFORE launch, so the app opens it immediately.
 */

import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

/** Path to the fixture repo created by tests/fixtures/setup-test-repo.sh
 * Uses PRISMGIT_TEST_REPOS env var if set, otherwise falls back to a
 * cross-platform temp directory (previously hardcoded /home/z/my-project/repos
 * which only works on the Linux dev container).
 */
export const FIXTURE_REPO = process.env.PRISMGIT_TEST_REPOS
  ? path.join(process.env.PRISMGIT_TEST_REPOS, 'test-repo')
  : path.join(os.tmpdir(), 'prismgit-test-repo');

/** Per-test userData dir — fresh app state (no leftover repos/settings) */
export function makeUserDataDir(prefix = 'prismgit-e2e-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Write a prismgit-settings.json with the fixture repo pre-loaded */
export function seedUserData(
  userDataDir: string,
  repos: Array<{ path: string; name: string }> = [{ path: FIXTURE_REPO, name: 'test-repo' }]
): void {
  // The app uses a SINGLE SimpleStore file named `prismgit-settings.json`
  // containing { settings, repositories, repoMetadata }. We pre-populate it
  // so the app opens the fixture repo immediately on launch.
  const settingsFile = path.join(userDataDir, 'prismgit-settings.json');
  const reposData = repos.map((r, i) => ({
    path: r.path,
    name: r.name,
    lastOpened: Date.now() - i * 1000,
    pinned: false,
  }));
  const data = {
    settings: {
      theme: 'light',
      fontSize: 13,
      fontSizeTree: 12,
      fontSizeList: 12,
      fontSizeDiff: 11,
      fontSizeMonospace: 11,
      sidebarWidth: 240,
      contrast: 100,
      defaultCloneDir: '',
      showReflogInHistory: false,
      maxHistoryLoad: 500,
      enableTelemetry: false,
      pullStrategy: 'merge',
    },
    repositories: reposData,
    repoMetadata: {} as Record<string, unknown>,
  };
  fs.writeFileSync(settingsFile, JSON.stringify(data, null, 2));

  // Also write the window-state file so the window doesn't open maximized
  // (which can cause issues with screenshots)
  const windowStateFile = path.join(userDataDir, 'prismgit-window-state.json');
  fs.writeFileSync(
    windowStateFile,
    JSON.stringify(
      {
        windowState: {
          bounds: { x: 0, y: 0, width: 1440, height: 900 },
          isMaximized: false,
          isFullScreen: false,
        },
      },
      null,
      2
    )
  );
}

export interface AppContext {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
  close: () => Promise<void>;
}

/**
 * Launch the PrismGit Electron app with a fresh userData dir, pre-loaded
 * with the fixture repo.
 *
 * The caller MUST call `ctx.close()` in `afterEach` to release the app.
 */
export async function launchApp(opts: {
  userDataDir?: string;
  repos?: Array<{ path: string; name: string }>;
} = {}): Promise<AppContext> {
  const userDataDir = opts.userDataDir || makeUserDataDir();
  seedUserData(userDataDir, opts.repos);

  const app = await electron.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      path.join(process.cwd(), 'dist-electron/main.js'),
    ],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DISPLAY: process.env.DISPLAY || ':99',
      PRISMGIT_USER_DATA: userDataDir,
    },
    timeout: 30000,
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // Give the app time to load repos + settings
  await page.waitForTimeout(1500);

  // The app starts on the WelcomeScreen — click the first repo in the
  // "Recent Repositories" list to open it. The list shows repo.name as
  // a button.
  const repoButton = page.locator(`button:has-text("${opts.repos?.[0]?.name || 'test-repo'}")`).first();
  if (await repoButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await repoButton.click();
    // Wait for the repo to load and the Changes page to render
    await page.waitForTimeout(2000);
  }

  const close = async () => {
    try {
      await app.close();
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  return { app, page, userDataDir, close };
}

/** Wait for a sidebar nav item by its label and click it */
export async function navigateTo(page: Page, label: string): Promise<void> {
  // Sidebar nav buttons live in <aside><nav>...</nav></aside>, but the
  // Settings button lives in <aside><div>...</div></aside> at the bottom.
  // Search both.
  const navButton = page.locator(`aside button:has-text("${label}")`).first();
  await navButton.waitFor({ state: 'visible', timeout: 15000 });
  await navButton.click();
  await page.waitForTimeout(800);
}

/** Wait for an element containing the given text to appear */
export async function waitForText(page: Page, text: string, timeout = 10000): Promise<void> {
  await page.waitForSelector(`text="${text}"`, { timeout });
}

/**
 * Enable an extra status filter in the Changes view via the quick-toggle chip.
 *
 * Since b92f54d the default filter set is MADS (Modified, Added, Deleted,
 * Staged) — Untracked (U) and Unstaged (U2) are OFF by default, so e2e flows
 * that create fresh (untracked) files must enable the chip first. Verified by
 * the "Status: N filters" caption growing from 4 to 5.
 */
export async function enableStatusFilter(page: Page, label: 'Untracked' | 'Unstaged'): Promise<void> {
  const title = label === 'Untracked' ? 'Show Untracked files' : 'Show Unstaged files';
  const chip = page.locator(`button[title="${title}"]`).first();
  await chip.waitFor({ state: 'visible', timeout: 10000 });
  const statusButton = page.locator('button', { hasText: 'Status:' }).first();
  // applyProjectPrefs may asynchronously apply the MADS default AFTER launch
  // and overwrite an early toggle — retry the whole click until the caption
  // confirms the filter stuck (MADS=4 -> 5).
  await expect(async () => {
    await chip.click();
    await expect(statusButton).toContainText('5 filters');
  }).toPass({ timeout: 15_000 });
}

/** Take a screenshot for debugging test failures */
export async function screenshot(page: Page, name: string): Promise<void> {
  const shotDir = path.join(process.cwd(), 'tests', 'e2e', 'screenshots');
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage: false });
}
