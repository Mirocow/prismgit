/**
 * RELEASE FLOW — Phase 3 (rewrite): main is PROTECTED on the GitLab server,
 * so the release goes the GitLab way — entirely through the app:
 *   1. (from main) Push → REAL protected-branch rejection → PushRejectionDialog
 *   2. Tag v2.2.0 pushed from the feature branch («Отправить теги»)
 *   3. MR feature→main CREATED in-app (Pull Requests → Новый PR)
 *   4. MR MERGED in-app (row ⇪ → «Слить») — GitLab lands the merge commit
 *   5. main checked out + pulled in-app → local main == merge commit
 * Idempotent: skips steps whose effect already exists. Usage: DISPLAY=:99 …
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

fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) })
  .then(() => console.log(`📸 ${name}`));
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', timeout: 30000 }).trim();
const remoteHash = (ref) => { try { return sh(`git ls-remote origin ${ref}`); } catch { return ''; } };
const cur = () => sh('git rev-parse --abbrev-ref HEAD');

// The GitLab project was RENAMED (gitclient → prismgit, commit 3d5cc37);
// the git remote still uses the old path (server redirects it).
const pid = sh(`curl -s --header "PRIVATE-TOKEN: ${GL_TOKEN}" "${GL_URL}/api/v4/projects?search=prismgit&simple=true" | python3 -c "import json,sys; print([p['id'] for p in json.load(sys.stdin) if p['path_with_namespace']=='web/git/prismgit'][0])"`).trim();

// ── Launch (RU) ─────────────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-rel3-'));
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

// Menu spy — __menu RESET before every right-click so a stale application
// menu (also built via Menu.buildFromTemplate!) can never be clicked by
// accident. Only the freshly built ROW menu is a legal click target.
await app.evaluate(({ Menu }) => {
  globalThis.__menu = null;
  const orig = Menu.buildFromTemplate;
  Menu.buildFromTemplate = (template) => {
    const menu = orig.call(Menu, template);
    globalThis.__menu = menu;
    return menu;
  };
});
const resetMenu = () => app.evaluate(() => { globalThis.__menu = null; });
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
// Right-click a branch row and click one of ITS context-menu items.
const rowMenu = async (page, branch, item) => {
  await resetMenu();
  await page.locator(`span.truncate:text-is("${branch}")`).first().click({ button: 'right' });
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
console.log('start branch:', cur());

// ═══ 1. REAL protected-branch rejection → PushRejectionDialog ═══════════════
if (cur() !== 'main') {
  await nav('#/branches', 3000);
  await rowMenu(page, 'main', 'Переключиться...');
  await page.waitForTimeout(4000);
  console.log('checked out:', cur());
}
if (cur() === 'main') {
  // Push a protected branch → expect the PushRejectionDialog (verified live
  // by the probe: «Push отклонён — ветка защищена» + Create-MR button).
  // Robust: poll up to 60 s; one retry click (pushes are idempotent — a
  // second rejected push is harmless). Non-fatal: the MR path below is the
  // actual release; the demo is evidence.
  const dlg = page.locator('div.fixed.inset-0:has-text("Push отклонён")');
  await page.locator('button[title*="Отправить текущую ветку"]').first().click();
  let seen = false;
  for (let i = 0; i < 12 && !seen; i++) {
    await page.waitForTimeout(5000);
    seen = (await dlg.count()) > 0;
    if (i === 2 && !seen) { // 15 s — retry once
      await page.locator('button[title*="Отправить текущую ветку"]').first().click().catch(() => {});
    }
  }
  if (seen) {
    await page.waitForTimeout(1200);
    await shot(page, '24-push-rejected-protected.png');
    const btns = await page.locator('button:has-text("Merge Request")').count();
    console.log('PushRejectionDialog open with Create-MR button:', btns > 0 ? 'YES' : 'NO');
    await page.locator('button:text-is("Отмена")').last().click();
    await page.waitForTimeout(800);
  } else {
    console.log('PushRejectionDialog not observed this run (see probe-protected-push evidence)');
  }
}

// ═══ 2. On feature → push the v2.2.0 tag («Отправить теги») ═════════════════
if (cur() !== BRANCH) {
  await nav('#/branches', 3000);
  await rowMenu(page, BRANCH, 'Переключиться...');
  await page.waitForTimeout(4000);
}
console.log('now on:', cur());
const tagLocal = sh('git rev-parse v2.2.0');
const tagAlready = remoteHash('refs/tags/v2.2.0').startsWith(tagLocal.slice(0, 8));
if (!tagAlready) {
  await page.locator('button[title^="Параметры push"]').first().click();
  await page.waitForTimeout(600);
  await page.locator('label:has-text("Отправить теги") input[type="checkbox"]').check();
  await shot(page, '26-push-tags.png');
  await page.locator('button:has-text("Отправить в origin")').first().click();
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(5000);
    if (remoteHash('refs/tags/v2.2.0').startsWith(tagLocal.slice(0, 8))) break;
  }
  await shot(page, '27-tag-pushed.png');
}
const tagLanded = remoteHash('refs/tags/v2.2.0').startsWith(tagLocal.slice(0, 8));
console.log('TAG v2.2.0 on remote:', tagLanded ? '✓' : '✗');

// ═══ 3. GitLab auth + create MR feature→main IN-APP ═════════════════════════
await page.evaluate(async ({ token, url }) => {
  await window.smartgit.gitlab.authWithPAT(token, url);
}, { token: GL_TOKEN, url: GL_URL });
await page.waitForTimeout(1000);
await nav('#/pulls', 3000);
await page.waitForTimeout(5000);
const mrTitle = 'Release v2.2.0 — conflict reactions, push rejection recovery, squash-to-branch, counters audit, secrets manager';
let mr = JSON.parse(sh(`curl -s --header "PRIVATE-TOKEN: ${GL_TOKEN}" "${GL_URL}/api/v4/projects/${pid}/merge_requests?state=opened&source_branch=${BRANCH}"`))[0];
if (mr) {
  console.log('open MR already exists:', `!${mr.iid} → ${mr.target_branch}`);
  await shot(page, '31-mr-created.png');
} else {
  await shot(page, '28-pr-list.png');
  await page.locator('button:has-text("Новый PR")').first().click();
  await page.waitForTimeout(800);
  await shot(page, '29-mr-create-dialog.png');
  await page.locator('.panel input[placeholder="Заголовок PR"]').first().fill(mrTitle);
  const inputs = page.locator('input.mono');
  await inputs.nth(0).fill(BRANCH);   // source
  await inputs.nth(1).fill('main');   // target
  await page.locator('.panel textarea').first().fill('Release v2.2.0 — see docs/CHANGELOG.md (RU/ZH/DE translations included)');
  await page.waitForTimeout(400);
  await shot(page, '30-mr-create-filled.png');
  await page.locator('button:text-is("Создать PR")').first().click();
  await page.waitForTimeout(6000);
  await shot(page, '31-mr-created.png');
  mr = JSON.parse(sh(`curl -s --header "PRIVATE-TOKEN: ${GL_TOKEN}" "${GL_URL}/api/v4/projects/${pid}/merge_requests?state=opened&source_branch=${BRANCH}"`))[0];
}
if (!mr) { console.log('FAIL: no open MR'); process.exit(1); }
console.log('MR:', `!${mr.iid} ${mr.title.slice(0, 50)} → ${mr.target_branch} [${mr.state}]`);

// ═══ 4. Merge the MR IN-APP (row ⇪ → confirm «Слить») ═══════════════════════
if (mr.state === 'opened') {
  await page.locator('button[title="Обновить"]').first().click().catch(() => {});
  await page.waitForTimeout(4000);
  // The MR row renders the iid as '#6' (the GitLab list maps iid → number).
  const row = page.locator(`div.cursor-pointer:has-text("#${mr.iid}")`).first();
  await row.waitFor({ timeout: 15000 });
  await shot(page, '32-mr-row.png');
  // Clicking a row SELECTS the PR and hands off to Reviews — the code-review
  // surface where the merge lives (the list's own merge buttons were
  // disabled — see the commented-out block in PullRequestsPage).
  await row.click();
  await page.waitForTimeout(5000); // Reviews loads PR detail via API
  await shot(page, '32b-mr-in-reviews.png');
  // Action bar: Approve | «Слить» (primary) | Close — only for open PRs.
  const mergeBtn = page.locator('button:has-text("Слить")').first();
  await mergeBtn.waitFor({ timeout: 15000 });
  const disabled = await mergeBtn.isDisabled();
  console.log('Reviews Merge button disabled?', disabled, '(must be false — MR is conflict-free)');
  if (disabled) { console.log('FAIL: merge blocked'); process.exit(1); }
  await mergeBtn.click();
  await page.waitForTimeout(800);
  await shot(page, '33-mr-merge-confirm.png');
  // Confirm dialog (fixed overlay renders AFTER the page → .last()).
  await page.locator('button:text-is("Слить")').last().click();
  await page.waitForTimeout(12000); // GitLab merge + source-branch removal
  await shot(page, '34-mr-merged.png');
  mr = JSON.parse(sh(`curl -s --header "PRIVATE-TOKEN: ${GL_TOKEN}" "${GL_URL}/api/v4/projects/${pid}/merge_requests?iid=${mr.iid}"`))[0];
  console.log('MR state after in-app merge:', mr.state, 'merge_commit:', (mr.merge_commit_sha || '').slice(0, 8));
}

// ═══ 5. main checked out + pulled in-app → local == merge commit ════════════
if (cur() !== 'main') {
  await nav('#/branches', 3000);
  await rowMenu(page, 'main', 'Переключиться...');
  await page.waitForTimeout(4000);
}
await page.locator('button:has-text("Pull")').first().click();
await page.waitForTimeout(8000);
await shot(page, '35-main-pulled.png');
const localMain = sh('git rev-parse main');
const remoteMain = remoteHash('refs/heads/main');
console.log('local main:', localMain.slice(0, 8), '| origin/main:', remoteMain.slice(0, 8));

// ═══ 6. Final evidence ═════════════════════════════════════════════════════
await nav('#/history', 3500);
await shot(page, '36-history-main-released.png');
await app.close();

const checks = {
  'origin/main advanced past old main (f5fe829)': remoteMain.startsWith('f5fe829') === false && remoteMain.length >= 40,
  'local main == origin/main': localMain === remoteMain,
  'release commit daf50bd6 reachable from main': sh('git merge-base --is-ancestor daf50bd6 main && echo YES || echo NO') === 'YES',
  'tag v2.2.0 pushed': tagLanded,
  'feature branch removed by GitLab merge': remoteHash(`refs/heads/${BRANCH}`) === '',
};
let ok = true;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '✓' : '✗'} ${k}`); if (!v) ok = false; }
console.log(ok ? 'RELEASE TO MAIN COMPLETE (protected branch — via MR)' : 'RELEASE INCOMPLETE');
process.exit(ok ? 0 : 1);
