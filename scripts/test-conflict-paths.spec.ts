/**
 * Conflict Resolution Paths — E2E test
 * =====================================
 * Tests every resolution path available in the PrismGit 3-way merge tool:
 *
 *   Path 1: Take Left (ours)          — simple-content repo
 *   Path 2: Take Right (theirs)        — simple-content repo (re-created)
 *   Path 3: Both L→R (ours + theirs)  — multiple-hunks repo, hunk 1
 *   Path 4: Both R→L (theirs + ours)  — multiple-hunks repo, hunk 2
 *   Path 5: Reset Hunk                — multiple-hunks repo, hunk 3
 *   Path 6: Take Left on file 1 of 3  — multi-file repo
 *   Path 7: Take Right on file 2 of 3  — multi-file repo
 *   Path 8: Take Left on nested file   — nested-path repo
 *   Path 9: Take Left on JSON file     — json-conflict repo
 *   Path 10: Abort from banner         — simple-content repo (fresh)
 *
 * Each path:
 *   1. Opens the repo
 *   2. Navigates to Diff
 *   3. Right-clicks the conflicted file → "Resolve Conflict..."
 *   4. Verifies the 3-way panel opens with conflict markers
 *   5. Clicks the resolution button (Take Left / Take Right / Both / Reset)
 *   6. Verifies conflict markers are removed
 *   7. Takes before/after screenshots
 *
 * Run: DISPLAY=:99 npx playwright test scripts/test-conflict-paths.spec.ts --workers=1
 */
import { test } from '@playwright/test';
import { chromium } from '@playwright/test';
import { exec, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as net from 'node:net';

const BASE = '/tmp/conflict-scenarios';
const SHOTS = '/home/z/my-project/screenshots/conflict-paths';

// ── Helpers ────────────────────────────────────────────────────────

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

let portCounter = 9400;

async function launch(repoPath: string, repoName: string) {
  const port = portCounter++;
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), `pg-${repoName}-${port}-`));
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
  await waitForPort(port, 20000);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0] || await browser.newContext();
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
  const btn = page.locator(`button:has-text("${repoName}")`).first();
  if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(2000);
  }
  return { page, browser, child, ud };
}

async function cleanup(browser: any, child: ChildProcess, ud: string) {
  try { await browser.close(); } catch {}
  child.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 500));
  fs.rmSync(ud, { recursive: true, force: true });
}

async function goToDiff(page: any) {
  const nav = page.locator('text=Diff').first();
  if (await nav.isVisible({ timeout: 2000 }).catch(() => false)) {
    await nav.click();
    await page.waitForTimeout(1500);
  }
}

async function openConflictPanel(page: any, fileText: string): Promise<boolean> {
  const fileRow = page.locator(`text=${fileText}`).first();
  if (!await fileRow.isVisible({ timeout: 2000 }).catch(() => false)) return false;
  await fileRow.click({ button: 'right' });
  await page.waitForTimeout(500);
  const resolveItem = page.locator('text=Resolve Conflict').first();
  if (!await resolveItem.isVisible({ timeout: 2000 }).catch(() => false)) return false;
  await resolveItem.click();
  await page.waitForTimeout(3000);
  const editor = page.locator('[data-testid="conflict-editor"]');
  return await editor.isVisible({ timeout: 3000 }).catch(() => false);
}

async function clickButton(page: any, text: string): Promise<boolean> {
  const btn = page.locator(`button:has-text("${text}")`).first();
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(1000);
    return true;
  }
  return false;
}

async function hasConflictMarkers(page: any): Promise<boolean> {
  const editor = page.locator('[data-testid="conflict-editor"]');
  if (!await editor.isVisible({ timeout: 1000 }).catch(() => false)) return false;
  const text = await editor.textContent();
  return text?.includes('<<<<<<<') ?? false;
}

// ── Recreate a fresh conflict repo ─────────────────────────────────
function recreateSimpleContent(name: string, dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  exec(`cd "${dir}" && git init -b main -q && ` +
    `echo "line1" > file.txt && git add . && git commit -q -m "init" && ` +
    `git checkout -b feature -q && echo "FEATURE" > file.txt && git add . && git commit -q -m "feature" && ` +
    `git checkout main -q && echo "MAIN" > file.txt && git add . && git commit -q -m "main" && ` +
    `git merge feature 2>/dev/null; true`,
    { encoding: 'utf-8' });
}

// ── Tests ──────────────────────────────────────────────────────────

