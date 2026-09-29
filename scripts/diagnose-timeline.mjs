/**
 * Timeline diagnostic: open MR !6 review, then sample the Approve button
 * state + gitlab API log every 2s for 30s — reveals whether the projectId
 * prop heals (extra getProjectByPath lookups after the store reset).
 * Usage: DISPLAY=:99 node scripts/diagnose-timeline.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const GL_TOKEN = 'glpat-WU4paMsj1aLktM8BUQktAm86MQp1Om0H.01.0w0h427at';
const GL_URL = 'http://178.140.10.58:8082';

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-tl-'));
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
await page.evaluate(async ({ token, url }) => {
  await window.smartgit.gitlab.authWithPAT(token, url);
}, { token: GL_TOKEN, url: GL_URL });
await page.waitForTimeout(1000);
await page.evaluate((h) => { window.location.hash = h; }, '#/pulls');
await page.waitForTimeout(8000);
await page.locator('div.cursor-pointer:has-text("#6")').first().click();
await page.waitForTimeout(4000);
await page.locator('h2:has-text("Release v2.2.0")').waitFor({ timeout: 25000 });

let lastCount = 0;
for (let t = 0; t <= 30; t += 2) {
  const btn = page.locator('button:text-is("Одобрить")').first();
  const disabled = (await btn.count()) > 0 ? await btn.isDisabled() : null;
  const title = (await btn.count()) > 0 ? (await btn.getAttribute('title')) : null;
  const log = await page.evaluate(() => window.smartgit.commandLog.list());
  const gl = log.filter((e) => (e.args || [])[0] === 'api' && (e.args || [])[1] === 'gitlab');
  const fresh = gl.slice(lastCount);
  lastCount = gl.length;
  console.log(`t=${t}s approveDisabled=${disabled} title=${JSON.stringify(title)} glCalls=${gl.length}`);
  for (const e of fresh) {
    console.log(`   + ${(e.args || []).slice(2).join(' ')} [${e.exitCode === 0 ? 'ok' : 'err'} ${e.durationMs}ms]`);
  }
  await page.waitForTimeout(2000);
}
await app.close();
process.exit(0);
