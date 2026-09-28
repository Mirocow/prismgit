/**
 * Probe: WHY did the dogfood commit (prismgit repo, branch feature/…) fire
 * «Коммит создан» WITHOUT the hash chip while scratch repos showed it?
 *
 * FOUND (Task 29 root cause): electron/services/git.ts commit() parsed the
 * hash from "[branch hash] msg" with a branch charset of [a-z0-9_-] — no
 * '/'. feature/* branches → '' → no hash in any commit toast.
 *
 * SAFETY (the Task-28/29 lesson, learned the hard way): this probe COMMITS
 * through the app on the REAL repo. It REFUSES to run on a dirty tree —
 * the app's stage-all would swallow uncommitted work into the probe commit,
 * and the cleanup reset would DESTROY it. Commit your work first.
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

// GUARD: never probe-commit on top of uncommitted work.
const dirty = sh('git status --porcelain').trim();
if (dirty) {
  console.error('REFUSING: worktree is dirty — commit or stash first.\n' + dirty);
  process.exit(2);
}
const before = sh('git rev-parse HEAD').trim();
fs.writeFileSync(path.join(REPO, 'probe-temp.txt'), 'probe\n');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-timing-'));
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
await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(2500);

const unstagedHeader = page.locator('span:has-text("Изменения (")').first();
if (await unstagedHeader.count() > 0) {
  await unstagedHeader.click();
  await page.waitForTimeout(3000);
}
await page.locator('#commit-message-input').fill('probe: toast timing');
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.locator('button:text-is("Коммит")').first().click();

// poll 200ms: toast text + chip + real HEAD, correlated
const t0 = Date.now();
let sawChip = false;
let sawToast = false;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(200);
  const toasts = await page.locator('[role="status"] > div, [role="alert"] > div').allInnerTexts().catch(() => []);
  const chips = await page.locator('button[title="Копировать полный хеш"]').count();
  const head = sh('git rev-parse --short HEAD').trim();
  if (toasts.length > 0) sawToast = true;
  if (chips > 0) sawChip = true;
  if (i % 10 === 0 || (toasts.length && i < 10)) {
    console.log(`t=${((Date.now() - t0) / 1000).toFixed(1)}s head=${head} chips=${chips} toasts=${JSON.stringify(toasts.map(x => x.replace(/\n/g, '|')))}`);
  }
}
console.log(sawToast && sawChip ? 'PASS — toast + hash chip observed' : 'FAIL — toast seen: ' + sawToast + ', chip: ' + sawChip);
await app.close();

// Cleanup: reset to the recorded BEFORE head; remove the probe file.
const after = sh('git rev-parse HEAD').trim();
if (after !== before) {
  sh(`git reset --hard ${before}`);
  sh('rm -f probe-temp.txt');
}
console.log('cleanup: HEAD =', sh('git rev-parse --short HEAD').trim(), '(clean:', sh('git status --porcelain').trim() === '' ? 'yes' : 'NO', ')');
if (!sawChip) process.exit(1);
