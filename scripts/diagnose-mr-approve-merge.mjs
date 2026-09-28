/**
 * DIAGNOSTIC for the MR acceptance anomalies (task: приём MR через PrismGit):
 *   A. Approve showed a SUCCESS toast but no approval landed on GitLab.
 *   B. Merge PUT failed with "GitLab API 401" (expected 403 Maintainers).
 * Dumps the app's own command log (every API call: method/path/status) around
 * each action so we can see EXACTLY what the app called and what came back.
 * Usage: DISPLAY=:99 node scripts/diagnose-mr-approve-merge.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const GL_TOKEN = 'glpat-WU4paMsj1aLktM8BUQktAm86MQp1Om0H.01.0w0h427at';
const GL_URL = 'http://178.140.10.58:8082';

const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', timeout: 30000 }).trim();
const pid = sh(`curl -s --header "PRIVATE-TOKEN: ${GL_TOKEN}" "${GL_URL}/api/v4/projects?search=prismgit&simple=true" | python3 -c "import json,sys; print([p['id'] for p in json.load(sys.stdin) if p['path_with_namespace']=='web/git/prismgit'][0])"`).trim();

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-diag-'));
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
const nav = async (hash, settle = 2500) => {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(settle);
};

const dumpLog = async (label) => {
  const log = await page.evaluate(() => window.smartgit.commandLog.list());
  console.log(`\n──── ${label} (${log.length} entries) ────`);
  for (const e of log.slice(-40)) {
    console.log(`  ${JSON.stringify(e).slice(0, 260)}`);
  }
  return log;
};

// auth + open MR !6 review
await page.evaluate(async ({ token, url }) => {
  await window.smartgit.gitlab.authWithPAT(token, url);
}, { token: GL_TOKEN, url: GL_URL });
await page.waitForTimeout(1000);
await nav('#/pulls', 3000);
await page.waitForTimeout(5000);
const row6 = page.locator('div.cursor-pointer:has-text("#6")').first();
await row6.waitFor({ timeout: 20000 });
await row6.click();
await page.waitForTimeout(7000);
await page.locator('h2:has-text("Release v2.2.0")').waitFor({ timeout: 25000 });
const before = await dumpLog('BEFORE approve (Reviews load)');

// APPROVE
await page.locator('button:text-is("Approve")').first().click();
await page.waitForTimeout(9000); // toast + any pending resolution
await dumpLog('AFTER approve click');
const approvalsA = JSON.parse(sh(`curl -s --header "PRIVATE-TOKEN: ${GL_TOKEN}" "${GL_URL}/api/v4/projects/${pid}/merge_requests/6/approvals"`));
console.log('server approvals after in-app approve:', JSON.stringify(approvalsA.approved_by || []));

// MERGE
const mergeBtn = page.locator('button:text-is("Слить")').first();
await mergeBtn.click();
await page.waitForTimeout(900);
await page.locator('button:text-is("Слить")').last().click();
await page.waitForTimeout(12000);
await dumpLog('AFTER merge click');
const mrAfter = JSON.parse(sh(`curl -s --header "PRIVATE-TOKEN: ${GL_TOKEN}" "${GL_URL}/api/v4/projects/${pid}/merge_requests/6"`));
console.log('MR !6 state after merge attempt:', mrAfter.state, '| merge_commit:', mrAfter.merge_commit_sha || '(none)');

await app.close();
process.exit(0);
