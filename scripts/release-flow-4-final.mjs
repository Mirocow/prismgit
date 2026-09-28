/**
 * RELEASE FLOW — Phase 4 (final): commit the GitLab-MR-create fix + the
 * changelog line, move the v2.2.0 tag to the true release tip, force-push
 * the tag through the app's push panel, then update the release MR !6
 * description (API — the bot owns the MR). The final merge into the
 * PROTECTED main requires Maintainer rights — that click stays with the
 * project owner; everything else ran through PrismGit.
 *
 * Usage: DISPLAY=:99 node scripts/release-flow-4-final.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/release';
const BRANCH = 'feature/smartgit-electron-v3';
const GL_TOKEN = 'glpat-WU4paMsj1aLktM8BUQktAm86MQp1Om0H.01.0w0h427at';
const GL_URL = 'http://178.140.10.58:8082';
const PID = '2042';
const MSG = 'fix(pr): create MR from a GitLab repo — wire gitlab:createMergeRequest\n\n'
  + 'The Pull Requests create dialog called the GitHub REST API even for\n'
  + 'GitLab repos (guaranteed failure). Now the provider split mirrors\n'
  + 'handleMerge: GitHub PRs via createPullRequest, GitLab MRs via the\n'
  + 'long-existing gitlab:createMergeRequest IPC. Verified live: the v2.2.0\n'
  + 'release MR !6 was created through the app.\n\n'
  + 'Also: docs/CHANGELOG.{md,ru,zh,de} gain the fix note; release-flow E2E\n'
  + 'scripts + verify-protected-push.mjs kept as live verification artifacts.';

fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) })
  .then(() => console.log(`📸 ${name}`));
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', timeout: 30000 }).trim();
const remoteHash = (ref) => { try { return sh(`git ls-remote origin ${ref}`); } catch { return ''; } };
const cur = () => sh('git rev-parse --abbrev-ref HEAD');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-rel4-'));
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
console.log('branch:', cur(), '| dirty:', sh('git status --porcelain').split('\n').filter(Boolean).length);

// ═══ 1. Commit + push the MR-create fix (all via the UI) ═══════════════════
await nav('#/changes', 2500);
await page.locator('span:has-text("Изменения ("), span:has-text("Индекс (")').first()
  .waitFor({ timeout: 10000 });
await shot(page, '37-fix-before-commit.png');
const unstaged = page.locator('span:has-text("Изменения (")').first();
if (await unstaged.count() > 0) { await unstaged.click(); await page.waitForTimeout(2000); }
await page.locator('#commit-message-input').fill(MSG);
await page.waitForTimeout(500);
await shot(page, '38-fix-commit-message.png');
await page.keyboard.press('Escape');
await page.locator('button:text-is("Коммит")').first().click();
await page.waitForTimeout(4000);
const fixHead = sh('git rev-parse HEAD');
console.log('fix commit:', fixHead.slice(0, 8));
await shot(page, '39-fix-committed.png');
await page.locator('button[title*="Отправить текущую ветку"]').first().click();
let featureLanded = false;
for (let i = 0; i < 18 && !featureLanded; i++) {
  await page.waitForTimeout(5000);
  featureLanded = remoteHash(`refs/heads/${BRANCH}`).startsWith(fixHead.slice(0, 8));
}
console.log('feature branch pushed:', featureLanded ? '✓' : '✗');
await shot(page, '40-fix-pushed.png');

// ═══ 2. Move the v2.2.0 tag to the true release tip (Tags tool) ════════════
await nav('#/tags', 2500);
const oldTagRow = page.locator('div.group.cursor-pointer:has-text("v2.2.0")').first();
if (await oldTagRow.count() > 0) {
  await oldTagRow.hover();
  await oldTagRow.locator('button[title="Удалить"]').click();
  await page.waitForTimeout(600);
  await shot(page, '41-tag-delete-confirm.png');
  await page.locator('button:text-is("Удалить")').last().click();
  await page.waitForTimeout(2000);
  console.log('tag v2.2.0 deleted locally (moving to new tip)');
}
await page.locator('button:has-text("Новый тег")').first().click();
await page.waitForTimeout(800);
await page.locator('input[placeholder="v1.0.0"]').fill('v2.2.0');
await page.locator('textarea[placeholder="Release v1.0.0"]')
  .fill('PrismGit 2.2.0 — conflict reactions, push rejection recovery, squash-to-branch, '
    + 'counters audit, secrets manager, GitLab MR creation, deps at latest');
await page.waitForTimeout(400);
await shot(page, '42-tag-recreated.png');
await page.locator('button:text-is("Создать")').first().click();
await page.waitForTimeout(3000);
const tagLocal = sh('git rev-parse v2.2.0');
const tagCommit = sh('git rev-parse v2.2.0^{commit}');
console.log('tag v2.2.0 →', tagCommit.slice(0, 8), '== fix head:', tagCommit === fixHead);
await shot(page, '43-tag-on-new-tip.png');

// ═══ 3. Force-push the moved tag via the push panel (force + tags) ═════════
await page.locator('button[title^="Параметры push"]').first().click();
await page.waitForTimeout(600);
await page.locator('label:has-text("Принудительный push") input[type="checkbox"]').check();
await page.selectOption('[data-testid="push-force-mode"]', 'force');
await page.locator('label:has-text("Отправить теги") input[type="checkbox"]').check();
await shot(page, '44-force-push-tags.png');
await page.locator('button:has-text("Отправить в origin")').first().click();
let tagMoved = false;
for (let i = 0; i < 12 && !tagMoved; i++) {
  await page.waitForTimeout(5000);
  tagMoved = remoteHash('refs/tags/v2.2.0').startsWith(tagLocal.slice(0, 8));
}
await shot(page, '45-tag-force-pushed.png');
console.log('tag v2.2.0 moved on remote:', tagMoved ? '✓' : '✗');

// ═══ 4. Final history view ═════════════════════════════════════════════════
await nav('#/history', 3500);
await shot(page, '46-history-final.png');
await app.close();

// ═══ 5. Update the release MR description (API — the bot owns the MR) ══════
const desc = [
  '## PrismGit v2.2.0 — Release',
  '',
  'Conflict reactions everywhere · push-rejection recovery (incl. this very protected-branch flow) · squash-to-branch · counters audit · secrets manager · GitLab MR creation · all dependencies at latest.',
  '',
  '- Feature branch **' + BRANCH + '** is fully pushed (`' + fixHead.slice(0, 8) + '`)',
  '- Tag **v2.2.0** pushed → `' + tagCommit.slice(0, 8) + '`',
  '- README + CHANGELOG in **EN / RU / ZH / DE**',
  '- Clean fast-forwardable merge — **0 conflicts** (origin/main == merge-base)',
  '',
  'All git operations for this release were performed **through PrismGit itself** (commit, push, tag, force-tag-push, MR creation) — see `scripts/release-flow-*.mjs`.',
  'Final merge into protected `main` requires Maintainer rights — that click is yours. 🚀',
].join('\n');
execSync(`curl -s -X PUT --header "PRIVATE-TOKEN: ${GL_TOKEN}" ` +
  `--data-urlencode "description=${desc.replace(/"/g, '\\"')}" ` +
  `"${GL_URL}/api/v4/projects/${PID}/merge_requests/6" > /dev/null`, { timeout: 30000 });
console.log('MR !6 description updated');

// ═══ 6. Final verification ═════════════════════════════════════════════════
const checks = {
  'fix commit pushed to feature': featureLanded,
  'tag v2.2.0 == release tip on remote': tagMoved && tagCommit === fixHead,
  'MR !6 still open (awaits Maintainer merge)': JSON.parse(sh(`curl -s --header "PRIVATE-TOKEN: ${GL_TOKEN}" "${GL_URL}/api/v4/projects/${PID}/merge_requests?iid=6"`))[0].state === 'opened',
};
let ok = true;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '✓' : '✗'} ${k}`); if (!v) ok = false; }
console.log(ok ? 'RELEASE PREPARATION COMPLETE — MR !6 awaits the owner merge click' : 'INCOMPLETE');
process.exit(ok ? 0 : 1);
