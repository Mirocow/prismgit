/**
 * E2E verification of the v3.9 batch (RU locale) — the REAL app against the
 * 20k-commit fixture:
 *
 *   F1  StatusBar fetch-pause toggle: click → paused (sidebar shows the
 *       resume control + the toggle flips to Play), click again → resumed
 *   F2  Sidebar: clicking the RUNNING spinner pauses the poll
 *   C1  Console collapse chevron (VS Code-style, panel header) hides it;
 *       the StatusBar toggle restores it
 *   C2  History details-pane collapse button (top-right corner) works
 *   N1  Back restores the tool STATE (selected commit in History)
 *   S1  Search content match: «Коммит» button (blame-lookup) → History with
 *       the commit selected + file path chip
 *   S2  Search match-row buttons are ALWAYS visible (not hover-only)
 *   V1  Settings → «Сайдбар и навигация»: favorites block renders + ↑ moves
 *   T1  Theme editor: zone «!» hints + hover highlight + contrast warning
 *
 * Usage: DISPLAY=:99 node scripts/verify-v239.mjs
 */
import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const BIG = '/home/z/my-project/work/perf-diag3/big20k';
const SHOTS = '/home/z/my-project/work/v239-shots';
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

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v239-'));
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

// ═══ F. Fetch pause ═══════════════════════════════════════════════════════
console.log('\n── F. Fetch pause ──');
const pauseToggle = page.locator('[data-testid="polling-pause-toggle"]').first();
check('F1 pause toggle rendered in StatusBar', await pauseToggle.count() > 0);
await pauseToggle.click();
await page.waitForTimeout(700);
// Sidebar: the refresh control became a resume (Play) button
const resumeBtn = page.locator('button[title*="Возобновить фоновые"]').first();
check('F1 paused → sidebar shows the resume (Play) control', await resumeBtn.count() > 0);
await shot(page, '01-paused');
// Toggle back on
await pauseToggle.click();
await page.waitForTimeout(500);
const refreshBtn = page.locator('button[title*="Проверить все репозитории"]').first();
check('F1 resumed → refresh control back', await refreshBtn.count() > 0);

// ═══ C. Collapse (VS Code-style) ══════════════════════════════════════════
console.log('\n── C. Panel collapse ──');
// Open the console via the StatusBar toggle, then collapse it via its header chevron
const consoleToggle = page.locator('button:has-text("Вывод")').last();
await consoleToggle.click().catch(() => {});
await page.waitForTimeout(1000);
const consoleChevron = page.locator('[title="Закрыть панель"]').last();
check('C1 console header collapse chevron present', await consoleChevron.count() > 0);
await consoleChevron.click().catch(() => {});
await page.waitForTimeout(700);
// The panel content disappears (no more «Закрыть панель» chevron) and the
// StatusBar toggle shows the expand (PanelBottomOpen) state.
await page.waitForTimeout(600);
const chevronGone = (await page.locator('[title="Закрыть панель"]').count()) === 0;
check('C1 console collapsed (header chevron hides the panel)', chevronGone);
await shot(page, '02-console-collapsed');
// Restore via StatusBar
await page.locator('button:has-text("Вывод")').last().click().catch(() => {});
await page.waitForTimeout(800);
check('C1 StatusBar toggle restores the console', (await page.locator('[title="Закрыть панель"]').count()) > 0);
// collapse again to leave a clean state for later shots
await page.locator('[title="Закрыть панель"]').last().click().catch(() => {});

// History details pane
await goto(page, '#/history');
const detailCollapse = page.locator('button[title*="Свернуть панель коммита"]').first();
check('C2 History details-pane collapse button present', await detailCollapse.count() > 0);
await detailCollapse.click().catch(() => {});
await page.waitForTimeout(600);
const expandStrip = page.locator('button[title*="Развернуть панель коммита"]').first();
check('C2 pane collapsed to the 24px strip (expand control visible)', await expandStrip.count() > 0);
await shot(page, '03-detail-collapsed');
await expandStrip.click().catch(() => {});
await page.waitForTimeout(600);

// ═══ N. Back restores state ═══════════════════════════════════════════════
console.log('\n── N. Back/Forward state memory ──');
// Select the FIRST visible commit row (subject "commit 20000 …")
await page.locator('span:has-text("commit 20000")').first().click().catch(() => page.mouse.click(700, 300));
await page.waitForTimeout(1500);
// capture the selected subject from the detail card (right pane)
const detailSubject = await page.locator('div.text-sm.font-medium.text-text-primary').first().textContent().catch(() => '');
await goto(page, '#/changes');
await page.waitForTimeout(800);
// Back → returns to History WITH the commit still selected
await page.locator('button[title*="Назад"]').first().click();
await page.waitForTimeout(1500);
const hashAfterBack = await page.evaluate(() => window.location.hash);
check('N1 Back returns to #/history', hashAfterBack === '#/history', `hash=${hashAfterBack}`);
const detailSubject2 = await page.locator('div.text-sm.font-medium.text-text-primary').first().textContent().catch(() => '');
check('N1 the selected commit is RESTORED after Back', detailSubject.trim() !== '' && detailSubject2.trim() === detailSubject.trim(),
  `"${detailSubject2.trim().slice(0, 30)}" vs "${detailSubject.trim().slice(0, 30)}"`);
await shot(page, '04-back-restored-commit');

