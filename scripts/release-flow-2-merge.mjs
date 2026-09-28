/**
 * RELEASE FLOW — Phase 2: docs commit → push → checkout main → merge →
 * push main → tag v2.2.0 → push tags. EVERY git operation runs through the
 * PrismGit UI (commit editor, toolbar Push, branch context menus, Merge
 * panel, Tags dialog, push options «Отправить теги»), each step screenshotted.
 *
 * Native context menus (checkout / merge) are triggered through the app's
 * own menu pipeline: the main-process Menu.buildFromTemplate is patched to
 * capture the built menu, the item's real click() handler fires
 * webContents.send('context-menu:click') exactly as a user click would.
 *
 * Usage: DISPLAY=:99 node scripts/release-flow-2-merge.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/release';
const BRANCH = 'feature/smartgit-electron-v3';
const MSG = 'docs(release): v2.2.0 — README & CHANGELOG in 4 languages\n\n'
  + '- README.md refreshed: 2.2.0 badges, screenshot gallery of the main\n'
  + '  screens (History/Changes/Branches/PR/Reviews/AI/Settings, light+dark),\n'
  + '  Conflict Handling + Security feature sections, updated tech stack\n'
  + '- README.ru.md / README.zh.md / README.de.md — full translations\n'
  + '- docs/CHANGELOG.md: [2.2.0] — conflict reactions, push rejection\n'
  + '  recovery, squash-to-branch, counters audit, secrets manager, deps\n'
  + '- docs/CHANGELOG.{ru,zh,de}.md — localized 2.2.0 + history index\n'
  + '- version bump 2.1.0 → 2.2.0 (package.json + lockfile)';

fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) })
  .then(() => console.log(`📸 ${name}`));
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', timeout: 30000 }).trim();
const remoteHash = (ref) => sh(`git ls-remote origin ${ref}`).split('\t')[0];

// ── Launch (RU) ─────────────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-rel2-'));
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

// Native-menu spy: capture every built menu so we can click its items
// through the app's own pipeline.
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
const waitForRemote = async (ref, want, what, timeoutS = 120) => {
  for (let i = 0; i < Math.ceil(timeoutS / 5); i++) {
    await page.waitForTimeout(5000);
    const got = remoteHash(ref);
    if (got.startsWith(want)) { console.log(`   ${what}: remote landed after ${(i + 1) * 5}s`); return true; }
  }
  console.log(`   ${what}: NOT landed (remote=${remoteHash(ref).slice(0, 8)}, want=${want})`);
  return false;
};

// ═══ 1. Commit the docs release ═════════════════════════════════════════════
await nav('#/changes', 2500);
await page.locator('span:has-text("Изменения ("), span:has-text("Индекс (")').first()
  .waitFor({ timeout: 10000 });
await shot(page, '07-docs-before-commit.png');
const unstaged = page.locator('span:has-text("Изменения (")').first();
if (await unstaged.count() > 0) { await unstaged.click(); await page.waitForTimeout(2000); }
await page.locator('#commit-message-input').fill(MSG);
await page.waitForTimeout(500);
await shot(page, '08-docs-commit-message.png');
await page.keyboard.press('Escape');
await page.locator('button:text-is("Коммит")').first().click();
await page.waitForTimeout(4000);
const relHead = sh('git rev-parse HEAD');
console.log('docs commit:', relHead.slice(0, 8));
await shot(page, '09-docs-committed.png');

// push feature branch
await page.locator('button[title*="Отправить текущую ветку"]').first().click();
await (await waitForRemote(`refs/heads/${BRANCH}`, relHead.slice(0, 8), 'docs push'));
await shot(page, '10-docs-pushed.png');

// ═══ 2. Checkout main (branch context menu → «Переключиться...») ════════════
await nav('#/branches', 3000);
await shot(page, '11-branches-feature-current.png');
await page.locator('span.truncate:text-is("main")').first().click({ button: 'right' });
await page.waitForTimeout(600);
await clickMenuItem('Переключиться...');
await page.waitForTimeout(4000);
console.log('current branch now:', sh('git rev-parse --abbrev-ref HEAD'));
await shot(page, '12-branches-main-current.png');

// ═══ 3. Merge feature/smartgit-electron-v3 into main (MergePanel) ═══════════
// Conflicts are impossible by construction (origin/main == merge-base), but
// the merge still goes through the app's conflict-aware MergePanel path.
await page.locator(`span.truncate:text-is("${BRANCH}")`).first().click({ button: 'right' });
await page.waitForTimeout(600);
await clickMenuItem('Слияние...');
await page.waitForTimeout(1200);
await shot(page, '13-merge-dialog.png');
await page.locator('button:text-is("Слить")').first().click();
await page.waitForTimeout(5000);
const mainHead = sh('git rev-parse HEAD');
console.log('main after merge:', mainHead.slice(0, 8), '== release head:', mainHead === relHead);
await shot(page, '14-merge-done.png');

// ═══ 4. Push main ═══════════════════════════════════════════════════════════
await page.locator('button[title*="Отправить текущую ветку"]').first().click();
await (await waitForRemote('refs/heads/main', mainHead.slice(0, 8), 'main push'));
await shot(page, '15-main-pushed.png');

// ═══ 5. Tag v2.2.0 (Tags tool → «Новый тег») ═══════════════════════════════
await nav('#/tags', 2500);
await shot(page, '16-tags-empty.png');
await page.locator('button:has-text("Новый тег")').first().click();
await page.waitForTimeout(800);
await page.locator('input[placeholder="v1.0.0"]').fill('v2.2.0');
await page.locator('textarea[placeholder="Release v1.0.0"]')
  .fill('PrismGit 2.2.0 — conflict reactions, push rejection recovery, '
    + 'squash-to-branch, counters audit, secrets manager, deps at latest');
await page.waitForTimeout(400);
await shot(page, '17-tag-dialog.png');
await page.locator('button:text-is("Создать")').first().click();
await page.waitForTimeout(3000);
console.log('tag created:', sh('git rev-parse v2.2.0'), '→ points at', sh('git rev-parse v2.2.0^{commit}').slice(0, 8));
await shot(page, '18-tags-created.png');

// ═══ 6. Push the tag (toolbar Push options → «Отправить теги») ══════════════
await page.locator('button[title^="Параметры push"]').first().click();
await page.waitForTimeout(600);
await shot(page, '19-push-options.png');
await page.locator('label:has-text("Отправить теги") input[type="checkbox"]').check();
await page.locator('button:has-text("Отправить в origin")').first().click();
await page.waitForTimeout(3000);
const tagLanded = await waitForRemote('refs/tags/v2.2.0', sh('git rev-parse v2.2.0').slice(0, 8), 'tag push', 60);
await shot(page, '20-tag-pushed.png');

// ═══ 7. Final state: History on main with the release tag ══════════════════
await nav('#/history', 3500);
await page.locator('span.truncate:text-is("main")').first().waitFor({ timeout: 5000 }).catch(() => {});
await shot(page, '21-history-main-final.png');

await app.close();

// ═══ 8. CLI verification of the whole release ═══════════════════════════════
const checks = {
  'main local == release head': sh('git rev-parse main') === relHead,
  'origin/main == release head': remoteHash('refs/heads/main') === relHead,
  'tag v2.2.0 == release head': sh('git rev-parse v2.2.0^{commit}') === relHead,
  'tag pushed': tagLanded,
  'feature pushed': remoteHash(`refs/heads/${BRANCH}`) === relHead,
};
let ok = true;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '✓' : '✗'} ${k}`); if (!v) ok = false; }
console.log(ok ? 'RELEASE FLOW COMPLETE' : 'RELEASE FLOW HAS FAILURES');
process.exit(ok ? 0 : 1);
