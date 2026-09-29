/**
 * LIVE 3-WAY EDITOR TEST — the user: «В инструменте 3-way в средней большая
 * проблема редактирования и отображения, сам протестируй, еще и полоса
 * какая-то по середине панели».
 *
 * Creates a REAL conflict in a fixture repo, opens it in the app, launches
 * the 3-way editor (Changes → конфликтный файл → открыть resolve view), then:
 *   T1  the 3-way view renders with Ours/Result/Theirs panes
 *   T2  MIDDLE PANE EDITING — type text into the result textarea, verify the
 *       value changes AND the highlight layer follows (no desync)
 *   T3  no foreign vertical stripe in the middle pane (screenshot + DOM scan
 *       for full-height border/stripe elements)
 *   T4  splitters exist between Ours|Result and Result|Theirs and dragging
 *       changes column widths
 *   T5  headers align with body columns (left % width mirrors body)
 *
 * Usage: DISPLAY=:99 node scripts/diagnose-3way.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/three-way-test';
const REPO = path.join(ROOT, 'repo');
const SHOTS = '/home/z/my-project/work/three-way-shots';
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(REPO, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'] });
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
  console.log(`     📸 ${name}.png`);
};

// ── 1. Fixture: a real conflict ────────────────────────────────────────────
sh('git init -q -b main');
sh('git config user.email a@a.a && git config user.name A');
fs.writeFileSync(path.join(REPO, 'conflict.txt'), 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n');
sh('git add -A && git commit -q -m base');
// ours
fs.writeFileSync(path.join(REPO, 'conflict.txt'), 'line1\nOURS VERSION\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n');
sh('git commit -q -am ours');
// theirs from base
sh('git checkout -q -b feature -c `git rev-parse HEAD~1` || git checkout -q -b feature HEAD~1');
fs.writeFileSync(path.join(REPO, 'conflict.txt'), 'line1\nTHEIRS VERSION\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n');
sh('git add -A && git commit -q -m theirs');
sh('git checkout -q main');
sh('git merge feature || true');
const status = sh('git status --porcelain');
console.log('conflict state:', status.trim().split('\n').filter(l => l.includes('UU') || l.includes('AA')));

// ── 2. Launch ──────────────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-3way-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: false, locale: 'ru' },
  repositories: [{ path: REPO, name: 'repo', lastOpened: Date.now(), pinned: false }],
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
await page.locator('button:has-text("repo")').first().click();
await page.waitForTimeout(4000);

// ── 3. Open the conflict file in the 3-way view ────────────────────────────
// The conflict row: context menu «Разрешить конфликт» / double-click on the
// conflicted file opens ConflictMergeView. Try the Conflicts section row.
const conflictRow = page.locator('text=conflict.txt').first();
check('C1 conflicted file visible in Changes', await conflictRow.count() > 0);
await conflictRow.dblclick().catch(() => {});
await page.waitForTimeout(1500);
// If dblclick did not open the 3-way, try the context menu resolve action.
let threeWay = page.locator('[data-testid="merge-scroll-container"]').first();
if (await threeWay.count() === 0) {
  await conflictRow.click({ button: 'right' }).catch(() => {});
  await page.waitForTimeout(600);
  const resolveBtn = page.locator('text=Разрешить').first();
  if (await resolveBtn.count() > 0) {
    await resolveBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
  } else {
    // try the Conflict banner's «Открыть»/«Разрешить» button
    await page.locator('button:has-text("Разрешить"), button:has-text("Конфликт")').first().click().catch(() => {});
    await page.waitForTimeout(1500);
  }
  threeWay = page.locator('[data-testid="merge-scroll-container"]').first();
}
check('T1 3-way view opened', await threeWay.count() > 0);
await shot(page, '01-3way-opened');
if (await threeWay.count() === 0) {
  console.log('3-way did not open — dumping page state');
  await shot(page, '00-changes-state');
  await app.close();
  process.exit(1);
}

// ── T2: middle pane editing ────────────────────────────────────────────────
const ta = page.locator('[data-testid="merge-result-textarea"]').first();
check('T2 result textarea present', await ta.count() > 0);
await ta.click().catch(() => {});
await page.keyboard.type('EDITED ').catch(() => {});
await page.waitForTimeout(700);
const value = await ta.inputValue().catch(() => '');
check('T2 typing changed the result value', value.includes('EDITED'), `len=${value.length}`);
// highlight layer follows (debounced 150ms)
await page.waitForTimeout(600);
const preText = await page.locator('[data-testid="merge-result-column"] pre').first().textContent().catch(() => '');
check('T2 highlight layer follows edits', (preText || '').includes('EDITED'));
await shot(page, '02-middle-edited');

// ── T3: foreign stripe in the middle pane ─────────────────────────────────
// Screenshot + geometric scan: find any element in the middle column that
// renders as a tall thin stripe (height > 60% of the column, width < 12px).
const stripes = await page.evaluate(() => {
  const col = document.querySelector('[data-testid="merge-result-column"]');
  if (!col) return [];
  const colRect = col.getBoundingClientRect();
  const out = [];
  for (const el of col.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height > colRect.height * 0.5 && r.width <= 14) {
      const cs = getComputedStyle(el);
      out.push({
        tag: el.tagName, w: Math.round(r.width), h: Math.round(r.height),
        x: Math.round(r.x - colRect.x), bg: cs.backgroundColor, border: cs.borderRightWidth + '/' + cs.borderLeftWidth,
      });
    }
  }
  return out;
});
check('T3 no full-height stripe inside the middle column', stripes.length === 0, JSON.stringify(stripes.slice(0, 3)));
await shot(page, '03-stripe-check');

// ── T4: splitters ──────────────────────────────────────────────────────────
const splitterCount = await page.locator('[data-testid="merge-scroll-container"] [class*="resiz"], [data-testid*="splitter"]').count().catch(() => 0);
const cursorCount = await page.evaluate(() =>
  document.querySelectorAll('[data-testid="merge-scroll-container"] *').length &&
  [...document.querySelectorAll('[data-testid="merge-scroll-container"] *')].filter(el =>
    getComputedStyle(el).cursor === 'col-resize').length);
check('T4 two col-resize splitters in the 3-way view', cursorCount === 2, `found=${cursorCount}, classCount=${splitterCount}`);
// drag the left splitter → column widths change
const widthsBefore = await page.evaluate(() => {
  const sc = document.querySelector('[data-testid="merge-scroll-container"]');
  const first = sc?.firstElementChild;
  const mid = document.querySelector('[data-testid="merge-result-column"]');
  return { left: first ? Math.round(first.getBoundingClientRect().width) : 0, mid: mid ? Math.round(mid.getBoundingClientRect().width) : 0 };
});
const splitterBox = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-testid="merge-scroll-container"] *')].find(e => getComputedStyle(e).cursor === 'col-resize');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (splitterBox) {
  await page.mouse.move(splitterBox.x, splitterBox.y);
  await page.mouse.down();
  await page.mouse.move(splitterBox.x + 80, splitterBox.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const widthsAfter = await page.evaluate(() => {
    const sc = document.querySelector('[data-testid="merge-scroll-container"]');
    const first = sc?.firstElementChild;
    const mid = document.querySelector('[data-testid="merge-result-column"]');
    return { left: first ? Math.round(first.getBoundingClientRect().width) : 0, mid: mid ? Math.round(mid.getBoundingClientRect().width) : 0 };
  });
  check('T4 dragging the splitter resizes panes',
    Math.abs(widthsAfter.left - widthsBefore.left) > 20,
    `left ${widthsBefore.left}→${widthsAfter.left}, mid ${widthsBefore.mid}→${widthsAfter.mid}`);
} else {
  check('T4 dragging the splitter resizes panes', false, 'no splitter found');
}
await shot(page, '04-after-drag');

// ── T5: header/body column alignment ───────────────────────────────────────
const alignment = await page.evaluate(() => {
  // header row = the flex row just above the scroll container
  const sc = document.querySelector('[data-testid="merge-scroll-container"]');
  const header = sc ? sc.previousElementSibling : null;
  if (!sc || !header) return { ok: false, reason: 'not found' };
  const hsAll = [...header.children].map(c => Math.round(c.getBoundingClientRect().width)); const hs = [hsAll[0], hsAll[2], hsAll[4] ?? hsAll[hsAll.length - 1]];
  const leftPane = sc.firstElementChild;
  const rightPane = sc.lastElementChild;
  const mid = document.querySelector('[data-testid="merge-result-column"]');
  const lw = leftPane ? Math.round(leftPane.getBoundingClientRect().width) : 0;
  const rw = rightPane ? Math.round(rightPane.getBoundingClientRect().width) : 0;
  const mw = mid ? Math.round(mid.getBoundingClientRect().width) : 0;
  return { ok: Math.abs(hs[0] - lw) < 8 && Math.abs(hs[2] - rw) < 8, hs, body: [lw, mw, rw] };
});
check('T5 pane headers align with body columns', alignment.ok, JSON.stringify(alignment));
await shot(page, '05-header-alignment');

console.log(`\n════ 3-way live test: ${failures === 0 ? 'ALL PASSED' : failures + ' FAILURES'} ════`);
await app.close().catch(() => {});
process.exit(failures === 0 ? 0 : 1);
