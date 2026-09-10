/**
 * Manual-verification probe: launches the built app, drives the new
 * deep-link flows and captures screenshots to /home/z/my-project/download/.
 *
 *  1. Deep link → History filtered to README.md (+ cross-tool chips)
 *  2. Deep link → Blame for src/ files
 *  3. Copy Deep Link toast
 *  4. Settings → Git Config → System (missing /etc/gitconfig — no error)
 */
import { _electron as electron } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const FIXTURE_REPO = '/home/z/my-project/repos/test-repo';
const OUT_DIR = '/home/z/my-project/download';

function seedUserData(userDataDir) {
  const settingsFile = path.join(userDataDir, 'smartgit-settings.json');
  const data = {
    settings: {
      theme: 'light', fontSize: 13, fontSizeTree: 12, fontSizeList: 12,
      fontSizeDiff: 11, fontSizeMonospace: 11, sidebarWidth: 240, contrast: 100,
      defaultCloneDir: '', showReflogInHistory: false, maxHistoryLoad: 500,
      enableTelemetry: false, pullStrategy: 'merge',
    },
    repositories: [{ path: FIXTURE_REPO, name: 'test-repo', lastOpened: Date.now(), pinned: false }],
    repoMetadata: {},
  };
  fs.writeFileSync(settingsFile, JSON.stringify(data, null, 2));
  fs.writeFileSync(
    path.join(userDataDir, 'smartgit-window-state.json'),
    JSON.stringify({ windowState: { bounds: { x: 0, y: 0, width: 1440, height: 900 }, isMaximized: false, isFullScreen: false } }, null, 2)
  );
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-probe-'));
  seedUserData(userDataDir);

  const app = await electron.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      path.join(process.cwd(), 'dist-electron/main.js')],
    env: { ...process.env, NODE_ENV: 'production', DISPLAY: process.env.DISPLAY || ':99', PRISMGIT_USER_DATA: userDataDir },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // Open the fixture repo
  const repoButton = page.locator('button:has-text("test-repo")').first();
  if (await repoButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await repoButton.click();
    await page.waitForTimeout(2000);
  }

  const shot = (name) => page.screenshot({ path: path.join(OUT_DIR, name), fullPage: false });

  // 1) Deep link → History filtered to README.md
  await page.evaluate(() => { window.location.hash = '#/history?file=README.md'; });
  await page.waitForTimeout(2500);
  await shot('prismgit-deeplink-history-file.png');

  // 2) Deep link → Blame
  await page.evaluate(() => { window.location.hash = '#/blame?file=README.md'; });
  await page.waitForTimeout(2500);
  await shot('prismgit-deeplink-blame-file.png');

  // 3) Copy Deep Link via Command Palette
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(600);
  await page.keyboard.type('Copy Deep');
  await page.waitForTimeout(500);
  const copyCmd = page.locator('text=Copy Deep Link').first();
  if (await copyCmd.isVisible({ timeout: 3000 }).catch(() => false)) {
    await copyCmd.click();
    await page.waitForTimeout(900);
  }
  await shot('prismgit-deeplink-copy-toast.png');

  // 4) Settings → Git Config → System (the reported bug)
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await page.waitForTimeout(1200);
  const systemBtn = page.locator('section button:text-is("system")').first();
  if (await systemBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await systemBtn.click();
    await page.waitForTimeout(1500);
  }
  await shot('prismgit-settings-gitconfig-system.png');

  const errorCount = await page.locator('text=Failed to load git config').count();
  console.log(`[probe] "Failed to load git config" toasts: ${errorCount} (expected 0)`);

  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  console.log('[probe] screenshots saved to', OUT_DIR);
}

main().catch((e) => { console.error(e); process.exit(1); });
