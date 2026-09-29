/**
 * Commit + push Task-29 changes THROUGH the PrismGit UI (project doctrine:
 * git operations via the app itself, screenshotted).
 * Modeled on commit-task28.mjs. Usage: DISPLAY=:99 node scripts/commit-task29.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/task29';
const MSG = `feat(ui): merge Remotes into Branches, toast hash chips, Blame/Reflog/pin rework

Five user reports, five fixes (Task 29):

1. Remotes tool → Branches («откажемся от инструмента Remotes»):
- nav/route/chunk/menu entries removed; the Branches page already owned
  the remote groups (fetch/configure/rename/remove/properties/depth/
  push-to/pull/copy-url) — it now also gets the Fetch-All (--prune)
  header button, the Add-Remote header button, and the menu:remoteAdd
  entry pops its dialog via the prismgit:branches-add-remote event
- RemotesPage.tsx + remoteContextMenu.ts + tests deleted (~70 dead
  i18n keys removed across 3 domains; parity 3732x4)

2. Commit hash in the toast («не отображается хеш комита»):
- Toast.hash + successCommit(): monospace accent CHIP with a copy
  button in the toast title (8s duration) instead of the easy-to-miss
  «Хеш: …» detail line
- all commit-creating flows now carry the hash: Changes commit,
  merge-continue (continueMerge now returns the merge commit hash),
  undo-commit (captures the removed hash before the soft reset)
- DiffPage 'All conflicts resolved' was a hardcoded EN string in the
  RU/ZH/DE app — now localized (diff.conflictsAllResolved)

3. Reflog checkboxes («не понятно зачем нужны чекбоксы»):
- removed the dead multi-select placeholder rows (onChange did
  nothing); master-detail flow unchanged

4. Blame redesign («совершенно непонятный и неудобный»):
- fuzzy FILE PICKER over git ls-files (the old page required typing
  the exact path by hand)
- GitHub-style GROUPED gutter: one author+date+hash+subject block per
  commit run; nowrap code view (was break-all wrapped)
- "Blame before this commit" (hash^) drill-down + back-to-HEAD chip
- line context menu: VS Code at line / view commit / blame-before /
  copy hash / copy message

5. Repo tree pin («Закрепить» не работает и дублирует фавориты):
- pin button + pinRepo action + pinned sorting tiers removed (the
  flag duplicated favorites and its sort was masked by the favorites
  sort); storage field kept for back-compat

tests: 1992 passed / 0 failed / 34 pre-existing skips (+16: toast
hash chip x4, BlamePage x7, ReflogPage x3, MergeInProgressPanel x2;
deleted RemotesPage/remoteContextMenu suites); tsc clean; i18n parity
3732x4; live E2E verify-task29.mjs 20/20 (all five changes driven
through the real UI, screenshots in work/task29-verify/shots)`;

fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) })
  .then(() => console.log(`📸 ${name}`));
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

const before = {
  head: sh('git rev-parse HEAD').trim(),
  origin: sh('git rev-parse origin/feature/smartgit-electron-v3').trim(),
  dirty: sh('git status --porcelain').split('\n').filter(Boolean).length,
};
console.log('BEFORE: dirty files =', before.dirty, '· head', before.head.slice(0, 8));

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-t29-'));
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

// 1. Changes before
await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(2500);
await page.locator('span:has-text("Изменения ("), span:has-text("Индекс (")').first()
  .waitFor({ timeout: 10000 });
await shot(page, '11-changes-before.png');

// 2. Stage everything (the section header click = Stage All)
const unstagedHeader = page.locator('span:has-text("Изменения (")').first();
if (await unstagedHeader.count() > 0) {
  await unstagedHeader.click();
  await page.waitForTimeout(2000);
}
await page.locator('span:has-text("Индекс (")').first().waitFor({ timeout: 10000 });
await shot(page, '12-staged.png');

// 3. Commit — and the NEW toast must carry the hash chip (dogfooding check 2)
await page.locator('#commit-message-input').fill(MSG);
await page.waitForTimeout(600);
await shot(page, '13-commit-message.png');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.locator('button:text-is("Коммит")').first().click();
await page.waitForTimeout(4000);
await shot(page, '14-commit-done.png');

const head1 = sh('git rev-parse HEAD').trim();
const treeClean = sh('git status --porcelain').trim() === '';
console.log('COMMIT:', head1.slice(0, 8), 'parent', before.head.slice(0, 8), 'clean-tree', treeClean);
if (head1 === before.head) { console.log('FAIL: no commit created'); process.exit(1); }

// 4. Push
await shot(page, '15-before-push.png');
await page.locator('button[title*="Отправить текущую ветку"]').first().click();
await page.waitForTimeout(6000);
await shot(page, '16-push-toast.png');

const origin1 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
console.log('PUSH: origin =', origin1.slice(0, 8), '== local', head1.slice(0, 8), origin1 === head1);
if (origin1 !== head1) { console.log('FAIL: push did not land'); process.exit(1); }

await app.close();
console.log('DONE — Task-29 changes committed & pushed via the PrismGit UI');
