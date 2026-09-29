/**
 * Commit + push the MR-acceptance fixes THROUGH the PrismGit UI (project
 * doctrine: git operations via the app itself, screenshotted).
 * Modeled on release-flow-1-commit.mjs. Usage: DISPLAY=:99 node scripts/commit-mr-acceptance-fixes.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/mr-acceptance';
const MSG = `fix(reviews): MR acceptance hardening — found while live-accepting MR !6

- approve/merge/comment: refuse loudly while the GitLab projectId is
  unresolved (was: silent no-op + false success toast «PR #6 одобрен»
  with zero API traffic, verified live against MR !6)
- projectId heal watchdog: recovers after provider-store resets
  (actions were dead forever — the silent approve's forceReload was
  the only accidental healer)
- listMRCommits: paginate to the real count (badge said 100 of 244)
- header stats: fall back to per-file sums for GitLab (was «+0 −0»)
- gitlab apiJson redirects: pass the resolved token (the cross-host PAT
  drop was a no-op); refuse POST/PUT-to-GET downgrade on 3xx (silent
  false-success class)
- index.html CSP: refresh the stale boot-script hash (blocked on every
  prod load)
- i18n: RU/ZH/DE prApprove/prClose + prProjectNotResolved (3778x4)
- tests: PRReview.gitlabUnresolved (4) — disabled state, heal, stats
- live harness: scripts/verify-mr-acceptance.mjs (10 checks green)`;

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

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-mrfix-'));
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
await shot(page, '11-fix-changes-before.png');

// 2. Stage everything
const unstagedHeader = page.locator('span:has-text("Изменения (")').first();
if (await unstagedHeader.count() > 0) {
  await unstagedHeader.click();
  await page.waitForTimeout(2000);
}
await page.locator('span:has-text("Индекс (")').first().waitFor({ timeout: 10000 });
await shot(page, '12-fix-staged.png');

// 3. Commit
await page.locator('#commit-message-input').fill(MSG);
await page.waitForTimeout(600);
await shot(page, '13-fix-commit-message.png');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.locator('button:text-is("Коммит")').first().click();
await page.waitForTimeout(4000);
await shot(page, '14-fix-commit-done.png');

const head1 = sh('git rev-parse HEAD').trim();
const treeClean = sh('git status --porcelain').trim() === '';
console.log('COMMIT:', head1.slice(0, 8), 'parent', before.head.slice(0, 8), 'clean-tree', treeClean);
if (head1 === before.head) { console.log('FAIL: no commit created'); process.exit(1); }

// 4. Push
await shot(page, '15-fix-before-push.png');
await page.locator('button[title*="Отправить текущую ветку"]').first().click();
await page.waitForTimeout(6000);
await shot(page, '16-fix-push-toast.png');

const origin1 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
console.log('PUSH: origin =', origin1.slice(0, 8), '== local', head1.slice(0, 8), origin1 === head1);
if (origin1 !== head1) { console.log('FAIL: push did not land'); process.exit(1); }

await app.close();
console.log('DONE — MR-acceptance fixes committed & pushed via the PrismGit UI');
