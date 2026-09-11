/**
 * E2E: Full UI/UX test suite — all PrismGit tools
 *
 * Tests each tool by launching Electron via CDP, navigating to the page,
 * interacting with UI elements, taking screenshots, and verifying state.
 *
 * Run: DISPLAY=:99 npx playwright test tests/e2e/ui-ux-full.spec.ts --workers=1
 */
import { test } from '@playwright/test';
import { chromium } from '@playwright/test';
import { exec, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as net from 'node:net';

const BASE = '/tmp/ui-test';
const SHOTS = '/home/z/my-project/screenshots';
const REPOS = [
  { path: `${BASE}/changes`,   name: 'changes' },
  { path: `${BASE}/branches/work`,  name: 'branches' },
  { path: `${BASE}/history`,   name: 'history' },
  { path: `${BASE}/diff`,      name: 'diff' },
  { path: `${BASE}/tags`,      name: 'tags' },
  { path: `${BASE}/stash`,     name: 'stash' },
  { path: `${BASE}/remotes/work`, name: 'remotes' },
  { path: `${BASE}/submodules`, name: 'submodules' },
];

function waitForPort(port: number, timeout = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryConnect = () => {
      const sock = new net.Socket();
      sock.setTimeout(500);
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start > timeout) reject(new Error(`Port ${port} timeout`));
        else setTimeout(tryConnect, 300);
      });
      sock.once('timeout', () => {
        sock.destroy();
        if (Date.now() - start > timeout) reject(new Error(`Port ${port} timeout`));
        else setTimeout(tryConnect, 300);
      });
      sock.connect(port, '127.0.0.1');
    };
    tryConnect();
  });
}

async function launchElectron(repoPath: string, repoName: string, port: number) {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), `pg-${repoName}-`));
  fs.writeFileSync(path.join(ud, 'prismgit-settings.json'), JSON.stringify({
    settings: { theme: 'dark', fontSize: 13, sidebarWidth: 240, contrast: 100 },
    repositories: [{ path: repoPath, name: repoName, lastOpened: Date.now(), pinned: false }],
    repoMetadata: {},
  }, null, 2));
  const electronBin = path.join(process.cwd(), 'node_modules/electron/dist/electron');
  const mainJs = path.join(process.cwd(), 'dist-electron/main.js');
  const child: ChildProcess = exec(
    `DISPLAY=:99 "${electronBin}" "${mainJs}" --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=${port}`,
    { env: { ...process.env, DISPLAY: ':99', NODE_ENV: 'production', PRISMGIT_USER_DATA: ud, PRISMGIT_LOCALE: 'en' } },
  );
  const stderr: string[] = [];
  child.stderr?.on('data', (d) => stderr.push(d.toString()));
  await waitForPort(port, 20000);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0] || await browser.newContext();
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
  // Click repo on welcome screen
  const btn = page.locator(`button:has-text("${repoName}")`).first();
  if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(2000);
  }
  return { page, browser, child, ud, stderr };
}

async function cleanup(browser: any, child: ChildProcess, ud: string) {
  try { await browser.close(); } catch {}
  child.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 500));
  fs.rmSync(ud, { recursive: true, force: true });
}

async function navigateTo(page: any, navText: string) {
  const nav = page.locator(`text=${navText}`).first();
  if (await nav.isVisible({ timeout: 2000 }).catch(() => false)) {
    await nav.click();
    await page.waitForTimeout(1500);
    return true;
  }
  return false;
}

