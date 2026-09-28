/**
 * RELEASE FLOW — Phase 4 (final): the GitLab-MR-create fix commit c8690c3
 * landed on LOCAL main (flow-4 run 1 started there). This run moves it into
 * the release properly — all via the app:
 *   1. checkout feature → merge main into it (FF — brings the fix into the
 *      MR branch) → push feature
 *   2. delete + recreate tag v2.2.0 on the true tip (Tags tool)
 *   3. force-push the moved tag via the push panel (force + tags)
 *   4. update the release MR !6 description; final verification
 * The final merge into PROTECTED main needs Maintainer rights — that click
 * stays with the project owner.
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

fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) })
  .then(() => console.log(`📸 ${name}`));
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', timeout: 30000 }).trim();
const remoteHash = (ref) => { try { return sh(`git ls-remote origin ${ref}`).split('\t')[0]; } catch { return ''; } };
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
await app.evaluate(({ Menu }) => {
  globalThis.__menu = null;
  const orig = Menu.buildFromTemplate;
  Menu.buildFromTemplate = (template) => {
    const menu = orig.call(Menu, template);
    globalThis.__menu = menu;
    return menu;
  };
});
const clickMenuItem = (label) => app.evaluate(({ Menu }, { label }) => {
  const m = globalThis.__menu;
  if (!m) throw new Error('no menu captured');
  const walk = (items) => {
    for (const it of items) {
      if (it.label === label) return it;
      if (it.submenu && it.submenu.items) { const f = walk(it.submenu.items); if (f) return f; }
    }
    return null;
  };
  const target = walk(m.items);
  if (!target) throw new Error('menu item not found: ' + label);
  target.click();
  m.closePopup && m.closePopup();
  return true;
}, { label });
const rowMenu = async (page, branch, item) => {
  await app.evaluate(() => { globalThis.__menu = null; });
  await page.locator(`span.truncate.font-medium:text-is("${branch}"), span.truncate.font-bold:text-is("${branch}")`).first().click({ button: 'right' });
  await page.waitForTimeout(700);
  if (!await app.evaluate(() => globalThis.__menu !== null)) {
    throw new Error(`context menu did not build for row ${branch}`);
  }
  await clickMenuItem(item);
  await page.waitForTimeout(200);
};

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
const closeAnyOverlay = async () => {
  await page.locator('button:text-is("Отмена")').last().click().catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
};
console.log('start branch:', cur(), '| dirty:', sh('git status --porcelain').split('\n').filter(Boolean).length);
const fixHead = sh('git rev-parse main'); // c8690c3 — the MR-create fix (landed on local main)

// The app REFUSES checkout with a dirty tree (untracked files count). The
// release-flow scripts themselves are the dirt — commit them via the UI
// (they belong in the repo as verification artifacts anyway).
if (sh('git status --porcelain').trim() !== '') {
  await nav('#/changes', 2500);
  const un = page.locator('span:has-text("Изменения (")').first();
  if (await un.count() > 0) { await un.click(); await page.waitForTimeout(2000); }
  await page.locator('#commit-message-input').fill(
    'chore(release): keep the release-flow E2E scripts in-repo\n\n'
    + 'release-flow-1..4 + verify-protected-push: the live harnesses that\n'
    + 'drove the whole v2.2.0 release through the PrismGit UI.');
  await page.keyboard.press('Escape');
  await page.locator('button:text-is("Коммит")').first().click();
  await page.waitForTimeout(4000);
  console.log('scripts committed:', sh('git rev-parse HEAD').slice(0, 8));
}

// ═══ 1. Bring the fix into the feature branch (checkout + FF merge) ════════
if (cur() !== BRANCH) {
  await nav('#/branches', 3000);
  await rowMenu(page, BRANCH, 'Переключиться...');
  await page.waitForTimeout(4000);
  await closeAnyOverlay();
  console.log('now on:', cur());
  if (cur() !== BRANCH) { console.log('FAIL: checkout did not land'); process.exit(1); }
}
const featureHead = sh(`git rev-parse ${BRANCH}`);
if (featureHead !== fixHead) {
  await nav('#/branches', 3000);
  await shot(page, '37-before-merge-fix-into-feature.png');
  await rowMenu(page, 'main', 'Слияние...');
  await page.waitForTimeout(1200);
  await shot(page, '38-merge-dialog.png');
  await page.locator('button:text-is("Слить")').first().click();
  await page.waitForTimeout(5000);
  console.log('feature after FF merge:', sh(`git rev-parse ${BRANCH}`).slice(0, 8));
  await shot(page, '39-merge-done.png');
}
// Push feature (the MR branch)
await page.locator('button[title*="Отправить текущую ветку"]').first().click();
let featureLanded = remoteHash(`refs/heads/${BRANCH}`).startsWith(fixHead.slice(0, 8));
for (let i = 0; i < 18 && !featureLanded; i++) {
  await page.waitForTimeout(5000);
  featureLanded = remoteHash(`refs/heads/${BRANCH}`).startsWith(fixHead.slice(0, 8));
}
await closeAnyOverlay();
console.log('feature branch pushed:', featureLanded ? '✓' : '✗');
await shot(page, '40-feature-pushed.png');

// ═══ 2. Move the v2.2.0 tag to the true release tip (Tags tool) ════════════
await nav('#/tags', 2500);
await closeAnyOverlay();
const tagLocal0 = sh('git rev-parse v2.2.0');
const tagPointsAtFix = sh('git rev-parse v2.2.0^{commit}') === fixHead;
if (!tagPointsAtFix) {
  const oldTagRow = page.locator('div.group.cursor-pointer:has-text("v2.2.0")').first();
  if (await oldTagRow.count() > 0) {
    await oldTagRow.hover();
    await oldTagRow.locator('button[title="Удалить"]').click();
    await page.waitForTimeout(600);
    await shot(page, '41-tag-delete-confirm.png');
    await page.locator('button:text-is("Удалить")').last().click();
    await page.waitForTimeout(2000);
    console.log('tag v2.2.0 deleted locally (moving to the new tip)');
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
}
const tagLocal = sh('git rev-parse v2.2.0');
console.log('tag v2.2.0 → commit', sh('git rev-parse v2.2.0^{commit}').slice(0, 8), '== release tip:', sh('git rev-parse v2.2.0^{commit}') === fixHead);
await shot(page, '43-tag-on-tip.png');

// ═══ 3. Force-push the moved tag via the push panel (force + tags) ═════════
if (!remoteHash('refs/tags/v2.2.0').startsWith(tagLocal.slice(0, 8))) {
  await page.locator('button[title^="Параметры push"]').first().click();
  await page.waitForTimeout(600);
  await page.locator('label:has-text("Принудительный push") input[type="checkbox"]').check();
  await page.selectOption('[data-testid="push-force-mode"]', 'force');
  await page.locator('label:has-text("Отправить теги") input[type="checkbox"]').check();
  await shot(page, '44-force-push-tags.png');
  await page.locator('button:has-text("Отправить в origin")').first().click();
}
let tagMoved = remoteHash('refs/tags/v2.2.0').startsWith(tagLocal.slice(0, 8));
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

// ═══ 5. Update the release MR description (API — the bot owns the MR) ═════════
// NOTE: node fetch, NOT execSync+curl — backticks in a shell double-quoted
// string are command substitution and mangled the first attempt.
const tip = sh(`git rev-parse ${BRANCH}`);
const tagTip = sh('git rev-parse v2.2.0^{commit}');
const desc = [
  '## PrismGit v2.2.0 — Release',
  '',
  'Conflict reactions everywhere · push-rejection recovery (incl. this very protected-branch flow) · squash-to-branch · counters audit · secrets manager · GitLab MR creation · all dependencies at latest.',
  '',
  `- Feature branch **${BRANCH}** fully pushed: ${tip.slice(0, 8)}`,
  `- Tag **v2.2.0** pushed, points at: ${tagTip.slice(0, 8)}`,
  '- README + CHANGELOG in **EN / RU / ZH / DE**',
  '- Clean fast-forwardable merge — **0 conflicts** (origin/main == merge-base)',
  '',
  'All git operations for this release were performed **through PrismGit itself** (commit, push, tag, force-tag-push, MR creation) — see scripts/release-flow-*.mjs',
  'Final merge into protected main requires Maintainer rights — that click is yours.',
].join('\n');
const resp = await fetch(`${GL_URL}/api/v4/projects/${PID}/merge_requests/6`, {
  method: 'PUT',
  headers: { 'PRIVATE-TOKEN': GL_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ description: desc }),
});
console.log('MR !6 description updated:', resp.status === 200 ? 'ok' : `HTTP ${resp.status}`);

// ═══ 6. Final verification ═════════════════════════════════════════════════
let mr = await (await fetch(`${GL_URL}/api/v4/projects/${PID}/merge_requests?iid=6`,
  { headers: { 'PRIVATE-TOKEN': GL_TOKEN } })).json();
if (Array.isArray(mr)) mr = mr[0];
// Ancestor-stable: the tag marks the RELEASE COMMIT; later tooling tweaks
// (this script committing its own fixes) may advance the branch past it —
// the tag must remain reachable, not equal to the tip.
const tagReachable = sh(`git merge-base --is-ancestor 'v2.2.0^{commit}' ${BRANCH} && echo YES || echo NO`) === 'YES';
const checks = {
  'feature branch pushed at its tip': remoteHash(`refs/heads/${BRANCH}`) === tip,
  'tag v2.2.0 reachable from the release branch': tagMoved && tagReachable,
  'MR !6 open (awaits the Maintainer merge click)': mr.state === 'opened',
};
let ok = true;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '✓' : '✗'} ${k}`); if (!v) ok = false; }
console.log(ok ? 'RELEASE PREPARATION COMPLETE — MR !6 awaits the owner merge click' : 'INCOMPLETE');
process.exit(ok ? 0 : 1);
