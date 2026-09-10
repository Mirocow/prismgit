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

  // Open the repo
  await page.locator('text=test-conflict-repo').first().click();
  await page.waitForTimeout(2000);
  await page.evaluate(() => { window.location.hash = '#/changes'; });
  await page.waitForTimeout(2000);

  // Right-click on a conflicted file and capture the menu structure via IPC
  const file1Row = page.locator('text=file1.ts').first();
  if (await file1Row.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Hook into the context-menu:show IPC to capture the items
    const menuItems = await page.evaluate(() => {
      return new Promise((resolve) => {
        const origInvoke = (window as any).smartgit?.contextMenu?.show;
        if (origInvoke) {
          (window as any).smartgit.contextMenu.show = (items: any[]) => {
            // Capture the menu items and return them
            resolve(JSON.parse(JSON.stringify(items)));
            // Don't actually show the menu
            return Promise.resolve(true);
          };
        }
        // Trigger right-click
        const evt = new MouseEvent('contextmenu', { bubbles: true, button: 2 });
        document.querySelector('[class*="file1"]')?.dispatchEvent(evt);
        // Fallback: just resolve with empty
        setTimeout(() => resolve([]), 3000);
      });
    });
    console.log('MENU ITEMS:', JSON.stringify(menuItems, null, 2));
  }

  await app.close();
}
main().catch(console.error);
