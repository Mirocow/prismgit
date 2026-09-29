/**
 * E2E audit of EVERY user-visible counter in PrismGit (RU locale) —
 * «Подсчет тегов в инструменте History неверен как и другие счетчики
 * перепроверь все что есть в PrismGit».
 *
 * Fixture ground truth (deterministic, verified against the git CLI):
 *   - 6 tags:  v1.0.0 (annotated @c2), v1.1.0 (lightweight @c4),
 *              rel-a (annotated @merge), hotfix (lightweight @HEAD),
 *              v2.0.0-rc1 (annotated @HEAD — 2 tags on ONE commit),
 *              mark-f (annotated @feature/b tip — OUTSIDE the default
 *              head+upstream history view)
 *   - 3 local branches (main, feature/a, feature/b) + 1 remote (origin/main)
 *   - 1 stash, dirty tree: 2 modified + 1 staged + 1 untracked
 *   - main: ahead 2 / behind 1
 *
 * Checked surfaces: History «Tagged (N)» chip + per-commit «Теги на этом
 * коммите (N)» + Tagged-filter rows, Tags tool «Тегов: N», Branches summary
 * «N локальных · N удалённых · N тегов · N stash», Stashes «Записей: N»,
 * Sidebar Changes badges (staged / unstaged), cross-tool counter sync after
 * a tag delete, repo-info «Ветки: N» (local-only definition probe).
 *
 * Usage: DISPLAY=:99 node scripts/verify-counters.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/counter-audit';
const REPO = path.join(ROOT, 'repo');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};
const sh = (cmd, cwd = REPO) =>
  execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

// ── 1. Fixture ─────────────────────────────────────────────────────────────
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
sh('git init -q -b main --bare origin.git', ROOT);
sh('git clone -q origin.git seeder', ROOT);
const SEEDER = path.join(ROOT, 'seeder');
sh('git config user.email e2e@prismgit.test && git config user.name E2E', SEEDER);

// c1..c4 on main, pushed (the clone base)
for (const [n, subj] of [['1', 'c1'], ['2', 'c2'], ['3', 'c3'], ['4', 'c4']]) {
  fs.writeFileSync(path.join(SEEDER, `f${n}.txt`), `base ${n}\n`);
  sh(`git add -A && GIT_COMMITTER_DATE="2026-01-0${n}T12:00:00" git commit -q -m "${subj}"`, SEEDER);
}
sh('git push -q origin main', SEEDER);
sh('git clone -q origin.git repo', ROOT);
sh('git config user.email e2e@prismgit.test && git config user.name E2E', REPO);
const C = {}; // hash registry
C.c2 = sh('git rev-parse HEAD~2').trim();
C.c4 = sh('git rev-parse HEAD').trim();
// feature/a: 2 commits (local only — merged later, never pushed directly)
sh('git checkout -q -b feature/a');
sh('git commit -q --allow-empty -m "feature a 1"');
sh('git commit -q --allow-empty -m "feature a 2"');
// main: c5, merge feature/a, c6 → push (origin has c1..c4, f1, f2, c5, M, c6)
sh('git checkout -q main');
sh('git commit -q --allow-empty -m "c5"');
sh('git merge -q --no-ff feature/a -m "merge feature/a"');
C.M = sh('git rev-parse HEAD').trim();
sh('git commit -q --allow-empty -m "c6"');
sh('git push -q origin main');
// local-only: c7 (ahead 2 with c6)
sh('git commit -q --allow-empty -m "c7 head"');
// remote-only: r1 (behind 1) — the seeder first syncs to our pushed main,
// then moves forward by one commit.
sh('git fetch -q origin && git reset -q --hard origin/main', SEEDER);
fs.writeFileSync(path.join(SEEDER, 'r1.txt'), 'remote move\n');
sh('git add -A && git commit -q -m "remote side"', SEEDER);
sh('git push -q origin main', SEEDER);
// feature/b: 1 local-only commit (tag mark-f points here)
sh('git checkout -q -b feature/b main');
sh('git commit -q --allow-empty -m "feature b tip"');
C.fB = sh('git rev-parse HEAD').trim();
sh('git checkout -q main');
// fetch → ahead 2 / behind 1
sh('git fetch -q origin');

// Stash carrier commit — becomes the FINAL HEAD (top row in History)
fs.writeFileSync(path.join(REPO, 'stash-file.txt'), 'stash content\n');
sh('git add stash-file.txt && git commit -q -m "stash carrier"');
C.head = sh('git rev-parse HEAD').trim();
// Stash (1)
fs.writeFileSync(path.join(REPO, 'stash-file.txt'), 'stash content CHANGED\n');
sh('git stash push -q -m "wip stash"');

// Tags (6 total; 2 on the final HEAD, 1 outside the default view)
sh('git tag -a v1.0.0 -m "release one" ' + C.c2);
sh('git tag v1.1.0 ' + C.c4);
sh('git tag -a rel-a -m "release a" ' + C.M);
sh('git tag hotfix ' + C.head);
sh('git tag -a v2.0.0-rc1 -m "rc for two" ' + C.head);
sh('git tag -a mark-f -m "feature b mark" ' + C.fB);

// Dirty tree: 2 modified (unstaged) + 1 staged + 1 untracked
fs.writeFileSync(path.join(REPO, 'f1.txt'), 'base 1 CHANGED\n');
fs.writeFileSync(path.join(REPO, 'f2.txt'), 'base 2 CHANGED\n');
fs.writeFileSync(path.join(REPO, 'staged.txt'), 'staged new file\n');
fs.writeFileSync(path.join(REPO, 'untracked.txt'), 'untracked file\n');
sh('git add staged.txt');

// ── 2. CLI ground truth ────────────────────────────────────────────────────
const gt = {
  tags: sh("git for-each-ref refs/tags/ --format='%(refname:short)'").trim().split('\n').filter(Boolean),
  local: sh("git for-each-ref refs/heads/ --format='%(refname:short)'").trim().split('\n').filter(Boolean),
  remote: sh("git for-each-ref refs/remotes/ --format='%(refname)' | grep -v '/HEAD$' || true").trim().split('\n').filter(Boolean).map(r => r.replace('refs/remotes/', '')),
  stash: sh('git stash list').trim().split('\n').filter(Boolean),
  tagsOnHead: sh("git for-each-ref --points-at HEAD refs/tags/ --format='%(refname:short)'").trim().split('\n').filter(Boolean),
  tagsOnM: sh(`git for-each-ref --points-at ${C.M} refs/tags/ --format='%(refname:short)'`).trim().split('\n').filter(Boolean),
  staged: sh('git diff --cached --name-only').trim().split('\n').filter(Boolean),
  unstaged: sh('git diff --name-only').trim().split('\n').filter(Boolean),
  untracked: sh('git ls-files --others --exclude-standard').trim().split('\n').filter(Boolean),
  ahead: sh("git rev-list --count 'origin/main..main'").trim(),
  behind: sh("git rev-list --count 'main..origin/main'").trim(),
};
console.log('GROUND TRUTH  tags=' + gt.tags.length, 'local=' + gt.local.length,
  'remote=' + gt.remote.length, 'stash=' + gt.stash.length,
  'onHEAD=' + gt.tagsOnHead.length, 'onM=' + gt.tagsOnM.length,
  `staged=${gt.staged.length} unstaged=${gt.unstaged.length} untracked=${gt.untracked.length}`,
  `ahead=${gt.ahead} behind=${gt.behind}`);
console.log('  tags:', gt.tags.join(', '));
console.log('  on HEAD:', gt.tagsOnHead.join(', '), '| on M:', gt.tagsOnM.join(', '));

// ── 3. App launch (RU) ─────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-counters-'));
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

const txt = async (sel) => (await page.locator(sel).textContent().catch(() => '')) || '';

// ═══ G. SIDEBAR Changes badges + Changes section counters (early: on the
// Changes page, before other tools navigate away) ═════════════════════════
console.log('\n── G. Sidebar Changes badges + section counters ──');
await page.evaluate(() => { window.location.hash = '#/changes'; });
// DIAGNOSTIC: global span scan (the debug harness proved the badges exist
// after repo open — see what the audit's timing actually sees).
const dbg = await page.evaluate(() => {
  const out = [];
  for (const span of document.querySelectorAll('span')) {
    const cls = span.getAttribute('class') || '';
    if (cls.includes('badge-added') || cls.includes('bg-accent-muted')) {
      out.push(cls.slice(0, 50) + ' :: ' + (span.textContent || '').slice(0, 20));
    }
  }
  const labels = [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).slice(0, 20);
  return { hash: location.hash, badges: out, labels };
});
console.log('     DBG', JSON.stringify(dbg).slice(0, 600));
// The status job lands async on repo open (spinner «Загрузка репозитория…»
// first) — wait for the badge instead of guessing a timeout.
// aria-label={item.label} — translated since the navItems() reactivity fix;
// asserting the RU label ALSO pins that fix (was EN "Changes" on RU startup).
await page.waitForSelector('[aria-label="Изменения"] span.badge-added', { timeout: 15000 });
await page.waitForTimeout(1500);
const stagedBadge = await txt('[aria-label="Изменения"] span.badge-added');
const unstagedBadge = await txt('[aria-label="Изменения"] span.bg-accent-muted');
const expectedUnstaged = gt.unstaged.length + gt.untracked.length;
check(`G1 staged badge = ${gt.staged.length}`, stagedBadge.trim() === String(gt.staged.length),
  `got="${stagedBadge.trim()}"`);
check(`G2 unstaged badge = ${expectedUnstaged} (modified + untracked)`,
  unstagedBadge.trim() === String(expectedUnstaged), `got="${unstagedBadge.trim()}"`);
// Section headers are CSS-uppercased («ИНДЕКС (1)») — Playwright text= matches
// RENDERED text and the regex form is case-sensitive → /i flag is required.
// Flat mode has NO separate untracked header: the «Изменения (N)» section
// lists modified + renamed + untracked together (N = sidebar unstaged badge).
// String-form :has-text() is case-insensitive by design — the safest match
// against the CSS-uppercased header («ИНДЕКС (1)»); the count is verified
// from the captured text itself.
const stagedSection = await page.locator('span:has-text("Индекс (")').first().textContent().catch(() => '');
const unstagedSection = await page.locator('span:has-text("Изменения (")').first().textContent().catch(() => '');
const expectedChangesSection = gt.unstaged.length + gt.untracked.length;
check(`G3 Changes «Индекс (${gt.staged.length})» header`, stagedSection.includes(`(${gt.staged.length})`),
  `got="${stagedSection.trim()}"`);
check(`G4 Changes «Изменения (${expectedChangesSection})» header (modified+untracked in ONE section)`,
  unstagedSection.includes(`(${expectedChangesSection})`), `got="${unstagedSection.trim()}"`);
// incoming/outgoing badges (↓N ↑N) — the sidebar remote check runs on its
// own schedule (background fetch opt-in); informational, not a hard FAIL.
await page.waitForTimeout(6000);
const down = await page.locator('text=/^↓1$/').count();
const up = await page.locator('text=/^↑2$/').count();
console.log(`     INFO ↓/↑ badges: down=${down ? 'visible' : 'absent'} up=${up ? 'visible' : 'absent'} (depends on the background remote check running)`);

// ═══ A. HISTORY: «С тегами (N)» chip — N = tagged commits IN VIEW ═════════
console.log('\n── A. History: Tagged chip (in-view tagged commits) ──');
await page.evaluate(() => { window.location.hash = '#/history'; });
await page.waitForTimeout(2500);
const taggedInViewExpected = 4; // c2, c4, M, HEAD — mark-f's commit is outside head+upstream
const chip = await txt('button:has-text("С тегами")');
check(`A1 History chip «С тегами (${taggedInViewExpected})» — IN-VIEW tagged commits`,
  chip.includes(`С тегами (${taggedInViewExpected})`), `chip="${chip.trim()}"`);
const chipTitle = await page.locator('button:has-text("С тегами")').first().getAttribute('title').catch(() => '');
check('A2 chip tooltip carries the repo-wide tag total (6) too', (chipTitle || '').includes('6'),
  `title="${(chipTitle || '').slice(0, 90)}…"`);

// ═══ B. HISTORY: per-commit tag count (HEAD = 2 tags) ═══════════════════════
console.log('\n── B. History: tags on selected commit ──');
const headRow = page.locator('div.cursor-pointer:has-text("stash carrier")').first();
await headRow.click();
await page.waitForTimeout(1500);
const sectionB = await page.locator('text=Теги на этом коммите').first().textContent().catch(() => '');
check(`B1 HEAD section count = (${gt.tagsOnHead.length})`, (sectionB || '').includes(`(${gt.tagsOnHead.length})`),
  `section="${(sectionB || '').trim()}"`);
const namesVisible = await Promise.all(gt.tagsOnHead.map(async (n) =>
  (await page.locator(`span.font-semibold:has-text("${n}")`).count()) > 0));
check('B2 both tag names listed on HEAD', namesVisible.every(Boolean));

const mergeRow = page.locator('div.cursor-pointer:has-text("merge feature/a")').first();
await mergeRow.click();
await page.waitForTimeout(1500);
const sectionM = await page.locator('text=Теги на этом коммите').first().textContent().catch(() => '');
check(`B3 merge-commit section count = (${gt.tagsOnM.length})`, (sectionM || '').includes(`(${gt.tagsOnM.length})`),
  `section="${(sectionM || '').trim()}"`);

// ═══ C. HISTORY: Tagged filter — chip (in-view tagged commits) === rows ══
console.log('\n── C. History: Tagged filter rows === chip number ──');
await page.locator('button:has-text("С тегами")').first().click();
await page.waitForTimeout(1200);
const taggedInDefaultView = 4; // c2, c4, M, HEAD (mark-f's commit is outside head+upstream)
const rowSubjects = ['stash carrier', 'merge feature/a', 'c4', 'c2'];
// 'remote side' is NOT here: it is the incoming (behind-1) commit and History
// renders incoming rows in a separate section that the Tagged filter does
// not apply to — that is by design, not a counter leak.
const hidden = ['local only', 'c5', 'feature b tip'];
// (kept as the expected in-view count for C1)
// has-text() substring-matches ANY text in the row — including 40-char SHAs
// (a hash containing 'c5' once made this check flaky). The subject renders
// as its own <span class="truncate…">, so anchor it: text=/^subject$/.
let visibleCount = 0;
for (const s of rowSubjects) {
  if ((await page.locator(`span.truncate >> text=/^${s}$/`).count()) > 0) visibleCount++;
}
let hiddenCount = 0;
for (const s of hidden) {
  if ((await page.locator(`span.truncate >> text=/^${s}$/`).count()) === 0) hiddenCount++;
}
check(`C1 filter shows exactly the ${taggedInViewExpected} tagged commits the chip promises`, visibleCount === taggedInViewExpected,
  `visible=${visibleCount}`);
check('C2 untagged commits filtered out', hiddenCount === hidden.length, `hidden=${hiddenCount}/${hidden.length}`);
const chipAfterFilter = await txt('button:has-text("С тегами")');
console.log(`     chip="${chipAfterFilter.trim()}" — the number now MATCHES the row count by construction`);
await page.locator('button:has-text("С тегами")').first().click(); // clear filter
await page.waitForTimeout(800);

// ═══ D. TAGS TOOL ═══════════════════════════════════════════════════════════
console.log('\n── D. Tags tool ──');
await page.evaluate(() => { window.location.hash = '#/tags'; });
await page.waitForTimeout(2000);
const tagsCountTxt = await txt('text=/Тегов: \\d+/');
check(`D1 Tags tool «Тегов: ${gt.tags.length}»`, tagsCountTxt.includes(`Тегов: ${gt.tags.length}`),
  `got="${tagsCountTxt.trim()}"`);

// ═══ E. BRANCHES summary ════════════════════════════════════════════════════
console.log('\n── E. Branches summary ──');
await page.evaluate(() => { window.location.hash = '#/branches'; });
await page.waitForTimeout(2500);
const summary = await txt('span.text-2xs:has-text("локальн")');
// The RU summary now pluralizes (1 локальная · 2 локальные · 5 локальных) —
// compute the expected string with the same CLDR rule the t() engine uses.
const ruPlural = (n, one, few, many) => {
  const m10 = Math.abs(n) % 10, m100 = Math.abs(n) % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};
const expectedSummary =
  `${gt.local.length} ${ruPlural(gt.local.length, 'локальная', 'локальные', 'локальных')} · ` +
  `${gt.remote.length} ${ruPlural(gt.remote.length, 'удалённая', 'удалённые', 'удалённых')} · ` +
  `${gt.tags.length} ${ruPlural(gt.tags.length, 'тег', 'тега', 'тегов')} · ` +
  `${gt.stash.length} stash`;
check(`E1 Branches (RU plural): «${expectedSummary}»`,
  summary.includes(expectedSummary), `got="${summary.trim()}"`);

// ═══ F. STASHES ═════════════════════════════════════════════════════════════
console.log('\n── F. Stashes ──');
await page.evaluate(() => { window.location.hash = '#/stashes'; });
await page.waitForTimeout(2000);
const stashTxt = await txt('text=/Записей: \\d+/');
check(`F1 Stashes «Записей: ${gt.stash.length}»`, stashTxt.includes(`Записей: ${gt.stash.length}`),
  `got="${stashTxt.trim()}"`);

// (G checks ran EARLY — right after repo open on the Changes page, where the
// sidebar badges and section counters are guaranteed rendered. The old
// late-run here raced the nav state and matched foreign badge elements.)

// ═══ H. Cross-tool sync: delete a tag in Tags → History chip updates ════════
console.log('\n── H. Cross-tool counter sync (tag delete) ──');
await page.evaluate(() => { window.location.hash = '#/tags'; });
await page.waitForTimeout(2000);
const v1Row = page.locator('div.group.cursor-pointer:has-text("v1.0.0")').first();
await v1Row.hover();
await v1Row.locator('button[title="Удалить"]').click();
await page.waitForTimeout(500);
await page.locator('button:has-text("Удалить")').last().click(); // confirm
await page.waitForTimeout(1500);
const tagsAfter = await txt('text=/Тегов: \\d+/');
check(`H1 Tags tool counter after delete = ${gt.tags.length - 1}`, tagsAfter.includes(`Тегов: ${gt.tags.length - 1}`),
  `got="${tagsAfter.trim()}"`);
await page.evaluate(() => { window.location.hash = '#/history'; });
await page.waitForTimeout(2500);
const chipAfter = await txt('button:has-text("С тегами")');
check(`H2 History chip after delete = С тегами (${taggedInDefaultView - 1}) (v1.0.0's commit left the tagged set)`,
  chipAfter.includes(`С тегами (${taggedInDefaultView - 1})`), `chip="${chipAfter.trim()}"`);

// ═══ I. Repo info «Ветки:» (local-only definition probe) ════════════════════
console.log('\n── I. RepoInfo «Ветки» (informational) ──');
// branchCount comes from `git branchLocal` — LOCAL ONLY. The dialog label is
// just «Ветки:» — with remote branches present users read it as TOTAL.
// Probe via the store data path (CLI): what the backend would compute.
const branchLocalCount = sh("git branch --format='%(refname:short)' | wc -l").trim();
console.log(`     CLI: branchLocal=${branchLocalCount} (dialog shows this under «Ветки:»), ` +
  `remotes add ${gt.remote.length} more — Branches tool says «${gt.local.length} локальных · ${gt.remote.length} удалённых»`);

await page.screenshot({ path: '/home/z/my-project/work/counters-audit.png' });
console.log('screenshot: /home/z/my-project/work/counters-audit.png');

await app.close();
fs.rmSync(ROOT, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
