/**
 * E2E verification: squash a group of commits to another branch from the
 * Pull Requests / Reviews tools (the user's request: «также этот функционал
 * должен быть у Pull Request, Reviews»).
 *
 * Runs against the REAL GitLab (project 2042, MR !5 — open, 100 commits)
 * with a THROWAWAY single-branch clone, so nothing user-visible changes on
 * the server (read-only API + fetch) and the squashes land in the fixture.
 *
 * Covers in the RUNNING app (RU locale):
 *   1. REVIEWS (local mode) — git-notes reviewed commits: multi-select
 *      (plain + Shift+click) → «Сквошить в ветку…» → new branch.
 *   2. PULL REQUESTS — MR row action «Перенести коммиты этого PR…»: the
 *      MR's commits (objects NOT in the single-branch clone) are fetched
 *      via refs/merge-requests/5/head, then squashed as ONE commit.
 *   3. REVIEWS (PR review mode) — PRReview Commits tab: group of 5 commits
 *      selected in the chronological list → squashed to a new branch; the
 *      group's squashed tree == the newest selected commit's tree.
 *
 * Usage: DISPLAY=:99 node scripts/verify-squash-to-branch-pr.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const GL_URL = 'http://178.140.10.58:8082';
const GL_TOKEN = 'glpat-WU4paMsj1aLktM8BUQktAm86MQp1Om0H.01.0w0h427at';
const GL_API = `${GL_URL}/api/v4`;
const REMOTE_URL = `http://mirocow:${GL_TOKEN}@178.140.10.58:8082/web/git/gitclient.git`;
const ROOT = '/home/z/my-project/work/pr-e2e';
const REPO = path.join(ROOT, 'repo');

const sh = (cmd, cwd = REPO) => execSync(cmd, { cwd, encoding: 'utf8' }).trim();
/** Like sh() but returns '' when the command exits non-zero (e.g. rev-parse
 *  --verify --quiet on a missing object). */
const shOk = (cmd, cwd = REPO) => {
  try { return execSync(cmd, { cwd, encoding: 'utf8' }).trim(); } catch { return ''; }
};

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};

// ── 1. MR data via the API (raw GitLab order: NEWEST first) ─────────────────
const mrCommits = await fetch(`${GL_API}/projects/2042/merge_requests/5/commits?per_page=100`, {
  headers: { 'PRIVATE-TOKEN': GL_TOKEN },
}).then((r) => r.json());
const chrono = [...mrCommits].reverse(); // OLDEST → NEWEST
const MR_HEAD = mrCommits[0].id;          // newest = MR head
const MR_OLDEST = chrono[0];
const GROUP5_NEWEST = chrono[4];
console.log(`MR !5: ${mrCommits.length} commits (API caps at 100)`);
console.log(`  oldest: ${MR_OLDEST.short_id} ${MR_OLDEST.title.slice(0, 50)}`);
console.log(`  head:   ${MR_HEAD.slice(0, 8)} ${mrCommits[0].title.slice(0, 50)}`);

// ── 2. Throwaway single-branch clone (MR commits NOT in it) ────────────────
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
execSync(`git clone -q --single-branch -b main ${REMOTE_URL} ${REPO}`, { cwd: ROOT, stdio: 'pipe' });
sh('git config user.email e2e@prismgit.test');
sh('git config user.name E2E');

// ── 3. Seed git-notes reviews on main's 3 newest commits ───────────────────
// (skip the merge commit at the tip — squash ranges must not span merges)
const mainTop = sh('git log main --format=%H --skip=1 -3').split('\n'); // newest first
for (const [i, h] of mainTop.entries()) {
  const note = JSON.stringify([{
    id: `e2e-${i}`, commitHash: h, filePath: 'src/x.ts', lineNumber: 1,
    author: 'E2E', date: new Date().toISOString(), body: 'e2e note',
    severity: 'info', resolved: false,
  }]);
  execSync(`git notes --ref refs/notes/reviews add -f -m ${JSON.stringify(note)} ${h}`, { cwd: REPO, stdio: 'pipe' });
}
console.log('fixture ready (single-branch main clone + review notes on 3 commits)');

