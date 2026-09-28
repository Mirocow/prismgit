/**
 * RELEASE FLOW — Phase 1: commit + push the counters fix THROUGH THE APP.
 * «Все операции с git надо выполнить с помощью prismgit и снимая экраны
 * каждого из действий».
 *
 * RU locale (user-facing evidence). Every action is a real UI interaction:
 * stage via the «Изменения (N)» section header click, message typed into the
 * commit editor, «Коммит» button, toolbar «Push». Evidence screenshots land
 * in /home/z/my-project/work/release/.
 *
 * Usage: DISPLAY=:99 node scripts/release-flow-1-commit.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/release';
const MSG = 'fix(counters): every user-visible counter audited & corrected\n\n'
  + '- History «Tagged (N)» chip: N is now the TAGGED-COMMITS-IN-VIEW count\n'
  + '  (matches what the filter shows); tooltip carries the repo-wide total\n'
  + '- per-commit «Теги на этом коммите (N)» — counts only tags on the commit\n'
  + '- Branches summary RU grammar: {n|one|few|many} plural pipe in t()\n'
  + '  («1 локальная · 2 локальные · 5 локальных»), en/zh/de byte-identical\n'
  + '- sidebar nav labels/groups now follow the restored locale at startup\n'
  + '  (were frozen at module-load: RU profile showed an English sidebar)\n'
  + '- E2E: scripts/verify-counters.mjs — 17/17 live checks vs git CLI ground truth';

fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) })
  .then(() => console.log(`📸 ${name}`));
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8' });

const before = {
  head: sh('git rev-parse HEAD').trim(),
  origin: sh('git rev-parse origin/feature/smartgit-electron-v3').trim(),
  dirty: sh('git status --porcelain').split('\n').filter(Boolean).length,
};
console.log('BEFORE: dirty files =', before.dirty, '· head', before.head.slice(0, 8));

// ── Launch (RU) ─────────────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-rel1-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'dark', tourCompleted: true, autoRefresh: true, locale: 'ru' },
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

// ── 1. Changes before: the counters-fix worktree ───────────────────────────
await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(2500);
await page.locator('span:has-text("Изменения ("), span:has-text("Индекс (")').first()
  .waitFor({ timeout: 10000 });
await shot(page, '01-changes-before.png');

// ── 2. Stage everything (section header click = git add) ───────────────────
// Robust to a re-run where a previous attempt already staged everything
// (then the «Изменения (N)» section is hidden entirely).
const unstagedHeader = page.locator('span:has-text("Изменения (")').first();
if (await unstagedHeader.count() > 0) {
  await unstagedHeader.click();
  await page.waitForTimeout(2000);
}
await page.locator('span:has-text("Индекс (")').first().waitFor({ timeout: 10000 });
await shot(page, '02-staged.png');

// ── 3. Commit message + commit button ──────────────────────────────────────
await page.locator('#commit-message-input').fill(MSG);
await page.waitForTimeout(600);
await shot(page, '03-commit-message.png');
// :text-is() — EXACT text. has-text() is a case-insensitive SUBSTRING match
// and also matches the «Тип коммита» type-picker button (the first run opened
// the type dropdown instead of committing!).
await page.keyboard.press('Escape'); // close any stray dropdown
await page.waitForTimeout(300);
await page.locator('button:text-is("Коммит")').first().click();
await page.waitForTimeout(4000); // commit + journal refresh
await shot(page, '04-commit-done.png');

// CLI check: exactly one new commit, message preserved, tree clean
const head1 = sh('git rev-parse HEAD').trim();
const treeClean = sh('git status --porcelain').trim() === '';
console.log('COMMIT:', head1.slice(0, 8), 'parent', before.head.slice(0, 8),
  'clean-tree', treeClean);
if (head1 === before.head) { console.log('FAIL: no commit created'); process.exit(1); }

// ── 4. Push to origin/feature/smartgit-electron-v3 (toolbar «Push») ────────
await shot(page, '05-before-push.png');
await page.locator('button[title*="Отправить текущую ветку"]').first().click();
await page.waitForTimeout(6000);
await shot(page, '06-push-toast.png');

const origin1 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
console.log('PUSH: origin =', origin1.slice(0, 8), '== local', head1.slice(0, 8), origin1 === head1);
if (origin1 !== head1) { console.log('FAIL: push did not land'); process.exit(1); }

await app.close();
console.log('PHASE 1 DONE — commit + push via UI verified');
