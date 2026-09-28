/**
 * PROBE: push main (protected) in the live app — dump every overlay, toast,
 * and the app's own command-log entries for the push, to see exactly which
 * reaction fires (dialog vs toast vs nothing).
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', timeout: 30000 }).trim();

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-probe-'));
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
console.log('branch:', sh('git rev-parse --abbrev-ref HEAD'));

await page.locator('button[title*="Отправить текущую ветку"]').first().click();
for (const wait of [5000, 5000, 5000, 5000]) {
  await page.waitForTimeout(wait);
  const state = await page.evaluate(() => {
    const overlays = [...document.querySelectorAll('div.fixed.inset-0')].map((d) => ({
      cls: (d.getAttribute('class') || '').slice(0, 70),
      text: (d.textContent || '').slice(0, 220),
    }));
    const toasts = [...document.querySelectorAll('[class*="toast"], [data-sonner-toast], [role="status"]')]
      .map((t) => (t.textContent || '').slice(0, 200));
    return { overlays, toasts };
  });
  console.log(JSON.stringify(state, null, 1).slice(0, 1600));
  console.log('—'.repeat(60));
}
// The app's own git-command log for the push
const log = await page.evaluate(async () => await window.smartgit.commandLog.list());
const pushes = (log || []).filter((e) => (e.command || '').includes('push'));
console.log('push commands in log:', pushes.length);
for (const e of pushes.slice(-3)) {
  console.log('---', (e.command || '').slice(0, 120), '| exit', e.exitCode);
  console.log('    out:', (e.stdout || '').slice(0, 200).replace(/\n/g, ' ⏎ '));
  console.log('    err:', (e.stderr || '').slice(0, 400).replace(/\n/g, ' ⏎ '));
}
await page.screenshot({ path: '/home/z/my-project/work/release/probe-protected-push.png' });
await app.close();
