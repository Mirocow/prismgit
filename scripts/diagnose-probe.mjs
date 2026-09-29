/**
 * PERF PROBE — enumerate the exact git commands each user action spawns in
 * the MAIN process (the app's own command log), incl. a commit-row click
 * (branchesContaining / commit card) and tool re-opens (cache behavior).
 *
 * Usage: DISPLAY=:99 node scripts/diagnose-probe.mjs
 */
import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const BIG = '/home/z/my-project/work/perf-diag3/big20k';
const OUT = '/home/z/my-project/work/perf-diag3/probe.json';
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-probe-'));
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

const dump = () => page.evaluate(async () => (await window.smartgit.commandLog.list())
  .map((e) => ({ ts: e.timestamp, ms: e.durationMs, cmd: (Array.isArray(e.args) ? e.args.join(' ') : String(e.args)).slice(0, 120) })));
const since = async (label, prevCount) => {
  const all = await dump();
  const fresh = all.slice(prevCount);
  console.log(`\n=== ${label}: +${fresh.length} main-process spawns ===`);
  for (const e of fresh) console.log(`   ${Math.round(e.ms)}ms  ${e.cmd}`);
  return all.length;
};
let n = (await dump()).length;
const goto = async (h) => { await page.evaluate((x) => { window.location.hash = x; }, h); await page.waitForTimeout(3000); };

await goto('#/history'); n = await since('HISTORY-1st-open', n);
await goto('#/changes'); await goto('#/history'); n = await since('HISTORY-2nd-open (cache?)', n);
// click a visible commit row → commit card (branchesContaining + tagsHere)
const row = page.locator('[data-testid="commit-row"], [data-testid*="commit"]').first();
await row.click().catch(() => page.mouse.click(700, 300));
await page.waitForTimeout(2500);
n = await since('COMMIT-ROW-CLICK', n);
const row2 = page.locator('[data-testid="commit-row"], [data-testid*="commit"]').nth(3);
await row2.click().catch(() => {});
await page.waitForTimeout(2500);
n = await since('COMMIT-ROW-CLICK-2 (cache?)', n);
await goto('#/branches'); n = await since('BRANCHES-1st-open', n);
await goto('#/changes'); await goto('#/branches'); n = await since('BRANCHES-2nd-open (cache?)', n);
await goto('#/stashes'); n = await since('STASHES-open', n);
await goto('#/search'); n = await since('SEARCH-open', n);
await page.evaluate(() => window.smartgit.commandLog.list().length);

fs.writeFileSync(OUT, JSON.stringify(await dump(), null, 2));
console.log(`\nfull log → ${OUT} (500-entry ring)`);
await app.close().catch(() => {});
process.exit(0);
