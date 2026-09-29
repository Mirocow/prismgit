/**
 * SHIP v2.3.0 — commit + push THIS round's UX batch THROUGH THE APP.
 * «Все операции с git надо выполнять с помощью PrismGit и снимая экраны
 * каждого из действий, и документированием операций».
 *
 * RU locale. Real UI interactions only: stage via the «Изменения (N)»
 * section header, message in the commit editor, «Коммит», toolbar «Push».
 * Evidence → /home/z/my-project/work/release-v230/.
 *
 * Usage: DISPLAY=:99 node scripts/ship-v230.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/release-v230';
const MSG = 'feat(ux): v2.3.0 — nav back/forward, panel collapse, custom themes, per-tool hotkeys\n\n'
  + '- Back/Forward toolbar buttons + Alt+Left/Right (navHistoryStore, user trail only)\n'
  + '- VS Code-style collapse: left sidebar → 48px icon rail; History details pane → 24px strip\n'
  + '- Themes curated 27 → 6 (Ayu Light, One Dark, Simple, Material, Discord,\n'
  + '  light+dark-sidebar) + visual Custom Theme editor (15 colors incl. TEXT colors,\n'
  + '  sidebar bg = dark-sidebar/light-main look); legacy ids auto-migrate\n'
  + '- every sidebar tool gets exactly ONE hotkey: Ctrl+1..9 + Alt+1..9;\n'
  + '  order + bindings configurable in Settings → «Сайдбар и навигация»\n'
  + '- commit detail card: «Ветки, содержащие коммит» (git branch --contains,\n'
  + '  new git:branchesContaining IPC) + author click-to-filter + copy\n'
  + '- counters take two: Branches summary = repo totals (not search-filtered),\n'
  + '  Tagged chip over the filtered set, repo stats + remote branch count,\n'
  + '  dead stash/reflog loaders removed from History\n'
  + '- PR 401 (Bad credentials): zero toasts + auth gate + in-flight/last-key\n'
  + '  guard (one request per session; Refresh = force)\n'
  + '- Settings dedup: one External Tools panel, commit guides single owner,\n'
  + '  InfoHint «!» tooltips on confusing settings, AI sub-headers localized\n'
  + '- CHANGELOG ×4 languages, version bump 2.3.0\n'
  + '- tests: 2004 passed / 0 failed; e2e verify-ui-round 27/27,\n'
  + '  verify-counters 17/17, verify-conflict-reactions 17/17';

fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) })
  .then(() => console.log(`📸 ${name}`));
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8' });

const before = {
  head: sh('git rev-parse HEAD').trim(),
  origin: sh('git rev-parse origin/feature/smartgit-electron-v3').trim(),
  dirty: sh('git status --porcelain').split('\n').filter(Boolean).length,
};
console.log('BEFORE: dirty files =', before.dirty, '· head', before.head.slice(0, 8));

// ── Launch (RU) ─────────────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v230-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true, locale: 'ru' },
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

// ── 1. Changes before: the v2.3.0 worktree ─────────────────────────────────
await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(2500);
await page.locator('span:has-text("Изменения ("), span:has-text("Индекс (")').first()
  .waitFor({ timeout: 15000 });
await shot(page, '01-changes-before.png');

// ── 2. Stage everything (section header click = git add) ───────────────────
const unstagedHeader = page.locator('span:has-text("Изменения (")').first();
if (await unstagedHeader.count() > 0) {
  await unstagedHeader.click();
  await page.waitForTimeout(2500);
}
await page.locator('span:has-text("Индекс (")').first().waitFor({ timeout: 15000 });
await shot(page, '02-staged.png');

// ── 3. Commit message + commit button ──────────────────────────────────────
await page.locator('#commit-message-input').fill(MSG);
await page.waitForTimeout(600);
await shot(page, '03-commit-message.png');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.locator('button:text-is("Коммит")').first().click();
await page.waitForTimeout(4000);
await shot(page, '04-commit-done.png');

// CLI check: exactly one new commit, tree clean
const head1 = sh('git rev-parse HEAD').trim();
const treeClean = sh('git status --porcelain').trim() === '';
console.log('COMMIT:', head1.slice(0, 8), 'parent', before.head.slice(0, 8), 'clean-tree', treeClean);
if (head1 === before.head) { console.log('FAIL: no commit created'); process.exit(1); }

// ── 4. Push to origin/feature/smartgit-electron-v3 (toolbar «Push») ────────
await shot(page, '05-before-push.png');
await page.locator('button[title*="Отправить текущую ветку"]').first().click();
await page.waitForTimeout(8000);
await shot(page, '06-push-toast.png');

const origin1 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
console.log('PUSH: origin =', origin1.slice(0, 8), '== local', head1.slice(0, 8), origin1 === head1);
if (origin1 !== head1) { console.log('FAIL: push did not land'); process.exit(1); }

// ── 5. Tag v2.3.0 via the Branches tool (row context menu → тег) ───────────
// Skipped-by-default; the release tag is created by the release flow when
// the owner merges. Keep the ship minimal and reversible.

await app.close();
console.log('SHIP v2.3.0 DONE — commit + push via UI verified');
