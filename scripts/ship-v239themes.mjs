/**
 * SHIP v2.3.9 — commit + push THIS round THROUGH THE APP.
 *
 * RU locale. Real UI interactions only: stage via the «Изменения (N)»
 * section header, message in the commit editor, «Коммит», toolbar «Push».
 * Bonus evidence: the fixed theme switcher working live in the shipping
 * app (light-dim-sidebar dark aside + probe-red accent).
 * Evidence → /home/z/my-project/work/release-v239/.
 *
 * Usage: DISPLAY=:99 node scripts/ship-v239themes.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/release-v239';
const MSG = 'feat(ux): v2.3.9 — themes: settings match what you actually see\n\n'
  + '- User-reported: «темы там просто ад в настройках одно а визуально\n'
  + '  затрагивает и другие блоки» — audited empirically per the request:\n'
  + '  two extreme signal-color custom themes + six built-ins pushed\n'
  + '  through the live app and pixel-diffed against the light baseline\n'
  + '- light-dim-sidebar: the dark-sidebar override block was LOST in the\n'
  + '  Tailwind v4 migration (orphaned selector glued to simple-light) —\n'
  + '  the theme rendered a WHITE sidebar + token leak; block restored\n'
  + '  (live: aside #1e1e1e, text #ccc, 16% pixel diff vs 0.4% before)\n'
  + '- built-in themes completed to the full 59-token canonical set:\n'
  + '  Material hover/active/focus was AYU blue on an indigo theme;\n'
  + '  Discord info/warning were Ayu cyan/gold\n'
  + '- theme-blind regions now derive from tokens via color-mix(): status\n'
  + '  badges (were identical Ayu rgba in ALL 8 probe themes), 3-way\n'
  + '  conflict washes, ghost rows, btn-primary shadow halo, btn-danger\n'
  + '  hover, Active chip uses --text-inverse\n'
  + '- syntax: text-function/tok-function referenced the non-existent\n'
  + '  --accent-blue (functions uncolored) — now accent-light-blue+fallback\n'
  + '- customThemeCss: border-subtle was inverted for dark themes; now\n'
  + '  derives focus/info/link/tag/graph/scrollbar/diff-line/word + the\n'
  + '  syntax accent family (status -> accent-green/yellow/red/purple/cyan)\n'
  + '- pins v239Pins (27) + themeRegistry; suite 2106/0/34 skipped; tsc\n'
  + '  clean; build green; live e2e verify-v239themes ALL PASSED (17);\n'
  + '  probe-themes re-run: all computed tokens follow each theme;\n'
  + '  regression verify-v238 ALL PASSED';

fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) })
  .then(() => console.log(`📸 ${name}`));
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', shell: '/bin/bash' });

const before = {
  head: sh('git rev-parse HEAD').trim(),
  origin: sh('git rev-parse origin/feature/smartgit-electron-v3').trim(),
  dirty: sh('git status --porcelain').split('\n').filter(Boolean).length,
};
console.log('BEFORE: dirty files =', before.dirty, '· head', before.head.slice(0, 8));

const PROBE_THEMES = [
  { id: 'custom-probe-red', name: 'Проба Красная', isDark: false, colors: {
      bgPrimary: '#ffe8e6', bgSecondary: '#ffd6d3', bgTertiary: '#ffc4c0',
      bgElevated: '#fff5f4', bgSidebar: '#1a237e',
      textPrimary: '#b71c1c', textSecondary: '#d32f2f', textTertiary: '#e57373',
      accent: '#d50000', border: '#ef9a9a',
      statusAdded: '#1b5e20', statusModified: '#e65100', statusDeleted: '#ad1457',
      statusConflict: '#6a1b9a', statusUntracked: '#00695c' } },
];

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v239-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true, locale: 'ru', customThemes: PROBE_THEMES },
  repositories: [{ path: REPO, name: 'gitclient', lastOpened: Date.now(), pinned: false }],
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
await page.locator('button:has-text("gitclient")').first().click().catch(async () => {
  await page.locator('[data-testid="repo-item-gitclient"]').first().click();
});
await page.waitForTimeout(4000);

// ── 0. BONUS EVIDENCE: the fixed themes working in the shipping app ────────
await page.evaluate(() => { window.location.hash = '#/settings'; });
await page.waitForTimeout(2200);
await page.locator('[role="button"][aria-label="Светлая + тёмный сайдбар"]').first().click();
await page.waitForTimeout(900);
await shot(page, '00-dim-sidebar-live.png');
const asideLive = await page.evaluate(() => {
  const el = document.querySelector('aside');
  return el ? getComputedStyle(el).backgroundColor : 'none';
});
console.log('LIVE aside bg:', asideLive);
await page.locator('[role="button"][aria-label="Ayu Light (по умолчанию)"]').first().click();
await page.waitForTimeout(600);

// ── 1. Changes before: the v2.3.9 worktree ──────────────────────────────────
await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(2500);
await page.locator('span:has-text("Изменения ("), span:has-text("Индекс (")').first()
  .waitFor({ timeout: 15000 });
await shot(page, '01-changes-before.png');

// ── 2. Stage everything (section header click = git add) ───────────────────
const unstagedHeader = page.locator('span:has-text("Изменения (")').first();
if (await unstagedHeader.count() > 0) {
  await unstagedHeader.click();
  await page.waitForTimeout(2500);
}
await page.locator('span:has-text("Индекс (")').first().waitFor({ timeout: 15000 });
await shot(page, '02-staged.png');

// ── 3. Commit message + commit button ──────────────────────────────────────
await page.locator('#commit-message-input').fill(MSG);
await page.waitForTimeout(600);
await shot(page, '03-commit-message.png');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.locator('button:text-is("Коммит")').first().click();
await page.waitForTimeout(4500);
await shot(page, '04-commit-done.png');

// CLI check: exactly one new commit, tree clean
const head1 = sh('git rev-parse HEAD').trim();
const treeClean = sh('git status --porcelain').trim() === '';
console.log('COMMIT:', head1.slice(0, 8), 'parent', before.head.slice(0, 8), 'clean-tree', treeClean);
if (head1 === before.head) { console.log('FAIL: no commit created'); await app.close(); process.exit(1); }

// ── 4. Push to origin/feature/smartgit-electron-v3 (toolbar «Push») ────────
await shot(page, '05-before-push.png');
await page.locator('button[title*="Отправить текущую ветку"]').first().click();
await page.waitForTimeout(9000);
await shot(page, '06-push-toast.png');

let origin1 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
if (origin1 !== head1) {
  await page.waitForTimeout(3000);
  origin1 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
}
console.log('PUSH: origin =', origin1.slice(0, 8), '== local', head1.slice(0, 8), origin1 === head1);
if (origin1 !== head1) { console.log('FAIL: push did not land'); await app.close(); process.exit(1); }

await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log('SHIP v2.3.9 DONE — commit + push via UI verified');
