/**
 * Commit + push Task-28 changes THROUGH the PrismGit UI (project doctrine:
 * git operations via the app itself, screenshotted).
 * Modeled on commit-mr-acceptance-fixes.mjs. Usage: DISPLAY=:99 node scripts/commit-task28.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/task28';
const MSG = `feat(merge,pr): editable 3-way center pane + stacked PR chains

3-way merge tool (user: «средняя панель недоступна для редактирования»):
- live re-highlight while typing — the visible <pre> layer rebuilt only
  on resolve/reset; typing changed the hidden value with ZERO visible
  feedback (the actual root cause of "not editable")
- shared 3-pane scroller: panes are tall columns in ONE scroll
  container; the middle textarea no longer scrolls internally — the
  side panes were frozen at row 0 for any file taller than the
  viewport (container had nothing scrollable to itself)
- attach-on-enabled: scroll/resize listeners were attached during the
  loading early-return (scrollRef === null) and never retried
- gutter pixel alignment (48px both layers) + nowrap everywhere;
  horizontal scroll synced pre→textarea via translateX
- Ctrl+Z stays NATIVE while typing (the app-level resolution-undo
  hijacked it globally on the capture phase)
- F7 / toolbar conflict navigation auto-scrolls to the conflict
- DiffPage: key={filePath} remount (stale textarea on file switch)

Stacked PRs (user: «не видно фишек гитхаба которых нет в гите типа
"Stacked PRs"»):
- src/lib/prStacks: provider-agnostic chain detection by branch
  linkage (X.base = Y.head), bottom→top merge order, cycle-safe,
  branch-point deterministic
- PR list rows: badge 1/2..N/N + chain tooltip; right-click menu with
  jump-to-stack-member entries
- PRReview header: stack strip (chips bottom→top, current highlighted,
  merge-order hint, click-through navigation)
- i18n: 7 keys x4 locales (parity 3785x4)

tests: 1967 -> 1988 (+3 ConflictMergeView v3 pins, +15 prStacks unit,
+3 prStacks UI); live probes kept in-repo: probe-3way-editable.mjs
(typing visible, 3-pane sync scroll, save+stage) and
verify-pr-stacks.mjs (real GitLab stacked chain created in-app,
badges+strip+navigation, 12/12)`;

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

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-t28-'));
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

// 3. Commit
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
console.log('DONE — Task-28 changes committed & pushed via the PrismGit UI');
