/**
 * SHIP v2.3.10 follow-up — commit the post-merge fixes through the app:
 *   - the «Customize toolbar» gear button restored (ff9e761 dropped the
 *     only entry point to the customization panel)
 *   - v234/v237/v238 pins made format-agnostic (the refactor reformatted
 *     Toolbar.tsx/shell.ts)
 * Usage: DISPLAY=:99 node scripts/ship-v2310followup.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/release-v239';
const MSG = 'fix(ux): v2.3.10 follow-up — restore the Customize-toolbar entry point\n\n'
  + '- the ff9e761 refactor dropped the gear button that opened the\n'
  + '  toolbar-customization panel (setShowCustomize(true) was never called\n'
  + '  — the panel existed but was unreachable); restored as an IconButton\n'
  + '  right before the VS Code hero-row toggles\n'
  + '- v234/v237/v238 pins normalized (flat(): strip whitespace + unify\n'
  + '  quotes) so they assert INTENT, not the refactor formatting\n'
  + '- full unit layer 1388/0 green again; live e2e verify-v238 +\n'
  + '  verify-v239themes ALL PASSED on the merged build';

fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) })
  .then(() => console.log(`📸 ${name}`));
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', shell: '/bin/bash' });

const before = { head: sh('git rev-parse HEAD').trim(), dirty: sh('git status --porcelain').split('\n').filter(Boolean).length };
console.log('BEFORE: dirty =', before.dirty, '· head', before.head.slice(0, 8));

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v2310fu-'));
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

// BONUS EVIDENCE: the restored gear button opens the customization panel
await page.locator('button[title="Настроить панель инструментов"]').first().click();
await page.waitForTimeout(1000);
await shot(page, '18-customize-restored.png');
const panelVisible = await page.locator('text=' + 'Настроить панель инструментов').count();
console.log('customize panel opened:', panelVisible > 0);

await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(2500);
const unstagedHeader = page.locator('span:has-text("Изменения (")').first();
if (await unstagedHeader.count() > 0) {
  await unstagedHeader.click();
  await page.waitForTimeout(2500);
}
await page.locator('span:has-text("Индекс (")').first().waitFor({ timeout: 15000 });
await page.locator('#commit-message-input').fill(MSG);
await page.waitForTimeout(500);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.locator('button:text-is("Коммит")').first().click();
await page.waitForTimeout(4500);
await shot(page, '19-followup-commit.png');

const head1 = sh('git rev-parse HEAD').trim();
const clean = sh('git status --porcelain').trim() === '';
console.log('COMMIT:', head1.slice(0, 8), 'parent', before.head.slice(0, 8), 'clean', clean);
if (head1 === before.head) { console.log('FAIL: no commit'); await app.close(); process.exit(1); }

await page.locator('button[title*="Отправить текущую ветку"]').first().click();
await page.waitForTimeout(9000);
await shot(page, '20-followup-push.png');

let origin1 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
if (origin1 !== head1) { await page.waitForTimeout(4000); origin1 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim(); }
console.log('PUSH: origin =', origin1.slice(0, 8), '== local', head1.slice(0, 8), origin1 === head1);
if (origin1 !== head1) { console.log('FAIL: push did not land'); await app.close(); process.exit(1); }

await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log('SHIP v2.3.10 follow-up DONE');
