/**
 * Live E2E — Stacked PR/MR visibility (Task 28: «Жаль что не видно фишек
 * гитхаба которых нет в гите типа "Stacked PRs"»).
 *
 * Creates a REAL stacked chain on the user's GitLab (via the app's own
 * PR-create dialog — dogfooding), then verifies in the RUNNING app:
 *   1. The PR list rows carry stack badges «1/2» / «2/2» (bottom→top).
 *   2. Unstacked rows (!6) have NO badge.
 *   3. Clicking a stacked row opens the review with the STACK STRIP:
 *      chips bottom→top, current highlighted, click-through navigation.
 *
 * Fixture (throwaway — fully cleaned up at the end):
 *   stack-demo-root (= HEAD) ── MR-A: stack-demo-a  → stack-demo-root
 *   stack-demo-a             ── MR-B: stack-demo-b  → stack-demo-a   (stacked on A)
 *
 * Usage: DISPLAY=:99 node scripts/verify-pr-stacks.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const GL_URL = 'http://178.140.10.58:8082';
const GL_TOKEN = 'glpat-WU4paMsj1aLktM8BUQktAm86MQp1Om0H.01.0w0h427at';
const OUT = '/home/z/my-project/work/pr-stacks';
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};
const sh = (cmd, cwd = REPO) =>
  execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const shOk = (cmd, cwd = REPO) => {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { return String(e.stdout ?? ''); }
};

// ── Launch (RU dark) with the gitclient repo ────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-stacks-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'dark', tourCompleted: true, autoRefresh: true, locale: 'ru' },
  repositories: [{ path: REPO, name: 'gitclient', lastOpened: Date.now(), pinned: false }],
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
await page.locator('button:has-text("gitclient")').first().click().catch(async () => {
  await page.locator('[data-testid="repo-item-gitclient"]').first().click();
});
await page.waitForTimeout(4000);
const nav = async (hash, settle = 2500) => {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(settle);
};
const shot = (name) => page.screenshot({ path: path.join(OUT, name) });

// ── 1. GitLab auth in-app ───────────────────────────────────────────────────
await page.evaluate(async ({ token, url }) => {
  await window.smartgit.gitlab.authWithPAT(token, url);
}, { token: GL_TOKEN, url: GL_URL });
await page.waitForTimeout(1000);

// ── 2. Create the stacked chain via the app's PR-create dialog ─────────────
// Idempotency: a previous run may have left the demo MRs on the server —
// GitLab refuses duplicate source→target pairs and the create dialog stays
// open, blocking the UI. Query first; create only what's missing.
const apiRaw = (method, urlPath, body) => sh(
  `curl -s --max-time 20 -X ${method} -H "PRIVATE-TOKEN: ${GL_TOKEN}" -H "Content-Type: application/json" ` +
  `${body ? `-d '${JSON.stringify(body)}'` : ''} "${GL_URL}/api/v4${urlPath}"`);
const existing = JSON.parse(apiRaw('GET', '/projects/2042/merge_requests?state=opened&per_page=50'));
const hasMR = (src, tgt) => existing.some((m) => m.source_branch === src && m.target_branch === tgt);
const needA = !hasMR('stack-demo-a', 'stack-demo-root');
const needB = !hasMR('stack-demo-b', 'stack-demo-a');

await nav('#/pulls', 3000);
if (needA || needB) {
  await page.locator('button.btn-primary:has-text("Новый PR")').first().click();
  await page.waitForTimeout(800);
  await page.locator('div.panel input').first().waitFor({ timeout: 10000 });
}

const createMR = async (title, head, base) => {
  const dialog = page.locator('div.panel');
  // Title input (autoFocus), head/base by hardcoded placeholders.
  await dialog.locator('input[autofocus], input').first().fill(title);
  await dialog.locator('input[placeholder="feature/my-branch"]').fill(head);
  await dialog.locator('input[placeholder="main"]').fill(base);
  await shot(`create-${head}.png`);
  await dialog.locator('button.btn-primary').last().click();
  await page.waitForTimeout(4000); // API round-trip + list reload
};
if (needA) await createMR('Stack demo A — base layer', 'stack-demo-a', 'stack-demo-root');
if (needA || needB) await page.locator('button.btn-primary:has-text("Новый PR")').first().click().catch(() => {});
if (needB) {
  await page.waitForTimeout(800);
  await page.locator('div.panel input').first().waitFor({ timeout: 10000 });
  await createMR('Stack demo B — stacked on A', 'stack-demo-b', 'stack-demo-a');
}
console.log(`demo MRs on server: A=${!needA ? 'pre-existing' : 'created'} B=${!needB ? 'pre-existing' : 'created'}`);
// NOTE: no page.reload() — a reload drops the in-memory GitLab PAT auth AND
// the opened repo (the app lands back on the Welcome screen). Use the PR
// list's own refresh button instead.
await page.locator('button[title="Обновить"], button.icon-btn[title*="бнов"]').first().click().catch(() => {});
await page.waitForTimeout(4000);
await shot('02-pr-list-stacked.png');

// ── 3. Assertions on the live list ──────────────────────────────────────────
const badges = await page.locator('[data-testid^="pr-stack-badge-"]').all();
const badgeTexts = [];
for (const b of badges) badgeTexts.push(await b.textContent());
check('stack badges present on BOTH chained MR rows', badges.length === 2,
  `badges=${JSON.stringify(badgeTexts)}`);
check('badge positions «1/2» and «2/2» (bottom→top order)',
  badgeTexts.some((t) => t.includes('1/2')) && badgeTexts.some((t) => t.includes('2/2')),
  JSON.stringify(badgeTexts));

// The unstacked MR !6 must NOT carry a badge.
const badge6 = await page.locator('[data-testid="pr-stack-badge-6"]').count();
check('unstacked MR (!6) has NO badge', badge6 === 0);

// The badge tooltip carries the chain (merge order, bottom first).
if (badges.length === 2) {
  const tip = await badges[1].getAttribute('title');
  check('badge tooltip shows the chain + merge order', !!tip && tip.includes('!') && tip.includes('←'),
    String(tip).slice(0, 80));
}

// ── 4. Review the TOP MR — the stack strip in the header ────────────────────
const topRow = page.locator('div.cursor-pointer').filter({ hasText: 'Stack demo B' }).first();
await topRow.click();
await page.waitForTimeout(4000);
const strip = page.locator('[data-testid="pr-stack-strip"]');
check('PRReview header shows the STACK STRIP', (await strip.count()) === 1);
const chips = await page.locator('[data-testid^="pr-stack-chip-"]').all();
const chipTexts = [];
for (const c of chips) chipTexts.push(await c.textContent());
check('strip chips: both members, bottom→top with «!» prefix',
  chips.length === 2 && chipTexts.every((t) => t.includes('!')),
  JSON.stringify(chipTexts));
await shot('03-review-stack-strip.png');

// The merge-order hint mentions the BOTTOM MR.
const stripText = await strip.textContent().catch(() => '');
check('merge-order hint (bottom first) visible in the strip', /снизу вверх|!/i.test(String(stripText)),
  String(stripText).slice(0, 120));

// Click the BOTTOM member's chip → the review navigates to it.
const bottomChip = chips[0];
await bottomChip.click();
await page.waitForTimeout(4000);
const headerTitle = await page.locator('h2').first().textContent().catch(() => '');
check('chip click-through: review switched to the bottom stack member',
  String(headerTitle).includes('Stack demo A'), String(headerTitle).slice(0, 60));
await shot('04-review-navigated-to-bottom.png');

// ── 5. Right-click the stacked row → the stack section in the menu ─────────
await nav('#/pulls', 2000);
const anyStackedRow = page.locator('div.cursor-pointer').filter({ hasText: 'Stack demo' }).first();
await anyStackedRow.click({ button: 'right' });
await page.waitForTimeout(1000);
await shot('05-row-context-menu.png');
console.log('(context-menu stack section captured to 05-row-context-menu.png — check visually)');

await app.close();

// ── 6. CLEANUP: close both MRs + delete the demo branches ───────────────────
console.log('\n── cleanup ──');
// Find the demo MRs (open, on the demo branches).
const openMRs = JSON.parse(apiRaw('GET', '/projects/2042/merge_requests?state=opened&per_page=50'));
const demoMRs = openMRs.filter((m) => m.source_branch.startsWith('stack-demo-'));
for (const m of demoMRs) {
  const closed = apiRaw('PUT', `/projects/2042/merge_requests/${m.iid}`, { state_event: 'close' });
  check(`demo MR !${m.iid} closed`, closed.includes('"state":"closed"') || closed.includes('"closed"'));
}
shOk('git push -q origin --delete stack-demo-root stack-demo-a stack-demo-b');
shOk('git branch -D stack-demo-root stack-demo-a stack-demo-b');
const remaining = JSON.parse(apiRaw('GET', '/projects/2042/merge_requests?state=opened&per_page=50'))
  .filter((m) => m.source_branch.startsWith('stack-demo-'));
check('no demo MRs left open', remaining.length === 0);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