// ── 4. App launch ───────────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-pr-verify-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true },
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
  timeout: 30000,
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2000);

// Open the fixture repo.
await page.locator('button:has-text("repo")').first().click().catch(async () => {
  await page.locator('[data-testid="repo-item-repo"]').first().click();
});
await page.waitForTimeout(3000);

// Authenticate with GitLab THROUGH the app (token lands in the vault).
await page.evaluate(async ({ token, url }) => {
  await window.smartgit.gitlab.authWithPAT(token, url);
}, { token: GL_TOKEN, url: GL_URL });
await page.waitForTimeout(800);

const commitRow = (text) => page.locator('div.cursor-pointer').filter({ hasText: text }).first();
// Distinctive subject fragments of the 3 noted commits (newest → oldest).
const RV = ['AI Guard for destructive', 'now configurable in Settings', 'second message not sent'];
const openDialogAndSquash = async (branchName, nCommits) => {
  await page.waitForSelector('text=Сквош коммитов в ветку', { timeout: 20000 });
  await page.locator('[placeholder="имя-ветки"]').fill(branchName);
  await page.waitForTimeout(200);
  await page.locator(`button:has-text("Сквошить ${nCommits} коммит")`).last().click();
  await page.waitForTimeout(3000);
};

// ═══ 1. REVIEWS local mode (git-notes) — on main ════════════════════════════
await page.evaluate(() => { window.location.hash = '#/reviews'; });
await page.waitForTimeout(2500);
// Reviewed-commit rows (3, newest first). Plain click + Shift+click.
await page.locator('div.cursor-pointer').filter({ hasText: RV[0] }).first().click();
await page.waitForTimeout(300);
await page.locator('div.cursor-pointer').filter({ hasText: RV[2] }).first().click({ modifiers: ['Shift'] });
await page.waitForTimeout(600);
check('R1: Reviews selection bar shows 3 commits',
  (await page.locator('text=/Выбрано коммитов: 3/').count()) > 0);
await page.locator('button:has-text("Сквошить в ветку")').first().click();
await openDialogAndSquash('e2e/reviews-group', 3);

const rgBase = sh(`git rev-parse ${mainTop[2]}^`);
check('R2: branch created at the group base',
  sh('git merge-base e2e/reviews-group main') === rgBase);
check('R3: squashed tree == newest selected commit tree',
  sh(`git rev-parse e2e/reviews-group^{tree}`) === sh(`git rev-parse ${mainTop[0]}^{tree}`));
const rgCount = parseInt(sh('git rev-list --count e2e/reviews-group'), 10);
const rgExpected = parseInt(sh(`git rev-list --count ${mainTop[2]}^`), 10) + 1;
check('R4: exactly one squashed commit on top of the base', rgCount === rgExpected, `${rgCount} vs ${rgExpected}`);

// ═══ 2. PULL REQUESTS — MR row action (whole MR) ════════════════════════════
await page.evaluate(() => { window.location.hash = '#/pulls'; });
// The provider chain (detect → getProjectByPath(301) → listMergeRequests)
// takes a few round-trips — wait for the row, don't guess a fixed timeout.
try {
  await page.waitForSelector('div.cursor-pointer:has-text("feat(i18n)")', { timeout: 25000 });
} catch {
  console.log('DEBUG P: MR row never appeared — page text dump:');
  console.log((await page.evaluate(() => document.body.innerText)).slice(0, 3500));
  await page.screenshot({ path: `${ROOT}/debug-pulls.png` });
}
const mrRow = page.locator('div.cursor-pointer').filter({ hasText: 'feat(i18n)' }).first();
check('P1: MR !5 row listed (open state)', (await mrRow.count()) > 0);
// Hover-revealed branch icon — the row action (click on the row itself
// would navigate to the review surface).
await mrRow.hover();
await page.locator('button[title*="сквош-коммитом"]').first().click();
// The chain (MR commits via API → 100 rev-parse probes → PR head ref
// fetch) takes several seconds — wait for the dialog, dump on failure.
try {
  await page.waitForSelector('text=Сквош коммитов в ветку', { timeout: 40000 });
} catch {
  console.log('DEBUG P2: dialog never opened — page text dump:');
  console.log((await page.evaluate(() => document.body.innerText)).slice(0, 1500));
  await page.screenshot({ path: `${ROOT}/debug-row-action.png` });
}
check('P2: dialog opened from the MR row action',
  (await page.locator('text=Сквош коммитов в ветку').count()) > 0);
