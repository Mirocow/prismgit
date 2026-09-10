/**
 * PrismGit window/performance benchmark.
 * ========================================
 *
 * Measures the numbers users perceive as "windows open slowly":
 *
 *   1. Cold start  — electron.launch() → main window created → DOM loaded →
 *                    first paint → app interactive (WelcomeScreen visible).
 *   2. Repo open   — clicking the first recent repository → Changes page ready.
 *   3. About open  — Help → About menu click → About window content visible
 *                    (cold = window is created from scratch).
 *   4. About reopen — same after closing it (exercises the singleton path:
 *                    after the keep-alive optimization this must be near-instant).
 *
 * Usage:  node scripts/bench-windows.mjs [runs=3]
 * Requires: the app to be built (npm run build) and Xvfb on :99 for headless runs.
 */

import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const FIXTURE_REPO = '/home/z/my-project/repos/test-repo';
const RUNS = parseInt(process.argv[2] || '3', 10);

function seedUserData(userDataDir) {
  const settingsFile = path.join(userDataDir, 'prismgit-settings.json');
  fs.writeFileSync(
    settingsFile,
    JSON.stringify(
      {
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
        repositories: [{ path: FIXTURE_REPO, name: 'test-repo', lastOpened: Date.now(), pinned: false }],
        repoMetadata: {},
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(userDataDir, 'prismgit-window-state.json'),
    JSON.stringify(
      { windowState: { bounds: { x: 0, y: 0, width: 1440, height: 900 }, isMaximized: false, isFullScreen: false } },
      null,
      2
    )
  );
}

const now = () => Number(process.hrtime.bigint() / 1000000n); // ms

async function measureRun() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-bench-'));
  seedUserData(userDataDir);

  const m = {};
  let t = now();

  const app = await electron.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      path.join(process.cwd(), 'dist-electron/main.js'),
    ],
    env: { ...process.env, NODE_ENV: 'production', DISPLAY: process.env.DISPLAY || ':99', PRISMGIT_USER_DATA: userDataDir },
    timeout: 30000,
  });
  m.launchMs = now() - t;

  try {
    // --- 1. main window created
    t = now();
    const page = await app.firstWindow();
    m.firstWindowMs = now() - t;

    await page.waitForLoadState('domcontentloaded');
    const perf = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paint = performance.getEntriesByType('paint');
      return {
        domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : -1,
        loadEvent: nav ? Math.round(nav.loadEventEnd) : -1,
        fcp: Math.round(paint.find((p) => p.name === 'first-contentful-paint')?.startTime ?? -1),
        transferSize: nav ? nav.transferSize : -1,
      };
    });

    // --- 2. app interactive: WelcomeScreen with the recent repo button
    t = now();
    await page.waitForSelector(`button:has-text("test-repo")`, { timeout: 20000 });
    m.interactiveMs = now() - t;

    // --- 3. repo open → repo UI (GitToolbar only exists with an open repo)
    t = now();
    await page.locator(`button:has-text("test-repo")`).first().click();
    await page.waitForSelector('button:has-text("Stage")', { timeout: 20000 }).catch(() => {});
    m.repoOpenMs = now() - t;

    // --- 4. About open (cold — new window is created)
    const menuClick = () =>
      app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()?.getMenuItemById('help-about')?.click?.();
      });

    /** Main-process ground truth: poll until window `id` is visible. */
    const waitVisibleMain = async (id, deadlineMs = 15000) => {
      const t0 = now();
      for (;;) {
        const vis = await app.evaluate(({ BrowserWindow }, wid) => {
          const w = BrowserWindow.getAllWindows().find((x) => x.id === wid);
          return w ? w.isVisible() : false;
        }, id);
        if (vis) return now() - t0;
        if (now() - t0 > deadlineMs) return -1;
        await page.waitForTimeout(5);
      }
    };

    t = now();
    const aboutPromise = app.waitForEvent('window', { timeout: 15000 });
    menuClick();
    const about = await aboutPromise;
    await about.waitForLoadState('domcontentloaded');
    await about.waitForSelector('h1', { timeout: 10000 });
    m.aboutColdMs = now() - t;
    m.aboutWindows = app.windows().length;
    const aboutId = await app.evaluate(({ BrowserWindow }) =>
      Math.max(...BrowserWindow.getAllWindows().map((w) => w.id))
    );

    // Close it — then reopen (singleton path). Reopen is measured in the
    // MAIN process (isVisible poll): Playwright drops hidden windows from
    // app.windows() and its page re-attach would distort the numbers with
    // ~250ms of tooling overhead the user never pays.
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((w) => w.id === id)?.close(), aboutId);
    await page.waitForTimeout(200);

    t = now();
    menuClick();
    m.aboutReopenMs = await waitVisibleMain(aboutId);
    // Same window must be reused (keep-alive) — verify via id list.
    m.aboutReusedSameWindow = await app.evaluate(
      ({ BrowserWindow }, id) => BrowserWindow.getAllWindows().some((w) => w.id === id),
      aboutId
    );

    m.perf = perf;
  } finally {
    await app.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* tmp cleanup best-effort */
    }
  }
  return m;
}

const runs = [];
for (let i = 0; i < RUNS; i++) {
  const r = await measureRun();
  runs.push(r);
  console.log(`run ${i + 1}:`, JSON.stringify(r));
}

const avg = (k) => {
  const vals = runs.map((r) => r[k]).filter((v) => v >= 0);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : -1;
};

console.log('\n=== AVERAGE of', RUNS, 'runs ===');
console.log(`launch (main process ready)      : ${avg('launchMs')} ms`);
console.log(`firstWindow() resolved           : ${avg('firstWindowMs')} ms`);
console.log(`renderer domContentLoaded        : ${avg('perf') === -1 ? '?' : runs[0].perf.domContentLoaded} ms`);
console.log(`renderer first-contentful-paint  : ${runs[0].perf.fcp} ms (last run)`);
console.log(`app interactive (WelcomeScreen)  : ${avg('interactiveMs')} ms`);
console.log(`repo open → Changes              : ${avg('repoOpenMs')} ms`);
console.log(`About open (cold, new window)    : ${avg('aboutColdMs')} ms`);
console.log(`About reopen (keep-alive, main-proc truth): ${avg('aboutReopenMs')} ms (same window reused: ${runs[runs.length - 1].aboutReusedSameWindow})`);
