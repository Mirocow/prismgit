/**
 * E2E verification: squash a group of commits to another branch (History tool).
 *
 * Covers the user's request end-to-end in the RUNNING app:
 *   A) FAST PATH — multi-select (Shift+click) in History → dialog → new
 *      branch → one squashed commit, preserved author, auto-switch.
 *   B) CONFLICTS — same selection → existing branch → dry-run preview step
 *      (repo untouched) → proceed → conflicts land in the worktree on the
 *      target branch (CHERRY_PICK_HEAD + markers) — the standard resolve
 *      flow then takes over.
 *
 * Usage: DISPLAY=:99 node scripts/verify-squash-to-branch.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/sqx-e2e';
const REPO = path.join(ROOT, 'repo');
const sh = (cmd, cwd = REPO) => execSync(cmd, { cwd, encoding: 'utf8' }).trim();

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};

// ── fixture ─────────────────────────────────────────────────────────────────
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(REPO, { recursive: true });
sh('git init -q -b master .');
sh('git config user.name "SQ Author"');
sh('git config user.email sq@author.dev');
fs.writeFileSync(path.join(REPO, 'a.txt'), 'seed\n');
sh('git add -A && git commit -qm seed');
sh('git branch base');        // clean target (stays at seed)
sh('git branch conflicted');  // will get a conflicting x.txt
sh('git checkout -q -b dev');
fs.writeFileSync(path.join(REPO, 'x.txt'), 'x0\n');
sh('git add -A && git commit -qm "SQX r1"');
fs.writeFileSync(path.join(REPO, 'x.txt'), 'x1\n');
sh('git add -A && git commit -qm "SQX r2"');
fs.writeFileSync(path.join(REPO, 'x.txt'), 'x1\nx2\n');
sh('git add -A && git commit -qm "SQX r3"');
sh('git checkout -q conflicted');
fs.writeFileSync(path.join(REPO, 'x.txt'), 'conflicting base content\n');
sh('git add -A && git commit -qm "base conflict"');
sh('git checkout -q dev');
console.log('fixture ready:', REPO);

// ── app launch ──────────────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-sqx-verify-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true },
  repositories: [{ path: REPO, name: 'sqx-e2e', lastOpened: Date.now(), pinned: false }],
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1440, height: 900 }, isMaximized: false, isFullScreen: false },
}, null, 2));

const app = await electron.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    path.join(process.cwd(), 'dist-electron/main.js')],
  env: { ...process.env, NODE_ENV: 'production', DISPLAY: process.env.DISPLAY || ':99',
    PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'ru' },
  timeout: 30000,
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2000);

// open the repo + go to History
await page.locator('button:has-text("sqx-e2e")').first().click().catch(async () => {
  await page.locator('[data-testid="repo-item-sqx-e2e"]').first().click();
});
await page.waitForTimeout(3000);
await page.evaluate(() => { window.location.hash = '#/history'; });
await page.waitForTimeout(3500);
// debug aid when rows are missing
if ((await page.locator('div.cursor-pointer:has-text("SQX r3")').count()) === 0) {
  console.log('DEBUG: history rows not found — hash =', await page.evaluate(() => window.location.hash));
  await page.screenshot({ path: '/home/z/my-project/work/sqx-e2e/debug-history.png' });
}

const row = (subject) => page.locator(`div.cursor-pointer:has-text("${subject}")`).first();

// ═══ A) FAST PATH: multi-select → new branch ════════════════════════════════
await row('SQX r3').click();
await page.waitForTimeout(300);
await row('SQX r1').click({ modifiers: ['Shift'] });
await page.waitForTimeout(500);

const barText = await page.locator('text=/Выбрано коммитов: 3/').count();
check('A1: selection bar shows 3 commits', barText > 0);

// multi-selected rows get the accent tint + left marker (class check —
// computed boxShadow normalizes '2px 0' to '2px 0px')
const tinted = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('div.cursor-pointer')];
  return rows.filter((r) => (r.textContent || '').includes('SQX r2'))
    .filter((r) => String(r.className).includes('bg-accent/15')).length;
});
check('A2: middle row carries the range-selection marker', tinted > 0);

// open the dialog from the bar
await page.locator('button:has-text("Сквошить в ветку")').first().click();
await page.waitForTimeout(400);
check('A3: dialog opened', (await page.locator('text=Сквош коммитов в ветку').count()) > 0);

// fill the new branch name (radio "Новая ветка" is default)
await page.locator('[placeholder="имя-ветки"]').fill('release/sqx');
await page.waitForTimeout(200);
const prefilled = await page.locator('textarea').inputValue();
check('A4: message prefilled with the oldest subject + bullet list',
  prefilled.startsWith('SQX r1') && prefilled.includes('SQX r3'));

await page.locator('button:has-text("Сквошить")').last().click();
await page.waitForTimeout(2500);

// verify repo state directly
const cnt = sh('git rev-list --count release/sqx');
check('A5: new branch has exactly 2 commits (base + squash)', cnt === '2', cnt);
const subject = sh('git log -1 --format=%s release/sqx');
check('A6: squashed commit message = oldest subject', subject === 'SQX r1', subject);
const author = sh("git log -1 --format='%an <%ae>' release/sqx");
check('A7: original author preserved', author === 'SQ Author <sq@author.dev>', author);
const head = sh('git symbolic-ref --short HEAD');
check('A8: switched to the new branch', head === 'release/sqx', head);
const tree = sh('git rev-parse release/sqx^{tree}');
const devTree = sh('git rev-parse dev^{tree}');
check('A9: squashed tree == newest commit tree', tree === devTree);
check('A10: dialog closed after success', (await page.locator('text=Сквош коммитов в ветку').count()) === 0);

// ═══ B) CONFLICTS: existing branch → preview → proceed ═════════════════════
// The fast path left us on release/sqx — go back to dev so the original
// range commits are visible in the History list again.
sh('git checkout -q dev');
// A pure HEAD move between identical trees produces no workdir change, so
// the file watcher may not fire — drop a harmless untracked file to nudge
// it, then wait for the graph to show dev's commits again.
fs.writeFileSync(path.join(REPO, '.e2e-nudge'), String(Date.now()));
try {
  await page.waitForSelector('div.cursor-pointer:has-text("SQX r3")', { timeout: 20000 });
} catch {
  console.log('DEBUG B: rows never showed dev history — screenshot saved');
  await page.screenshot({ path: '/home/z/my-project/work/sqx-e2e/debug-b.png' });
}
fs.rmSync(path.join(REPO, '.e2e-nudge'), { force: true });
await row('SQX r3').click();
await page.waitForTimeout(300);
await row('SQX r1').click({ modifiers: ['Shift'] });
await page.waitForTimeout(500);
check('B1: selection bar re-appears', (await page.locator('text=/Выбрано коммитов: 3/').count()) > 0);

// right-click INSIDE the group → the menu is built in the MAIN process
// (context-menu:show → Menu.buildFromTemplate). Capture the template by
// stubbing buildFromTemplate in main; the stub returns a menu whose popup
// is a no-op so no native menu appears in headless Xvfb.
await app.evaluate(({ Menu }) => {
  globalThis.__capturedMenu = null;
  globalThis.__origBuild = Menu.buildFromTemplate.bind(Menu);
  Menu.buildFromTemplate = (template) => {
    globalThis.__capturedMenu = template;
    return { popup: () => {} };
  };
});
await row('SQX r2').click({ button: 'right' });
await page.waitForTimeout(700);
const menuSummary = await app.evaluate(() =>
  (globalThis.__capturedMenu || []).map((i) => ({ label: i.label, type: i.type })));
await app.evaluate(({ Menu }) => { Menu.buildFromTemplate = globalThis.__origBuild; });
check('B2: context menu offers the group squash (first item)',
  Array.isArray(menuSummary) && /Сквошить 3 коммитов/.test(String(menuSummary[0]?.label)),
  JSON.stringify(menuSummary?.slice(0, 3)));
// open the dialog via the action bar (the menu's clickId runs the same callback)
await page.locator('button:has-text("Сквошить в ветку")').first().click();
await page.waitForTimeout(500);

// target an EXISTING branch
await page.locator('text=Существующая ветка').first().click();
await page.waitForTimeout(300);
await page.locator('select').last().selectOption('conflicted');
await page.waitForTimeout(200);

// message is still prefilled — submit
await page.locator('button:has-text("Сквошить")').last().click();
await page.waitForTimeout(2000);

// dry-run found conflicts → the dialog must show the warning step, repo untouched
check('C1: conflict preview step shown', (await page.locator('text=/Конфликтов файлов: 1/').count()) > 0);
check('C2: conflicted file listed', (await page.locator('li:has-text("x.txt")').count()) > 0);
const conflictedTip = sh('git rev-parse conflicted');
const conflictedLog = sh('git log --format=%H conflicted');
check('C3: preview touched NOTHING (branch unchanged)',
  conflictedLog.includes(conflictedTip) && conflictedLog.split('\n').length === 2);
check('C4: still on the current branch (dev)', sh('git symbolic-ref --short HEAD') === 'dev');

// proceed → live route
await page.locator('button:has-text("Переключиться и разрешить")').click();
await page.waitForTimeout(2500);

check('D1: checked out the target branch', sh('git symbolic-ref --short HEAD') === 'conflicted');
check('D2: cherry-pick state present', fs.existsSync(path.join(REPO, '.git', 'CHERRY_PICK_HEAD')));
const xtxt = fs.readFileSync(path.join(REPO, 'x.txt'), 'utf8');
check('D3: conflict markers in the working tree', xtxt.includes('<<<<<<<'), xtxt.slice(0, 40).replace(/\n/g, '\\n'));
const mergeMsg = fs.readFileSync(path.join(REPO, '.git', 'MERGE_MSG'), 'utf8');
check('D4: prepared squash message survived into MERGE_MSG', mergeMsg.startsWith('SQX r1'), mergeMsg.slice(0, 30).replace(/\n/g, '\\n'));

// finish like a user would: resolve + the app's Continue flow
fs.writeFileSync(path.join(REPO, 'x.txt'), 'resolved by hand\n');
sh('git add x.txt');
await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(1500);
// The cherry-pick state banner offers Continue — click it.
const continueBtn = page.locator('button:has-text("Продолжить")').first();
if ((await continueBtn.count()) > 0) {
  await continueBtn.click();
  await page.waitForTimeout(2000);
} else {
  console.log('NOTE: Continue button not found by RU label — finishing via CLI');
  sh('git cherry-pick --continue --no-edit');
}
const finalSubject = sh('git log -1 --format=%s conflicted');
const finalAuthor = sh('git log -1 --format=%an conflicted');
check('E1: squash landed as ONE commit with the prepared message', finalSubject === 'SQX r1', finalSubject);
check('E2: preserved author survived the conflict resolution', finalAuthor === 'SQ Author', finalAuthor);
check('E3: no leftover cherry-pick state', !fs.existsSync(path.join(REPO, '.git', 'CHERRY_PICK_HEAD')));
check('E4: dev branch untouched', sh('git rev-list --count dev') === '4');

await app.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
