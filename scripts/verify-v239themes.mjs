/**
 * v2.3.9 e2e verification (RU locale) — THEMES, the in-session path.
 * (probe-themes.mjs covered the boot/restart path; this one switches themes
 * by clicking the REAL picker cards in Settings → Appearance.)
 *
 *   T1  Click «One Dark» card   → data-theme=one-dark + .dark class +
 *       computed accent/hover/active follow One Dark (not Ayu boot values)
 *   T2  Click «Material» card   → accent-hover #5c6bc0 (indigo, WAS Ayu
 *       blue #55b4d4), bg-active indigo tint, border-focused #3f51b5
 *   T3  Click «Discord» card    → status-info #00aff4, status-warning
 *       #faa61a (were Ayu cyan/gold)
 *   T4  Click «Светлая + тёмный сайдбар» → aside computed bg DARK
 *       (#1e1e1e family) while main content stays LIGHT; sidebar text light
 *   T5  Click the custom «Проба Красная» card → accent #d50000,
 *       border-focused #d50000, status-info #d50000 (derived, was Ayu)
 *   T6  Badge tint follows the theme: .badge-added background is a
 *       color-mix() of the theme's --status-added (probe-red: dark green,
 *       one-dark: #98c379) — on the Changes screen with real badges
 *   T7  Back to «Ayu Light» → everything returns to baseline values
 *   R1  Regression: the theme picker itself still renders (6 built-in
 *       cards + 2 custom + create card)
 *
 * Usage: DISPLAY=:99 node scripts/verify-v239themes.mjs
 */
import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/theme-probe-repo';
const SHOTS = '/home/z/my-project/work/v239-shots';
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};

const PROBE_THEMES = [
  { id: 'custom-probe-red', name: 'Проба Красная', isDark: false, colors: {
      bgPrimary: '#ffe8e6', bgSecondary: '#ffd6d3', bgTertiary: '#ffc4c0',
      bgElevated: '#fff5f4', bgSidebar: '#1a237e',
      textPrimary: '#b71c1c', textSecondary: '#d32f2f', textTertiary: '#e57373',
      accent: '#d50000', border: '#ef9a9a',
      statusAdded: '#1b5e20', statusModified: '#e65100', statusDeleted: '#ad1457',
      statusConflict: '#6a1b9a', statusUntracked: '#00695c' } },
  { id: 'custom-probe-dark', name: 'Проба Тёмная', isDark: true, colors: {
      bgPrimary: '#1a0033', bgSecondary: '#2a0a4a', bgTertiary: '#3d1566',
      bgElevated: '#5e2a8a', bgSidebar: '#00251c',
      textPrimary: '#e8c5f0', textSecondary: '#c084d5', textTertiary: '#9a6bb0',
      accent: '#00e5ff', border: '#6a1b9a',
      statusAdded: '#00e676', statusModified: '#ffea00', statusDeleted: '#ff1744',
      statusConflict: '#ff9100', statusUntracked: '#e040fb' } },
];

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v239themes-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true, locale: 'ru', customThemes: PROBE_THEMES },
  repositories: [{ path: REPO, name: 'theme-probe-repo', lastOpened: Date.now(), pinned: false }],
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
await page.waitForTimeout(3000);
try {
  await page.locator('text=theme-probe-repo').first().click({ timeout: 6000 });
  await page.waitForTimeout(2500);
} catch { /* may already be open */ }

const readTokens = () => page.evaluate(() => {
  const s = getComputedStyle(document.documentElement);
  const g = (n) => s.getPropertyValue(n).trim();
  return { theme: document.documentElement.getAttribute('data-theme'),
    dark: document.documentElement.classList.contains('dark'),
    accent: g('--accent'), accentHover: g('--accent-hover'), bgActive: g('--bg-active'),
    borderFocused: g('--border-focused'), statusInfo: g('--status-info'), statusWarning: g('--status-warning') };
});

const clickCard = async (label) => {
  await page.locator(`[role="button"][aria-label="${label}"]`).first().click({ timeout: 5000 });
  await page.waitForTimeout(900);
};

