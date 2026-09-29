/**
 * E2E verification of the v2.3.4 batch (RU locale) — the REAL app against
 * the 20k-commit fixture:
 *
 *   S1  Settings row spacing: consecutive setting rows are 32px apart
 *       (space-y-8), the reorder lists got the wider 2.5 gap
 *   H1  InfoHint «!» hitbox: hovering the marker SHOWS the tooltip content
 *       (the stacked group-hover:group-focus variant never matched)
 *   T1  Toolbar corner: both collapse toggles render AFTER «Customize
 *       toolbar»; clicking them collapses the sidebar rail and the History
 *       detail pane (and the in-panel chevrons stay in sync)
 *   L1  LFS pins are source-level (no live LFS fixture) — skipped here
 *
 * Usage: DISPLAY=:99 node scripts/verify-v234.mjs
 */
import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const BIG = '/home/z/my-project/work/perf-diag3/big20k';
const SHOTS = '/home/z/my-project/work/v234-shots';
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

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v234-'));
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

// ═══ S1. Settings spacing ══════════════════════════════════════════════════
console.log('\n── S1. Settings row spacing ──');
await goto(page, '#/settings');
const spacing = await page.evaluate(() => {
  // The first wide panel: consecutive setting rows. Tailwind v4's space-y-*
  // puts margin on non-last children — measure the REAL rendered distance
  // between the first two rows (bottom of row 1 → top of row 2).
  const panel = document.querySelector('div.p-5.space-y-8');
  if (!panel) return { found: false };
  const rows = [...panel.children].filter((el) => el.tagName === 'DIV');
  let gap = -1;
  let margin = -1;
  if (rows.length >= 2) {
    const a = rows[0].getBoundingClientRect();
    const b = rows[1].getBoundingClientRect();
    gap = Math.round(b.top - a.bottom);
    margin = Math.round(a.height >= 0 ? b.top - a.bottom : -1);
    margin = parseFloat(getComputedStyle(rows[0]).marginBottom);
  }
  return {
    found: true, rows: rows.length, gap,
    margin,
    visible: !!panel.offsetParent || getComputedStyle(panel).display !== 'none',
    cls: panel.className, first: rows[0]?.className ?? '',
    mb: rows[0] ? getComputedStyle(rows[0]).marginBottom : '?',
    mbLast: rows.length ? getComputedStyle(rows[rows.length - 1]).marginBottom : '?',
  };
});
check('S1 wide panel (p-5 space-y-8) present', spacing.found);
// 2rem at the app's root font (13.5px zoom) = 27px; at 16px = 32px.
check('S1 consecutive setting rows have the space-y-8 margin (>20px, was 0 — the cascade bug)',
  spacing.gap > 20 && spacing.gap === Math.round(spacing.margin),
  `gap=${spacing.gap}px, margin=${spacing.margin}px, rows=${spacing.rows}`);
await shot(page, '01-settings-spacing');

// ═══ H1. InfoHint shows its content ════════════════════════════════════════
console.log('\n── H1. InfoHint «!» tooltips ──');
const hintBtn = page.locator('button[aria-label="?"]').first();
check('H1 «!» hitbox present in Settings', await hintBtn.count() > 0);
// BEFORE hover: hidden
const beforeDisplay = await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label="?"]');
  const tip = btn?.closest('.group')?.querySelector('[role="note"]');
  return tip ? getComputedStyle(tip).display : 'missing';
});
check('H1 tooltip hidden at rest', beforeDisplay === 'none', `display=${beforeDisplay}`);
// Hover: shown
await hintBtn.hover();
await page.waitForTimeout(400);
const after = await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label="?"]');
  const tip = btn?.closest('.group')?.querySelector('[role="note"]');
  if (!tip) return { display: 'missing', text: '' };
  return { display: getComputedStyle(tip).display, text: (tip.textContent || '').trim() };
});
check('H1 tooltip SHOWS on hover (display block)', after.display === 'block', `display=${after.display}`);
check('H1 tooltip has real CONTENT (not empty)', after.text.length > 20, `len=${after.text.length}, "${after.text.slice(0, 40)}…"`);
await shot(page, '02-infohint-tooltip');
// Keyboard focus path (group-focus-within)
await page.mouse.move(5, 5); // leave hover
await page.waitForTimeout(200);
const focused = await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label="?"]');
  btn?.focus();
  const tip = btn?.closest('.group')?.querySelector('[role="note"]');
  return tip ? getComputedStyle(tip).display : 'missing';
});
check('H1 tooltip shows on keyboard focus too', focused === 'block', `display=${focused}`);

// ═══ T1. Toolbar corner collapse toggles ═══════════════════════════════════
console.log('\n── T1. Toolbar corner toggles ──');
const customizeBtn = page.locator('button[title="Настроить панель инструментов"]').first();
const leftToggle = page.locator('button[title*="Свернуть сайдбар"], button[title*="Свернуть левый"]').first();
const rightToggle = page.locator('button[title*="правую панель"]').first();
check('T1 «Customize toolbar» button present', await customizeBtn.count() > 0);
check('T1 left-sidebar toggle present', await leftToggle.count() > 0, (await leftToggle.getAttribute('title')) || '');
check('T1 right-panel toggle present', await rightToggle.count() > 0, (await rightToggle.getAttribute('title')) || '');
// Order: toggles are AFTER the customize button (right corner)
const order = await page.evaluate(() => {
  const all = [...document.querySelectorAll('button')];
  const idx = (title) => all.findIndex((b) => (b.getAttribute('title') || '').includes(title));
  return { customize: idx('Настроить панель'), left: idx('сайдбар'), right: idx('правую панель') };
});
check('T1 toggles sit RIGHT of the customize button', order.customize >= 0 && order.left > order.customize && order.right > order.left,
  JSON.stringify(order));

// Click left toggle → sidebar collapses to the rail
await leftToggle.click();
await page.waitForTimeout(700);
const railExpand = page.locator('button[title*="Развернуть сайдбар"]').first();
check('T1 left toggle click → sidebar collapsed to rail (expand control visible)', await railExpand.count() > 0);
await shot(page, '03-sidebar-rail-via-toolbar');
await railExpand.click();
await page.waitForTimeout(600);
check('T1 rail expand restores the full sidebar', (await page.locator('button[title*="Свернуть сайдбар"]').count()) > 0);

// Right toggle → History detail pane collapses
await goto(page, '#/history');
await page.waitForTimeout(2500);
const rightToggle2 = page.locator('button[title*="правую панель"]').first();
await rightToggle2.click();
await page.waitForTimeout(700);
const detailStrip = page.locator('button[title*="Развернуть панель коммита"]').first();
check('T1 right toggle click → detail pane collapsed (strip expand visible)', await detailStrip.count() > 0);
await shot(page, '04-detail-collapsed-via-toolbar');
await detailStrip.click();
await page.waitForTimeout(600);
check('T1 detail pane restored', (await page.locator('button[title*="Свернуть панель коммита"]').count()) > 0);

console.log(`\n════ verify-v234: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURES'} ════`);
await app.close().catch(() => {});
process.exit(failures === 0 ? 0 : 1);
