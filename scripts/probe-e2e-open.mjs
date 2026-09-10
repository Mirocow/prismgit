import { _electron } from 'playwright';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Recreate the e2e fixture repo (same as tests/e2e/fixtures)
const FIXTURE_REPO = path.join(os.tmpdir(), 'prismgit-test-repo');
execSync(`rm -rf "${FIXTURE_REPO}" && mkdir -p "${FIXTURE_REPO}" && cd "${FIXTURE_REPO}" && git init -q -b main && git config user.email t@t.co && git config user.name T && echo one > a.txt && git add . && git commit -qm "initial" && git tag v1.0 && echo two >> a.txt`, { shell: '/bin/bash' });

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe2-'));
const settingsFile = path.join(userDataDir, 'prismgit-settings.json');
fs.writeFileSync(settingsFile, JSON.stringify({
  settings: { theme: 'light', fontSize: 13, sidebarWidth: 240, contrast: 100, maxHistoryLoad: 500, pullStrategy: 'merge', enableTelemetry: false },
  repositories: [{ path: FIXTURE_REPO, name: 'test-repo', lastOpened: Date.now(), pinned: false }],
  repoMetadata: {},
}, null, 2));

const app = await _electron.launch({
  args: ['--no-sandbox', path.join(process.cwd(), 'dist-electron/main.js')],
  env: { ...process.env, NODE_ENV: 'production', DISPLAY: process.env.DISPLAY || ':99', PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'en' },
});
app.process().stdout?.on('data', (d) => console.log('[main.out]', String(d).trim().slice(0, 300)));
app.process().stderr?.on('data', (d) => { const s = String(d).trim(); if (!s.includes('bus.cc')) console.log('[main.err]', s.slice(0, 300)); });
const page = await app.firstWindow();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 500)));
await page.waitForTimeout(2500);
console.log('url before click:', page.url());
const btn = page.locator('button:has-text("test-repo")').first();
console.log('repo button visible:', await btn.isVisible().catch((e) => 'ERR ' + e));
if (await btn.isVisible().catch(() => false)) {
  await btn.click();
  await page.waitForTimeout(2500);
  console.log('url after click:', page.url());
  const aside = page.locator('aside button:has-text("Tags")').first();
  console.log('aside Tags visible:', await aside.isVisible().catch(() => false));
  const anyNav = await page.locator('aside button').count();
  console.log('aside button count:', anyNav);
}
await page.screenshot({ path: '/tmp/probe2.png' });
await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
