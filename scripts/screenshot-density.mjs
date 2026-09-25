/**
 * Captures app screenshots (RU locale) for spacing-density review.
 * Usage: DISPLAY=:99 node scripts/screenshot-density.mjs [outdir]
 */
import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const OUT = process.argv[2] || '/tmp/prismgit-density-shots';
const ROOT = '/tmp/prismgit-switch-repos';
fs.mkdirSync(OUT, { recursive: true });

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-shots-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true },
  repositories: [
    { path: path.join(ROOT, 'heavy-repo'), name: 'heavy-repo', lastOpened: Date.now(), pinned: false },
    { path: path.join(ROOT, 'medium-repo'), name: 'medium-repo', lastOpened: Date.now(), pinned: false },
  ],
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1440, height: 900 }, isMaximized: false, isFullScreen: false },
}, null, 2));

const app = await electron.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    path.join(process.cwd(), 'dist-electron/main.js')],
  env: {
    ...process.env, NODE_ENV: 'production',
    DISPLAY: process.env.DISPLAY || ':99',
    PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'ru',
  },
  timeout: 30000,
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1500);

await page.locator('button:has-text("heavy-repo")').first().click().catch(async () => {
  await page.locator('[data-testid="repo-item-heavy-repo"]').first().click();
});
await page.waitForTimeout(4000);

// 1 — Changes page (file list density)
await page.screenshot({ path: path.join(OUT, '01-changes-ru.png') });

// 2 — file row context menu (menu item spacing)
{
  const row = page.locator('[role="option"]').first();
  if (await row.count()) {
    await row.click({ button: 'right' }).catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '02-context-menu-ru.png') });
    await page.keyboard.press('Escape').catch(() => {});
  }
}

// 3 — Settings (form density)
await page.evaluate(() => { window.location.hash = '#/settings'; });
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, '03-settings-ru.png') });

// 4 — History (commit rows)
await page.evaluate(() => { window.location.hash = '#/history'; });
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, '04-history-ru.png') });

// 5 — Branches
await page.evaluate(() => { window.location.hash = '#/branches'; });
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, '05-branches-ru.png') });

console.log('shots →', OUT);
await app.close().catch(() => {});
process.exit(0);
