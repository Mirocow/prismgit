/* Probe: launch the app exactly like e2e helpers do, then dump any modal
 * dialog (role=dialog) content that is open after repo load. */
const { _electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-ud-'));
  const repoPath = path.join('/tmp', 'prismgit-e2e-repos', 'test-repo');
  // seed userData with the repo like helpers.seedUserData
  fs.mkdirSync(path.join(userDataDir), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'prismgit-settings'), JSON.stringify({
    version: 1,
    repositories: [{ path: repoPath, name: 'test-repo' }],
    lastOpenedRepo: repoPath,
  }));

  const app = await _electron.launch({
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      path.join(process.cwd(), 'dist-electron/main.js'),
    ],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DISPLAY: process.env.DISPLAY || ':99',
      PRISMGIT_USER_DATA: userDataDir,
      PRISMGIT_LOCALE: 'en',
    },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  const repoBtn = page.locator('button:has-text("test-repo")').first();
  if (await repoBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await repoBtn.click();
    await page.waitForTimeout(2500);
  }
  // Dump any open dialogs
  for (let round = 0; round < 3; round++) {
    const dialogs = await page.locator('[role="dialog"]').all();
    console.log(`--- round ${round}: ${dialogs.length} dialog(s) open`);
    for (const d of dialogs) {
      const txt = await d.textContent().catch(() => '<no text>');
      console.log('DIALOG TEXT:', (txt || '').slice(0, 400));
    }
    const overlay = await page.locator('.fixed.inset-0.z-\\[60\\]').count();
    console.log('z-60 overlays:', overlay);
    await page.waitForTimeout(1500);
  }
  await app.close().catch(() => {});
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(reposDir, { recursive: true, force: true });
}
main().catch((e) => { console.error('PROBE FAIL', String(e).slice(0, 400)); process.exit(1); });
