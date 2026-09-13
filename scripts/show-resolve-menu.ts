import { _electron as electron } from '@playwright/test';
import * as path from 'node:path';

const USER_DATA = '/tmp/prismgit-screens-data';

async function main() {
  const app = await electron.launch({
    args: [
      path.join('/home/z/my-project/repos/gitclient', 'dist-electron', 'main.js'),
      '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--ozone-platform=headless', '--use-gl=swiftshader', '--disable-software-rasterizer',
    ],
    env: { ...process.env, DISPLAY: ':42', PRISMGIT_USER_DATA: USER_DATA },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.waitForTimeout(2000);
  await page.locator('text=test-conflict-repo').first().click();
  await page.waitForTimeout(2000);
  await page.evaluate(() => { window.location.hash = '#/changes'; });
  await page.waitForTimeout(2000);

  // Override contextMenu.show BEFORE right-click — store captured items globally
  await page.evaluate(() => {
    (window as any).__capturedMenu = null;
    const origShow = (window as any).smartgit.contextMenu.show;
    (window as any).smartgit.contextMenu.show = (items: any[]) => {
      (window as any).__capturedMenu = JSON.parse(JSON.stringify(items));
      return Promise.resolve(true);
    };
  });

  // Right-click on file1.ts
  await page.locator('text=file1.ts').first().click({ button: 'right' });
  await page.waitForTimeout(2000);

  // Read the captured menu
  const menu = await page.evaluate(() => (window as any).__capturedMenu);
  console.log('=== FILE CONTEXT MENU (right-click on conflicted file1.ts) ===');
  console.log(JSON.stringify(menu, null, 2));

  await app.close();
}
main().catch(console.error);