// The single-branch clone did NOT have the MR commits — the PR head ref
// fetch (refs/merge-requests/5/head) must have brought them down.
check('P3: MR head objects fetched into the local clone',
  shOk(`git rev-parse --verify --quiet ${MR_HEAD}^{commit}`) !== '', MR_HEAD.slice(0, 8));
await page.locator('[placeholder="имя-ветки"]').fill('e2e/pr5-all');
await page.waitForTimeout(200);
await page.locator('button:has-text("Сквошить")').last().click();
await page.waitForTimeout(4000);

check('P4: whole-MR squash landed as ONE commit on top of the range base',
  parseInt(sh('git rev-list --count e2e/pr5-all'), 10) ===
    parseInt(sh(`git rev-list --count ${MR_OLDEST.id}^`), 10) + 1);
check('P5: squashed tree == MR head tree',
  sh(`git rev-parse e2e/pr5-all^{tree}`) === sh(`git rev-parse ${MR_HEAD}^{tree}`));
check('P6: original author preserved (oldest MR commit)',
  sh("git log -1 --format='%an <%ae>' e2e/pr5-all") === `${MR_OLDEST.author_name} <${MR_OLDEST.author_email}>`);

// ═══ 3. REVIEWS PR mode — Commits tab group of 5 ════════════════════════════
await page.evaluate(() => { window.location.hash = '#/pulls'; });
await page.waitForTimeout(2000);
await page.locator('div.cursor-pointer').filter({ hasText: 'feat(i18n)' }).first().click();
await page.waitForTimeout(3000);
check('C0: PR review surface opened', (await page.locator('text=/PR review · #5/').count()) > 0);
// Commits tab (RU label «Коммиты»).
await page.locator('button:has-text("Коммиты")').first().click();
await page.waitForTimeout(2500);
// Chronological list: oldest at the top (GitLab's head-first order got
// normalized). Select the FIRST 5 commits: plain click on the oldest…
const firstRow = page.locator('div.cursor-pointer').filter({ hasText: 'ROOT CAUSE of .gitmodules' }).first();
check('C1: commits listed chronologically (oldest first)',
  (await firstRow.count()) > 0 && (await page.locator('div.cursor-pointer').filter({ hasText: 'syncDesktopName' }).count()) > 0);
await firstRow.click();
await page.waitForTimeout(400);
// …then Shift+click the 5th row.
const fifthRow = page.locator('div.cursor-pointer').filter({ hasText: 'statsBits from Sidebar' }).first();
await fifthRow.click({ modifiers: ['Shift'] });
await page.waitForTimeout(700);
check('C2: PR Commits tab selection bar shows 5 commits',
  (await page.locator('text=/Выбрано коммитов: 5/').count()) > 0);
await page.locator('button:has-text("Сквошить в ветку")').last().click();
await openDialogAndSquash('e2e/pr5-group', 5);

check('C3: group squash tree == newest selected commit tree',
  sh(`git rev-parse e2e/pr5-group^{tree}`) === sh(`git rev-parse ${GROUP5_NEWEST.id}^{tree}`));
check('C4: exactly one squashed commit on top of the group base',
  parseInt(sh('git rev-list --count e2e/pr5-group'), 10) ===
    parseInt(sh(`git rev-list --count ${MR_OLDEST.id}^`), 10) + 1);
check('C5: current branch switched to the squash target',
  sh('git symbolic-ref --short HEAD') === 'e2e/pr5-group');

await app.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
