/**
 * v2.3.8 pixel forensics — exact rect of the MIDDLE layout toggle, both
 * states, pixel-count the icon's bottom strip vs its top area.
 * Usage: DISPLAY=:99 node scripts/pixcheck-v238.mjs
 */
import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/v238-fixture/repo';
const SHOTS = '/home/z/my-project/work/v238-shots';
fs.mkdirSync(SHOTS, { recursive: true });

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-pix-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: false, locale: 'ru' },
  repositories: [{ path: REPO, name: 'repo', lastOpened: Date.now(), pinned: false }],
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1560, height: 960 }, isMaximized: false, isFullScreen: false },
}, null, 2));

const app = await electron.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    path.join(process.cwd(), 'dist-electron/main.js')],
  env: { ...process.env, NODE_ENV: 'production', DISPLAY: ':99',
    PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'ru' },
});
const page = await app.firstWindow();
page.on('dialog', (d) => d.dismiss().catch(() => {}));
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);
await page.locator('button:has-text("repo")').first().click();
await page.waitForTimeout(3500);

const rectOf = (title) => page.locator(`button[title="${title}"]`).first().boundingBox();

// open state
await page.locator('button[title*="журнал команд"]').first().click();
await page.waitForTimeout(600);
let r = await rectOf('Скрыть журнал команд');
await page.screenshot({ path: path.join(SHOTS, 'pix-open.png'), clip: r });
await page.locator('button[title="Скрыть журнал команд"]').first().click();
await page.waitForTimeout(600);
r = await rectOf('Показать журнал команд');
await page.screenshot({ path: path.join(SHOTS, 'pix-closed.png'), clip: r });
console.log('button box:', JSON.stringify(r));
await app.close().catch(() => {});
process.exit(0);
