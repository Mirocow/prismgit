/**
 * Reproduce the user's NEW 3-way report: «полоса появляется при клике на
 * среднюю панель или при фокусе ее» (v2.3.5 already neutralized the STATIC
 * marker bands — this one appears ONLY on click/focus).
 *
 * Suspect (static analysis): the Result pane is a FULL-PANE textarea; global
 * `textarea:focus-visible { outline: 2px solid var(--accent) }` in globals.css
 * paints a ring around the pane-sized textarea → accent stripes on pane edges.
 * Chromium matches :focus-visible for text inputs EVEN ON MOUSE CLICK.
 *
 * Proof collected here:
 *   1. computed style of the textarea before/after a real mouse click
 *      (outline, position, z-index, border-color) + matches(':focus-visible')
 *   2. screenshots idle vs focused vs blurred
 *   3. typing still works after the click (editing regression pin)
 *   4. pixel diff (idle → focused) inside the middle pane → vertical stripes
 *
 * Usage: DISPLAY=:99 node scripts/diagnose-3way-focus-stripe.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/three-way-focus';
const REPO = path.join(ROOT, 'repo');
const SHOTS = ROOT;
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(REPO, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'] });

// Same realistic fixture as Task 36: tall file, conflict in the middle
const longLine = (i) => `function handleRequest${i}(payload, context) { return processPipeline${i}(payload, context, { retries: 3, timeout: 30000, fallback: 'queue', metadata: { source: 'gateway', requestId: context.id, spanId: context.trace.span } }); } // end of line ${i}`;
const base = (mid) => {
  const lines = [];
  for (let i = 1; i <= 40; i++) lines.push(longLine(i));
  if (mid) lines.push('center line common');
  for (let i = 41; i <= 80; i++) lines.push(longLine(i));
  return lines.join('\n') + '\n';
};

sh('git init -q -b main');
sh('git config user.email a@a.a && git config user.name A');
fs.writeFileSync(path.join(REPO, 'conflict.txt'), base(true));
sh('git add -A && git commit -q -m base');
fs.writeFileSync(path.join(REPO, 'conflict.txt'), base(true).replace('center line common', 'OURS center line version A'));
sh('git commit -q -am ours');
sh('git checkout -q -b feature HEAD~1');
fs.writeFileSync(path.join(REPO, 'conflict.txt'), base(true).replace('center line common', 'THEIRS center line version B'));
sh('git add -A && git commit -q -m theirs');
sh('git checkout -q main');
sh('git merge feature || true');
console.log('conflict state:', sh('git status --porcelain').trim());

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-focus-'));
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
if (await threeWay.count() === 0) { console.log('3-way did not open'); await app.close(); process.exit(1); }

// ── Computed-style probe of the middle textarea ───────────────────────────
const probe = () => page.evaluate(() => {
  const ta = document.querySelector('[data-testid="merge-result-textarea"]');
  if (!ta) return null;
  const cs = getComputedStyle(ta);
  const r = ta.getBoundingClientRect();
  return {
    active: document.activeElement === ta,
    focusVisible: ta.matches(':focus-visible'),
    outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`,
    outlineOffset: cs.outlineOffset,
    position: cs.position,
    zIndex: cs.zIndex,
    borderColor: cs.borderColor,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
  };
});

console.log('BEFORE CLICK:', JSON.stringify(await probe(), null, 2));
await page.screenshot({ path: path.join(SHOTS, '01-idle.png') });

// ── REAL MOUSE CLICK into the middle pane (context line ~5, past gutter) ──
const ta = page.locator('[data-testid="merge-result-textarea"]');
await ta.click({ position: { x: 300, y: 110 } });
await page.waitForTimeout(400);
console.log('AFTER CLICK:', JSON.stringify(await probe(), null, 2));
await page.screenshot({ path: path.join(SHOTS, '02-focused.png') });

// ── Editing regression: caret placed, typing works ─────────────────────────
const typed = await page.evaluate(() => {
  const t = document.querySelector('[data-testid="merge-result-textarea"]');
  const before = t.value;
  t.setRangeText('X', 0, 0, 'end');
  t.dispatchEvent(new Event('input', { bubbles: true }));
  return { before: before.slice(0, 30), afterLen: t.value.length, beforeLen: before.length };
});
console.log('TYPING:', JSON.stringify(typed));
await page.waitForTimeout(200);

// ── Blur: click the OURS pane header area (outside the textarea) ───────────
const ours = page.locator('[data-testid="merge-pane-ours"]').first();
if (await ours.count() > 0) {
  await ours.click({ position: { x: 40, y: 8 } }).catch(() => {});
} else {
  await page.keyboard.press('Escape').catch(() => {});
}
await page.waitForTimeout(400);
console.log('AFTER BLUR:', JSON.stringify(await probe(), null, 2));
await page.screenshot({ path: path.join(SHOTS, '03-blurred.png') });

// Middle-pane rect for the Python pixel-diff step
const midRect = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="merge-result-column"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
});
fs.writeFileSync(path.join(SHOTS, 'mid-rect.json'), JSON.stringify(midRect));
console.log('MID RECT:', JSON.stringify(midRect));
console.log('SHOTS saved to', SHOTS);
await app.close().catch(() => {});
