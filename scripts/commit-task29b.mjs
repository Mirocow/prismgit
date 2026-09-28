/**
 * Commit + push the Task-29 root-cause fix (commit() hash extraction on
 * slashed branches) THROUGH the PrismGit UI.
 *
 * SAFETY: refuses to run on a dirty tree with MORE than the probe file —
 * the app's stage-all would swallow uncommitted work into the commit.
 * (Task-28/29 lesson, learned twice.)
 * Usage: DISPLAY=:99 node scripts/commit-task29b.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/task29';
// The message is passed via COMMIT_MSG_FILE so this script stays generic.
const MSG = fs.readFileSync(path.join(REPO, '.commit-msg-task29b'), 'utf8');

fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) })
  .then(() => console.log(`📸 ${name}`));
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

const dirtyFiles = sh('git status --porcelain').split('\n').filter(Boolean);
if (dirtyFiles.length === 0) {
  console.error('REFUSING: nothing to commit.');
  process.exit(2);
}
const before = sh('git rev-parse HEAD').trim();
console.log('BEFORE: dirty files =', dirtyFiles.length, '· head', before.slice(0, 8));

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-t29b-'));
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
await page.locator('#commit-message-input').fill(MSG);
await page.waitForTimeout(600);
await shot(page, '21-message.png');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.locator('button:text-is("Коммит")').first().click();
await page.waitForTimeout(5000);

// dogfooding the fix itself: THIS commit's toast must carry the hash chip
const chip = page.locator('[role="status"] button[title="Копировать полный хеш"]');
const chipCount = await chip.count();
const chipText = chipCount ? (await chip.first().innerText()).trim() : '';
const head1 = sh('git rev-parse --short HEAD').trim();
console.log('CHIP:', chipCount, chipText, 'vs HEAD', head1, chipText === head1 ? 'MATCH' : 'NO MATCH');
await shot(page, '22-commit-toast.png');

const treeClean = sh('git status --porcelain').trim() === '';
console.log('COMMIT:', head1, 'parent', before.slice(0, 8), 'clean-tree', treeClean);
if (head1 === before.head) { console.log('FAIL: no commit created'); process.exit(1); }
if (!treeClean) { console.log('FAIL: tree not clean after commit'); process.exit(1); }

await page.locator('button[title*="Отправить текущую ветку"]').first().click();
await page.waitForTimeout(6000);
await shot(page, '23-push-toast.png');
const origin1 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
console.log('PUSH: origin =', origin1.slice(0, 8), '== local', head1.slice(0, 8), origin1 === sh('git rev-parse HEAD').trim());
if (origin1 !== sh('git rev-parse HEAD').trim()) { console.log('FAIL: push did not land'); process.exit(1); }

await app.close();
console.log('DONE — root-cause fix committed & pushed via the PrismGit UI');
