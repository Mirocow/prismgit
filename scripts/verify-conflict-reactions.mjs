/**
 * E2E verification of the conflict-reaction audit (v3.6) —
 * «проверь всю работу с конфликтами… Надо предоставить пользователю
 * возможность реагировать, а не как сейчас просто промолчать и отчитаться
 * в лог».
 *
 * Reproduces REAL conflicts in the RUNNING app (RU locale) and asserts the
 * REACTION for every previously-silent or raw-error flow:
 *   S1. Pull (merge strategy) — Toolbar pull → conflicted merge lands the
 *       user on the Changes tool: banner «Слияние» + conflicts section.
 *   S2. Cherry-pick from another branch (Journal) → banner «Применяется».
 *   S3. MergePanel REBASE strategy onto a diverged branch → banner
 *       «Rebase в процессе» (was: raw «Merge failed» stderr toast).
 *   S4. Stash pop conflict → resolver + the "stash was KEPT" message
 *       (was: false «popped» success / raw error — the simple-git stdout
 *       conflict bug).
 *
 * (git-flow finish conflicts and squash-to-branch conflicts are pinned by
 * tests/integration/conflictScenarios.test.ts + conflictReactions.test.tsx
 * + the existing squashToBranch suite; those dialog flows duplicate the
 * same surfaceConflictedState reaction verified here.)
 *
 * Usage: DISPLAY=:99 node scripts/verify-conflict-reactions.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/conflict-e2e';
const REPO = path.join(ROOT, 'repo');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};

const sh = (cmd, cwd = REPO) =>
  execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
/** Tolerant reset — a scenario may have aborted already. */
const shOk = (cmd, cwd = REPO) => {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch { return ''; }
};

// ── 1. Fixture: bare remote + diverged clone + feature branch + stash ─────
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
sh('git init -q -b main --bare origin.git', ROOT);
sh('git clone -q origin.git seeder', ROOT);
const SEEDER = path.join(ROOT, 'seeder');
sh('git config user.email e2e@prismgit.test && git config user.name E2E', SEEDER);
fs.writeFileSync(path.join(SEEDER, 'shared.txt'), 'line1\nline2\nline3\n');
sh('git add -A && git commit -q -m seed', SEEDER);
sh('git push -q origin main', SEEDER);
// The clone the app opens.
sh('git clone -q origin.git repo', ROOT);
sh('git config user.email e2e@prismgit.test && git config user.name E2E', REPO);
// SEED = the clone's initial commit — every conflicting side branches from
// HERE, not from each other (branching from the tip made every later apply
// CLEAN — the first run's «Cherry-pick выполнен» false positive).
const SEED = sh('git rev-parse HEAD').trim();
// Stash FIRST (base = seed): popping it later onto the LOCAL-side tree
// conflicts.
fs.writeFileSync(path.join(REPO, 'shared.txt'), 'line1\nSTASHED\nline3\n');
sh('git stash push -q -m "conflicting wip"');
// LOCAL side: commit on main (not pushed).
fs.writeFileSync(path.join(REPO, 'shared.txt'), 'line1\nLOCAL\nline3\n');
sh('git add -A && git commit -q -m "local side"', REPO);
// REMOTE side: moves AFTER the clone — genuine divergence.
fs.writeFileSync(path.join(SEEDER, 'shared.txt'), 'line1\nREMOTE\nline3\n');
sh('git add -A && git commit -q -m "remote side"', SEEDER);
sh('git push -q origin main', SEEDER);
// feature/x from the SEED (its commit conflicts with BOTH local and remote
// sides — for the cherry-pick and the rebase scenarios).
sh(`git checkout -q -b feature/x ${SEED}`);
fs.writeFileSync(path.join(REPO, 'shared.txt'), 'line1\nFEATURE\nline3\n');
sh('git add -A && git commit -q -m "feature C"', REPO);
sh('git checkout -q main', REPO);
console.log('fixture ready (diverged main, feature/x off seed, stashed wip, bare origin)');

// ── 2. App launch (RU locale) ──────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-conflicts-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true, locale: 'ru' },
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
await page.waitForTimeout(3000);

/** Wait for the conflict-reaction: navigation + banner + conflicts section. */
const expectReaction = async (bannerText, label) => {
  const hashOk = await page
    .waitForFunction(() => window.location.hash === '#/changes', null, { timeout: 12000 })
    .then(() => true).catch(() => false);
  check(`${label}: navigated to the Changes tool (#/changes)`, hashOk,
    `hash=${await page.evaluate(() => window.location.hash)}`);
  const bannerOk = await page
    .waitForSelector(`text=${bannerText}`, { timeout: 6000 })
    .then(() => true).catch(() => false);
  check(`${label}: in-progress state banner visible («${bannerText}»)`, bannerOk);
  const conflictsOk = await page
    .waitForSelector('text=/Конфликтов \\(1\\)/', { timeout: 6000 })
    .then(() => true).catch(() => false);
  check(`${label}: conflicted file listed in the Conflicts section`, conflictsOk);
  // Best-effort toast title check (toasts auto-dismiss after a few seconds).
  const toastOk = await page
    .waitForSelector('text=/привёл к конфликтам|конфликтами/', { timeout: 4000 })
    .then(() => true).catch(() => false);
  check(`${label}: warning toast fired (operation-specific wording)`, toastOk);
};

