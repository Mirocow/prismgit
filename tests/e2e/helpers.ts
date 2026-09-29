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
 * MUST stay in sync with the script: it uses
 * `${PRISMGIT_TEST_REPOS:-${TMPDIR:-/tmp}/prismgit-repos}` as the base dir.
 * (A previous version pointed at os.tmpdir()/prismgit-test-repo — a DIFFERENT
 * path than the script creates, so seeded settings referenced a repo that
 * did not exist and the app stayed on the WelcomeScreen: 02-branches failed.)
 */
export const FIXTURE_REPO = path.join(
  process.env.PRISMGIT_TEST_REPOS || path.join(os.tmpdir(), 'prismgit-repos'),
  'test-repo'
);

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
      pullStrategy: 'merge',
      // E2E FIX (root cause #1): without tourCompleted the first-run tour
      // overlay renders as a fixed inset-0 z-100 layer that intercepts
      // EVERY click — which is why half the suite used to time out on its
      // first locator.click(). Marking the tour done keeps the overlay
      // from ever mounting.
      tourCompleted: true,
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
      // Pin the UI locale to English for e2e: the app detects the OS language
      // otherwise, and text assertions in the specs are English-based.
      PRISMGIT_LOCALE: 'en',
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

/** Wait for a sidebar nav item by its label and click it.
 *
 * E2E FIX (root cause #2): the old `aside button:has-text(label)` matcher
 * broke three ways at once:
 *   a) sidebar nav items are div[role=button] (they contain a NESTED
 *      favorite-star button), not <button>;
 *   b) the repo-header button's accessible name is "<repo> <branch>" — for
 *      repos named like tools (the "tags"/"history"/"diff" fixtures)
 *      :has-text matched the header first and clicked the wrong thing;
 *   c) the nav groups (Working Tree/Workflows/Refs) start COLLAPSED
 *      (projectPrefs DEFAULT_COLLAPSED_GROUPS), so items are not visible
 *      until their group header is expanded.
 *
 * Strategy: target aria-label (nav items carry aria-label={item.label}),
 * expanding any collapsed group header (title="Expand") that stands
 * between us and the item; fall back to the nav~div area for Settings
 * (which lives outside <nav>) and to a plain has-text match last.
 */
export async function navigateTo(page: Page, label: string): Promise<void> {
  // 1. Preferred: aria-labeled nav item (exact match, no shadowing).
  const byAria = page.locator(`aside [role="button"][aria-label="${label}"]`).first();
  if (await byAria.isVisible({ timeout: 1500 }).catch(() => false)) {
    await byAria.click();
    await page.waitForTimeout(600);
    return;
  }

  // 2. The item may sit in a COLLAPSED group — expand every collapsed
  //    group header (title="Expand" while collapsed) and retry.
  const expandable = page.locator('aside button[role="heading"][title="Expand"]');
  const n = await expandable.count();
  for (let i = 0; i < n; i++) {
    const header = expandable.nth(i);
    if (await header.isVisible().catch(() => false)) {
      await header.click().catch(() => { /* toggle best-effort */ });
    }
  }
  if (n > 0) await page.waitForTimeout(300);
  if (await byAria.isVisible({ timeout: 3000 }).catch(() => false)) {
    await byAria.click();
    await page.waitForTimeout(600);
    return;
  }

  // 3. Settings & friends live in <aside><div> BELOW <nav> — try a plain
  //    button there (scoped to the div, so the repo header can't shadow).
  const asideBtn = page.locator('aside div button').filter({ hasText: label }).first();
  if (await asideBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await asideBtn.click();
    await page.waitForTimeout(600);
    return;
  }

  // 4. Last resort: div[role=button] containing the label text.
  const byText = page.locator(`aside div[role="button"]`).filter({ hasText: label }).first();
  await byText.waitFor({ state: 'visible', timeout: 15000 });
  await byText.click();
  await page.waitForTimeout(600);
}

/** Wait for an element containing the given text to appear */
export async function waitForText(page: Page, text: string, timeout = 10000): Promise<void> {
  await page.waitForSelector(`text="${text}"`, { timeout });
}

/**
 * Enable an extra file-display category in the Changes view.
 *
 * E2E FIX (root cause #3): since f1c4a35 the old MADS quick-toggle chips
 * ("Show Untracked files" / "Show Unstaged files" + a "Status: N filters"
 * caption) are GONE — replaced by the 8 SmartGit-style display-flag icon
 * buttons in the Changes toolbar. Default ON: subdirectories + unversioned
 * (untracked). Wait — unversioned DEFAULT ON means fresh untracked files
 * are always listed; the button toggles the flag regardless, so tests can
 * still force it on and verify the active state (bg-accent-muted class).
 *
 * 'Unstaged' no longer exists as a separate flag (unstaged/changed files
 * are ALWAYS visible in the union model), so it is a no-op kept for API
 * compatibility with the older specs.
 */
export async function enableStatusFilter(page: Page, label: 'Untracked' | 'Unstaged'): Promise<void> {
  if (label === 'Unstaged') return; // always visible in the SmartGit union model
  const title = 'Show Unversioned (untracked) Files';
  const chip = page.locator(`button[title="${title}"]`).first();
  await chip.waitFor({ state: 'visible', timeout: 10000 });
  // If the flag is already active (accent-tinted), nothing to do.
  const active = await chip.evaluate((el) => el.className.includes('bg-accent-muted'));
  if (!active) {
    await chip.click();
    // The button gains bg-accent-muted when the flag is ON.
    await expect
      .poll(async () => chip.evaluate((el) => el.className.includes('bg-accent-muted')), { timeout: 10_000 })
      .toBe(true);
  }
}

/** Take a screenshot for debugging test failures */
export async function screenshot(page: Page, name: string): Promise<void> {
  const shotDir = path.join(process.cwd(), 'tests', 'e2e', 'screenshots');
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage: false });
}