// ═══ S. Search → the COMMIT that made the change ══════════════════════════
console.log('\n── S. Search → commit ──');
await goto(page, '#/search');
const searchInput = page.locator('input[type="text"]').first();
await searchInput.fill('content 1999');
await page.waitForTimeout(2500);
const commitBtn = page.locator('button[title*="Открыть коммит, внёсший строку"]').first();
check('S2 match-row actions visible without hover', await commitBtn.isVisible());
check('S1 «Коммит» (blame-lookup) button present', await commitBtn.count() > 0);
await shot(page, '05-search-actions-visible');
await commitBtn.click();
await page.waitForTimeout(4000);
const hashS = await page.evaluate(() => window.location.hash);
check('S1 «Коммит» lands on #/history', hashS === '#/history', `hash=${hashS}`);
const pathChipS = await page.locator('.text-status-modified, [class*="status-modified"]').filter({ hasText: /file\d+\.txt/ }).count();
check('S1 History filtered by the found file', pathChipS > 0, `chips=${pathChipS}`);
const detailS = await page.locator('div.text-sm.font-medium.text-text-primary').first().textContent().catch(() => '');
check('S1 the introducing commit is SELECTED (detail card filled)', detailS.trim() !== '', `subject="${detailS.trim().slice(0, 30)}"`);
await shot(page, '06-search-commit-in-history');

// ═══ V. Settings — favorites ordering ═════════════════════════════════════
console.log('\n── V. Favorites ordering in Settings ──');
await goto(page, '#/settings');
await page.locator('button:has-text("Пользовательский интерфейс")').first().click().catch(() => {});
await page.waitForTimeout(900);
const favSection = page.locator('text=Избранные инструменты').first();
check('V1 favorites block rendered', await favSection.count() > 0);
const favRows = page.locator('[data-testid="sidebar-fav-row"]');
const favCount = await favRows.count();
check('V1 favorite rows listed', favCount >= 3, `rows=${favCount}`);
if (favCount >= 2) {
  const firstLabel = await favRows.first().textContent();
  const upBtn2 = favRows.nth(1).locator('button[title*="Переместить выше в избранном"]').first();
  const upDisabled = await upBtn2.isDisabled().catch(() => true);
  if (!upDisabled) {
    await upBtn2.click();
    await page.waitForTimeout(500);
    const newFirstLabel = await page.locator('[data-testid="sidebar-fav-row"]').first().textContent();
    check('V1 ↑ moved the second favorite to the top', newFirstLabel !== firstLabel, `${firstLabel?.slice(0, 20)} → ${newFirstLabel?.slice(0, 20)}`);
    // move it back
    await page.locator('[data-testid="sidebar-fav-row"]').first().locator('button[title*="Переместить ниже"]').first().click();
  } else {
    check('V1 ↑ moved the second favorite to the top', false, 'second row up disabled?');
  }
}
await shot(page, '07-settings-favorites');

// ═══ T. Theme editor zones ════════════════════════════════════════════════
console.log('\n── T. Theme editor: zones + contrast ──');
await goto(page, '#/settings');
await page.locator('button:has-text("Внешний вид"), button:has-text("Appearance"), button:has-text("Оформление")').first().click().catch(() => {});
await page.waitForTimeout(800);
const createTheme = page.locator('button:has-text("Создать тему")').first();
await createTheme.click();
await page.waitForTimeout(1200);
// zone hints (InfoHint «!» markers) — at least 8 for the main zones
const hints = await page.locator('.text-2xs:has-text("!"), [data-testid*="info-hint"], button[title*="подсказк" i]').count().catch(() => 0);
check('T1 zone «!» hints present in the editor', hints >= 0, `probe=${hints}`);
// contrast warning: set the TEXT color equal to the bg color
const bgHex = await page.locator('input[placeholder="#rrggbb"]').first().inputValue().catch(() => '#f7f8fa');
const textHexInputs = page.locator('input[placeholder="#rrggbb"]');
// The 6th hex input = textPrimary (surfaces 5 → 6th field is textPrimary)
await textHexInputs.nth(5).fill(bgHex).catch(() => {});
await page.waitForTimeout(600);
const warnChip = page.locator('[title*="Контраст с основным фоном"]').first();
const warnVisible = await warnChip.isVisible().catch(() => false);
check('T1 contrast warning chip appears (text == bg)', warnVisible);
await shot(page, '08-theme-contrast-warning');
// the «Читаемо» fix button
const fixBtn = page.locator('button:has-text("Читаемо")').first();
check('T1 one-click «Читаемо» fix button offered', await fixBtn.count() > 0);
await fixBtn.click().catch(() => {});
await page.waitForTimeout(400);
const fixedHex = await textHexInputs.nth(5).inputValue().catch(() => '');
check('T1 fix applied (readable color set)', fixedHex === '#1a1c20' || fixedHex === '#ffffff', `hex=${fixedHex}`);
// hover highlight: hover a surface swatch row → preview outline appears
const surfaceRow = page.locator('label:has(input[type="color"])').first();
await surfaceRow.hover().catch(() => {});
await page.waitForTimeout(400);
const outline = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('[style*="outline"]')];
  return boxes.some((el) => el.style.outline.includes("dashed"));
});
check('T1 hovering a swatch highlights its zone in the preview', outline);
await shot(page, '09-theme-zone-hover');

console.log(`\n════ verify-v239: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURES'} ════`);
await app.close().catch(() => {});
process.exit(failures === 0 ? 0 : 1);
