/**
 * E2E verification of the v2.3.5 batch (RU locale) — the REAL app:
 *
 *   H1  History author filter is SERVER-SIDE: a fresh page-1 (100 commits,
 *       two interleaved authors) + author filter → ONLY that author's rows,
 *       no scrolling; the Operations console shows the `--author=` argv
 *   N1  Back/Forward is project-scoped: works within the repo, WIPED after
 *       a repository switch; Settings exposes the limit (default 10)
 *   T1  3-way middle pane: conflict MARKER rows render neutral (no red
 *       band — the «полоса по центру центральной панели»); ours/theirs
 *       content bands softened to 0.20
 *
 * Usage: DISPLAY=:99 node scripts/verify-v235.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/v235-fixture';
const AUTHORS = path.join(ROOT, 'authors-repo');   // 2 interleaved authors × 130
const CONFLICT = path.join(ROOT, 'conflict-repo'); // a small real conflict
const SHOTS = '/home/z/my-project/work/v235-shots';
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(AUTHORS, { recursive: true });
fs.mkdirSync(CONFLICT, { recursive: true });
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
  await page.waitForTimeout(1600);
};
const sh = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8', shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'] });

// ── Fixture 1: two interleaved authors, 260 commits ────────────────────────
sh('git init -q -b main', AUTHORS);
sh('git config user.name seed && git config user.email seed@example.com', AUTHORS);
fs.writeFileSync(path.join(AUTHORS, 'file.txt'), 'init\n');
sh('git add -A && git commit -q -m init', AUTHORS);
for (let i = 1; i <= 130; i++) {
  fs.writeFileSync(path.join(AUTHORS, 'file.txt'), `solo line ${i}\nother line ${i}\n`);
  sh('git config user.name soloauthor && git config user.email solo@example.com', AUTHORS);
  sh('git add -A && git commit -q -m "solo change ' + i + '"', AUTHORS);
  fs.writeFileSync(path.join(AUTHORS, 'file.txt'), `solo line ${i}\nother line ${i}\nedited by other ${i}\n`);
  sh('git config user.name otherauthor && git config user.email other@example.com', AUTHORS);
  sh('git add -A && git commit -q -m "other change ' + i + '"', AUTHORS);
}

// ── Fixture 2: a real conflict ──────────────────────────────────────────────
sh('git init -q -b main', CONFLICT);
sh('git config user.email a@a.a && git config user.name A', CONFLICT);
fs.writeFileSync(path.join(CONFLICT, 'conflict.txt'), 'line1\nmid line\nline3\n');
sh('git add -A && git commit -q -m base', CONFLICT);
fs.writeFileSync(path.join(CONFLICT, 'conflict.txt'), 'line1\nOURS mid\nline3\n');
sh('git commit -q -am ours', CONFLICT);
sh('git checkout -q -b feature HEAD~1', CONFLICT);
fs.writeFileSync(path.join(CONFLICT, 'conflict.txt'), 'line1\nTHEIRS mid\nline3\n');
sh('git add -A && git commit -q -m theirs', CONFLICT);
sh('git checkout -q main', CONFLICT);
sh('git merge feature || true', CONFLICT);

// ── Launch ──────────────────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v235-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: false, locale: 'ru' },
  repositories: [
    { path: AUTHORS, name: 'authors-repo', lastOpened: Date.now(), pinned: false },
    { path: CONFLICT, name: 'conflict-repo', lastOpened: Date.now() - 1000, pinned: false },
  ],
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1560, height: 960 }, isMaximized: false, isFullScreen: false },
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
await page.locator('button:has-text("authors-repo")').first().click();
await page.waitForTimeout(4000);

// ═══ H. History author filter — server-side ═══════════════════════════════
console.log('\n── H. History: author filter (server-side) ──');
await goto(page, '#/history');
await page.waitForTimeout(2500);
// Baseline: page 1 contains BOTH authors (100 commits interleaved)
const soloRowsBefore = await page.locator('text=solo change').count();
const otherRowsBefore = await page.locator('text=other change').count();
check('H1 baseline: unfiltered page-1 shows both authors', soloRowsBefore > 0 && otherRowsBefore > 0,
  `solo=${soloRowsBefore}, other=${otherRowsBefore}`);

// Open the "More filters" row, then type the author filter — the server
// re-runs git log --author (300ms debounce)
await page.locator('button[title="More filters"]').first().click();
await page.waitForTimeout(600);
const authorInput = page.locator('label:has-text("Author:") input').first();
check('H1 author input present', await authorInput.count() > 0);
await authorInput.fill('soloauthor');
await page.waitForTimeout(2200); // debounce 300 + git log + render
await shot(page, '01-author-filtered');
const soloRowsAfter = await page.locator('text=solo change').count();
const otherRowsAfter = await page.locator('text=other change').count();
check('H1 filtered list shows ONLY soloauthor commits (no scrolling!)', soloRowsAfter >= 25 && otherRowsAfter === 0,
  `solo=${soloRowsAfter}, other=${otherRowsAfter}`);

// The Operations console (command log API) shows the --author argv —
// the honest cross-process record of what git actually ran.
const cmdLog = await page.evaluate(async () => await window.smartgit.commandLog.list());
const authorCmd = (cmdLog || []).find((e) =>
  String(e.command || e.cmd || (e.args || []).join(' ')).includes('--author=soloauthor'));
check('H1 the command log carries the --author=soloauthor argv', !!authorCmd,
  `entries=${(cmdLog || []).length}`);
await shot(page, '02-console-author-arg');

// Clear the filter → history returns
await authorInput.fill('');
await page.waitForTimeout(2000);
const otherRowsRestored = await page.locator('text=other change').count();
check('H1 clearing the filter restores the full history', otherRowsRestored > 0, `other=${otherRowsRestored}`);

// ═══ N. Back/Forward — project-scoped ═════════════════════════════════════
console.log('\n── N. Back/Forward: project scope ──');
await goto(page, '#/branches');
await goto(page, '#/tags');
const backBtn = page.locator('button[title*="Назад"]').first();
check('N1 Back enabled after in-project navigation', await backBtn.isEnabled());
await backBtn.click();
await page.waitForTimeout(1200);
const hashAfterBack = await page.evaluate(() => window.location.hash);
check('N1 Back navigated within the project', hashAfterBack === '#/branches', `hash=${hashAfterBack}`);

// Switch the repository → the history must RESET
await shot(page, '05-before-repo-switch');
const repoButtons = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter((t) => t.includes('repo') || t.includes('authors') || t.includes('conflict')).slice(0, 12));
fs.writeFileSync(path.join(SHOTS, 'repo-buttons.json'), JSON.stringify(repoButtons, null, 2));
await page.locator('button:has-text("conflict-repo")').first().click({ timeout: 8000 }).catch(async () => {
  // fall back to the repo list dropdown in the sidebar header
  await page.locator('[data-testid="repo-item-conflict-repo"]').first().click().catch(() => {});
});
await page.waitForTimeout(3500);
const backAfterSwitch = page.locator('button[title*="Назад"]').first();
check('N1 Back DISABLED after switching the project (history wiped)', !(await backAfterSwitch.isEnabled()));

// Settings: the limit row (default 10)
await goto(page, '#/settings');
await page.locator('button:has-text("Пользовательский интерфейс")').first().click().catch(() => {});
await page.waitForTimeout(900);
const limitSelect = page.locator('[data-testid="nav-history-limit-select"]').first();
check('N1 Settings exposes the history limit select', await limitSelect.count() > 0);
const limitValue = await limitSelect.inputValue().catch(() => '');
check('N1 default limit is 10', limitValue === '10', `value=${limitValue}`);
await shot(page, '03-settings-history-limit');

// ═══ T. 3-way — markers neutral ════════════════════════════════════════════
console.log('\n── T. 3-way: marker rows neutral (no red band) ──');
// We're already in the conflict repo — go to Changes and open the 3-way
await goto(page, '#/changes');
await page.waitForTimeout(2000);
const conflictRow = page.locator('text=conflict.txt').first();
await conflictRow.dblclick().catch(() => {});
await page.waitForTimeout(1800);
let threeWay = page.locator('[data-testid="merge-scroll-container"]').first();
if (await threeWay.count() === 0) {
  await conflictRow.click({ button: 'right' }).catch(() => {});
  await page.waitForTimeout(600);
  const resolveBtn = page.locator('text=Разрешить').first();
  if (await resolveBtn.count() > 0) { await resolveBtn.click().catch(() => {}); await page.waitForTimeout(1800); }
  threeWay = page.locator('[data-testid="merge-scroll-container"]').first();
}
check('T1 3-way view opened', await threeWay.count() > 0);
const markerColors = await page.evaluate(() => {
  // The result column's highlight rows: classify by their inline background
  const col = document.querySelector('[data-testid="merge-result-column"]');
  if (!col) return { found: false };
  const rows = [...col.querySelectorAll('div[style*="position:absolute"]')];
  const bgs = new Map();
  for (const r of rows) {
    const bg = (r.getAttribute('style') || '').match(/background-color:\s*([^;]+);/)?.[1] ?? 'none';
    bgs.set(bg, (bgs.get(bg) ?? 0) + 1);
  }
  return { found: true, bgs: [...bgs.entries()] };
});
check('T1 marker rows render with the NEUTRAL tertiary background', markerColors.found &&
  markerColors.bgs.some(([bg]) => bg.includes('var(--bg-tertiary)')),
  JSON.stringify(markerColors.bgs));
check('T1 NO red band left (rgba(220,38,38) gone)', markerColors.found &&
  !markerColors.bgs.some(([bg]) => bg.includes('220, 38, 38')),
  JSON.stringify(markerColors.bgs));
check('T1 ours/theirs content bands at 0.20', markerColors.found &&
  markerColors.bgs.some(([bg]) => bg.includes('rgba(34, 197, 94, 0.2')) &&
  markerColors.bgs.some(([bg]) => bg.includes('rgba(59, 130, 246, 0.2')));
await shot(page, '04-3way-neutral-markers');

console.log(`\n════ verify-v235: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURES'} ════`);
await app.close().catch(() => {});
process.exit(failures === 0 ? 0 : 1);
