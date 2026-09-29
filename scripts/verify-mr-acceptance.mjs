/**
 * MR ACCEPTANCE via PrismGit (task: «выполни прием mr с помощью prismgit
 * и отчитайся о найденых ошибках»).
 *
 * The acceptance flow, entirely in the RUNNING app (RU locale, dark):
 *   1. GitLab auth (PAT) in-app
 *   2. Pull Requests list → rows !6 (release v2.2.0) & !5 (owner's i18n MR)
 *   3. MR !6 review: header / stats / tabs Обзор·Коммиты·Файлы·Обсуждение
 *   4. APPROVE attempt (bot is the MR AUTHOR — GitLab may refuse self-approval)
 *   5. MERGE attempt (main is protected, merge=Maintainers 40, bot=Developer 30
 *      → expect a server-side 403/405 — observe HOW the app surfaces it)
 *   6. Post-state via API (MR must remain open, no merge commit)
 *   7. MR !5 read-only review
 * Every step is screenshotted; renderer console errors are collected.
 * Usage: DISPLAY=:99 node scripts/verify-mr-acceptance.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/mr-acceptance';
const GL_TOKEN = 'glpat-WU4paMsj1aLktM8BUQktAm86MQp1Om0H.01.0w0h427at';
const GL_URL = 'http://178.140.10.58:8082';

fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) })
  .then(() => console.log(`📸 ${name}`));
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', timeout: 30000 }).trim();
const pid = sh(`curl -s --header "PRIVATE-TOKEN: ${GL_TOKEN}" "${GL_URL}/api/v4/projects?search=prismgit&simple=true" | python3 -c "import json,sys; print([p['id'] for p in json.load(sys.stdin) if p['path_with_namespace']=='web/git/prismgit'][0])"`).trim();
const mrApi = (iid) => JSON.parse(sh(`curl -s --header "PRIVATE-TOKEN: ${GL_TOKEN}" "${GL_URL}/api/v4/projects/${pid}/merge_requests/${iid}"`));
const approvalsApi = (iid) => JSON.parse(sh(`curl -s --header "PRIVATE-TOKEN: ${GL_TOKEN}" "${GL_URL}/api/v4/projects/${pid}/merge_requests/${iid}/approvals"`));

console.log('GitLab project id:', pid);
const before = mrApi(6);
console.log(`MR !6 before: state=${before.state} merge_status=${before.merge_status} detailed=${before.detailed_merge_status}`);
const approvalsBefore = approvalsApi(6);
console.log('MR !6 approvals before:', JSON.stringify(approvalsBefore.approved_by || approvalsBefore));

const findings = [];
const checks = [];
const consoleErrors = [];
const pageErrors = [];

// ── Launch (RU, dark) ────────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-mracc-'));
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
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 400));
});
page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 400)));
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

// ── 1. GitLab auth in-app ────────────────────────────────────────────────────
await page.evaluate(async ({ token, url }) => {
  await window.smartgit.gitlab.authWithPAT(token, url);
}, { token: GL_TOKEN, url: GL_URL });
await page.waitForTimeout(1000);

// ── 2. Pull Requests list ────────────────────────────────────────────────────
await nav('#/pulls', 3000);
await page.waitForTimeout(5000);
const row6 = page.locator('div.cursor-pointer:has-text("#6")').first();
await row6.waitFor({ timeout: 20000 });
const row5 = page.locator('div.cursor-pointer:has-text("#5")').first();
const has5 = (await row5.count()) > 0;
await shot(page, '01-pr-list.png');
const row6Text = await row6.innerText();
checks.push(['PR list shows MR !6 row', row6Text.includes('#6')]);
checks.push(['PR list shows MR !5 row (owner\'s i18n MR)', has5]);
const row6Conflicts = /Конфликт/i.test(row6Text);
checks.push(['MR !6 row has NO «Конфликты» badge (mergeable)', !row6Conflicts]);
if (row6Conflicts) findings.push('MR !6 row shows a conflicts badge although GitLab says mergeable');
console.log('row !6 text:', row6Text.replace(/\n/g, ' | ').slice(0, 300));

// ── 3. MR !6 review in Reviews ──────────────────────────────────────────────
await row6.click();
await page.waitForTimeout(6000); // detail + changes + notes + commits in parallel
const h2 = page.locator('h2:has-text("Release v2.2.0")');
await h2.waitFor({ timeout: 25000 });
await shot(page, '02-pr6-reviews-overview.png');

const mergeBtn = page.locator('button:text-is("Слить")').first();
await mergeBtn.waitFor({ timeout: 15000 });
const mergeDisabled = await mergeBtn.isDisabled();
checks.push(['Reviews «Слить» (Merge) button ENABLED (no conflicts)', !mergeDisabled]);
if (mergeDisabled) findings.push('Merge button disabled although MR !6 is mergeable');

// Header state + stats text for the record.
const headerText = await page.locator('div.flex.items-start.gap-3').first().innerText().catch(() => '');
const statsText = await page.locator('div.ml-auto').first().innerText().catch(() => '');
console.log('PR6 header:', headerText.replace(/\n/g, ' | ').slice(0, 250));
console.log('PR6 stats :', statsText.replace(/\n/g, ' | ').slice(0, 250));

// Tabs: Коммиты / Файлы / Обсуждение
await page.locator('button:text-is("Коммиты")').first().click();
await page.waitForTimeout(4000);
await shot(page, '03-pr6-commits-tab.png');
const commitsTabText = await page.locator('button:text-is("Коммиты")').first().innerText();
console.log('Коммиты tab badge:', commitsTabText.replace(/\n/g, ' ').trim());

await page.locator('button:text-is("Файлы")').first().click();
await page.waitForTimeout(6000);
await shot(page, '04-pr6-files-tab.png');
const filesTabText = await page.locator('button:text-is("Файлы")').first().innerText();
console.log('Файлы tab badge:', filesTabText.replace(/\n/g, ' ').trim());
const diffRows = await page.locator('[data-testid*="file"], div.group, li').count().catch(() => 0);

await page.locator('button:text-is("Обсуждение")').first().click();
await page.waitForTimeout(2500);
await shot(page, '05-pr6-discussion-tab.png');
await page.locator('button:text-is("Обзор")').first().click();
await page.waitForTimeout(2000);

// ── 4. GUARD VERIFICATION (post-fix): while gitlabProjectId is unresolved
//    the action buttons must be DISABLED (pre-fix bug: clickable + a
//    false-success toast with zero API traffic) ─────────────────────────────
const approveBtn = page.locator('button:text-is("Одобрить")').first();
await approveBtn.waitFor({ timeout: 15000 });
const approveLabelRu = await approveBtn.innerText();
console.log('Approve button label (RU locale):', JSON.stringify(approveLabelRu.trim()));
const logAfter = async (label) => {
  const log = await page.evaluate(() => window.smartgit.commandLog.list());
  return { label, log };
};
const earlyDisabled = await approveBtn.isDisabled();
console.log('Approve DISABLED right after review load (informational — the heal watchdog may already have resolved):', earlyDisabled);
if (earlyDisabled) await shot(page, '05b-actions-disabled-while-unresolved.png');

// Wait until the resolution settles → the button becomes enabled.
for (let i = 0; i < 60 && (await approveBtn.isDisabled()); i++) {
  await page.waitForTimeout(500);
}
const nowEnabled = !(await approveBtn.isDisabled());
console.log('Approve button enabled after resolution:', nowEnabled);
checks.push(['Approve button becomes ENABLED once projectId resolves', nowEnabled]);

// ── 4b. APPROVE (real POST — must land on the server) ──────────────────────
await page.evaluate(() => window.smartgit.commandLog.clear());
await approveBtn.click();
let approve2Toast = null;
for (let i = 0; i < 80 && !approve2Toast; i++) {
  await page.waitForTimeout(300);
  approve2Toast = (await page.locator('div.panel.animate-fade-in').allTextContents().catch(() => [])).join('\n') || null;
}
await page.waitForTimeout(1500);
await shot(page, '06b-pr6-approve-result.png');
console.log('APPROVE toast:', JSON.stringify((approve2Toast || '(none)').slice(0, 300)));
const { log: logA2 } = await logAfter('after-approve');
const approve2Posted = logA2.some((e) => (e.args || []).join(' ').includes('/approve'));
console.log('APPROVE actually called the API?', approve2Posted ? 'YES' : 'NO');
const approvalsAfter = approvalsApi(6);
console.log('server approved_by after approve:', JSON.stringify((approvalsAfter.approved_by || []).map((a) => a.user.username)));
checks.push(['APPROVE landed on the server (bot approved MR !6)', (approvalsAfter.approved_by || []).some((a) => a.user.username.includes('bot'))]);
if (!approve2Posted) findings.push('Approve click did not fire the API call even after resolution — regression.');

// ── 5. MERGE attempt (protected main → expect server refusal) ────────────────
await mergeBtn.click();
await page.waitForTimeout(900);
await shot(page, '07-pr6-merge-confirm-dialog.png');
const confirmText = await page.locator('div.fixed.inset-0').last().innerText().catch(() => '');
console.log('Confirm dialog:', confirmText.replace(/\n/g, ' | ').slice(0, 250));
await page.locator('button:text-is("Слить")').last().click();
let mergeToast = null;
for (let i = 0; i < 100 && !mergeToast; i++) {
  await page.waitForTimeout(300);
  mergeToast = (await page.locator('div.panel.animate-fade-in').allTextContents().catch(() => [])).join('\n') || null;
}
await shot(page, '08-pr6-merge-result.png');
console.log('MERGE toast:', JSON.stringify((mergeToast || '(none — took >30s or silent)').slice(0, 600)));
const { log: logM } = await logAfter('after-merge');
const mergePosted = logM.some((e) => (e.args || []).join(' ').includes('/merge'));
console.log('MERGE actually called the API?', mergePosted ? 'YES' : 'NO — silent no-op (bug)');
await page.waitForTimeout(2500);
await shot(page, '09-pr6-post-merge-attempt.png');

// Post-state via API: the MR must still be open (refused by design).
const after = mrApi(6);
checks.push(['MR !6 still OPEN after merge attempt (server refused, by design)', after.state === 'opened']);
checks.push(['No merge commit created', !after.merge_commit_sha]);
if (after.state !== 'opened' || after.merge_commit_sha) {
  findings.push(`UNEXPECTED: MR !6 state=${after.state} merge_commit=${after.merge_commit_sha}`);
}

// ── 6. MR !5 (owner's) read-only review ──────────────────────────────────────
await nav('#/pulls', 3000);
await page.waitForTimeout(5000);
const row5b = page.locator('div.cursor-pointer:has-text("#5")').first();
if ((await row5b.count()) > 0) {
  await row5b.click();
  await page.waitForTimeout(6000);
  await page.locator('h2').first().waitFor({ timeout: 25000 }).catch(() => {});
  await shot(page, '10-pr5-reviews.png');
  const h5 = await page.locator('h2').first().innerText().catch(() => '');
  const mergeBtn5 = page.locator('button:text-is("Слить")').first();
  const merge5Disabled = (await mergeBtn5.count()) > 0 ? await mergeBtn5.isDisabled() : null;
  checks.push(['MR !5 opens in Reviews (read-only review)', h5.includes('i18n') || h5.length > 10]);
  console.log('PR5 header:', h5.slice(0, 120), '| merge disabled:', merge5Disabled);
} else {
  checks.push(['MR !5 opens in Reviews (read-only review)', false]);
}

// ── 7. Summary ───────────────────────────────────────────────────────────────
await app.close();

console.log('\n════════ CHECKS ════════');
let ok = true;
for (const [k, v] of checks) { console.log(`${v ? '✓' : '✗'} ${k}`); if (!v) ok = false; }
console.log('\n════════ CONSOLE ERRORS (renderer) ════════');
console.log(consoleErrors.length ? consoleErrors.slice(0, 20).join('\n') : '(none)');
console.log('pageerror:', pageErrors.length ? pageErrors.slice(0, 10).join('\n') : '(none)');
console.log('\nFindings:', findings.length ? findings.map((f, i) => `\n${i + 1}. ${f}`).join('') : '(none recorded in-app)');
fs.writeFileSync(path.join(SHOTS, 'acceptance-report.json'), JSON.stringify({
  pid, checks, consoleErrors, pageErrors, findings,
  approve2Toast, mergeToast, earlyDisabled,
  commitsTabText, filesTabText, statsText,
  approvalsBefore, approvalsAfter,
  mrBefore: { state: before.state, merge_status: before.merge_status },
  mrAfter: { state: after.state, merge_status: after.merge_status, merge_commit_sha: after.merge_commit_sha },
}, null, 2));
console.log('\nRESULT:', ok ? 'ACCEPTANCE RUN COMPLETE' : 'ACCEPTANCE RUN HAS FAILED CHECKS');
process.exit(0);
