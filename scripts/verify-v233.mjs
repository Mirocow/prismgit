/**
 * E2E verification of the v2.3.3 fix (RU locale) — the REAL app against the
 * 20k-commit fixture:
 *
 *   S1  Commit-result rows: «Открыть в браузере» + «Скопировать хэш коммита»
 *       buttons render at rest opacity (were opacity-0 hover-only — the user
 *       found them "by accident")
 *   S2  File-result rows: Changes / Diff / Blame / History buttons visible
 *       without hover
 *   S3  Content results: file-group header Diff/Blame/History + per-match
 *       buttons visible without hover
 *   S4  Regression: «Коммит» (blame-lookup) still lands on #/history with the
 *       file filter chip
 *
 * Usage: DISPLAY=:99 node scripts/verify-v233.mjs
 */
import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const BIG = '/home/z/my-project/work/perf-diag3/big20k';
const SHOTS = '/home/z/my-project/work/v233-shots';
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
  console.log(`     📸 ${name}.png`);
};
const goto = async (page, h) => {
  await page.evaluate((x) => { window.location.hash = x; }, h);
  await page.waitForTimeout(1800);
};

/** Every button whose title CONTAINS one of `titles` must rest at opacity >= 0.5 (no hover). */
const checkButtonsVisible = async (page, titles, section) => {
  const res = await page.evaluate((ts) => {
    const btns = [...document.querySelectorAll('button')]
      .filter((b) => ts.some((t) => (b.getAttribute('title') || '').includes(t)));
    return {
      count: btns.length,
      minOpacity: btns.length
        ? Math.min(...btns.map((b) => parseFloat(getComputedStyle(b).opacity)))
        : -1,
      hoverOnly: btns.filter((b) => parseFloat(getComputedStyle(b).opacity) === 0).length,
    };
  }, titles);
  check(`${section}: buttons present`, res.count >= titles.length, `count=${res.count}`);
  check(`${section}: ALL visible WITHOUT hover`, res.count > 0 && res.minOpacity >= 0.5,
    `minOpacity=${res.minOpacity}, hoverOnly=${res.hoverOnly}`);
  return res;
};

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v233-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true, locale: 'ru' },
  repositories: [{ path: BIG, name: 'big20k', lastOpened: Date.now(), pinned: false }],
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1500, height: 950 }, isMaximized: false, isFullScreen: false },
}, null, 2));

const app = await electron.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    path.join(process.cwd(), 'dist-electron/main.js')],
  env: { ...process.env, NODE_ENV: 'production', DISPLAY: process.env.DISPLAY || ':99',
    PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'ru' },
});
const page = await app.firstWindow();
page.on('dialog', (d) => d.dismiss().catch(() => {}));
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);
await page.locator('button:has-text("big20k")').first().click();
await page.waitForTimeout(4000);

await goto(page, '#/search');
const searchInput = page.locator('input[type="text"]').first();
await searchInput.fill('commit 19');
await page.waitForTimeout(2500);

// ═══ S1. Commit-result rows ════════════════════════════════════════════════
console.log('\n── S1. Commit rows: browser + copy buttons ──');
await checkButtonsVisible(page, ['Открыть в браузере', 'Скопировать хэш коммита'], 'S1 commit rows');
await shot(page, '01-commit-row-buttons');

// ═══ S2. File-result rows ══════════════════════════════════════════════════
console.log('\n── S2. File rows: Changes/Diff/Blame/History ──');
await searchInput.fill('file1');
await page.waitForTimeout(2500);
await checkButtonsVisible(page,
  ['Открыть в Изменениях', 'Открыть в инструменте Diff', 'Открыть в инструменте Blame', 'История файла'],
  'S2 file rows');
await shot(page, '02-file-row-buttons');

// ═══ S3. Content matches: group header + match rows ════════════════════════
console.log('\n── S3. Content results: header + per-match buttons ──');
await searchInput.fill('content 1999');
await page.waitForTimeout(2500);
await checkButtonsVisible(page,
  ['Открыть в инструменте Diff', 'Открыть в инструменте Blame', 'История файла'],
  'S3 content group headers');
await checkButtonsVisible(page, ['Открыть коммит, внёсший строку'], 'S3 match rows «Коммит»');
await shot(page, '03-content-buttons');

// ═══ S4. Regression: «Коммит» still navigates to History ═══════════════════
console.log('\n── S4. «Коммит» jump regression ──');
const commitBtn = page.locator('button[title*="Открыть коммит, внёсший строку"]').first();
check('S4 «Коммит» button present', await commitBtn.count() > 0);
await commitBtn.click();
await page.waitForTimeout(4000);
const hashS = await page.evaluate(() => window.location.hash);
check('S4 «Коммит» lands on #/history', hashS === '#/history', `hash=${hashS}`);
const pathChipS = await page.locator('.text-status-modified, [class*="status-modified"]').filter({ hasText: /file\d+\.txt/ }).count();
check('S4 History filtered by the found file', pathChipS > 0, `chips=${pathChipS}`);
await shot(page, '04-commit-in-history');

console.log(`\n════ verify-v233: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURES'} ════`);
await app.close().catch(() => {});
process.exit(failures === 0 ? 0 : 1);
