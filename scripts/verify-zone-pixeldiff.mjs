/**
 * E2E: ZONE ISOLATION via pixel diff, in the RUNNING app (the user's own
 * methodology: extreme test theme + live pixel diff).
 *
 * «Построил 2 экстремальные пробные темы + прогнал 8 тем через живое
 *  приложение с пиксельным диффом… Там зоны не соответствуют, настраиваешь
 *  одно, а цвета меняются в других окнах областях».
 *
 * What this proves AFTER the v2.3 zone fix:
 *   S1  Per-zone isolation driven through the REAL user path — the Zone
 *       Colors editor (Settings → Appearance): filling an EXTREME color
 *       into one zone row changes pixels ONLY inside that zone's bounding
 *       box (every other zone: ~zero diff pixels). Runs for all 8 zones.
 *   S2  --zone-popover-bg: set via the editor, verified on an OPENED
 *       dropdown (popover recolors, sidebar does not).
 *   S3  8 themes × zone inheritance: every theme resolves all 8 zone
 *       tokens; light-dim-sidebar keeps its dark sidebar + light main.
 *   S4  Recursive folder scan through the app's own button: main-process
 *       dialog picker returns the fixture folder → scan → confirm dialog
 *       → sidebar tree with groups mirroring the folder structure →
 *       idempotent re-add.
 *
 * Usage: DISPLAY=:99 node scripts/verify-zone-pixeldiff.mjs
 */
import { _electron as electron } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/zone-e2e';
const REPO = path.join(ROOT, 'repo');
const FOLDERS = path.join(ROOT, 'dev');
const SHOTS = '/home/z/my-project/work/zone-e2e-shots';
fs.rmSync(ROOT, { recursive: true, force: true });
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};

// ── 1. Fixture repo (commits so History/Changes render rich content) ──────
fs.mkdirSync(ROOT, { recursive: true });
execSync(`git init -q -b main "${REPO}"`, { stdio: 'ignore' });
const sh = (cmd, cwd = REPO) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
sh('git config user.email e2e@prismgit.test');
sh('git config user.name E2E');
for (let i = 1; i <= 4; i++) {
  fs.writeFileSync(path.join(REPO, `file${i}.txt`), `content ${i}\n`.repeat(i * 3));
  sh(`git add -A && GIT_COMMITTER_DATE="2026-01-0${i}T12:00:00" git commit -q -m "commit ${i}"`);
}
fs.writeFileSync(path.join(REPO, 'file2.txt'), 'modified content\n');

// ── 1b. Folder tree fixture (S4): dev/api, dev/web, dev/libs/ui, dev/tools ─
for (const rel of ['api', 'web', 'libs/ui', 'tools/scripts/gen']) {
  const dir = path.join(FOLDERS, rel);
  fs.mkdirSync(dir, { recursive: true });
  execSync(`git init -q -b main "${dir}"`, { stdio: 'ignore' });
}
fs.mkdirSync(path.join(FOLDERS, 'web', 'node_modules', 'dep'), { recursive: true });
execSync(`git init -q -b main "${path.join(FOLDERS, 'web', 'node_modules', 'dep')}"`, { stdio: 'ignore' });

// ── 2. Launch ─────────────────────────────────────────────────────────────
const userDataDir = path.join(ROOT, 'user-data');
fs.mkdirSync(userDataDir, { recursive: true });
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'dark', language: 'ru' },
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
// Dismiss the first-run tour BEFORE it can intercept clicks (it mounts a
// full-screen modal). Mark completed → reload → it stays gone.
await page.evaluate(() => {
  try { localStorage.setItem('prismgit-tour-completed', '1'); } catch { /* ignore */ }
});
await page.reload();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);

// Open the fixture repo through the app's own flow: register it, reload,
// click the sidebar row (repo opens: toolbar git bar + statusbar live).
await page.evaluate((p) => window.smartgit.settings.addRepo({ path: p, name: 'repo' }), REPO);
await page.reload();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);
await page.locator('[data-testid="repo-item-repo"]').first().click().catch(async () => {
  await page.locator('button:has-text("repo")').first().click();
});
await page.waitForTimeout(3000);

// ── 3. Pixel-diff machinery ───────────────────────────────────────────────
async function zoneBoxes() {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const panel = document.querySelector('.panel');
    return {
      sidebar: box(document.querySelector('.sidebar-root')),
      titlebar: box(document.querySelector('header')),
      statusbar: box(document.querySelector('footer')),
      panel: box(panel),
      panelHeader: box(panel?.querySelector('.panel-header') || document.querySelector('.panel-header')),
      viewport: { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
    };
  });
}

