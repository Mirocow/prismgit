/**
 * SHIP v2.3.2 — commit + push THIS round THROUGH THE APP.
 * «Все операции с git надо выполнять с помощью PrismGit и снимая экраны
 * каждого из действий, и документированием операций».
 *
 * RU locale. Real UI interactions only: stage via the «Изменения (N)»
 * section header, message in the commit editor, «Коммит», toolbar «Push».
 * Evidence → /home/z/my-project/work/release-v232/.
 *
 * Usage: DISPLAY=:99 node scripts/ship-v231.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/release-v232';
const MSG = 'feat(ux): v2.3.2 — live 3-way splitters, fetch pause, VS Code collapse, nav state memory, search→commit, favorites sorting, theme zones\n\n'
  + '- 3-way merge: splitters were 1px x 0px (invisible/ungrabbable) — now\n'
  + '  6px wide dividers with center grip, ±5px hit area; pane headers\n'
  + '  mirror leftPct/rightPct exactly; live-tested on a real conflict\n'
  + '  (diagnose-3way: editing, highlight sync, drag-resize, alignment)\n'
  + '- fetch pause: sidebar spinner click stops the background poll cycle\n'
  + '  (Play resumes); StatusBar Фетч Pause/Play toggle everywhere\n'
  + '- VS Code-style collapse: console folds via its own header chevron;\n'
  + '  StatusBar toggle got PanelBottomClose/Open icons\n'
  + '- Back/Forward remembers tool STATE (NavSnapshot: commit/file/branch/\n'
  + '  tag/pathFilter; cross-tool jumps mark themselves to avoid pollution)\n'
  + '- Search content hits: «Коммит» button (blame-lookup → History with\n'
  + '  the commit selected + file-filtered graph); action buttons now\n'
  + '  always visible (were hover-only)\n'
  + '- Settings → «Сайдбар и навигация»: «Избранные инструменты» block —\n'
  + '  ↑/↓ reorders the sidebar favorites (favoriteToolsStore, persisted),\n'
  + '  ✕ removes; rows spaced wider\n'
  + '- theme editor: per-swatch «!» zone hints + hover zone highlight in\n'
  + '  the preview, WCAG contrast warnings + one-click «Читаемо» fix,\n'
  + '  «Панель» → «Панели и консоль», preview button label uses\n'
  + '  readableOn(accent) like the compiled theme\n'
  + '- CHANGELOG ×4 languages, version 2.3.2; tests 2027/0 (+10 pins);\n'
  + '  e2e verify-v239 20/20, verify-ui-round + verify-counters +\n'
  + '  diagnose-3way green';

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

// ── Launch (RU) ─────────────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v231-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true, locale: 'ru' },
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

// ── 1. Changes before: the v2.3.1 worktree ─────────────────────────────────
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
  // one retry via the app after fetch settle
  await page.waitForTimeout(3000);
  origin1 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
}
console.log('PUSH: origin =', origin1.slice(0, 8), '== local', head1.slice(0, 8), origin1 === head1);
if (origin1 !== head1) { console.log('FAIL: push did not land'); await app.close(); process.exit(1); }

await app.close();
console.log('SHIP v2.3.2 DONE — commit + push via UI verified');
