/**
 * Probe: does the «Коммит создан» toast actually show the commit hash?
 *
 * User report: «В тоасте Комит создан не отображается хеш комита».
 *
 * Fixture: scratch repo with one staged change; commit through the real
 * Changes-page flow (stage row checkbox → message editor → «Коммит»
 * button); then dump the toast DOM + screenshot before it auto-dismisses.
 *
 * Usage: DISPLAY=:99 node scripts/probe-commit-toast.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/probe-toast';
const REPO = path.join(ROOT, 'repo');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};

const sh = (cmd, cwd = REPO) =>
  execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

// ── Fixture ─────────────────────────────────────────────────────────────────
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(REPO, { recursive: true });
sh('git init -q -b main');
sh('git config user.email e2e@prismgit.test && git config user.name E2E');
fs.writeFileSync(path.join(REPO, 'hello.txt'), 'v1\n');
sh('git add -A && git commit -q -m seed');
fs.writeFileSync(path.join(REPO, 'hello.txt'), 'v2 — toast probe\n');
console.log('fixture ready (one modified file)');

// ── Launch (RU, dark) ───────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-toast-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'dark', tourCompleted: true, autoRefresh: true, locale: 'ru' },
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
await page.waitForTimeout(2500);

// Go to Changes
await page.locator('a[href="#/changes"], [data-testid="nav-changes"]').first().click().catch(() => {});
await page.waitForTimeout(1500);

// Stage the modified file: hover the file row and click its «Индексировать» button
const fileRow = page.locator('div[title*="hello.txt"], [data-file-path*="hello.txt"]').first();
await fileRow.hover({ timeout: 5000 }).catch(() => {});
const stageBtn = page.locator('button[title="Индексировать"]').first();
await stageBtn.click({ timeout: 5000 }).catch(async (e) => {
  console.log('stage-title click fallback:', String(e).slice(0, 100));
  // Fallback: Stage All button in the files toolbar
  await page.locator('button[title="Индексировать все"]').first().click({ timeout: 3000 }).catch(() => {});
});
await page.waitForTimeout(800);

// Type the commit message into the message editor textarea
const msgBox = page.locator('textarea').first();
await msgBox.fill('probe: commit toast');
await page.waitForTimeout(300);

// Click the Commit button (primary «Коммит», NOT «Коммит и Push»)
const commitBtn = page.locator('button.btn-primary:has-text("Коммит")').first();
check('commit button visible', await commitBtn.count() > 0);
// DEBUG: state before clicking commit
console.log('DEBUG commit btn disabled:', await commitBtn.isDisabled().catch(() => '?'));
await commitBtn.click();
await page.waitForTimeout(600);
// "Nothing staged" modal → choose «Проиндексировать и коммитить всё (включая...)»
const stageAllChoice = page.locator('button:has-text("Проиндексировать и коммитить всё")').last();
if (await stageAllChoice.count()) {
  console.log('DEBUG: nothing-staged modal → choosing stage-all');
  await stageAllChoice.click();
}
await page.waitForTimeout(1500);
// DEBUG: dump ALL fixed-position panels (toast look-alikes)
const anyPanels = await page.locator('div.fixed').allInnerTexts().catch(() => []);
console.log('DEBUG fixed divs:', JSON.stringify(anyPanels).slice(0, 400));
const bodyTxt = await page.locator('body').innerText().catch(() => '');
console.log('DEBUG body tail:', bodyTxt.slice(-400).replace(/\n/g, ' | '));
await page.screenshot({ path: path.join(ROOT, 'after-commit.png') });

// Grab every toast node's text + screenshot
const toastTexts = await page.locator('[role="status"] > div, [role="alert"] > div').allInnerTexts().catch(() => []);
console.log('TOASTS:', JSON.stringify(toastTexts, null, 2));
const anyToast = toastTexts.join('\n');
check('a toast appeared', toastTexts.length > 0, anyToast.slice(0, 80));
check('toast mentions Коммит создан', /Коммит создан/.test(anyToast));
// The user's claim: hash NOT displayed. A 7-hex string would match /[0-9a-f]{7}/.
const hashMatch = anyToast.match(/\b[0-9a-f]{7,40}\b/);
check('toast contains a commit hash', !!hashMatch, hashMatch ? hashMatch[0] : 'none found');
await page.screenshot({ path: path.join(ROOT, 'toast.png') });

// Also verify the commit really happened (toast isn't lying)
const nCommits = sh('git rev-list --count HEAD').trim();
console.log('commits =', nCommits);
check('commit actually created', nCommits === '2');
const head = sh('git rev-parse --short HEAD').trim();
console.log('HEAD =', head);
check('toast hash == real HEAD', !!hashMatch && hashMatch[0] === head, `${hashMatch?.[0]} vs ${head}`);

await page.waitForTimeout(3000);
await app.close();

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
