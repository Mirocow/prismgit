import { test, expect } from '@playwright/test';
import { launchApp, navigateTo, waitForText, screenshot, FIXTURE_REPO } from './helpers';

test.describe('PrismGit E2E smoke', () => {
  test('launches and shows the test-repo in Changes view', async () => {
    const ctx = await launchApp();
    try {
      // Window title should be "PrismGit"
      const title = await ctx.page.title();
      expect(title).toBe('PrismGit');

      // The app should auto-open the fixture repo and land on Changes
      // The header shows "SmartGit / test-repo" in the top toolbar
      await waitForText(ctx.page, 'test-repo', 15000);
      await screenshot(ctx.page, 'smoke-changes');
    } finally {
      await ctx.close();
    }
  });
});
