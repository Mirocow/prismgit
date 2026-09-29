/**
 * Reproduce the user's «полоса по центру центральной панели» with a REALISTIC
 * conflict: long lines (horizontal scroll territory) + a tall file with the
 * conflict deep inside. Pixel-analyze the middle pane + VLM the screenshot.
 *
 * Usage: DISPLAY=:99 node scripts/diagnose-3way-stripe.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/three-way-stripe';
const REPO = path.join(ROOT, 'repo');
const SHOTS = '/home/z/my-project/work/three-way-stripe';
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(REPO, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'] });

// Tall file, LONG lines, conflict in the middle
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
// ours — modify the center line
fs.writeFileSync(path.join(REPO, 'conflict.txt'), base(true).replace('center line common', 'OURS center line version A'));
sh('git commit -q -am ours');
// theirs from base — modify the SAME line differently
sh('git checkout -q -b feature HEAD~1');
fs.writeFileSync(path.join(REPO, 'conflict.txt'), base(true).replace('center line common', 'THEIRS center line version B'));
sh('git add -A && git commit -q -m theirs');
sh('git checkout -q main');
sh('git merge feature || true');
console.log('conflict state:', sh('git status --porcelain').trim());

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-stripe-'));
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

// ── Geometry dump: panes, splitters, gutter, scrollbars ─────────────────────
const geo = await page.evaluate(() => {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const out = { panes: {}, splitters: [], scrollbars: [] };
  for (const side of ['ours', 'theirs']) {
    const el = document.querySelector(`[data-testid="merge-pane-${side}"]`);
    if (el) out.panes[side] = rect(el);
  }
  const mid = document.querySelector('[data-testid="merge-result-column"]');
  if (mid) out.panes.result = rect(mid);
  const ta = document.querySelector('[data-testid="merge-result-textarea"]');
  if (ta) {
    out.textarea = rect(ta);
    out.textareaScroll = { scrollWidth: ta.scrollWidth, clientWidth: ta.clientWidth, hasHScroll: ta.scrollWidth > ta.clientWidth };
  }
  for (const el of document.querySelectorAll('.split-divider')) {
    out.splitters.push({ rect: rect(el), cls: el.className });
  }
  // ANY full-height-ish vertical element inside the middle pane?
  const midRect = mid?.getBoundingClientRect();
  out.midPaneVerticals = [];
  if (mid && midRect) {
    for (const el of mid.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.height > midRect.height * 0.5 && r.width <= 12 && r.width > 0) {
        out.midPaneVerticals.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 40), rect: { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) } });
      }
    }
  }
  return out;
});
console.log('GEOMETRY:', JSON.stringify(geo, null, 2));
await page.screenshot({ path: path.join(SHOTS, '01-stripe-top.png') });

// Scroll down to the conflict (line ~41) and horizontally if possible
await page.evaluate(() => {
  const sc = document.querySelector('[data-testid="merge-scroll-container"]');
  if (sc) sc.scrollTop = 800;
});
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(SHOTS, '02-stripe-scrolled.png') });

// Scroll the textarea horizontally (long lines)
await page.evaluate(() => {
  const ta = document.querySelector('[data-testid="merge-result-textarea"]');
  if (ta) ta.scrollLeft = 400;
});
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(SHOTS, '03-stripe-hscrolled.png') });

console.log('SHOTS saved to', SHOTS);
await app.close().catch(() => {});
