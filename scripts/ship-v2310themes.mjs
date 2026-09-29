/**
 * SHIP v2.3.10 (rebranded) — the v2.3.9 number was taken by the project
 * owner's own push (ff9e761 «v2.3.9 — unified sidebar and command palette
 * interactions»), so our themes work becomes v2.3.10.
 *
 * All git operations THROUGH THE APP (RU locale):
 *   1. History → select 799c7b6d → details-pane «Reset» (mixed) → confirm
 *      (our 6ee8ea15 v2.3.9 commit becomes unstaged worktree changes)
 *   2. Files were already rebranded to 2.3.10 before this script ran
 *   3. Changes → stage all → commit «feat(ux): v2.3.10 — themes …»
 *   4. Toolbar «Push» → PushRejectionDialog (remote ahead) → «Стянуть и
 *      слить» → the app pulls (merge ff9e761), then push retries itself
 *   5. CLI verify: origin == local, tree clean
 *
 * Usage: DISPLAY=:99 node scripts/ship-v2310themes.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/release-v239';
const MSG = 'feat(ux): v2.3.10 — themes: settings match what you actually see\n\n'
  + '(rebased round of the v2.3.9 themes audit — the 2.3.9 number was\n'
  + ' taken by ff9e761 «unified sidebar and command palette interactions»)\n\n'
  + '- User-reported: «темы там просто ад в настройках одно а визуально\n'
  + '  затрагивает и другие блоки» — audited empirically per the request:\n'
  + '  two extreme signal-color custom themes + six built-ins pushed\n'
  + '  through the live app and pixel-diffed against the light baseline\n'
  + '- light-dim-sidebar: the dark-sidebar override block was LOST in the\n'
  + '  Tailwind v4 migration (orphaned selector glued to simple-light) —\n'
  + '  the theme rendered a WHITE sidebar + token leak; block restored\n'
  + '  (live: aside #1e1e1e, text #ccc, 16% pixel diff vs 0.4% before)\n'
  + '- built-in themes completed to the full 59-token canonical set:\n'
  + '  Material hover/active/focus was AYU blue on an indigo theme;\n'
  + '  Discord info/warning were Ayu cyan/gold\n'
  + '- theme-blind regions now derive from tokens via color-mix(): status\n'
  + '  badges (were identical Ayu rgba in ALL 8 probe themes), 3-way\n'
  + '  conflict washes, ghost rows, btn-primary shadow halo, btn-danger\n'
  + '  hover, Active chip uses --text-inverse\n'
  + '- syntax: text-function/tok-function referenced the non-existent\n'
  + '  --accent-blue (functions uncolored) — now accent-light-blue+fallback\n'
  + '- customThemeCss: border-subtle was inverted for dark themes; now\n'
  + '  derives focus/info/link/tag/graph/scrollbar/diff-line/word + the\n'
  + '  syntax accent family (status -> accent-green/yellow/red/purple/cyan)\n'
  + '- pins v239Pins (27) + themeRegistry; suite 2106/0/34 skipped; tsc\n'
  + '  clean; build green; live e2e verify-v239themes ALL PASSED (17);\n'
  + '  probe-themes re-run: all computed tokens follow each theme;\n'
  + '  regression verify-v238 ALL PASSED';

fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) })
  .then(() => console.log(`📸 ${name}`));
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', shell: '/bin/bash' });

const before = {
  head: sh('git rev-parse HEAD').trim(),
  origin: sh('git rev-parse origin/feature/smartgit-electron-v3').trim(),
  dirty: sh('git status --porcelain').split('\n').filter(Boolean).length,
};
console.log('BEFORE: dirty =', before.dirty, '· head', before.head.slice(0, 8), '· origin', before.origin.slice(0, 8));

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v2310-'));
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

// ── 1. History → select the v2.3.8 commit (799c7b6d) → Mixed reset ────────
await page.evaluate(() => { window.location.hash = '#/history'; });
await page.waitForTimeout(2800);
// NOTE: use the exact-subject `text=` locator (matches the smallest element,
// as in probe-themes). A `div:has-text(...)` locator matches CONTAINER
// ancestors too — the previous run clicked a list container, selected the
// wrong commit and reset the branch to v2.3.0.
await page.locator('text=v2.3.8 — layout-panel').first().click({ timeout: 8000 });
await page.waitForTimeout(1800);
await shot(page, '10-selected-v238.png');

await page.locator('button[title="Reset to this commit (mixed)"]').first().click();
await page.waitForTimeout(700);
await shot(page, '11-reset-confirm.png');
await page.locator('button:text-is("Сбросить")').first().click();
await page.waitForTimeout(3000);

const resetState = sh('git rev-parse HEAD').trim();
const dirtyNow = sh('git status --porcelain').split('\n').filter(Boolean).length;
console.log('RESET: head', resetState.slice(0, 8), '· dirty files:', dirtyNow);
if (resetState.slice(0, 7) !== '799c7b6') {
  console.log('FAIL: reset did not land on 799c7b6d'); await app.close(); process.exit(1);
}

// ── 2. Changes → stage everything → commit v2.3.10 ────────────────────────
await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(2500);
await shot(page, '12-changes-after-reset.png');
const unstagedHeader = page.locator('span:has-text("Изменения (")').first();
if (await unstagedHeader.count() > 0) {
  await unstagedHeader.click();
  await page.waitForTimeout(2500);
}
await page.locator('span:has-text("Индекс (")').first().waitFor({ timeout: 15000 });
await shot(page, '13-staged.png');

await page.locator('#commit-message-input').fill(MSG);
await page.waitForTimeout(600);
await shot(page, '14-commit-message.png');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.locator('button:text-is("Коммит")').first().click();
await page.waitForTimeout(5000);
await shot(page, '15-commit-done.png');

const head2 = sh('git rev-parse HEAD').trim();
console.log('COMMIT v2.3.10:', head2.slice(0, 8), 'parent', resetState.slice(0, 8));
if (head2 === resetState) { console.log('FAIL: no commit created'); await app.close(); process.exit(1); }

// ── 3. Push → rejection → «Стянуть и слить» (merge ff9e761 + auto retry) ──
await page.locator('button[title*="Отправить текущую ветку"]').first().click();
await page.waitForTimeout(5000);
await shot(page, '16-push-rejected.png');
const pullBtn = page.locator('button:text-is("Стянуть и слить")').first();
try {
  await pullBtn.click({ timeout: 8000 });
  console.log('PULL+MERGE clicked');
} catch {
  console.log('no rejection dialog — push may have landed directly');
}
await page.waitForTimeout(12000);
await shot(page, '17-after-merge-push.png');

let origin2 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
let head3 = sh('git rev-parse HEAD').trim();
if (origin2 !== head3) {
  await page.waitForTimeout(5000);
  origin2 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
  head3 = sh('git rev-parse HEAD').trim();
}
const clean = sh('git status --porcelain').trim() === '';
const parents = sh('git log --pretty=%P -1 HEAD').trim().split(' ');
console.log('PUSH: origin =', origin2.slice(0, 8), '· local =', head3.slice(0, 8), '· clean =', clean, '· parents =', parents.map(p => p.slice(0, 8)).join('+'));
if (origin2 !== head3) { console.log('FAIL: push did not land'); await app.close(); process.exit(1); }
if (parents.length < 2) { console.log('WARN: HEAD is not a merge commit (unexpected shape)'); }

await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log('SHIP v2.3.10 DONE — reset+recommit+pull-merge+push all via UI');
