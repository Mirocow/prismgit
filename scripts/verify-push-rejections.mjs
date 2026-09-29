/**
 * E2E verification of the REMOTE-conflict reactions — the PushRejectionDialog
 * («расширь сам список проработав все случаи возникающие при работе с git и
 * Remote сессиями (gitlab, github)»).
 *
 * Reproduces REAL remote-side push rejections in the RUNNING app (RU locale,
 * local bare origin + a second clone standing in for the colleague/GitLab):
 *   S1. non-fast-forward — Toolbar Push → the dialog opens (title, recovery
 *       buttons, raw git output, branch chip). «Стянуть и слить» pulls (merge)
 *       and the push RETRIES automatically; the remote ends at the local HEAD.
 *   S2. non-fast-forward after a local history rewrite — «Перезаписать
 *       (--force-with-lease)» in the dialog force-pushes with a lease; the
 *       remote ends at the amended HEAD.
 *   S3. lease-stale — the remote moved again after our last fetch; a
 *       force-with-lease push from the Push To… panel is refused with
 *       «stale info»; «Fetch и повторить push» renews the lease and lands.
 *
 * Usage: DISPLAY=:99 node scripts/verify-push-rejections.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/pushrej-e2e';
const REPO = path.join(ROOT, 'repo');
const SEEDER = path.join(ROOT, 'seeder');
const ORIGIN = path.join(ROOT, 'origin.git');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};

const sh = (cmd, cwd = REPO) =>
  execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const remoteMain = () => sh(`git rev-parse refs/heads/main`, ORIGIN).trim();
const localMain = () => sh('git rev-parse main').trim();

// ── 1. Fixture: bare origin, seeder (the "colleague"), diverged clone ──────
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
sh('git init -q -b main --bare origin.git', ROOT);
sh('git clone -q origin.git seeder', ROOT);
sh('git config user.email e2e@prismgit.test && git config user.name E2E', SEEDER);
fs.writeFileSync(path.join(SEEDER, 'seed.txt'), 'seed\n');
sh('git add -A && git commit -q -m seed', SEEDER);
sh('git push -q origin main', SEEDER);
sh('git clone -q origin.git repo', ROOT);
sh('git config user.email e2e@prismgit.test && git config user.name E2E', REPO);
// Genuine divergence: local-only commit on a DIFFERENT file (pull stays clean,
// the push is what gets rejected), plus a remote-side commit after the clone.
fs.writeFileSync(path.join(REPO, 'local.txt'), 'local work\n');
sh('git add -A && git commit -q -m "local work"', REPO);
fs.writeFileSync(path.join(SEEDER, 'remote.txt'), 'remote work\n');
sh('git add -A && git commit -q -m "remote work"', SEEDER);
sh('git push -q origin main', SEEDER);
console.log('fixture ready (diverged clone, remote ahead, bare origin)');

// ── 2. App launch (RU locale) ──────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-pushrej-'));
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
await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(1500);

/** The toolbar one-click Push button (label kept as "Push" in RU too). */
const pushButton = page.locator('button').filter({ hasText: /^Push$/ }).first();
const pushChevron = pushButton.locator('xpath=following-sibling::button[1]');

/** Dialog helpers — the PushRejectionDialog is a fixed overlay z-50. */
const dialog = page.locator('.fixed.inset-0.z-50');
const waitDialogGone = () =>
  dialog.waitFor({ state: 'detached', timeout: 15000 }).then(() => true).catch(() => false);

// ═══ S1. non-fast-forward → dialog → «Стянуть и слить» recovers ════════════
console.log('\n── S1. Push rejected (non-fast-forward) → dialog + pull-merge recovery ──');
await pushButton.click();
const s1Title = await page
  .waitForSelector('text=Push отклонён — удалённая ветка ушла вперёд', { timeout: 12000 })
  .then(() => true).catch(() => false);
check('S1: PushRejectionDialog opened with the non-FF title', s1Title);
check('S1: recovery buttons rendered',
  (await page.locator('button:has-text("Стянуть и слить")').count()) === 1 &&
  (await page.locator('button:has-text("Стянуть с rebase")').count()) === 1 &&
  (await page.locator('button:has-text("Перезаписать (--force-with-lease)")').count()) === 1);
