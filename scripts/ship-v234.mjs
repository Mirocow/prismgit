/**
 * SHIP v2.3.4 — commit + push THIS round THROUGH THE APP.
 * «Все операции с git надо выполнять с помощью PrismGit и снимая экраны
 * каждого из действий, и документированием операций».
 *
 * RU locale. Real UI interactions only: stage via the «Изменения (N)»
 * section header, message in the commit editor, «Коммит», toolbar «Push».
 * Evidence → /home/z/my-project/work/release-v234/.
 *
 * Usage: DISPLAY=:99 node scripts/ship-v234.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/release-v234';
const MSG = 'fix(ux+ai): v2.3.4 — spacing cascade root cause, InfoHint content, toolbar collapse toggles, AI covers all 18 tools\n\n'
  + '- ROOT CAUSE of "spacing still small": app * { margin:0 } reset compiled\n'
  + '  into @layer utilities AFTER space-y-* (Tailwind v4 :where() = 0\n'
  + '  specificity) — silently beat EVERY space-* utility app-wide;\n'
  + '  redundant reset removed, all spacing now renders (Settings\n'
  + '  panels widened to space-y-8 on top)\n'
  + '- InfoHint: stacked group-hover:group-focus:block never matched\n'
  + '  (hover AND focus; button swallows mousedown) — tooltip content\n'
  + '  never displayed; now group-hover + group-focus-within\n'
  + '- Toolbar corner (right of Customize): left-sidebar rail + right\n'
  + '  commit-details collapse toggles via shared uiLayoutStore\n'
  + '- LFS file rows: history/lock buttons always visible (opacity-60)\n'
  + '- AI: 10 new tool engines, 41 total — get_reflog, submodules (x2),\n'
  + '  lfs (x2), bisect state machine, gitflow, recyclable, reviews,\n'
  + '  pull requests; system-prompt rules 24-27; 18/18 sidebar tools\n'
  + '- pins v234Pins (14); suite 2044/0; tsc clean; live e2e verify-v234\n'
  + '  ALL PASSED + regressions (v233, counters, ui-round 27,\n'
  + '  conflict-reactions, v231 perf) ALL PASSED'

fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) })
  .then(() => console.log(`📸 ${name}`));
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', shell: '/bin/bash' });

const before = {
  head: sh('git rev-parse HEAD').trim(),
  origin: sh('git rev-parse origin/feature/smartgit-electron-v3').trim(),
  dirty: sh('git status --porcelain').split('\n').filter(Boolean).length,
};
console.log('BEFORE: dirty files =', before.dirty, '· head', before.head.slice(0, 8));

// ── Launch (RU) ─────────────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v234-'));
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

// ── 1. Changes before: the v2.3.4 worktree ──────────────────────────────────
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
await page.waitForTimeout(4500);
await shot(page, '04-commit-done.png');

// CLI check: exactly one new commit, tree clean
const head1 = sh('git rev-parse HEAD').trim();
const treeClean = sh('git status --porcelain').trim() === '';
console.log('COMMIT:', head1.slice(0, 8), 'parent', before.head.slice(0, 8), 'clean-tree', treeClean);
if (head1 === before.head) { console.log('FAIL: no commit created'); await app.close(); process.exit(1); }

// ── 4. Push to origin/feature/smartgit-electron-v3 (toolbar «Push») ────────
await shot(page, '05-before-push.png');
await page.locator('button[title*="Отправить текущую ветку"]').first().click();
await page.waitForTimeout(9000);
await shot(page, '06-push-toast.png');

let origin1 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
if (origin1 !== head1) {
  // one retry via the app after fetch settle
  await page.waitForTimeout(3000);
  origin1 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
}
console.log('PUSH: origin =', origin1.slice(0, 8), '== local', head1.slice(0, 8), origin1 === head1);
if (origin1 !== head1) { console.log('FAIL: push did not land'); await app.close(); process.exit(1); }

await app.close();
console.log('SHIP v2.3.4 DONE — commit + push via UI verified');
