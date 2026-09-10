/**
 * E2E: About window
 * =================
 * Help → About PrismGit must open a dedicated, informative About window
 * (not the old one-line native message box): title, app version, system
 * info rows and a working "Copy System Info" feedback. The window is a
 * singleton — re-triggering the menu item must NOT spawn a second window.
 */
import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

test.describe('About window', () => {
  test('opens from the Help menu and shows system information', async () => {
    const ctx = await launchApp();
    try {
      const windowsBefore = ctx.app.windows().length;

      const aboutPromise = ctx.app.waitForEvent('window', { timeout: 10000 });
      await ctx.app.evaluate(({ Menu }) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById('help-about');
        item?.click?.();
      });
      const about = await aboutPromise;
      await about.waitForLoadState('domcontentloaded');

      // Title + heading + version
      expect(await about.title()).toBe('About PrismGit');
      await expect(about.locator('h1')).toContainText('PrismGit');
      await expect(about.locator('.version')).toContainText('v2.');

      // System information table is populated
      await expect(about.locator('td.k', { hasText: 'Electron' })).toBeVisible();
      await expect(about.locator('td.k', { hasText: 'Node.js' })).toBeVisible();
      await expect(about.locator('td.k', { hasText: 'Build date' })).toBeVisible();
      await expect(about.locator('td.k', { hasText: 'First launch' })).toBeVisible();

      // Links + actions are present
      await expect(about.locator('.link', { hasText: 'Project Repository' })).toBeVisible();
      await expect(about.locator('#copy-btn')).toBeVisible();

      // "Copy System Info" gives visual feedback
      await about.click('#copy-btn');
      await expect(about.locator('#copied')).toHaveClass(/show/, { timeout: 5000 });
    } finally {
      await ctx.close();
    }
  });

  test('is a singleton — second menu invocation does not spawn another window', async () => {
    const ctx = await launchApp();
    try {
      const aboutPromise = ctx.app.waitForEvent('window', { timeout: 10000 });
      await ctx.app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()?.getMenuItemById('help-about')?.click?.();
      });
      await aboutPromise;

      const countAfterFirst = ctx.app.windows().length;

      await ctx.app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()?.getMenuItemById('help-about')?.click?.();
      });
      // Give any (buggy) duplicate window a moment to appear
      await ctx.page.waitForTimeout(600);

      expect(ctx.app.windows().length).toBe(countAfterFirst);
    } finally {
      await ctx.close();
    }
  });
});
