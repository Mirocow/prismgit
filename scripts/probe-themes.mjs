/**
 * THEME PROBE (v2.3.9 audit) — «построить пару тем и посмотреть что реально
 * изменяется».
 *
 * Boots the REAL app once per theme config (settings-file driven — the same
 * path a user takes by picking a theme in Settings and restarting), then
 * screenshots three screens:
 *   - history.png  (graph lanes + commit row + selected-commit DIFF tints)
 *   - changes.png  (status badges: modified/staged/untracked)
 *   - settings.png (appearance tab: picker cards, contrast, sidebar mode)
 *
 * Eight configs: 6 built-in themes + 2 EXTREME custom probe themes whose
 * every token is a signal color. Anything that keeps its baseline color in
 * the probe shots is theme-blind (hardcoded / missing token).
 *
 * Usage: DISPLAY=:99 node scripts/probe-themes.mjs
 * Output: /home/z/my-project/work/theme-audit/<theme>-<screen>.png
 */
import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/theme-probe-repo';
const SHOTS = '/home/z/my-project/work/theme-audit';
fs.mkdirSync(SHOTS, { recursive: true });

// ── the two extreme probe themes ───────────────────────────────────────────
const PROBE_THEMES = [
  {
    id: 'custom-probe-red', name: 'Проба Красная', isDark: false,
    colors: {
      bgPrimary: '#ffe8e6', bgSecondary: '#ffd6d3', bgTertiary: '#ffc4c0',
      bgElevated: '#fff5f4', bgSidebar: '#1a237e',
      textPrimary: '#b71c1c', textSecondary: '#d32f2f', textTertiary: '#e57373',
      accent: '#d50000', border: '#ef9a9a',
      statusAdded: '#1b5e20', statusModified: '#e65100', statusDeleted: '#ad1457',
      statusConflict: '#6a1b9a', statusUntracked: '#00695c',
    },
  },
  {
    id: 'custom-probe-dark', name: 'Проба Тёмная', isDark: true,
    colors: {
      bgPrimary: '#1a0033', bgSecondary: '#2a0a4a', bgTertiary: '#3d1566',
      bgElevated: '#5e2a8a', bgSidebar: '#00251c',
      textPrimary: '#e8c5f0', textSecondary: '#c084d5', textTertiary: '#9a6bb0',
      accent: '#00e5ff', border: '#6a1b9a',
      statusAdded: '#00e676', statusModified: '#ffea00', statusDeleted: '#ff1744',
      statusConflict: '#ff9100', statusUntracked: '#e040fb',
    },
  },
];

const THEMES_TO_SHOOT = [
  'light',           // baseline
  'one-dark',
  'simple-light',
  'material',
  'discord',
  'light-dim-sidebar',
  'custom-probe-red',
  'custom-probe-dark',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shootTheme(themeId) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `prismgit-themeprobe-${themeId.replace(/[^a-z0-9-]/gi, '')}-`));
  fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
    settings: {
      theme: themeId,
      tourCompleted: true,
      autoRefresh: true,
      locale: 'ru',
      customThemes: PROBE_THEMES,
    },
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

  // The app boots on the Welcome screen — open the probe repo like a user
  // would (click its card in the sidebar / repo list).
  try {
    await page.locator('text=theme-probe-repo').first().click({ timeout: 6000 });
    await page.waitForTimeout(3500);
  } catch (e) {
    console.log(`  !! repo open failed: ${e.message.split('\n')[0]}`);
  }
  const bootHash = await page.evaluate(() => window.location.hash);
  console.log(`  boot hash after repo open: ${bootHash}`);

  // Prove the theme actually applied on <html> (data-theme + .dark).
  const applied = await page.evaluate(() => ({
    dataTheme: document.documentElement.getAttribute('data-theme'),
    darkClass: document.documentElement.classList.contains('dark'),
    bgPrimary: getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim(),
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    bgActive: getComputedStyle(document.documentElement).getPropertyValue('--bg-active').trim(),
    accentHover: getComputedStyle(document.documentElement).getPropertyValue('--accent-hover').trim(),
    borderFocused: getComputedStyle(document.documentElement).getPropertyValue('--border-focused').trim(),
    statusInfo: getComputedStyle(document.documentElement).getPropertyValue('--status-info').trim(),
    statusWarning: getComputedStyle(document.documentElement).getPropertyValue('--status-warning').trim(),
    badgeAddedBg: (() => { const el = document.querySelector('.badge-added'); return el ? getComputedStyle(el).backgroundColor : 'n/a'; })(),
  }));
  console.log(`\n=== ${themeId} ===`);
  console.log('  html:', JSON.stringify(applied));

  // 1) History + selected-commit diff
  await page.evaluate(() => { window.location.hash = '#/history'; });
  await page.waitForTimeout(2500);
  try {
    await page.locator('text=edit file1, add file3, delete file2').first().click({ timeout: 4000 });
    await page.waitForTimeout(1200);
  } catch { /* row not found — screenshot anyway */ }
  await page.screenshot({ path: path.join(SHOTS, `${themeId}-history.png`) });
  console.log(`     📸 ${themeId}-history.png`);

  // 2) Changes (badges)
  await page.evaluate(() => { window.location.hash = '#/changes'; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, `${themeId}-changes.png`) });
  console.log(`     📸 ${themeId}-changes.png`);

  // 3) Settings (appearance tab — picker cards, contrast, sidebar mode)
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(SHOTS, `${themeId}-settings.png`) });
  console.log(`     📸 ${themeId}-settings.png`);

  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

for (const t of THEMES_TO_SHOOT) {
  await shootTheme(t);
  await sleep(500);
}
console.log('\nDONE — shots in ' + SHOTS);
