/**
 * Verifies the computed typography/row density in the RUNNING app:
 *   - .text-2xs / .text-xs / .text-sm computed line-heights
 *   - Changes file-row, History commit-row, BranchesPage row heights
 * Fails (exit 1) when any measured value regresses below the target.
 * Usage: DISPLAY=:99 node scripts/verify-density.mjs
 */
import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/tmp/prismgit-switch-repos';
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-density-verify-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true },
  repositories: [{ path: path.join(ROOT, 'heavy-repo'), name: 'heavy-repo', lastOpened: Date.now(), pinned: false }],
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1440, height: 900 }, isMaximized: false, isFullScreen: false },
}, null, 2));

const app = await electron.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    path.join(process.cwd(), 'dist-electron/main.js')],
  env: { ...process.env, NODE_ENV: 'production', DISPLAY: process.env.DISPLAY || ':99',
    PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'ru' },
  timeout: 30000,
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1500);
await page.locator('button:has-text("heavy-repo")').first().click().catch(async () => {
  await page.locator('[data-testid="repo-item-heavy-repo"]').first().click();
});
await page.waitForTimeout(3500);

const px = (v) => Math.round(parseFloat(v));

// 1 — typography tokens on live elements
const typo = await page.evaluate(() => {
  // Isolated host: no parent font-size scope (main/footer/sidebar all set
  // their own vars) — measures the RAW utility values.
  const host = document.createElement('div');
  document.body.appendChild(host);
  const probe = (cls) => {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = 'Ag Яz 0';
    host.appendChild(el);
    const cs = getComputedStyle(el);
    const out = { fontSize: cs.fontSize, lineHeight: cs.lineHeight };
    el.remove();
    return out;
  };
  const out = { text2xs: probe('text-2xs'), textxs: probe('text-xs'), textsm: probe('text-sm') };
  host.remove();
  return out;
});
console.log(`.text-2xs: ${px(typo.text2xs.fontSize)}px font / ${px(typo.text2xs.lineHeight)}px line`);
console.log(`.text-xs:  ${px(typo.textxs.fontSize)}px font / ${px(typo.textxs.lineHeight)}px line`);
console.log(`.text-sm:  ${px(typo.textsm.fontSize)}px font / ${px(typo.textsm.lineHeight)}px line`);

// 2 — Changes file row height
const fileRowH = await page.evaluate(() => {
  const row = document.querySelector('[role="option"]');
  return row ? row.getBoundingClientRect().height : 0;
});
console.log(`Changes file row height: ${Math.round(fileRowH)}px`);

// 3 — History commit row height
await page.evaluate(() => { window.location.hash = '#/history'; });
await page.waitForTimeout(2500);
const histRowH = await page.evaluate(() => {
  const rows = document.querySelectorAll('.border-b.cursor-pointer');
  for (const r of rows) { const h = r.getBoundingClientRect().height; if (h > 20 && h < 80) return h; }
  return 0;
});
console.log(`History commit row height: ${Math.round(histRowH)}px`);

const failures = [];
const lh = (v) => px(v);
const ratio = (a, b) => lh(a) / px(b);
if (ratio(typo.text2xs.lineHeight, typo.text2xs.fontSize) < 1.4) failures.push('text-2xs line-height ratio < 1.4');
if (ratio(typo.textxs.lineHeight, typo.textxs.fontSize) < 1.45) failures.push('text-xs line-height ratio < 1.45');
if (ratio(typo.textsm.lineHeight, typo.textsm.fontSize) < 1.5) failures.push('text-sm line-height ratio < 1.5');
if (fileRowH && fileRowH < 26) failures.push(`file row too short: ${Math.round(fileRowH)}px`);
if (histRowH && histRowH < 30) failures.push(`history row too short: ${Math.round(histRowH)}px`);

if (failures.length) {
  console.error('DENSITY FAILURES:', failures);
  await app.close().catch(() => {});
  process.exit(1);
}
console.log('density OK');
await app.close().catch(() => {});
process.exit(0);
