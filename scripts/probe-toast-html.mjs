/**
 * Probe: dump the raw toast HTML on the real repo — used to prove the
 * commit-toast hash chip structure (Task 29) and to catch the root cause
 * (chip absent on feature/* branches before the fix, present after).
 *
 * SAFETY: refuses to run on a dirty tree (the app's stage-all would
 * swallow uncommitted work; the cleanup reset would destroy it).
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

const dirty = sh('git status --porcelain').trim();
if (dirty) {
  console.error('REFUSING: worktree is dirty — commit or stash first.\n' + dirty);
  process.exit(2);
}
const before = sh('git rev-parse HEAD').trim();
fs.writeFileSync(path.join(REPO, 'probe-temp.txt'), 'probe\n');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-html-'));
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
await page.locator('#commit-message-input').fill('probe: toast html');
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.locator('button:text-is("Коммит")').first().click();
await page.waitForTimeout(2500);

const html = await page.evaluate(() => {
  const el = document.querySelector('[role="status"] > div');
  return el ? el.outerHTML : '(no toast)';
});
const hasChip = html.includes('Копировать полный хеш');
console.log('TOAST CHIP:', hasChip ? 'PRESENT' : 'MISSING');
console.log('TOAST HTML (trimmed):\n', html.slice(0, 600));
await app.close();

const after = sh('git rev-parse HEAD').trim();
if (after !== before) {
  sh(`git reset --hard ${before}`);
  sh('rm -f probe-temp.txt');
}
console.log('cleanup: HEAD =', sh('git rev-parse --short HEAD').trim());
if (!hasChip) process.exit(1);