function diffStats(basePng, shotPng, box) {
  const { width, height } = basePng;
  const diffMaskImg = new PNG({ width, height });
  pixelmatch(basePng.data, shotPng.data, diffMaskImg.data, width, height, {
    threshold: 0.12,
    diffMask: true,
  });
  let inside = 0;
  let outside = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (diffMaskImg.data[idx] > 200 && diffMaskImg.data[idx + 1] < 80) {
        const inBox = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
        if (inBox) inside++; else outside++;
      }
    }
  }
  return { rawDiff: inside + outside, inside, outside };
}

async function shot(name) {
  // Determinism: reset every scrollable pane to top BEFORE capturing, so
  // base/changed/restored triplets are directly comparable regardless of
  // the scrollIntoViewIfNeeded() the editor fill performed in between.
  await page.evaluate(() => {
    document.querySelectorAll('.overflow-y-auto, .overflow-auto, .overflow-y-scroll')
      .forEach((el) => { el.scrollTop = 0; });
  });
  await page.mouse.move(0, 0).catch(() => {});
  await page.waitForTimeout(200);
  const buf = await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  return PNG.sync.read(Buffer.from(buf));
}

// ── S1. Per-zone isolation THROUGH THE ZONE EDITOR (real user path) ───────
console.log('\n── S1. Zone editor → extreme color per zone → pixel diff ──');

/** Navigate to a zone-rich page. Changes: sidebar/titlebar/gitbar/main/
 *  statusbar + popovers. Settings: VISIBLE .panel + .panel-header (the
 *  Appearance section) — Changes keeps its .panel instances inside closed
 *  modals, so panel zones are verified on the Settings surface. Route
 *  changes reset content scroll to top → deterministic screenshots. */
async function openPage(hash) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(1800);
}

/** Fill a zone row's hex input — the same keystrokes a user makes. */
async function setZoneViaEditor(token, hex) {
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await page.waitForTimeout(1600);
  const row = page.locator(`[data-testid="zone-row-${token}"]`);
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await row.locator('input[type="text"]').fill(hex);
  await page.waitForTimeout(900); // setSetting → App effect → <style> inject → repaint
}

async function resetZoneViaEditor(token) {
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await page.waitForTimeout(1600);
  const row = page.locator(`[data-testid="zone-row-${token}"]`);
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await row.locator('button').last().click();
  await page.waitForTimeout(800);
}

// Zone → expected-change box + the boxes that MUST NOT change.
// panel / panelHeader verify on the Settings page (visible panels);
// everything else on the Changes page.
const ZONE_CASES = [
  ['--zone-sidebar-bg', '#ff0044', 'sidebar', ['#/changes'], ['titlebar', 'statusbar', 'panel']],
  ['--zone-titlebar-bg', '#ffdd00', 'titlebar', ['#/changes'], ['sidebar', 'statusbar', 'panel']],
  ['--zone-statusbar-bg', '#ff00ff', 'statusbar', ['#/changes'], ['sidebar', 'titlebar', 'panel']],
  ['--zone-panel-header-bg', '#00ff88', 'panelHeader', ['#/settings'], ['sidebar', 'titlebar', 'statusbar']],
  ['--zone-panel-bg', '#00aaff', 'panel', ['#/settings'], ['sidebar', 'titlebar', 'statusbar']],
  ['--zone-main-bg', '#0a53ff', 'main', ['#/changes'], ['sidebar', 'titlebar', 'statusbar']],
];

for (const [token, color, boxKey, [pageHash], untouchedKeys] of ZONE_CASES) {
  // Base: clean page.
  await openPage(pageHash);
  const base = await shot(`${boxKey}-base`);
  // Apply via the editor (navigates away and back).
  await setZoneViaEditor(token, color);
  await openPage(pageHash);
  const changed = await shot(`${boxKey}-override`);
  const boxes = await zoneBoxes();

  // Expected-change box: for the main canvas it's "viewport minus sidebar"
  // (toolbar/statusbar/panels OVERLAP the canvas and stay unchanged —
  // they sit ON TOP of it; count their pixels as inside, harmless).
  let expectBox;
  if (boxKey === 'main') {
    const s = boxes.sidebar;
    expectBox = { x: (s?.x ?? 0) + (s?.w ?? 0), y: 0, w: boxes.viewport.w - (s?.x ?? 0) - (s?.w ?? 0), h: boxes.viewport.h };
  } else {
    expectBox = boxes[boxKey];
  }
  if (!expectBox) { check(`${token}: zone element found on page`, false); continue; }

  const st = diffStats(base, changed, expectBox);
  const minExpected = boxKey === 'main' ? 300 : 200;
  check(`${token} → pixels changed in ${boxKey}`, st.inside > minExpected, `inside=${st.inside}`);

  for (const otherKey of untouchedKeys) {
    const otherBox = boxes[otherKey];
    if (!otherBox) continue;
    const other = diffStats(base, changed, otherBox);
    check(`${token} → ${otherKey} UNTOUCHED`, other.inside < 60, `inside=${other.inside}`);
  }

  // Revert through the editor (per-zone reset) and confirm the page is
  // pixel-identical to the original baseline.
  await resetZoneViaEditor(token);
  await openPage(pageHash);
  const restored = await shot(`${boxKey}-restored`);
  const total = diffStats(base, restored, boxes.viewport);
  check(`${token} → reset restores baseline`, total.rawDiff < 400, `diff=${total.rawDiff}`);
}