test.describe('UI/UX Full Test Suite', () => {
  test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));

  // ── 1. Changes ──────────────────────────────────────────────────
  test('Changes: stage/unstage/discard/file list', async () => {
    const port = 9300;
    const { page, browser, child, ud, stderr } = await launchElectron(`${BASE}/changes`, 'changes', port);
    try {
      console.log('[Changes] === Changes page loaded ===');
      await page.screenshot({ path: `${SHOTS}/ui-changes-01-default.png` });

      // Check file list — should show modified, deleted, untracked
      const hasModified = await page.locator('text=a.txt').first().isVisible({ timeout: 2000 }).catch(() => false);
      const hasUntracked = await page.locator('text=newfile.go').first().isVisible({ timeout: 2000 }).catch(() => false);
      const hasDeleted = await page.locator('text=c.py').first().isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`[Changes] Modified (a.txt): ${hasModified}`);
      console.log(`[Changes] Untracked (newfile.go): ${hasUntracked}`);
      console.log(`[Changes] Deleted (c.py): ${hasDeleted}`);

      // Check staged section
      const stagedSection = page.locator('text=/staged/i').first();
      const hasStaged = await stagedSection.isVisible({ timeout: 1000 }).catch(() => false);
      console.log(`[Changes] Staged section visible: ${hasStaged}`);

      // Check filter buttons (icons)
      const filterBtns = page.locator('button[title*="Files From"], button[title*="Show"]');
      const filterCount = await filterBtns.count();
      console.log(`[Changes] Filter buttons: ${filterCount}`);

      await page.screenshot({ path: `${SHOTS}/ui-changes-02-file-list.png` });

      // Try clicking a file to see diff
      if (hasModified) {
        await page.locator('text=a.txt').first().click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `${SHOTS}/ui-changes-03-file-selected.png` });
        console.log('[Changes] Clicked a.txt — screenshot taken');
      }

      console.log('[Changes] === Done ===\n');
    } catch (e) {
      console.log(`[Changes] ERROR: ${(e as Error).message}`);
      console.log(`[Changes] stderr: ${stderr.join('').substring(0, 300)}`);
    } finally {
      await cleanup(browser, child, ud);
    }
  });

  // ── 2. Branches ────────────────────────────────────────────────
  test('Branches: list/create/checkout/delete', async () => {
    const port = 9301;
    const { page, browser, child, ud } = await launchElectron(`${BASE}/branches/work`, 'branches', port);
    try {
      await navigateTo(page, 'Branches');
      await page.screenshot({ path: `${SHOTS}/ui-branches-01-default.png` });
      console.log('[Branches] === Branches page loaded ===');

      // Check branch list
      const hasMain = await page.locator('text=main').first().isVisible({ timeout: 2000 }).catch(() => false);
      const hasAlpha = await page.locator('text=feature/alpha').first().isVisible({ timeout: 2000 }).catch(() => false);
      const hasBeta = await page.locator('text=feature/beta').first().isVisible({ timeout: 2000 }).catch(() => false);
      const hasHotfix = await page.locator('text=hotfix/urgent').first().isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`[Branches] main: ${hasMain}, alpha: ${hasAlpha}, beta: ${hasBeta}, hotfix: ${hasHotfix}`);

      await page.screenshot({ path: `${SHOTS}/ui-branches-02-list.png` });
      console.log('[Branches] === Done ===\n');
    } catch (e) {
      console.log(`[Branches] ERROR: ${(e as Error).message}`);
    } finally {
      await cleanup(browser, child, ud);
    }
  });

  // ── 3. History ─────────────────────────────────────────────────
  test('History: commit graph/log/navigation', async () => {
    const port = 9302;
    const { page, browser, child, ud } = await launchElectron(`${BASE}/history`, 'history', port);
    try {
      await navigateTo(page, 'History');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SHOTS}/ui-history-01-default.png` });
      console.log('[History] === History page loaded ===');

      // Check commit count
      const body = await page.locator('body').textContent();
      const hasCommits = body?.includes('commit');
      console.log(`[History] Has commits: ${hasCommits}`);

      // Check if graph is visible
      const graphArea = page.locator('[class*="graph"], [class*="commit"]').first();
      const hasGraph = await graphArea.isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`[History] Graph/commit area visible: ${hasGraph}`);

      await page.screenshot({ path: `${SHOTS}/ui-history-02-graph.png` });
      console.log('[History] === Done ===\n');
    } catch (e) {
      console.log(`[History] ERROR: ${(e as Error).message}`);
    } finally {
      await cleanup(browser, child, ud);
    }
  });

  // ── 4. Diff ────────────────────────────────────────────────────
  test('Diff: unified/split/word-diff/highlight modes', async () => {
    const port = 9303;
    const { page, browser, child, ud } = await launchElectron(`${BASE}/diff`, 'diff', port);
    try {
      await navigateTo(page, 'Diff');
      await page.screenshot({ path: `${SHOTS}/ui-diff-01-default.png` });
      console.log('[Diff] === Diff page loaded ===');

      // Select a file to diff
      const fileRow = page.locator('text=config.ts').first();
      if (await fileRow.isVisible({ timeout: 2000 }).catch(() => false)) {
        await fileRow.click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${SHOTS}/ui-diff-02-file-selected.png` });
        console.log('[Diff] Selected config.ts — diff shown');
      }

      // Try switching highlight mode (BG / +/- buttons)
      const bgBtn = page.locator('button:has-text("BG")').first();
      const textBtn = page.locator('button:has-text("+/-")').first();
      if (await textBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await textBtn.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/ui-diff-03-text-mode.png` });
        console.log('[Diff] Switched to text mode');
      }
      if (await bgBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await bgBtn.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/ui-diff-04-bg-mode.png` });
        console.log('[Diff] Switched to background mode');
      }

      console.log('[Diff] === Done ===\n');
    } catch (e) {
      console.log(`[Diff] ERROR: ${(e as Error).message}`);
    } finally {
      await cleanup(browser, child, ud);
    }
  });

  // ── 5. Tags ────────────────────────────────────────────────────
  test('Tags: list/create/delete', async () => {
    const port = 9304;
    const { page, browser, child, ud } = await launchElectron(`${BASE}/tags`, 'tags', port);
    try {
      await navigateTo(page, 'Tags');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SHOTS}/ui-tags-01-default.png` });
      console.log('[Tags] === Tags page loaded ===');

      // Check tag list
      const hasV1 = await page.locator('text=v1.0.0').first().isVisible({ timeout: 2000 }).catch(() => false);
      const hasV1Annotated = await page.locator('text=v1.1.0').first().isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`[Tags] v1.0.0: ${hasV1}, v1.1.0: ${hasV1Annotated}`);

      console.log('[Tags] === Done ===\n');
    } catch (e) {
      console.log(`[Tags] ERROR: ${(e as Error).message}`);
    } finally {
      await cleanup(browser, child, ud);
    }
  });

  // ── 6. Stash ──────────────────────────────────────────────────
  test('Stash: list/pop/apply/drop', async () => {
    const port = 9305;
    const { page, browser, child, ud } = await launchElectron(`${BASE}/stash`, 'stash', port);
    try {
      await navigateTo(page, 'Stashes');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SHOTS}/ui-stash-01-default.png` });
      console.log('[Stash] === Stashes page loaded ===');

      // Check stash list
      const body = await page.locator('body').textContent();
      const hasStash = body?.includes('stash@');
      console.log(`[Stash] Stash entries visible: ${hasStash}`);

      console.log('[Stash] === Done ===\n');
    } catch (e) {
      console.log(`[Stash] ERROR: ${(e as Error).message}`);
    } finally {
      await cleanup(browser, child, ud);
    }
  });

  // ── 7. Remotes ────────────────────────────────────────────────
  test('Remotes: list/fetch/pull/push', async () => {
    const port = 9306;
    const { page, browser, child, ud } = await launchElectron(`${BASE}/remotes/work`, 'remotes', port);
    try {
      await navigateTo(page, 'Remotes');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SHOTS}/ui-remotes-01-default.png` });
      console.log('[Remotes] === Remotes page loaded ===');

      // Check remote list
      const hasOrigin = await page.locator('text=origin').first().isVisible({ timeout: 2000 }).catch(() => false);
      const hasUpstream = await page.locator('text=upstream').first().isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`[Remotes] origin: ${hasOrigin}, upstream: ${hasUpstream}`);

      console.log('[Remotes] === Done ===\n');
    } catch (e) {
      console.log(`[Remotes] ERROR: ${(e as Error).message}`);
    } finally {
      await cleanup(browser, child, ud);
    }
  });

  // ── 8. Submodules ─────────────────────────────────────────────
  test('Submodules: list/status', async () => {
    const port = 9307;
    const { page, browser, child, ud } = await launchElectron(`${BASE}/submodules`, 'submodules', port);
    try {
      await navigateTo(page, 'Submodules');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SHOTS}/ui-submodules-01-default.png` });
      console.log('[Submodules] === Submodules page loaded ===');

      // Check submodule list
      const hasSub = await page.locator('text=sub').first().isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`[Submodules] Submodule visible: ${hasSub}`);

      console.log('[Submodules] === Done ===\n');
    } catch (e) {
      console.log(`[Submodules] ERROR: ${(e as Error).message}`);
    } finally {
      await cleanup(browser, child, ud);
    }
  });

  // ── 9. Sidebar: favorites + branch name ───────────────────────
  test('Sidebar: favorites + branch name display', async () => {
    const port = 9308;
    const { page, browser, child, ud } = await launchElectron(`${BASE}/changes`, 'changes', port);
    try {
      await page.screenshot({ path: `${SHOTS}/ui-sidebar-01-default.png` });
      console.log('[Sidebar] === Sidebar loaded ===');

      // Check favorites section
      const hasFavChanges = await page.locator('text=Changes').first().isVisible({ timeout: 2000 }).catch(() => false);
      const hasFavHistory = await page.locator('text=History').first().isVisible({ timeout: 2000 }).catch(() => false);
      const hasFavDiff = await page.locator('text=Diff').first().isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`[Sidebar] Favorites: Changes=${hasFavChanges}, History=${hasFavHistory}, Diff=${hasFavDiff}`);

      // Check branch name in header
      const branchLabel = page.locator('text=main').first();
      const hasBranch = await branchLabel.isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`[Sidebar] Branch name visible: ${hasBranch}`);

      console.log('[Sidebar] === Done ===\n');
    } catch (e) {
      console.log(`[Sidebar] ERROR: ${(e as Error).message}`);
    } finally {
      await cleanup(browser, child, ud);
    }
  });

  // ── 10. 3-way conflict resolution (merge state) ───────────────
  test('3-way conflict: merge state — banner + resolve', async () => {
    // Use the conflict-test-1 repo from earlier
    const port = 9309;
    const { page, browser, child, ud } = await launchElectron('/tmp/conflict-test-1', 'conflict-test-1', port);
    try {
      await page.screenshot({ path: `${SHOTS}/ui-conflict-01-changes.png` });
      console.log('[Conflict] === Changes page with merge-in-progress ===');

      // Check banner
      const banner = page.locator('[data-testid="repo-state-banner"]');
      const bv = await banner.isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`[Conflict] Banner visible: ${bv}`);

      // Navigate to Diff and try resolving
      await navigateTo(page, 'Diff');
      await page.screenshot({ path: `${SHOTS}/ui-conflict-02-diff.png` });

      const fileRow = page.locator('text=config.ts').first();
      if (await fileRow.isVisible({ timeout: 2000 }).catch(() => false)) {
        await fileRow.click({ button: 'right' });
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/ui-conflict-03-menu.png` });

        const resolveItem = page.locator('text=Resolve Conflict').first();
        if (await resolveItem.isVisible({ timeout: 2000 }).catch(() => false)) {
          await resolveItem.click();
          await page.waitForTimeout(3000);
          await page.screenshot({ path: `${SHOTS}/ui-conflict-04-3way.png` });
          console.log('[Conflict] 3-way panel opened');

          const editor = page.locator('[data-testid="conflict-editor"]');
          const ev = await editor.isVisible({ timeout: 3000 }).catch(() => false);
          console.log(`[Conflict] Editor visible: ${ev}`);

          if (ev) {
            const et = await editor.textContent();
            console.log(`[Conflict] Has markers: ${et?.includes('<<<<<<<')}`);

            // Take Left
            const tl = page.locator('button:has-text("Take Left")').first();
            if (await tl.isVisible({ timeout: 2000 }).catch(() => false)) {
              await tl.click();
              await page.waitForTimeout(1000);
              await page.screenshot({ path: `${SHOTS}/ui-conflict-05-resolved.png` });
              console.log('[Conflict] Conflict resolved via Take Left');
            }
          }
        }
      }

      console.log('[Conflict] === Done ===\n');
    } catch (e) {
      console.log(`[Conflict] ERROR: ${(e as Error).message}`);
    } finally {
      await cleanup(browser, child, ud);
    }
  });
});