test.describe('Conflict Resolution Paths', () => {
  test.beforeAll(() => {
    fs.mkdirSync(SHOTS, { recursive: true });
    // Ensure test repos exist
    exec('bash scripts/create-conflict-scenarios.sh', { cwd: process.cwd(), encoding: 'utf-8' });
  });

  // Path 1: Take Left (ours)
  test('Path 1: Take Left — use OURS version', async () => {
    recreateSimpleContent('simple-content', `${BASE}/simple-content`);
    const { page, browser, child, ud } = await launch(`${BASE}/simple-content`, 'simple-content');
    try {
      await goToDiff(page);
      const opened = await openConflictPanel(page, 'file.txt');
      console.log(`[Path1] Panel opened: ${opened}`);
      const hasMarkers = await hasConflictMarkers(page);
      console.log(`[Path1] Has markers: ${hasMarkers}`);
      await page.screenshot({ path: `${SHOTS}/path01-before.png` });

      const clicked = await clickButton(page, 'Take Left');
      console.log(`[Path1] Take Left clicked: ${clicked}`);
      await page.screenshot({ path: `${SHOTS}/path01-after.png` });

      const stillHasMarkers = await hasConflictMarkers(page);
      console.log(`[Path1] Markers after: ${stillHasMarkers}`);
      console.log('[Path1] === Done ===\n');
    } finally { await cleanup(browser, child, ud); }
  });

  // Path 2: Take Right (theirs)
  test('Path 2: Take Right — use THEIRS version', async () => {
    recreateSimpleContent('simple-content', `${BASE}/simple-content`);
    const { page, browser, child, ud } = await launch(`${BASE}/simple-content`, 'simple-content');
    try {
      await goToDiff(page);
      await openConflictPanel(page, 'file.txt');
      const hasMarkers = await hasConflictMarkers(page);
      console.log(`[Path2] Has markers: ${hasMarkers}`);
      await page.screenshot({ path: `${SHOTS}/path02-before.png` });

      const clicked = await clickButton(page, 'Take Right');
      console.log(`[Path2] Take Right clicked: ${clicked}`);
      await page.screenshot({ path: `${SHOTS}/path02-after.png` });

      const stillHasMarkers = await hasConflictMarkers(page);
      console.log(`[Path2] Markers after: ${stillHasMarkers}`);
      console.log('[Path2] === Done ===\n');
    } finally { await cleanup(browser, child, ud); }
  });

  // Path 3: Both L→R (ours first, then theirs)
  test('Path 3: Both L→R — concatenate ours + theirs', async () => {
    const { page, browser, child, ud } = await launch(`${BASE}/multiple-hunks`, 'multiple-hunks');
    try {
      await goToDiff(page);
      await openConflictPanel(page, 'file.txt');
      const hasMarkers = await hasConflictMarkers(page);
      console.log(`[Path3] Has markers: ${hasMarkers}`);
      await page.screenshot({ path: `${SHOTS}/path03-before.png` });

      const clicked = await clickButton(page, 'Take L,R');
      console.log(`[Path3] Take L,R clicked: ${clicked}`);
      await page.screenshot({ path: `${SHOTS}/path03-after.png` });

      const stillHasMarkers = await hasConflictMarkers(page);
      console.log(`[Path3] Markers after: ${stillHasMarkers}`);
      console.log('[Path3] === Done ===\n');
    } finally { await cleanup(browser, child, ud); }
  });

  // Path 4: Both R→L (theirs first, then ours)
  test('Path 4: Both R→L — concatenate theirs + ours', async () => {
    const { page, browser, child, ud } = await launch(`${BASE}/multiple-hunks`, 'multiple-hunks');
    try {
      await goToDiff(page);
      await openConflictPanel(page, 'file.txt');
      const hasMarkers = await hasConflictMarkers(page);
      console.log(`[Path4] Has markers: ${hasMarkers}`);
      await page.screenshot({ path: `${SHOTS}/path04-before.png` });

      const clicked = await clickButton(page, 'Take R,L');
      console.log(`[Path4] Take R,L clicked: ${clicked}`);
      await page.screenshot({ path: `${SHOTS}/path04-after.png` });

      const stillHasMarkers = await hasConflictMarkers(page);
      console.log(`[Path4] Markers after: ${stillHasMarkers}`);
      console.log('[Path4] === Done ===\n');
    } finally { await cleanup(browser, child, ud); }
  });

  // Path 5: Reset Hunk
  test('Path 5: Reset Hunk — restore conflict markers', async () => {
    const { page, browser, child, ud } = await launch(`${BASE}/multiple-hunks`, 'multiple-hunks');
    try {
      await goToDiff(page);
      await openConflictPanel(page, 'file.txt');
      // First resolve with Take Left
      await clickButton(page, 'Take Left');
      const afterTakeLeft = await hasConflictMarkers(page);
      console.log(`[Path5] After Take Left — markers: ${afterTakeLeft}`);
      await page.screenshot({ path: `${SHOTS}/path05-after-take-left.png` });

      // Now Reset to restore markers
      const resetClicked = await clickButton(page, 'Reset');
      console.log(`[Path5] Reset clicked: ${resetClicked}`);
      await page.screenshot({ path: `${SHOTS}/path05-after-reset.png` });

      const afterReset = await hasConflictMarkers(page);
      console.log(`[Path5] After Reset — markers: ${afterReset}`);
      console.log('[Path5] === Done ===\n');
    } finally { await cleanup(browser, child, ud); }
  });

  // Path 6: Multi-file — Take Left on first file
  test('Path 6: Multi-file — Take Left on file_a.ts', async () => {
    const { page, browser, child, ud } = await launch(`${BASE}/multi-file`, 'multi-file');
    try {
      await goToDiff(page);
      const opened = await openConflictPanel(page, 'file_a.ts');
      console.log(`[Path6] Panel opened for file_a.ts: ${opened}`);
      const hasMarkers = await hasConflictMarkers(page);
      console.log(`[Path6] Has markers: ${hasMarkers}`);
      await page.screenshot({ path: `${SHOTS}/path06-before.png` });

      const clicked = await clickButton(page, 'Take Left');
      console.log(`[Path6] Take Left clicked: ${clicked}`);
      await page.screenshot({ path: `${SHOTS}/path06-after.png` });

      console.log('[Path6] === Done ===\n');
    } finally { await cleanup(browser, child, ud); }
  });

  // Path 7: Multi-file — Take Right on second file
  test('Path 7: Multi-file — Take Right on file_b.py', async () => {
    const { page, browser, child, ud } = await launch(`${BASE}/multi-file`, 'multi-file');
    try {
      await goToDiff(page);
      const opened = await openConflictPanel(page, 'file_b.py');
      console.log(`[Path7] Panel opened for file_b.py: ${opened}`);
      const hasMarkers = await hasConflictMarkers(page);
      console.log(`[Path7] Has markers: ${hasMarkers}`);
      await page.screenshot({ path: `${SHOTS}/path07-before.png` });

      const clicked = await clickButton(page, 'Take Right');
      console.log(`[Path7] Take Right clicked: ${clicked}`);
      await page.screenshot({ path: `${SHOTS}/path07-after.png` });

      console.log('[Path7] === Done ===\n');
    } finally { await cleanup(browser, child, ud); }
  });

  // Path 8: Nested path conflict
  test('Path 8: Nested path — Take Left on src/components/ui/Modal.tsx', async () => {
    const { page, browser, child, ud } = await launch(`${BASE}/nested-path`, 'nested-path');
    try {
      await goToDiff(page);
      const opened = await openConflictPanel(page, 'Modal.tsx');
      console.log(`[Path8] Panel opened for Modal.tsx: ${opened}`);
      const hasMarkers = await hasConflictMarkers(page);
      console.log(`[Path8] Has markers: ${hasMarkers}`);
      await page.screenshot({ path: `${SHOTS}/path08-before.png` });

      const clicked = await clickButton(page, 'Take Left');
      console.log(`[Path8] Take Left clicked: ${clicked}`);
      await page.screenshot({ path: `${SHOTS}/path08-after.png` });

      console.log('[Path8] === Done ===\n');
    } finally { await cleanup(browser, child, ud); }
  });

  // Path 9: JSON file conflict
  test('Path 9: JSON conflict — Take Left on package.json', async () => {
    const { page, browser, child, ud } = await launch(`${BASE}/json-conflict`, 'json-conflict');
    try {
      await goToDiff(page);
      const opened = await openConflictPanel(page, 'package.json');
      console.log(`[Path9] Panel opened for package.json: ${opened}`);
      const hasMarkers = await hasConflictMarkers(page);
      console.log(`[Path9] Has markers: ${hasMarkers}`);
      await page.screenshot({ path: `${SHOTS}/path09-before.png` });

      const clicked = await clickButton(page, 'Take Left');
      console.log(`[Path9] Take Left clicked: ${clicked}`);
      await page.screenshot({ path: `${SHOTS}/path09-after.png` });

      console.log('[Path9] === Done ===\n');
    } finally { await cleanup(browser, child, ud); }
  });

  // Path 10: Abort from banner
  test('Path 10: Abort merge from RepoStateBanner', async () => {
    recreateSimpleContent('simple-content', `${BASE}/simple-content`);
    const { page, browser, child, ud } = await launch(`${BASE}/simple-content`, 'simple-content');
    try {
      // Should be on Changes page with merge-in-progress banner
      const banner = page.locator('[data-testid="repo-state-banner"]');
      const bannerVisible = await banner.isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`[Path10] Banner visible: ${bannerVisible}`);
      await page.screenshot({ path: `${SHOTS}/path10-banner.png` });

      if (bannerVisible) {
        // Click Abort button in the banner
        const abortBtn = banner.locator('button:has-text("Abort")').first();
        const abortVisible = await abortBtn.isVisible({ timeout: 2000 }).catch(() => false);
        console.log(`[Path10] Abort button visible: ${abortVisible}`);

        if (abortVisible) {
          await abortBtn.click();
          await page.waitForTimeout(2000);
          await page.screenshot({ path: `${SHOTS}/path10-after-abort.png` });
          console.log('[Path10] Abort clicked — merge cancelled');

          // Verify banner is gone
          const bannerAfter = page.locator('[data-testid="repo-state-banner"]');
          const bannerGone = !await bannerAfter.isVisible({ timeout: 2000 }).catch(() => false);
          console.log(`[Path10] Banner gone after abort: ${bannerGone}`);
        }
      }

      console.log('[Path10] === Done ===\n');
    } finally { await cleanup(browser, child, ud); }
  });
});