// ── R1: picker renders with all cards ──────────────────────────────────────
await page.evaluate(() => { window.location.hash = '#/settings'; });
await page.waitForTimeout(2200);
const cards = await page.locator('[role="button"][aria-label]').count();
check('R1 theme picker cards render (≥7)', cards >= 7, `cards=${cards}`);
await page.screenshot({ path: path.join(SHOTS, 'picker.png') });

// ── T1: One Dark ───────────────────────────────────────────────────────────
await clickCard('One Dark');
let t = await readTokens();
check('T1 one-dark applies', t.theme === 'one-dark' && t.dark, JSON.stringify(t));
check('T1 one-dark accent family', t.accent === '#61afef' && t.accentHover === '#82c1f2', `${t.accent}/${t.accentHover}`);

// ── T2: Material — the "settings say indigo, hover showed Ayu blue" bug ────
await clickCard('Material');
t = await readTokens();
check('T2 material accent-hover is indigo #5c6bc0 (was Ayu blue)', t.accentHover === '#5c6bc0', t.accentHover);
check('T2 material bg-active is indigo tint', t.bgActive === 'rgba(63, 81, 181, 0.13)' || t.bgActive === '#3f51b521', t.bgActive);
check('T2 material border-focused is indigo', t.borderFocused === '#3f51b5', t.borderFocused);

// ── T3: Discord — status synonyms ─────────────────────────────────────────
await clickCard('Discord');
t = await readTokens();
check('T3 discord status-info #00aff4 (was Ayu cyan)', t.statusInfo === '#00aff4', t.statusInfo);
check('T3 discord status-warning #faa61a (was Ayu gold)', t.statusWarning === '#faa61a', t.statusWarning);

// ── T4: light-dim-sidebar — dark aside + light main ────────────────────────
await clickCard('Светлая + тёмный сайдбар');
t = await readTokens();
const aside = await page.evaluate(() => {
  const el = document.querySelector('aside');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { bg: cs.backgroundColor, color: cs.color };
});
check('T4 theme applied (light main)', t.theme === 'light-dim-sidebar' && !t.dark, t.theme);
check('T4 aside is DARK (#1e1e1e)', !!aside && /rgb\(30, 30, 30\)/.test(aside.bg), JSON.stringify(aside));
check('T4 aside text is light', !!aside && /rgba?\((?:204|187|170), /.test(aside.color), aside?.color);
await page.screenshot({ path: path.join(SHOTS, 'dim-sidebar.png') });

// ── T5: custom probe-red — derived tokens ──────────────────────────────────
await clickCard('Проба Красная');
t = await readTokens();
check('T5 probe-red accent #d50000', t.accent === '#d50000', t.accent);
check('T5 probe-red border-focused derived (#d50000, was Ayu blue)', t.borderFocused === '#d50000', t.borderFocused);
check('T5 probe-red status-info derived (#d50000)', t.statusInfo === '#d50000', t.statusInfo);

// ── T6: badge tint follows the theme (Changes screen) ─────────────────────
await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(2200);
const badge = await page.evaluate(() => {
  const el = document.querySelector('.badge-added, .badge-modified, .badge-untracked, .badge-renamed');
  return el ? { cls: el.className, bg: getComputedStyle(el).backgroundColor } : null;
});
check('T6 badges present on Changes', !!badge, badge?.cls ?? 'none');
check('T6 badge background follows theme (not the Ayu constant)',
  !!badge && !/rgba\(170, 217, 76/.test(badge.bg), JSON.stringify(badge));

// ── T7: back to light ──────────────────────────────────────────────────────
await page.evaluate(() => { window.location.hash = '#/settings'; });
await page.waitForTimeout(1800);
await clickCard('Ayu Light (по умолчанию)');
t = await readTokens();
check('T7 back to Ayu light', t.theme === 'light' && !t.dark && t.accent === '#399ee6', JSON.stringify(t));

await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
