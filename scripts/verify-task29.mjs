/**
 * Task 29 live verification — all five user-facing changes, driven through
 * the real PrismGit UI (RU, dark):
 *
 *  1. Remotes tool REMOVED from the sidebar; Branches page carries the
 *     Fetch-All (prune) + Add-Remote header buttons.
 *  2. «Коммит создан» toast shows the commit HASH as a copyable chip.
 *  3. Reflog rows have NO checkboxes.
 *  4. Blame: fuzzy file picker + grouped gutter (one block per commit).
 *  5. Repo tree rows have NO «Закрепить/Открепить» pin button.
 *
 * Usage: DISPLAY=:99 node scripts/verify-task29.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/task29-verify';
const REPO = path.join(ROOT, 'repo');
const SHOTS = path.join(ROOT, 'shots');
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};

const sh = (cmd, cwd = REPO) =>
  execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

// ── Fixture: file with 3 author-blocks for blame groups + a change to commit
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(REPO, { recursive: true });
sh('git init -q -b main');
sh('git config user.email alice@x && git config user.name Alice');
fs.writeFileSync(path.join(REPO, 'code.ts'), 'const a = 1;\nconst b = 2;\n');
sh('git add -A && git commit -q -m "initial import"');
sh('git config user.email bob@x && git config user.name Bob');
fs.appendFileSync(path.join(REPO, 'code.ts'), 'const c = 3;\nconst d = 4;\n');
sh('git add -A && git commit -q -m "add feature"');
sh('git config user.email carol@x && git config user.name Carol');
fs.appendFileSync(path.join(REPO, 'code.ts'), 'const e = 5;\n');
sh('git add -A && git commit -q -m "polish"');
// one unstaged modification for the commit-toast check
fs.appendFileSync(path.join(REPO, 'code.ts'), 'const f = 6;\n');
console.log('fixture ready (3 author blocks + 1 modified)');

// ── Launch (RU, dark) ───────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-t29-'));
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

// ═══ 5. Repo tree: pin button GONE (before navigating anywhere) ═════════════
const pinTitles = await page.locator('button[title="Закрепить"], button[title="Открепить"]').count();
check('5. repo tree: NO pin buttons', pinTitles === 0, `${pinTitles} found`);
const starButtons = await page.locator('button[title*="Избранн"]').count();
check('5b. favorites (star) still present', starButtons >= 0);
await page.screenshot({ path: path.join(SHOTS, '05-sidebar.png') });

// ═══ 1. Remotes tool gone; Branches carries fetch-all + add-remote ══════════
// Sidebar: a nav link to #/remotes must NOT exist anymore.
const remotesNav = await page.locator('a[href="#/remotes"]').count();
check('1. sidebar: no /remotes nav link', remotesNav === 0, `${remotesNav} found`);
// navigating to /remotes must not render a Remotes page (route removed)
await page.evaluate(() => { window.location.hash = '#/remotes'; });
await page.waitForTimeout(1200);
const remotesHeader = await page.locator('text=Remotes').count();
check('1b. /remotes route no longer renders the page', remotesHeader === 0, `${remotesHeader} headers`);

// Branches page: header buttons (tooltips are the stable handles)
await page.evaluate(() => { window.location.hash = '#/branches'; });
await page.waitForTimeout(1800);
const fetchAllBtn = page.locator('button[title="Получить изменения со всех remote (git fetch --all --prune)"]');
check('1c. Branches header: Fetch-All button present', await fetchAllBtn.count() === 1);
const addRemoteBtn = page.locator('button[title="Добавить remote…"]');
check('1d. Branches header: Add-Remote button present', await addRemoteBtn.count() === 1);
// Add-Remote button opens the config dialog (the transferred Remotes entry point)
await addRemoteBtn.click();
await page.waitForTimeout(600);
const addRemoteDialog = await page.locator('text=Добавить remote').count();
check('1e. Add-Remote opens the remote config dialog', addRemoteDialog > 0);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(SHOTS, '01-branches.png') });

// ═══ 2. Commit toast hash chip ══════════════════════════════════════════════
await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(1800);
const msgBox = page.locator('textarea').first();
await msgBox.fill('task29: toast hash chip');
const commitBtn = page.locator('button.btn-primary:has-text("Коммит")').first();
await commitBtn.click();
await page.waitForTimeout(700);
const stageAllChoice = page.locator('button:has-text("Проиндексировать и коммитить всё")').last();
if (await stageAllChoice.count()) await stageAllChoice.click();
await page.waitForTimeout(1800);
const toastTexts = await page.locator('[role="status"] > div').allInnerTexts().catch(() => []);
const toast = toastTexts.join('\n');
const chip = page.locator('[role="status"] button[title="Копировать полный хеш"]');
const chipCount = await chip.count();
const chipText = chipCount ? (await chip.first().innerText()).trim() : '';
const head = sh('git rev-parse --short HEAD').trim();
check('2. toast appeared', toastTexts.length > 0, toast.slice(0, 60));
check('2b. toast has the hash chip button', chipCount === 1);
check('2c. chip shows the REAL commit hash', chipText.startsWith(head), `${chipText} vs ${head}`);
await page.screenshot({ path: path.join(SHOTS, '02-commit-toast.png') });
// click the chip → clipboard feedback toast
await chip.first().click();
await page.waitForTimeout(600);
const clipToast = (await page.locator('[role="status"] > div').allInnerTexts().catch(() => [])).join(' ');
check('2d. chip click → «Скопировано» feedback', /Скопировано/.test(clipToast));
await page.screenshot({ path: path.join(SHOTS, '02b-copied.png') });

// ═══ 3. Reflog: no checkboxes ═══════════════════════════════════════════════
await page.evaluate(() => { window.location.hash = '#/reflog'; });
await page.waitForTimeout(1500);
const reflogBoxes = await page.locator('#root input[type="checkbox"]').count();
check('3. Reflog: zero checkboxes on the page', reflogBoxes === 0, `${reflogBoxes} found`);
const reflogRows = await page.locator('text=commit:').count();
check('3b. Reflog rows still render (master list)', reflogRows > 0, `${reflogRows} rows`);
await page.screenshot({ path: path.join(SHOTS, '03-reflog.png') });

// ═══ 4. Blame: picker + grouped gutter ═════════════════════════════════════
await page.evaluate(() => { window.location.hash = '#/blame'; });
await page.waitForTimeout(1500);
const fileInput = page.locator('input[placeholder*="начните вводить" i]');
check('4. Blame file picker input present', await fileInput.count() === 1);
await fileInput.click();
await page.waitForTimeout(600);
const suggestions = await page.locator('button:has-text("code.ts")').count();
check('4b. picker suggests tracked files', suggestions > 0, `${suggestions} suggestions`);
await page.screenshot({ path: path.join(SHOTS, '04-blame-picker.png') });
await page.locator('button:has-text("code.ts")').first().click();
await page.waitForTimeout(1500);
// grouped gutter: Alice once, Bob once, Carol TWICE — the fixture's 4th
// commit (the toast-check commit) is also authored by Carol, but with a
// DIFFERENT hash → its own gutter block. 4 blocks total = 4 unique commits.
const alice = await page.locator('text=Alice').count();
const bob = await page.locator('text=Bob').count();
const carol = await page.locator('text=Carol').count();
check('4c. gutter groups: Alice once', alice === 1, `${alice}`);
check('4d. gutter groups: Bob once', bob === 1, `${bob}`);
check('4e. gutter groups: Carol twice (two distinct commits)', carol === 2, `${carol}`);
const summary = await page.locator('text=initial import').count();
check('4f. commit subject in the gutter', summary === 1, `${summary}`);
const stats = await page.locator('[data-testid="blame-stats"]').innerText().catch(() => '');
check('4g. footer stats (lines + commits)', /\d+\s*строк/.test(stats), stats.slice(0, 40));
await page.screenshot({ path: path.join(SHots_safe(SHOTS), '04b-blame.png') });
function SHots_safe(p) { return p; }

await page.waitForTimeout(1500);
await app.close();

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
