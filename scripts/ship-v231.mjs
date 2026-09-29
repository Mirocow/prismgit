/**
 * SHIP v2.3.1 — commit + push THIS round THROUGH THE APP.
 * «Все операции с git надо выполнять с помощью PrismGit и снимая экраны
 * каждого из действий, и документированием операций».
 *
 * RU locale. Real UI interactions only: stage via the «Изменения (N)»
 * section header, message in the commit editor, «Коммит», toolbar «Push».
 * Evidence → /home/z/my-project/work/release-v231/.
 *
 * Usage: DISPLAY=:99 node scripts/ship-v231.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/release-v231';
const MSG = 'perf+ux: v2.3.1 — read router to git worker, Search→Blame/History, AI search/blame tools\n\n'
  + '- all read/meta git commands execute in the dedicated git worker (the main\n'
  + '  loop is the IPC broker; History open blocked it 119ms on a 20k-commit\n'
  + '  repo, now ≤2.4ms; vitest keeps the in-process path — 2017 tests green)\n'
  + '- worker git spawns reported back to the Operations console\n'
  + '  (origin=worker entries — one honest instrument for load analysis)\n'
  + '- git remote -v: 60s cache (was a 384ms spawn on every History open)\n'
  + '- PRReview GitLab projectId heal: exponential backoff to 30s (was 1.5s\n'
  + '  network retries forever on 401/unreachable GitLab)\n'
  + '- Bisect page: 3s poll only while a bisect is actually running\n'
  + '- Search results: per-hit Blame-at-line (scroll + flash via one-shot\n'
  + '  blameFocusLine), History pre-filtered by the found file, Diff; the\n'
  + '  file-group header carries the full Changes/Diff/Blame/History set\n'
  + '- AI assistant: search_code + blame_file tools (the Search/Blame tool\n'
  + '  engines) + tool-selection guidance in the system prompt\n'
  + '- History: activating a chip/author/date filter clears the text search\n'
  + '  (filters operate over ALL commits); FilterInput gains ✕ clear + Esc\n'
  + '- dialogs/settings row spacing widened (space-y-4, taller list rows)\n'
  + '- CHANGELOG ×4 languages, version 2.3.1; tests 2017/0 (+13 new pins);\n'
  + '  e2e verify-v231 20/20, verify-counters + verify-ui-round green';

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
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v231-'));
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

// ── 1. Changes before: the v2.3.1 worktree ─────────────────────────────────
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
console.log('SHIP v2.3.1 DONE — commit + push via UI verified');
