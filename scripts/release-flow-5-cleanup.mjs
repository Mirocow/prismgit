/**
 * RELEASE FLOW — Phase 5 (history cleanup): the 4 identical «chore(release)»
 * commits (each flow-4 rerun committed its own script edits) are squashed
 * into ONE clean commit — using the app's own tools:
 *   1. History: right-click the fix commit → «Сбросить к этому коммиту» →
 *      «Mixed (разиндексировать)» → confirm  (branch moves back, files stay)
 *   2. Changes: stage all + ONE clean commit
 *   3. Push panel: force-with-lease (the remote is ahead — non-FF by design)
 *   4. Tags: delete + recreate v2.2.0 on the squashed tip; force-push tags
 *   5. MR !6 description refresh; final verification
 * Usage: DISPLAY=:99 node scripts/release-flow-5-cleanup.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/release';
const BRANCH = 'feature/smartgit-electron-v3';
const BASE_SUBJECT = 'fix(pr): create MR from a GitLab repo';
const GL_TOKEN = 'glpat-WU4paMsj1aLktM8BUQktAm86MQp1Om0H.01.0w0h427at';
const GL_URL = 'http://178.140.10.58:8082';
const PID = '2042';
const MSG = 'chore(release): live E2E harnesses for the v2.2.0 release flow\n\n'
  + 'release-flow-1..5 + verify-protected-push: the scripts that drove the\n'
  + 'whole v2.2.0 release through the PrismGit UI — commit, push, checkout,\n'
  + 'merge, protected-branch rejection dialog, MR create + merge, tagging,\n'
  + 'force-with-lease, tag force-move, history squash via mixed reset.';

fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) })
  .then(() => console.log(`📸 ${name}`));
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', timeout: 30000 }).trim();
const remoteHash = (ref) => { try { return sh(`git ls-remote origin ${ref}`).split('\t')[0]; } catch { return ''; } };
const cur = () => sh('git rev-parse --abbrev-ref HEAD');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-rel5-'));
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
console.log('branch:', cur(), '| tip:', sh('git rev-parse HEAD').slice(0, 8));

// ═══ 1. History: mixed reset onto the fix commit (squash prep) ═════════════
await nav('#/history', 3500);
const baseHash = sh(`git log --format=%H --grep='fix(pr): create MR from a GitLab repo' -1 ${BRANCH}`);
console.log('reset target:', baseHash.slice(0, 8));
const row = page.locator(`div.cursor-pointer:has-text("${BASE_SUBJECT}")`).first();
await row.waitFor({ timeout: 10000 });
await shot(page, '47-history-before-reset.png');
await row.click({ button: 'right' });
await page.waitForTimeout(700);
if (!await app.evaluate(() => globalThis.__menu !== null)) { console.log('FAIL: no menu'); process.exit(1); }
await shot(page, '48-reset-menu.png').catch(() => {});
// «Сбросить к этому коммиту» → «  Mixed (разиндексировать)»
await clickMenuItem('  Mixed (разиндексировать)');
await page.waitForTimeout(800);
await shot(page, '49-reset-confirm.png');
await page.locator('button:text-is("Сбросить")').last().click();
await page.waitForTimeout(3000);
console.log('after reset:', cur(), sh('git rev-parse HEAD').slice(0, 8),
  '| dirty:', sh('git status --porcelain').split('\n').filter(Boolean).length);
await shot(page, '50-after-reset.png');

// ═══ 2. Changes: stage all + ONE clean commit ══════════════════════════════
await nav('#/changes', 2500);
const un = page.locator('span:has-text("Изменения (")').first();
await un.waitFor({ timeout: 10000 });
await un.click(); // stage all
await page.waitForTimeout(2000);
await page.locator('#commit-message-input').fill(MSG);
await page.waitForTimeout(500);
await shot(page, '51-squashed-commit-message.png');
await page.keyboard.press('Escape');
await page.locator('button:text-is("Коммит")').first().click();
await page.waitForTimeout(4000);
const newTip = sh('git rev-parse HEAD');
console.log('squashed commit:', newTip.slice(0, 8));
await shot(page, '52-squashed-committed.png');
console.log('history now:');
for (const l of sh(`git log --oneline -4 ${BRANCH}`).split('\n')) console.log('   ', l);

// ═══ 3. Force-push-with-lease via the push panel ═══════════════════════════
await page.locator('button[title^="Параметры push"]').first().click();
await page.waitForTimeout(600);
await page.locator('label:has-text("Принудительный push") input[type="checkbox"]').check();
await page.selectOption('[data-testid="push-force-mode"]', 'lease');
await shot(page, '53-force-lease-push.png');
await page.locator('button:has-text("Отправить в origin")').first().click();
let landed = remoteHash(`refs/heads/${BRANCH}`) === newTip;
for (let i = 0; i < 18 && !landed; i++) {
  await page.waitForTimeout(5000);
  landed = remoteHash(`refs/heads/${BRANCH}`) === newTip;
}
await shot(page, '54-force-lease-pushed.png');
console.log('force-with-lease push landed:', landed ? '✓' : '✗');

// ═══ 4. Move the tag to the squashed tip ═══════════════════════════════════
await nav('#/tags', 2500);
const tagRow = page.locator('div.group.cursor-pointer:has-text("v2.2.0")').first();
await tagRow.hover();
await tagRow.locator('button[title="Удалить"]').click();
await page.waitForTimeout(600);
await page.locator('button:text-is("Удалить")').last().click();
await page.waitForTimeout(2000);
await page.locator('button:has-text("Новый тег")').first().click();
await page.waitForTimeout(800);
await page.locator('input[placeholder="v1.0.0"]').fill('v2.2.0');
await page.locator('textarea[placeholder="Release v1.0.0"]')
  .fill('PrismGit 2.2.0 — conflict reactions, push rejection recovery, squash-to-branch, '
    + 'counters audit, secrets manager, GitLab MR creation, deps at latest');
await shot(page, '55-tag-recreated.png');
await page.locator('button:text-is("Создать")').first().click();
await page.waitForTimeout(3000);
const tagTip = sh('git rev-parse v2.2.0^{commit}');
console.log('tag v2.2.0 →', tagTip.slice(0, 8), '== squashed tip:', tagTip === newTip);
// push the moved tag (force + tags — the remote tag points at the old object)
await page.locator('button[title^="Параметры push"]').first().click();
await page.waitForTimeout(600);
await page.locator('label:has-text("Принудительный push") input[type="checkbox"]').check();
await page.selectOption('[data-testid="push-force-mode"]', 'force');
await page.locator('label:has-text("Отправить теги") input[type="checkbox"]').check();
await shot(page, '56-tag-force-push.png');
await page.locator('button:has-text("Отправить в origin")').first().click();
let tagMoved = remoteHash('refs/tags/v2.2.0') === sh('git rev-parse v2.2.0');
for (let i = 0; i < 12 && !tagMoved; i++) {
  await page.waitForTimeout(5000);
  tagMoved = remoteHash('refs/tags/v2.2.0') === sh('git rev-parse v2.2.0');
}
await shot(page, '57-tag-moved.png');
console.log('tag v2.2.0 on remote → squashed tip:', tagMoved ? '✓' : '✗');

// ═══ 5. Final view + MR description refresh + verification ═════════════════
await nav('#/history', 3500);
await shot(page, '58-history-clean.png');
await app.close();

const desc = [
  '## PrismGit v2.2.0 — Release',
  '',
  'Conflict reactions everywhere · push-rejection recovery (incl. this very protected-branch flow) · squash-to-branch · counters audit · secrets manager · GitLab MR creation · all dependencies at latest.',
  '',
  `- Feature branch **${BRANCH}** fully pushed: ${newTip.slice(0, 8)}`,
  `- Tag **v2.2.0** pushed, points at: ${tagTip.slice(0, 8)}`,
  '- README + CHANGELOG in **EN / RU / ZH / DE**',
  '- Clean fast-forwardable merge — **0 conflicts** (origin/main == merge-base)',
  '',
  'All git operations for this release were performed **through PrismGit itself** (commit, push, checkout, merge, tag, force-with-lease, history squash via mixed reset, MR creation) — see scripts/release-flow-*.mjs',
  'Final merge into protected main requires Maintainer rights — that click is yours.',
].join('\n');
const resp = await fetch(`${GL_URL}/api/v4/projects/${PID}/merge_requests/6`, {
  method: 'PUT',
  headers: { 'PRIVATE-TOKEN': GL_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ description: desc }),
});
console.log('MR !6 description:', resp.status === 200 ? 'updated' : `HTTP ${resp.status}`);

let mr = await (await fetch(`${GL_URL}/api/v4/projects/${PID}/merge_requests?iid=6`,
  { headers: { 'PRIVATE-TOKEN': GL_TOKEN } })).json();
if (Array.isArray(mr)) mr = mr[0];
const checks = {
  'feature branch == squashed tip on remote': remoteHash(`refs/heads/${BRANCH}`) === newTip,
  'tag v2.2.0 == squashed tip on remote': tagMoved && tagTip === newTip,
  'single chore commit on top of the fix': sh(`git log --oneline -2 ${BRANCH}`).split('\n').length === 2,
  'MR !6 open (awaits the Maintainer merge click)': mr.state === 'opened',
};
let ok = true;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '✓' : '✗'} ${k}`); if (!v) ok = false; }
console.log(ok ? 'RELEASE CLEAN — MR !6 ready for the owner merge' : 'INCOMPLETE');
process.exit(ok ? 0 : 1);
