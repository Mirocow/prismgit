/**
 * E2E verification of the v2.3.8 change (RU locale) — the REAL app:
 *
 *   P1  THREE header-corner toggles in the hero-row order after the
 *       «Customize toolbar» gear: sidebar-left / PANEL / sidebar-right;
 *       the middle one is the missing layout-panel button the user asked
 *       for («кнопку для нижнего сайдбар?»), rendering the EXACT upstream
 *       codicon path (16×16 fill, 16px)
 *   P2  click it → the bottom Command Log panel opens (live «Вывод»
 *       header) AND the icon flips to the filled layout-panel variant
 *   P3  click again → panel closed, icon back to hollow off-variant
 *   P4  the legacy entry points drive the SAME flag: the Terminal button
 *       opens the panel; the panel's own ✕ (Закрыть панель) closes it and
 *       the corner icon follows (hollow)
 *   P5  the flag persists (localStorage prismgit-command-log-open)
 *   R1  regression: the left sidebar toggle still collapses to the 48px
 *       rail (v2.3.7 semantics untouched)
 *
 * Usage: DISPLAY=:99 node scripts/verify-v238.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/v238-fixture';
const REPO = path.join(ROOT, 'repo');
const SHOTS = '/home/z/my-project/work/v238-shots';
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
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v238-'));
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

// ── Exact upstream codicon path data ────────────────────────────────────────
const D = {
  panelOn: 'M15 12.5C15 13.881 13.881 15 12.5 15H3.5C2.119 15 1 13.881 1 12.5V3.5C1 2.119 2.119 1 3.5 1H12.5C13.881 1 15 2.119 15 3.5V12.5ZM2 10H14V3.5C14 2.672 13.328 2 12.5 2H3.5C2.672 2 2 2.672 2 3.5V10Z',
  panelOff: 'M12.5 1H3.5C2.122 1 1 2.121 1 3.5V12.5C1 13.879 2.122 15 3.5 15H12.5C13.878 15 15 13.879 15 12.5V3.5C15 2.121 13.878 1 12.5 1ZM14 12.5C14 13.327 13.327 14 12.5 14H3.5C2.673 14 2 13.327 2 12.5V11H14V12.5ZM14 10H2V3.5C2 2.673 2.673 2 3.5 2H12.5C13.327 2 14 2.673 14 3.5V10Z',
};

// Probe: the three layout toggles + their SVG paths + panel visibility
const probe = () => page.evaluate(() => {
  const wanted = ['Свернуть сайдбар', 'Развернуть сайдбар', 'Показать журнал команд', 'Скрыть журнал команд', 'Свернуть правую панель', 'Развернуть правую панель'];
  const btns = [...document.querySelectorAll('button')].filter((b) => {
    const t = b.getAttribute('title') || '';
    return wanted.some((w) => t.includes(w));
  });
  const out = [];
  for (const b of btns) {
    const svg = b.querySelector('svg');
    const p = svg?.querySelector('path');
    out.push({
      title: b.getAttribute('title'),
      viewBox: svg?.getAttribute('viewBox'),
      fill: svg?.getAttribute('fill'),
      d: p?.getAttribute('d') || '',
      w: svg?.getAttribute('width') || null,
    });
  }
  // Command Log panel: stable root marker (NOT the StatusBar «Вывод» chip,
  // which carries the same visible text — v2.3.8 e2e lesson)
  const panel = document.querySelector('[data-testid="command-log-panel"]');
  const sidebar = document.querySelector('aside');
  return {
    toggles: out,
    panelVisible: !!panel,
    panelH: panel ? Math.round(panel.getBoundingClientRect().height) : null,
    sidebarW: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : null,
    ls: localStorage.getItem('prismgit-command-log-open'),
  };
});

let st = await probe();
const titles = st.toggles.map((t) => t.title);
// P1 — hero-row order: left / panel / right (header buttons come first in DOM)
check('P1 three layout toggles present (left / panel / right)', st.toggles.length >= 3
  && (titles[0] || '').includes('сайдбар')
  && (titles[1] || '').includes('журнал команд')
  && (titles[2] || '').includes('правую панель'), JSON.stringify(titles));
const pt = st.toggles[1];
check('P1 panel toggle: exact layout-panel-off codicon, 16×16 fill, 16px', pt?.d === D.panelOff && pt.viewBox === '0 0 16 16' && pt.fill === 'currentColor' && pt.w === '16', `${pt?.d?.slice(0, 22)}… w=${pt?.w}`);
check('P1 panel starts CLOSED (flag not "1"; localStorage is the app-wide profile — PRISMGIT_USER_DATA isolates only the JSON stores)', st.panelVisible === false && st.ls !== '1', `ls=${st.ls}`);
await shot(page, '01-hero-row-panel-closed');

// ── P2: click the middle toggle → panel opens + icon fills ──────────────────
const panelBtnCorner = page.locator('button[title="Показать журнал команд"]').first();
await panelBtnCorner.click();
await page.waitForTimeout(800);
st = await probe();
check('P2 panel opens on click (live «Вывод» header, height > 100)', st.panelVisible === true && (st.panelH ?? 0) > 100, `h=${st.panelH}`);
check('P2 icon flips to the filled layout-panel variant', st.toggles[1]?.d === D.panelOn, (st.toggles[1]?.d || '').slice(0, 22) + '…');
check('P2 title flips to «Скрыть журнал команд»', (st.toggles[1]?.title || '').includes('Скрыть журнал'));
check('P2 flag persisted to localStorage', st.ls === '1', `ls=${st.ls}`);
await shot(page, '02-panel-open-filled');

// ── P3: click again → closed + hollow ───────────────────────────────────────
await page.locator('button[title="Скрыть журнал команд"]').first().click();
await page.waitForTimeout(800);
st = await probe();
check('P3 panel closed again', st.panelVisible === false);
check('P3 icon back to hollow off-variant', st.toggles[1]?.d === D.panelOff);
check('P3 flag persisted as 0', st.ls === '0', `ls=${st.ls}`);
await shot(page, '03-panel-closed-hollow');

// ── P4: legacy entry points drive the SAME flag ─────────────────────────────
// Terminal toolbar button
await page.locator('button[title*="Журнал команд"]').first().click();
await page.waitForTimeout(800);
st = await probe();
check('P4 Terminal button opens the panel too', st.panelVisible === true && st.toggles[1]?.d === D.panelOn);
// Panel's own ✕ (Закрыть панель)
await page.locator('button[title="Закрыть панель"]').first().click();
await page.waitForTimeout(800);
st = await probe();
check('P4 panel ✕ closes the panel AND the corner icon follows (hollow)', st.panelVisible === false && st.toggles[1]?.d === D.panelOff);
await shot(page, '04-legacy-paths-same-flag');

// ── R1: the left sidebar toggle still works (v2.3.7 regression) ─────────────
const leftBtn = page.locator('button[title*="сайдбар"]').first();
const w0 = st.sidebarW;
await leftBtn.click();
await page.waitForTimeout(700);
st = await probe();
check('R1 left sidebar still collapses to the 48px rail', st.sidebarW !== null && st.sidebarW <= 60, `${w0} → ${st.sidebarW}px`);
await leftBtn.click();
await page.waitForTimeout(700);
st = await probe();
check('R1 sidebar restored', st.sidebarW === w0, `${st.sidebarW}px`);

// ── Header corner crop for the VLM comparison step ──────────────────────────
const header = await page.evaluate(() => {
  const el = document.querySelector('header') || document.querySelector('nav')?.parentElement;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), w: Math.round(r.width), h: Math.round(r.height) };
});
if (header) {
  await page.screenshot({ path: path.join(SHOTS, '05-header-corner.png'), clip: { x: header.w - 460, y: header.y, width: 460, height: Math.min(header.h + 8, 80) } }).catch(() => {});
  console.log('     📸 05-header-corner.png');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURES`);
await app.close().catch(() => {});
process.exit(failures === 0 ? 0 : 1);
