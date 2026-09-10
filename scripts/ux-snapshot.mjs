import { _electron as electron } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const SHOT_DIR = '/home/z/my-project/download/ux-snapshot';
fs.mkdirSync(SHOT_DIR, { recursive: true });

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ux-'));
  fs.writeFileSync(
    path.join(userDataDir, 'smartgit-settings.json'),
    JSON.stringify({
      settings: { theme: 'light' },
      repositories: [{ path: '/home/z/my-project/repos/test-repo', name: 'test-repo', lastOpened: Date.now() }],
      repoMetadata: {},
    }, null, 2)
  );

  const app = await electron.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage', path.join(process.cwd(), 'dist-electron/main.js')],
    env: { ...process.env, NODE_ENV: 'production', DISPLAY: process.env.DISPLAY || ':99', PRISMGIT_USER_DATA: userDataDir },
    timeout: 30000,
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await page.locator('button:has-text("test-repo")').first().click();
  await page.waitForTimeout(2000);

  // Capture key pages
  const pages = ['Changes', 'History', 'Branches', 'Tags', 'Diff', 'Stashes', 'Settings'];
  for (const label of pages) {
    try {
      await page.locator(`aside button:has-text("${label}")`).first().click();
      await page.waitForTimeout(2000);
      const slug = label.toLowerCase();
      await page.screenshot({ path: path.join(SHOT_DIR, `${slug}.png`) });
      console.log(`✓ ${slug}.png`);
    } catch (e) { console.log(`✗ ${label}: ${e.message.substring(0, 80)}`); }
  }

  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
main().catch(e => { console.error(e); process.exit(1); });
