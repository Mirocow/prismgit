/**
 * E2E verification of the v2.3.0 UX batch (RU locale) — runs in the REAL
 * Electron app against a fixture repo:
 *
 *   N1-N4   Back/Forward toolbar buttons + Alt+←/→ keyboard navigation
 *   S1-S4   Sidebar collapse to the VS Code-style icon rail (and back)
 *   D1-D2   History commit-details pane collapse/expand
 *   H1-H6   Full tool hotkeys: Ctrl+7/8/9 (Search/Blame/PRs) + Alt+1/4
 *   T1-T5   Theme curation: exactly 6 curated cards + «Создать тему…»;
 *           custom theme created in the visual editor applies (data-theme,
 *           live --accent change, text colors), survives the picker
 *   V1-V2   Settings «Сайдбар и навигация»: 17 rows with hotkey selects
 *   B1-B3   Commit detail card: «Ветки, содержащие коммит» + author
 *           click-to-filter
 *
 * Usage: DISPLAY=:99 node scripts/verify-ui-round.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/ui-round';
const REPO = path.join(ROOT, 'repo');
const SHOTS = '/home/z/my-project/work/ui-round-shots';
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};
const sh = (cmd, cwd = REPO) =>
  execSync(cmd, { cwd, encoding: 'utf8', shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'] });
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
  console.log(`     📸 ${name}.png`);
};

// ── 1. Fixture: 4 commits on main + feature/x branch ──────────────────────
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(REPO, { recursive: true });
sh('git init -q -b main');
sh('git config user.email dev@prismgit.test && git config user.name "Dev Author"');
for (const [i, subj] of [['1', 'init commit'], ['2', 'add feature'], ['3', 'refactor'], ['4', 'release prep']]) {
  fs.writeFileSync(path.join(REPO, `file${i}.txt`), `content ${i}\n`);
  sh(`git add -A && GIT_COMMITTER_DATE="2026-02-0${i}T10:00:00" git commit -q -m "${subj}"`);
}
sh('git checkout -q -b feature/x');
sh('git commit -q --allow-empty -m "feature work"');
sh('git checkout -q main');

// ── 2. App launch (RU, light theme) ────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ui-round-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true, locale: 'ru' },
  repositories: [{ path: REPO, name: 'repo', lastOpened: Date.now(), pinned: false }],
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
await page.locator('button:has-text("repo")').first().click().catch(async () => {
  await page.locator('[data-testid="repo-item-repo"]').first().click();
});
await page.waitForTimeout(3000);

const hash = () => page.evaluate(() => window.location.hash);
const goto = async (h) => { await page.evaluate((x) => { window.location.hash = x; }, h); await page.waitForTimeout(1200); };

// ═══ N. Back / Forward navigation ══════════════════════════════════════════
console.log('\n── N. Back/Forward navigation ──');
await goto('#/changes');
await goto('#/history');
await goto('#/diff');
// Toolbar back button (chevron) — title «Назад (Alt+←)»
const backBtn = page.locator('button[title*="Назад"]').first();
check('N1 toolbar Back button exists', await backBtn.count() > 0);
await backBtn.click();
await page.waitForTimeout(600);
const h1 = await hash();
check('N2 Back: #/diff → #/history', h1 === '#/history', `hash=${h1}`);
const fwdBtn = page.locator('button[title*="Вперёд"]').first();
check('N3 Forward button enabled after back', !(await fwdBtn.isDisabled().catch(() => true)));
await fwdBtn.click();
await page.waitForTimeout(600);
const h2 = await hash();
check('N4 Forward: #/history → #/diff', h2 === '#/diff', `hash=${h2}`);
// Alt+← keyboard
await page.keyboard.press('Alt+ArrowLeft');
await page.waitForTimeout(600);
const h3 = await hash();
check('N5 Alt+← goes back to #/history', h3 === '#/history', `hash=${h3}`);
await shot(page, '01-back-forward-buttons');

// ═══ H. Full tool hotkeys ══════════════════════════════════════════════════
console.log('\n── H. Hotkeys for every tool ──');
for (const [combo, expectedHash, name] of [
  ['Control+7', '#/search', 'Ctrl+7 → Поиск'],
  ['Control+8', '#/blame', 'Ctrl+8 → Blame'],
  ['Control+9', '#/pulls', 'Ctrl+9 → Pull Requests'],
  ['Alt+1', '#/gitflow', 'Alt+1 → Git-Flow'],
  ['Alt+4', '#/ai-chat', 'Alt+4 → AI-чат'],
]) {
  await page.keyboard.press(combo);
  await page.waitForTimeout(900);
  const h = await hash();
  check(`H: ${name}`, h === expectedHash, `hash=${h}`);
}

// ═══ S. Sidebar collapse → icon rail ═══════════════════════════════════════
console.log('\n── S. Sidebar collapse (VS Code-style rail) ──');
const collapseBtn = page.locator('button[title*="Свернуть сайдбар"]').first();
check('S1 sidebar collapse button exists', await collapseBtn.count() > 0);
await collapseBtn.click();
await page.waitForTimeout(500);
const rail = page.locator('[data-testid="sidebar-rail"]');
check('S2 icon rail rendered when collapsed', await rail.count() === 1);
await shot(page, '02-sidebar-rail');
// Rail tool button navigates
await rail.locator('[aria-label="История"]').first().click();
await page.waitForTimeout(800);
check('S3 rail icon navigates to History', (await hash()) === '#/history', `hash=${await hash()}`);
// Expand restores the full sidebar
await page.locator('button[title*="Развернуть сайдбар"]').first().click();
await page.waitForTimeout(500);
check('S4 expand restores the full sidebar', (await page.locator('[data-testid="sidebar-rail"]').count()) === 0
  && (await page.locator('aside.sidebar-root').count()) >= 1);

// ═══ D. History details pane collapse ══════════════════════════════════════
console.log('\n── D. History commit-details collapse ──');
await goto('#/history');
await page.waitForTimeout(2000);
const collapsePane = page.locator('button[title*="Свернуть панель коммита"]').first();
check('D1 details collapse button exists', await collapsePane.count() > 0);
await collapsePane.click();
await page.waitForTimeout(400);
const expandPane = page.locator('button[title*="Развернуть панель коммита"]').first();
check('D2 collapsed → expand strip visible', await expandPane.count() === 1);
await shot(page, '03-history-pane-collapsed');
await expandPane.click();
await page.waitForTimeout(400);
check('D3 expand restores the details pane', (await page.locator('button[title*="Свернуть панель коммита"]').count()) === 1);

// ═══ B. Commit detail: branches containing + author filter ════════════════
console.log('\n── B. Commit details: branches + author ──');
await page.waitForTimeout(1500);
const branchesSection = await page.locator('text=Ветки, содержащие коммит').count();
check('B1 «Ветки, содержащие коммит» section rendered', branchesSection > 0);
// The default head+upstream walk is on main → main contains it (and maybe more).
const badges = await page.locator('text=Ветки, содержащие коммит').first()
  .locator('..').locator('button').allTextContents().catch(() => []);
console.log('     branch badges:', JSON.stringify(badges));
check('B2 main is listed among containing branches', badges.some((b) => b.trim() === 'main'),
  `badges=${badges.join('|')}`);
const authorBtn = page.locator('button[title*="Показать коммиты этого автора"]').first();
check('B3 author click-to-filter button exists', await authorBtn.count() > 0);
await authorBtn.click();
await page.waitForTimeout(700);
const authorInput = page.locator('input[placeholder*="Автор"], input[placeholder*="автор"]').first();
const authorVal = await authorBtn.textContent().catch(() => '');
// The extended filter panel opens with the Author field filled — check the
// History filter panel (extended) input contains the author name.
const filterVal = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input[type="text"]')];
  return inputs.map((i) => i.value).filter(Boolean);
});
const foundAuthor = filterVal.some((v) => v.includes('Dev Author'));
check('B4 author filter filled after click', foundAuthor, `inputs=${JSON.stringify(filterVal).slice(0, 160)}`);
await shot(page, '04-commit-branches-author');

// ═══ T. Theme curation + custom theme editor ══════════════════════════════
console.log('\n── T. Themes: 6 curated + custom theme editor ──');
await goto('#/settings');
await page.waitForTimeout(1500);
// Appearance tab («Оформление» / «Внешний вид»)
const appearanceTab = page.locator('button:has-text("Оформление"), button:has-text("Внешний вид")').first();
if ((await appearanceTab.count()) === 0) {
  // tab labels differ — take the first tab as fallback diagnostics
  console.log('     tab labels:', await page.locator('nav button, aside button').allTextContents().catch(() => []));
}
await appearanceTab.click().catch(() => {});
await page.waitForTimeout(800);
// Scroll the themes section into view
await page.locator('text=Темы').first().scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(400);
// Curated cards: click targets are div[role=button] in the theme grid
const themeCards = await page.locator('[role="button"][aria-label]').allTextContents().catch(() => []);
const cardCount = await page.locator('[role="button"][aria-label="Ayu Light"], [role="button"][aria-label="One Dark"], [role="button"][aria-label="Simple"], [role="button"][aria-label="Material"], [role="button"][aria-label="Discord"], [role="button"][aria-label="Светлое окно + тёмный сайдбар"]').count().catch(() => 0);
console.log(`     theme cards visible with curated aria-labels: ${cardCount} (labels are RU — see below)`);
// Curated cards — count role=button cards INSIDE the theme grid (the grid
// that contains the dashed «Создать тему…» button; nav items also use
// role=button, so the count must be scoped).
const createCard = page.locator('button:has-text("Создать тему")').first();
check('T1 «Создать тему…» card exists', await createCard.count() > 0);
const gridCards = await page.locator('div.grid:has(button:has-text("Создать тему")) [role="button"][aria-label]').count();
console.log(`     theme cards inside the picker grid: ${gridCards}`);
check('T2 exactly 6 curated theme cards', gridCards === 6, `got=${gridCards}`);
await shot(page, '05-theme-picker-6');

// Open the editor
await createCard.click();
await page.waitForTimeout(600);
const editor = page.locator('[role="dialog"]');
check('T3 theme editor dialog opened', await editor.count() > 0);
const colorInputs = await page.locator('[role="dialog"] input[type="color"]').count();
check('T4 editor offers 15 color pickers', colorInputs === 15, `got=${colorInputs}`);
await shot(page, '06-theme-editor');
// Name + accent color, then save. Field order: 5 surfaces, 3 text, then
// accent (index 8), border (9), 5 status colors.
await page.locator('[role="dialog"] input[type="text"]').first().fill('Тест-тема');
const accentPick = page.locator('[role="dialog"] input[type="color"]').nth(8);
await accentPick.fill('#ff6b35').catch(async () => {
  // input[type=color] fill needs evaluate in some builds
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('[role="dialog"] input[type="color"]')];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[8], '#ff6b35');
    inputs[8].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[8].dispatchEvent(new Event('change', { bubbles: true }));
  });
});
await shot(page, '06b-theme-editor-filled');
await page.locator('[role="dialog"] button:has-text("Сохранить")').first().click();
await page.waitForTimeout(1200);
// Diagnostics: did the settings persist + is the grid showing the card?
const savedT = JSON.parse(fs.readFileSync(path.join(userDataDir, 'prismgit-settings.json'), 'utf8'));
console.log('     persisted customThemes:', JSON.stringify(savedT.settings?.customThemes ?? null).slice(0, 220));
const cardsNow = await page.locator('div.grid:has(button:has-text("Создать тему")) [role="button"][aria-label]').count();
console.log(`     theme cards after save: ${cardsNow}`);
// The custom card now appears in the grid → click it to apply
const customCard = page.locator('div.grid:has(button:has-text("Создать тему")) [aria-label="Тест-тема"]').first();
check('T5 custom theme card appears after save', await customCard.count() > 0);
await customCard.click();
await page.waitForTimeout(900);
const dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
check('T6 custom theme applied (data-theme=custom-*)', (dataTheme || '').startsWith('custom-'), `data-theme=${dataTheme}`);
const accentNow = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
check('T7 --accent took the custom value', accentNow.toLowerCase().includes('#ff6b35'), `--accent=${accentNow}`);
const textNow = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim());
console.log(`     --text-primary under custom theme: ${textNow}`);
await shot(page, '07-custom-theme-applied');

// ═══ V. Settings: Sidebar & Navigation section ════════════════════════════
console.log('\n── V. Settings: «Сайдбар и навигация» ──');
// Interface tab
const uiTab = page.locator('button:has-text("Интерфейс")').first();
await uiTab.click().catch(() => {});
await page.waitForTimeout(700);
const navSection = page.locator('text=Сайдбар и навигация').first();
check('V1 «Сайдбар и навигация» section rendered', await navSection.count() > 0);
const hotkeySelects = await page.locator('select[title*="Горячая клавиша инструмента"]').count();
check('V2 hotkey select per tool (17 rows)', hotkeySelects === 17, `got=${hotkeySelects}`);
await shot(page, '08-sidebar-nav-settings');
// Move the first tool down → navOrder persisted → sidebar order changes
const moveDown = page.locator('button[title="Переместить ниже"]').first();
await moveDown.click();
await page.waitForTimeout(900);
const saved = JSON.parse(fs.readFileSync(path.join(userDataDir, 'prismgit-settings.json'), 'utf8'));
check('V3 navOrder persisted to settings', Array.isArray(saved.settings?.navOrder) && saved.settings.navOrder[0] !== '/changes',
  `navOrder[0]=${saved.settings?.navOrder?.[0]}`);

console.log(`\n════ RESULT: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURES'} ════`);
await app.close().catch(() => {});
process.exit(failures === 0 ? 0 : 1);
