/**
 * E2E verification of the v2.3.7 change (RU locale) — the REAL app:
 *
 *   I1  the two header-corner toggles render the EXACT VS Code codicon
 *       paths (16×16 fill) — left sidebar + right detail panel, in order
 *       after the «Customize toolbar» gear
 *   I2  VS Code state semantics: panel open → FILLED strip icon; after a
 *       real click the panel collapses AND the icon flips to the hollow
 *       off-variant; another click restores both
 *   I3  the collapse actually works (sidebar → 48px rail; right panel gone)
 *
 * Usage: DISPLAY=:99 node scripts/verify-v237.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/v237-fixture';
const REPO = path.join(ROOT, 'repo');
const SHOTS = '/home/z/my-project/work/v237-shots';
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

// ── Fixture: a small repo with history ──────────────────────────────────────
sh('git init -q -b main');
sh('git config user.email a@a.a && git config user.name A');
for (let i = 1; i <= 3; i++) {
  fs.writeFileSync(path.join(REPO, 'file.txt'), `line ${i}\n`);
  sh('git add -A && git commit -q -m "c' + i + '"');
}

// ── Launch ──────────────────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v237-'));
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

// ── Codicon path signatures (exact upstream data) ───────────────────────────
const D = {
  leftOn: 'M12.5 1C13.881 1 15 2.119 15 3.5V12.5C15 13.881 13.881 15 12.5 15H3.5C2.119 15 1 13.881 1 12.5V3.5C1 2.119 2.119 1 3.5 1H12.5ZM12.5 14C13.328 14 14 13.328 14 12.5V3.5C14 2.672 13.328 2 12.5 2H7V14H12.5Z',
  leftOff: 'M1 3.5V12.5C1 13.879 2.122 15 3.5 15H12.5C13.878 15 15 13.879 15 12.5V3.5C15 2.122 13.878 1 12.5 1H3.5C2.122 1 1 2.122 1 3.5ZM12.5 14H7V2H12.5C13.327 2 14 2.673 14 3.5V12.5C14 13.327 13.327 14 12.5 14ZM2 3.5C2 2.673 2.673 2 3.5 2H6V14H3.5C2.673 14 2 13.327 2 12.5V3.5Z',
  rightOn: 'M12.5 1C13.881 1 15 2.119 15 3.5V12.5C15 13.881 13.881 15 12.5 15H3.5C2.119 15 1 13.881 1 12.5V3.5C1 2.119 2.119 1 3.5 1H12.5ZM9 14V2H3.5C2.672 2 2 2.672 2 3.5V12.5C2 13.328 2.672 14 3.5 14H9Z',
  rightOff: 'M12.5 1H3.5C2.122 1 1 2.122 1 3.5V12.5C1 13.879 2.122 15 3.5 15H12.5C13.878 15 15 13.879 15 12.5V3.5C15 2.122 13.878 1 12.5 1ZM2 12.5V3.5C2 2.673 2.673 2 3.5 2H9V14H3.5C2.673 14 2 13.327 2 12.5ZM14 12.5C14 13.327 13.327 14 12.5 14H10V2H12.5C13.327 2 14 2.673 14 3.5V12.5Z',
};

// Probe: toggle buttons + their current SVG path + panel geometry
const probe = () => page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].filter((b) => {
    const t = b.getAttribute('title') || '';
    return t.includes('сайдбар') || t.includes('правую панель');
  });
  const out = [];
  for (const b of btns) {
    const svg = b.querySelector('svg');
    const path = svg?.querySelector('path');
    out.push({
      title: b.getAttribute('title'),
      viewBox: svg?.getAttribute('viewBox'),
      fill: svg?.getAttribute('fill'),
      d: path?.getAttribute('d') || '',
      size: svg ? { w: svg.getAttribute('width'), h: svg.getAttribute('height') } : null,
    });
  }
  const sidebar = document.querySelector('aside') || document.querySelector('[data-testid="sidebar"]');
  const sidebarRect = sidebar ? sidebar.getBoundingClientRect() : null;
  const main = document.querySelector('main');
  return {
    toggles: out,
    sidebarW: sidebarRect ? Math.round(sidebarRect.width) : null,
  };
});

let st = await probe();
// NOTE: the in-sidebar rail also has a «сайдбар» toggle with the same title —
// the header pair comes FIRST in DOM order (Toolbar renders above Sidebar).
check('I1 two header toggle buttons present (left, then right)', st.toggles.length >= 2 && (st.toggles[0]?.title || '').includes('сайдбар') && (st.toggles[1]?.title || '').includes('правую панель'), JSON.stringify(st.toggles.map((t) => t.title)));
const [lt, rt] = st.toggles;
check('I1 left toggle: exact codicon path, 16×16 fill, 16px', lt?.d === D.leftOn && lt.viewBox === '0 0 16 16' && lt.fill === 'currentColor' && lt.size?.w === '16', `${lt?.d?.slice(0, 24)}… ${lt?.size?.w}×${lt?.size?.h}`);
check('I1 right toggle: exact codicon path, 16×16 fill, 16px', rt?.d === D.rightOn && rt.viewBox === '0 0 16 16' && rt.size?.w === '16', `${rt?.d?.slice(0, 24)}…`);
await shot(page, '01-open-both-filled');

// ── I2/I3: click the LEFT toggle → collapse + hollow icon ───────────────────
const leftBtn = page.locator('button[title*="сайдбар"]').first();
const sidebarW0 = st.sidebarW;
await leftBtn.click();
await page.waitForTimeout(700);
st = await probe();
check('I2 after click: left icon flips to the hollow off-variant', st.toggles[0]?.d === D.leftOff, st.toggles[0]?.d?.slice(0, 24) + '…');
check('I2 right icon untouched (filled)', st.toggles[1]?.d === D.rightOn);
check('I3 sidebar collapsed to the 48px icon rail', st.sidebarW !== null && st.sidebarW <= 60, `${sidebarW0} → ${st.sidebarW}px`);
await shot(page, '02-left-collapsed-hollow');

await leftBtn.click();
await page.waitForTimeout(700);
st = await probe();
check('I2 click again: left icon back to filled', st.toggles[0]?.d === D.leftOn);
check('I3 sidebar restored', st.sidebarW === sidebarW0, `${st.sidebarW}px`);
await shot(page, '03-left-restored');

// ── Right toggle — on the History page, where the detail pane lives ────────
await page.evaluate(() => { window.location.hash = '#/history'; });
await page.waitForTimeout(1800);
await page.locator('tbody tr, [role="row"]').first().waitFor({ timeout: 8000 }).catch(() => {});
st = await probe();
const rightBtn = page.locator('button[title*="правую панель"]').first();
const expandStrip = page.locator('button[title*="Развернуть панель коммита"]').first();
const stripBefore = await expandStrip.count();
await rightBtn.click();
await page.waitForTimeout(700);
st = await probe();
check('I2 right toggle flips to the hollow off-variant', st.toggles[1]?.d === D.rightOff, st.toggles[1]?.d?.slice(0, 24) + '…');
check('I3 right panel collapsed (expand strip appears on History)', (await expandStrip.count()) > stripBefore, `strip ${stripBefore} → ${await expandStrip.count()}`);
await shot(page, '04-right-collapsed-hollow');

await rightBtn.click();
await page.waitForTimeout(700);
st = await probe();
check('I2 right icon back to filled', st.toggles[1]?.d === D.rightOn);
check('I3 right panel restored (expand strip gone)', (await expandStrip.count()) === stripBefore);
await shot(page, '05-right-restored');

// ── Header corner crop for the VLM comparison step ──────────────────────────
const header = await page.evaluate(() => {
  const el = document.querySelector('header') || document.querySelector('nav')?.parentElement;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), w: Math.round(r.width), h: Math.round(r.height) };
});
if (header) {
  await page.screenshot({ path: path.join(SHOTS, '06-header-corner.png'), clip: { x: header.w - 420, y: header.y, width: 420, height: Math.min(header.h + 8, 80) } }).catch(() => {});
  console.log('     📸 06-header-corner.png');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURES`);
await app.close().catch(() => {});
process.exit(failures === 0 ? 0 : 1);