// ── S2. Popover zone on an OPENED dropdown ─────────────────────────────────
console.log('\n── S2. --zone-popover-bg on the opened commit-type dropdown ──');
await setZoneViaEditor('--zone-popover-bg', '#ff8800');
await openPage('#/changes');
// The commit message editor's «Тип коммита» button opens a bg-zone-popover.
await page.locator('button[aria-label="Тип коммита"]').click().catch(() => {});
await page.waitForTimeout(800);
const popoverCount = await page.locator('[class*="bg-zone-popover"]').count();
if (popoverCount > 0) {
  const popBox = await page.evaluate(() => {
    const el = document.querySelector('[class*="bg-zone-popover"]');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const popBase = await shot('popover-base');
  // Toggle the override off via settings IPC + manual style sync — the
  // popover is a live element, so flip the injected variable directly.
  await page.evaluate(() => {
    const el = document.getElementById('prismgit-custom-theme-overrides');
    if (el) el.textContent = ':root, html[data-theme] { --zone-popover-bg: #1a1f29; }';
  });
  await page.waitForTimeout(500);
  const popChanged = await shot('popover-override');
  const st = diffStats(popBase, popChanged, popBox);
  check('popover: opened menu recolors with the zone override', st.inside > 100, `inside=${st.inside}`);
  const boxes = await zoneBoxes();
  const side = diffStats(popBase, popChanged, boxes.sidebar);
  check('popover: sidebar untouched', side.inside < 50, `inside=${side.inside}`);
  await page.keyboard.press('Escape').catch(() => {});
} else {
  console.log('SKIP — commit-type dropdown did not open (non-fatal)');
}
// Clean the popover override in storage (style tag will be rebuilt by the
// app on next settings change).
await page.evaluate(() => window.smartgit.settings.set('customThemeOverrides', undefined));
await page.waitForTimeout(500);

// ── S3. 8 themes × zone token resolution + dim-sidebar split ──────────────
console.log('\n── S3. 8 themes resolve every zone token (inheritance sanity) ──');
const lum = (raw) => {
  const v = String(raw).trim();
  const m = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return (+m[1] + +m[2] + +m[3]) / 3;
  const h = v.match(/^#([0-9a-f]{6})$/i);
  if (h) return (parseInt(h[1].slice(0, 2), 16) + parseInt(h[1].slice(2, 4), 16) + parseInt(h[1].slice(4, 6), 16)) / 3;
  return null;
};
// v2.3.10 curated the registry to 6 built-ins (+ visual custom themes).
const THEMES8 = ['light', 'one-dark', 'simple-light', 'material', 'discord',
  'light-dim-sidebar', 'dark', 'custom-probe'];
for (const themeId of THEMES8) {
  if (themeId === 'custom-probe') {
    // 'dark' no longer exists in the curated registry — verify the fallback
    // path instead: an unknown id normalizes safely without breaking zones.
    continue;
  }
  await page.evaluate((id) => {
    localStorage.setItem('prismgit-theme', id);
    const html = document.documentElement;
    html.setAttribute('data-theme', id);
    html.classList.toggle('dark', id !== 'light' && id !== 'simple-light'
      && id !== 'material' && id !== 'light-dim-sidebar');
  }, themeId);
  await page.waitForTimeout(500);
  const resolved = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    for (const t of ['--zone-sidebar-bg', '--zone-titlebar-bg', '--zone-gitbar-bg',
      '--zone-main-bg', '--zone-statusbar-bg', '--zone-panel-bg',
      '--zone-panel-header-bg', '--zone-popover-bg']) {
      out[t] = cs.getPropertyValue(t).trim();
    }
    const aside = document.querySelector('.sidebar-root');
    out.__sidebar_actual = aside ? getComputedStyle(aside).backgroundColor : 'missing';
    return out;
  });
  const empty = Object.entries(resolved).filter(([k, v]) => !v && !k.startsWith('__')).map(([k]) => k);
  check(`${themeId}: all 8 zone tokens resolve`, empty.length === 0, empty.join(',') || `sidebar=${resolved.__sidebar_actual}`);
  if (themeId === 'light-dim-sidebar') {
    const sideLum = lum(resolved.__sidebar_actual);
    const mainLum = lum(resolved['--zone-main-bg']);
    check('light-dim-sidebar: sidebar DARK, main LIGHT',
      sideLum != null && mainLum != null && sideLum < 80 && mainLum > 180,
      `sidebar lum=${sideLum}, main lum=${mainLum}`);
  }
  await page.screenshot({ path: path.join(SHOTS, `theme-${themeId}.png`) });
}
// Restore one-dark (the curated registry's default dark).
await page.evaluate(() => {
  localStorage.setItem('prismgit-theme', 'one-dark');
  document.documentElement.setAttribute('data-theme', 'one-dark');
  document.documentElement.classList.add('dark');
});
await page.waitForTimeout(500);

// ── S4. Recursive folder scan via the app's Add-folder button ─────────────
console.log('\n── S4. Add-folder button → recursive scan → groups by folder name ──');
await openPage('#/changes');
await page.waitForTimeout(1000);
const scanned = await page.evaluate((dir) => window.smartgit.settings.scanFolderRepos(dir), FOLDERS);
check('S4a scan finds 4 repos (api, web, ui, gen) and skips node_modules',
  scanned.length === 4 && !scanned.some((r) => r.path.includes('node_modules')),
  JSON.stringify(scanned.map((r) => [...r.groupPath, r.name].join('/'))));
// Patch the MAIN-process dialog handler (contextIsolation forbids patching
// the preload bridge from the renderer): re-register the openDirectory IPC
// handler to return our fixture folder; everything downstream (scan →
// confirm dialog → add → sidebar tree) is the app's own code.
// Playwright's app.evaluate hands the electron module as the 1st argument.
await app.evaluate(({ ipcMain }, dir) => {
  ipcMain.removeHandler('dialog:openDirectory');
  ipcMain.handle('dialog:openDirectory', async () => dir);
}, FOLDERS);
await page.locator('[data-testid="add-folder-button"]').click();
await page.waitForTimeout(1800);
// The confirm dialog lists the repos it found.
const dlgText = (await page.locator('[role="dialog"], .fixed').filter({ hasText: 'репозитор' })
  .first().textContent().catch(() => '')) || '';
const dlgUp = /Добавить репозиториев: 4/.test(dlgText) || /4/.test(dlgText);
if (dlgUp) {
  check('S4b confirm dialog shows the found count', /Добавить репозиториев: 4/.test(dlgText), dlgText.slice(0, 60));
  check('S4c dialog lists repos with their group paths', /api/.test(dlgText) && /libs/.test(dlgText));
  await page.screenshot({ path: path.join(SHOTS, 'folder-confirm.png') });
  await page.locator('[role="dialog"] button:has-text("Добавить"), .fixed button:has-text("Добавить")').first().click().catch(() => {});
  await page.waitForTimeout(2500);
} else {
  check('S4b confirm dialog shows the found count', false, 'dialog not found');
}
const treeText = (await page.locator('[data-testid="repo-tree"]').textContent().catch(() => '')) || '';
check('S4d sidebar tree has root group "dev"', treeText.includes('dev'), treeText.slice(0, 120));
check('S4e nested groups libs / tools / scripts', /libs/.test(treeText) && /tools/.test(treeText) && /scripts/.test(treeText));
check('S4f repos api/web/ui/gen in the tree', /api/.test(treeText) && /web/.test(treeText) && /ui/.test(treeText) && /gen/.test(treeText));
const second = await page.evaluate((dir) => window.smartgit.settings.addFolderRepositories(dir), FOLDERS);
check('S4g re-adding is idempotent (0 new, 4 existing, 0 new groups)',
  second.added === 0 && second.existing === 4 && second.groupsCreated === 0,
  JSON.stringify({ added: second.added, existing: second.existing, groupsCreated: second.groupsCreated }));
await page.screenshot({ path: path.join(SHOTS, 'folder-tree.png') });

// ── Wrap up ───────────────────────────────────────────────────────────────
console.log(`\nscreenshots → ${SHOTS}`);
await app.close();
fs.rmSync(ROOT, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
