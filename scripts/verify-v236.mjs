/**
 * E2E verification of the v2.3.6 fix (RU locale) — the REAL app:
 *
 *   F1  3-way middle pane: REAL mouse click into the Result pane → NO focus
 *       stripe: computed outline stays invisible, position stays absolute,
 *       textarea width stays == pane width (the 385→201px collapse is gone)
 *   F2  the caret still works: click → focus lands, typing edits the file,
 *       the highlight layer follows (90ms debounce)
 *   F3  blur (click elsewhere) → clean state, no residue
 *   R1  regression: v2.3.5 marker neutrality still in place (no red band)
 *
 * Usage: DISPLAY=:99 node scripts/verify-v236.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/v236-fixture';
const REPO = path.join(ROOT, 'conflict-repo');
const SHOTS = '/home/z/my-project/work/v236-shots';
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(REPO, { recursive: true });
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
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'] });

// ── Fixture: a real conflict, tall file, conflict in the middle ─────────────
sh('git init -q -b main');
sh('git config user.email a@a.a && git config user.name A');
const longLine = (i) => `function handleRequest${i}(payload, context) { return processPipeline${i}(payload, context, { retries: 3, timeout: 30000, fallback: 'queue' }); } // end ${i}`;
const base = () => {
  const lines = [];
  for (let i = 1; i <= 40; i++) lines.push(longLine(i));
  lines.push('center line common');
  for (let i = 41; i <= 80; i++) lines.push(longLine(i));
  return lines.join('\n') + '\n';
};
fs.writeFileSync(path.join(REPO, 'conflict.txt'), base());
sh('git add -A && git commit -q -m base');
fs.writeFileSync(path.join(REPO, 'conflict.txt'), base().replace('center line common', 'OURS center line'));
sh('git commit -q -am ours');
sh('git checkout -q -b feature HEAD~1');
fs.writeFileSync(path.join(REPO, 'conflict.txt'), base().replace('center line common', 'THEIRS center line'));
sh('git add -A && git commit -q -m theirs');
sh('git checkout -q main');
sh('git merge feature || true');
console.log('conflict state:', sh('git status --porcelain').trim());

// ── Launch ──────────────────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v236-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: false, locale: 'ru' },
  repositories: [{ path: REPO, name: 'conflict-repo', lastOpened: Date.now(), pinned: false }],
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
await page.locator('button:has-text("conflict-repo")').first().click();
await page.waitForTimeout(4000);

const conflictRow = page.locator('text=conflict.txt').first();
await conflictRow.dblclick().catch(() => {});
await page.waitForTimeout(1500);
let threeWay = page.locator('[data-testid="merge-scroll-container"]').first();
if (await threeWay.count() === 0) {
  await conflictRow.click({ button: 'right' }).catch(() => {});
  await page.waitForTimeout(600);
  const resolveBtn = page.locator('text=Разрешить').first();
  if (await resolveBtn.count() > 0) { await resolveBtn.click().catch(() => {}); await page.waitForTimeout(1500); }
  threeWay = page.locator('[data-testid="merge-scroll-container"]').first();
}
check('3-way view opened', (await threeWay.count()) > 0);
if (await threeWay.count() === 0) { await app.close(); process.exit(1); }

// Computed-style probe of the middle textarea
const probe = () => page.evaluate(() => {
  const ta = document.querySelector('[data-testid="merge-result-textarea"]');
  if (!ta) return null;
  const cs = getComputedStyle(ta);
  const pane = document.querySelector('[data-testid="merge-result-column"]');
  const pr = pane?.getBoundingClientRect();
  const r = ta.getBoundingClientRect();
  const outlineInvisible = cs.outlineStyle === 'none'
    || cs.outlineColor === 'rgba(0, 0, 0, 0)' || cs.outlineColor === 'transparent'
    || cs.outlineWidth === '0px';
  return {
    active: document.activeElement === ta,
    outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`,
    outlineInvisible,
    position: cs.position,
    widthFillsPane: pr ? Math.abs(r.width - pr.width) < 2 : false,
    paneW: Math.round(pr?.width ?? 0),
    taW: Math.round(r.width),
  };
});

// ── F1: NO focus stripe on a real mouse click ───────────────────────────────
const before = await probe();
check('F1 idle: outline invisible', before.outlineInvisible, before.outline);
check('F1 idle: position absolute', before.position === 'absolute');
check('F1 idle: textarea fills pane width', before.widthFillsPane, `${before.taW}/${before.paneW}px`);
await shot(page, '01-idle');

await page.locator('[data-testid="merge-result-textarea"]').click({ position: { x: 300, y: 110 } });
await page.waitForTimeout(400);
const focused = await probe();
check('F1 click: textarea IS focused (caret present)', focused.active);
check('F1 click: :focus-visible matched (Chromium text-input heuristic) — and STILL no outline', focused.outlineInvisible, focused.outline);
check('F1 click: position stays absolute (no relative hijack)', focused.position === 'absolute');
check('F1 click: width stays == pane (no 385→201 collapse)', focused.widthFillsPane, `${focused.taW}/${focused.paneW}px`);
await shot(page, '02-focused');

// ── F2: the caret still works — typing edits, highlight follows ─────────────
const typed = await page.evaluate(() => {
  const t = document.querySelector('[data-testid="merge-result-textarea"]');
  t.setRangeText('X', 0, 0, 'end');
  t.dispatchEvent(new Event('input', { bubbles: true }));
  return { len: t.value.length, hasX: t.value.startsWith('X') };
});
await page.waitForTimeout(400); // highlight debounce is 90ms
check('F2 typing edits the Result content', typed.hasX && typed.len > 0, `len=${typed.len}`);
const hl = await page.evaluate(() => {
  const pre = document.querySelector('[data-testid="merge-result-column"] pre');
  return pre ? pre.innerHTML.includes('X') : false;
});
check('F2 highlight layer follows the edit', hl);
await shot(page, '03-typed-highlight');

// ── F3: blur → clean, no residue ────────────────────────────────────────────
const ours = page.locator('[data-testid="merge-pane-ours"]').first();
if (await ours.count() > 0) {
  await ours.click({ position: { x: 40, y: 8 } }).catch(() => {});
}
await page.waitForTimeout(400);
const blurred = await probe();
check('F3 blur: textarea released focus', !blurred.active);
check('F3 blur: no outline residue', blurred.outlineInvisible, blurred.outline);
await shot(page, '04-blurred');

// ── R1: v2.3.5 marker neutrality still in place (no red band) ───────────────
const redRows = await page.evaluate(() => {
  const col = document.querySelector('[data-testid="merge-result-column"]');
  if (!col) return -1;
  let n = 0;
  for (const el of col.querySelectorAll('pre div[style*="background-color"]')) {
    if ((el.getAttribute('style') || '').includes('rgba(220, 38, 38')) n++;
  }
  return n;
});
check('R1 marker rows: no red rgba(220,38,38) bands (v2.3.5 pins hold)', redRows === 0, `redRows=${redRows}`);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURES`);
await app.close().catch(() => {});
process.exit(failures === 0 ? 0 : 1);