// ═══ S1. PULL (merge strategy) — Toolbar one-click ══════════════════════════
console.log('\n── S1. Pull conflict (merge strategy) ──');
await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(1500);
await page.locator('button').filter({ hasText: /^Pull$/ }).first().click().catch(() => {});
// The one-click pull needs selectedBranch; if it didn't fire, open the
// dropdown and use its primary button (origin/main).
await page.waitForTimeout(1500);
if (await page.evaluate(() => window.location.hash) !== '#/changes' ||
    !(await page.locator('text=Слияние').count())) {
  await page.locator('button[title*="параметры"], button:has-text("Pull")').nth(1).click().catch(() => {});
  await page.waitForTimeout(800);
  await page.locator('button.btn-primary:has-text("Pull")').first().click().catch(() => {});
}
await expectReaction('Слияние', 'S1 pull');
// Reset to a clean pre-S2 state.
shOk('git merge --abort');
await page.waitForTimeout(1500);

// ═══ S2. CHERRY-PICK from another branch (Journal) ══════════════════════════
console.log('\n── S2. Cherry-pick conflict (Journal) ──');
await page.evaluate(() => { window.location.hash = '#/journal'; });
await page.waitForTimeout(2000);
// Row-scoped: the reflog entry "commit: feature C" (feature/x's commit
// — cherry-picking it onto conflicted main). div.group is the ROW element
// (hover-actions parent); ancestors don't carry the group class.
const rowC = page.locator('div.group').filter({ hasText: 'commit: feature C' }).first();
await rowC.hover().catch(() => {});
await rowC.locator('button[title="Cherry-pick этого коммита"]').click();
await page.waitForTimeout(400);
await page.locator('button:has-text("Cherry-pick")').last().click(); // confirm dialog
await expectReaction('Применяется', 'S2 cherry-pick');
shOk('git cherry-pick --abort');
await page.waitForTimeout(1500);

// ═══ S3. MergePanel REBASE strategy onto a diverged branch ═════════════════
console.log('\n── S3. Rebase conflict (MergePanel, rebase strategy) ──');
sh('git checkout -q feature/x');
await page.waitForTimeout(1200);
await page.evaluate(() => { window.location.hash = '#/branches'; });
await page.waitForTimeout(2500);
// Row-scoped: the LOCAL branch row for "main" — ^main anchors on the row's
// leading name span, so the "origin/main" remote row doesn't match.
const mainRow = page.locator('div.group').filter({ hasText: /^main/ }).first();
await mainRow.hover().catch(() => {});
await mainRow.locator('button[title="Слить в текущую"]').click();
await page.waitForTimeout(1200); // MergePanel loads state/preview
await page.locator('label:has-text("Rebase") input[type="radio"]').check();
await page.locator('button.btn-primary:has-text("Rebase")').first().click();
await expectReaction('Rebase в процессе', 'S3 rebase');
shOk('git rebase --abort');
sh('git checkout -q main');
await page.waitForTimeout(1500);

// ═══ S4. STASH POP conflict — the false-success bug ════════════════════════
console.log('\n── S4. Stash pop conflict ──');
// The conflicting stash was created in the fixture (base = seed); the
// working tree carries the LOCAL-side content on the same lines.
await page.evaluate(() => { window.location.hash = '#/stashes'; });
await page.waitForTimeout(2500);
await page.locator('button[title="Извлечь (apply + drop)"]').first().click();
await page.waitForTimeout(400);
await page.locator('button:has-text("Pop")').last().click(); // confirm dialog
await expectReaction('Конфликт', 'S4 stash pop');
// THE bug assertion: git KEEPS the stash on a conflicted pop — the entry
// must still exist (the old code showed «Извлечён» and cleared the
// selection). Checked via the CLI because the reaction navigates AWAY from
// the Stashes page (the list itself is not rendered anymore).
const stashKept = sh('git stash list').includes('conflicting wip');
check('S4 stash pop: the stash entry is KEPT (git keeps it on conflict)', stashKept);
await page.screenshot({ path: '/home/z/my-project/work/conflict-stash-pop.png' });
console.log('screenshot: /home/z/my-project/work/conflict-stash-pop.png');
shOk('git reset -q --hard');
shOk('git stash drop');

await app.close();
fs.rmSync(ROOT, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