check('S1: raw git output block present',
  (await page.locator('text=Вывод git:').count()) === 1);
check('S1: branch chip shows main',
  (await page.locator('text=Ветка:').count()) === 1);
await page.screenshot({ path: '/home/z/my-project/work/push-rejection-dialog.png' });
console.log('screenshot: /home/z/my-project/work/push-rejection-dialog.png');

await page.locator('button:has-text("Стянуть и слить")').click();
const s1Recovered = await page
  .waitForSelector('text=Push выполнен после восстановления синхронизации', { timeout: 20000 })
  .then(() => true).catch(() => false);
check('S1: recovery toast after pull + auto-retried push', s1Recovered);
check('S1: dialog closed itself', await waitDialogGone());
check('S1: remote advanced to the local commit', remoteMain() === localMain());

// ═══ S2. local rewrite → non-FF → «Перезаписать (--force-with-lease)» ══════
console.log('\n── S2. History rewrite → dialog → force-with-lease overwrite ──');
sh('git commit --amend -q -m "local work (amended)" --no-edit');
await page.waitForTimeout(1500);
await pushButton.click();
const s2Title = await page
  .waitForSelector('text=Push отклонён — удалённая ветка ушла вперёд', { timeout: 12000 })
  .then(() => true).catch(() => false);
check('S2: dialog opened again for the rewritten-history push', s2Title);
await page.locator('button:has-text("Перезаписать (--force-with-lease)")').click();
const s2Recovered = await page
  .waitForSelector('text=Push выполнен после восстановления синхронизации', { timeout: 20000 })
  .then(() => true).catch(() => false);
check('S2: recovery toast after the force-with-lease push', s2Recovered);
check('S2: dialog closed', await waitDialogGone());
check('S2: remote now at the AMENDED head', remoteMain() === localMain());

// ═══ S3. lease-stale → Push To… force-lease → «Fetch и повторить» ══════════
console.log('\n── S3. Remote moved again → force-with-lease refused (stale info) → fetch retry ──');
// The colleague pushes once more AFTER our last fetch → the local lease is
// stale. We rewrite locally again so only a force push can land.
// (Seeder pulls first: S1's recovery pushed the merged history, so a plain
// seeder push would itself be rejected as non-fast-forward.)
sh('git pull --no-rebase -q origin main', SEEDER);
fs.writeFileSync(path.join(SEEDER, 'remote2.txt'), 'remote work 2\n');
sh('git add -A && git commit -q -m "remote work 2"', SEEDER);
sh('git push -q origin main', SEEDER);
sh('git commit --amend -q -m "local work (amended again)" --no-edit');
await page.waitForTimeout(1200);

// Open the Push To… dropdown, enable force + lease, push.
await pushChevron.click();
await page.waitForTimeout(600);
const forceCheckbox = page.locator('label:has(span.text-status-deleted) input[type="checkbox"]').first();
await forceCheckbox.check();
await page.waitForTimeout(400);
await page.locator('[data-testid="push-force-mode"]').selectOption('lease');
const panelPush = page.locator('button.btn-primary:has-text("Отправить")').first();
await panelPush.click();
const s3Title = await page
  .waitForSelector('text=Force push отклонён — устаревшая аренда', { timeout: 20000 })
  .then(() => true).catch(() => false);
check('S3: lease-stale dialog opened (was a raw stderr toast before)', s3Title);
await page.screenshot({ path: '/home/z/my-project/work/push-rejection-lease.png' });
console.log('screenshot: /home/z/my-project/work/push-rejection-lease.png');

await page.locator('button:has-text("Fetch и повторить push")').click();
const s3Recovered = await page
  .waitForSelector('text=Push выполнен после восстановления синхронизации', { timeout: 20000 })
  .then(() => true).catch(() => false);
check('S3: recovery toast after fetch + re-leased force push', s3Recovered);
check('S3: dialog closed', await waitDialogGone());
check('S3: remote at the locally rewritten head', remoteMain() === localMain());

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
await app.close().catch(() => {});
process.exit(failures === 0 ? 0 : 1);
