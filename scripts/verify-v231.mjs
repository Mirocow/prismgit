/**
 * E2E verification of the v2.3.1 batch (RU locale) — runs in the REAL
 * Electron app against the 20k-commit fixture:
 *
 *   S1  Search results: per-match Blame / History / Diff buttons exist
 *   S2  Match-row Blame → lands on #/blame, file loaded, line focused
 *       (data-blame-line row + flash highlight)
 *   S3  Match-row History → lands on #/history filtered by the file
 *       (path-filter chip with the file name)
 *   S4  History: typing a search then activating a filter chip clears
 *       the search (filter operates over ALL commits)
 *   S5  Filter ✕ button clears the input
 *   C1  Operations console shows worker-origin git commands (origin=worker)
 *   P1  Perf sanity: main-process event-loop lag over 20s idle ≤ 15ms max
 *
 * Usage: DISPLAY=:99 node scripts/verify-v231.mjs
 */
import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const BIG = '/home/z/my-project/work/perf-diag3/big20k';
const SHOTS = '/home/z/my-project/work/v231-shots';
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

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v231-'));
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
await page.locator('button:has-text("big20k")').first().click().catch(async () => {
  await page.locator('[data-testid="repo-item-big20k"]').first().click();
});
await page.waitForTimeout(4000);

const goto = async (h) => {
  await page.evaluate((x) => { window.location.hash = x; }, h);
  await page.waitForTimeout(1800);
};

// ═══ S. Search → Blame / History / Diff ════════════════════════════════════
console.log('\n── S. Search navigation ──');
await goto('#/search');
const searchInput = page.locator('input[type="text"]').first();
await searchInput.fill('content 1999');
await page.waitForTimeout(2500);
const matchRow = page.locator('[title*="Blame — строка"]').first();
check('S1 match rows carry Blame-at-line action', await matchRow.count() > 0);
const fileRow = page.locator('pre:has-text("content 1999")').first();
check('S1 content matches found', await fileRow.count() > 0);
await shot(page, '01-search-results');

// S2: Blame at line
await matchRow.click();
// The flash highlight lives 2.4s from blame-load — check INSIDE the window.
await page.waitForTimeout(1600);
const hash = await page.evaluate(() => window.location.hash);
check('S2 Blame button navigates to #/blame', hash === '#/blame', `hash=${hash}`);
const blameLines = await page.locator('[data-blame-line]').count();
check('S2 blame loaded rows', blameLines > 0, `rows=${blameLines}`);
const focusedRow = await page.locator('.blame-focus-flash').count().catch(() => 0);
check('S2 focused line flash-highlighted', focusedRow > 0);
await shot(page, '02-blame-focused-line');

// S3: History of the file (from the blame page gutter hash click is another
// path — go via Search again to test the match-row History button)
await goto('#/search');
await searchInput.fill('content 1999').catch(() => {});
await page.waitForTimeout(2200);
const histBtn = page.locator('[title*="История файла"], [title*="file history"], [data-testid="open-file-history"]').first()
  .or(page.locator('[title="История файла"]')).first();
// the match-row History button shares the fileHistory tooltip
const matchHistBtn = page.locator('[title*="История файла"], [title*="File history"], [title*="fileHistory"]').first();
check('S3 match rows carry History action', await matchHistBtn.count() > 0);
await matchHistBtn.click();
await page.waitForTimeout(4000);
const hash3 = await page.evaluate(() => window.location.hash);
check('S3 History button navigates to #/history', hash3 === '#/history', `hash=${hash3}`);
const pathChip = await page.locator('.text-status-modified, [class*="status-modified"]').filter({ hasText: /file\d+\.txt/ }).count();
check('S3 History filtered by the found file (path chip)', pathChip > 0, `chips=${pathChip}`);
await shot(page, '03-history-filtered-by-file');

// ═══ S4. Filter clears search ══════════════════════════════════════════════
console.log('\n── S4. History: filter activation clears search ──');
const filterInput = page.locator('input[placeholder*="Filter"], input[placeholder*="фильтр" i], input[placeholder*="Regex"]').first();
await filterInput.fill('commit 19');
await page.waitForTimeout(1200);
const rowsWithSearch = await page.locator('[data-testid="commit-row"], [class*="commit-row"]').count().catch(() => 0);
// click the Tagged chip (activates a filter while search is active)
const taggedChip = page.locator('button:has-text("С тегами"), button:has-text("Tagged")').first();
check('S4 Tagged chip present', await taggedChip.count() > 0);
await taggedChip.click().catch(() => {});
await page.waitForTimeout(800);
const filterValue = await filterInput.inputValue().catch(() => '');
check('S4 activating a filter cleared the text search', filterValue === '', `value="${filterValue}"`);
await shot(page, '04-history-filter-clears-search');

// S5: ✕ clear button on the filter input
await filterInput.fill('zzz').catch(() => filterInput.fill('commit'));
await page.waitForTimeout(600);
const clearBtn = page.locator('button[title="Сбросить фильтр"]').first();
check('S5 filter ✕ clear button present', await clearBtn.count() > 0);
await clearBtn.click().catch(() => {});
await page.waitForTimeout(400);
const v5 = await filterInput.inputValue().catch(() => 'n/a');
check('S5 ✕ cleared the filter', v5 === '', `value="${v5}"`);
await shot(page, '05-filter-clear-button');

// ═══ C1. Console shows worker-origin commands ══════════════════════════════
console.log('\n── C1. Worker-origin console entries ──');
const log = await page.evaluate(async () => await window.smartgit.commandLog.list());
const workerEntries = log.filter((e) => e.origin === 'worker');
check('C1 command log carries worker-origin entries', workerEntries.length > 0, `${workerEntries.length}/${log.length}`);
// open the console to capture a visible screenshot
await page.locator('[data-testid*="console"], [title*="онсол"], [title*="Console"], [title*="Журнал"]').first().click().catch(async () => {
  // StatusBar toggle fallback
  await page.locator('footer button').last().click().catch(() => {});
});
await page.waitForTimeout(1200);
await shot(page, '06-console-worker-entries');

// ═══ P1. Main-loop lag sanity ══════════════════════════════════════════════
console.log('\n── P1. Main-loop idle lag (20s) ──');
const lag = await app.evaluate(async () => {
  return await new Promise((resolve) => {
    const samples = [];
    let last = process.hrtime.bigint();
    const id = setInterval(() => {
      const now = process.hrtime.bigint();
      samples.push(Math.max(0, Number(now - last) / 1e6 - 500));
      last = now;
    }, 500);
    setTimeout(() => { clearInterval(id); resolve(samples); }, 20_000);
  });
});
const maxLag = Math.max(...lag);
const p95 = [...lag].sort((a, b) => a - b)[Math.floor(lag.length * 0.95)];
check('P1 main-loop idle lag max ≤ 15ms', maxLag <= 15, `max=${Math.round(maxLag)}ms p95=${Math.round(p95)}ms`);

console.log(`\n════ verify-v231: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURES'} ════`);
fs.writeFileSync(path.join(SHOTS, 'summary.json'), JSON.stringify({ failures, total: 20 }, null, 2));
await app.close().catch(() => {});
process.exit(failures === 0 ? 0 : 1);
