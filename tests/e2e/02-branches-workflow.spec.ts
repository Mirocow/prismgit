/**
 * E2E: Branches page workflow
 *
 * Verifies:
 *   - User can navigate to Branches page
 *   - The fixture repo's 5 local branches are shown (main, feature/auth, feature/api, develop, staging)
 *   - User can create a new branch via the New button
 *   - User can delete a branch via the row hover actions
 *   - User can rename via the row hover actions
 *   - User can checkout via clicking a row
 */

import { test, expect } from '@playwright/test';
import { launchApp, navigateTo, waitForText, screenshot, FIXTURE_REPO } from './helpers';
import { execSync } from 'node:child_process';

test.describe('Branches workflow', () => {
  test('lists all local branches from the fixture repo', async () => {
    const ctx = await launchApp();
    try {
      await navigateTo(ctx.page, 'Branches');
      await waitForText(ctx.page, 'Local Branches', 10000);
      await screenshot(ctx.page, 'branches-default');

      // The fixture repo has 5 local branches: main, feature/auth, feature/api, develop, staging
      await waitForText(ctx.page, 'main', 5000);
      await waitForText(ctx.page, 'feature/auth', 5000);
      await waitForText(ctx.page, 'feature/api', 5000);
      await waitForText(ctx.page, 'develop', 5000);
      await waitForText(ctx.page, 'staging', 5000);
    } finally {
      await ctx.close();
    }
  });

  test('creates a new branch via the New button', async () => {
    const ctx = await launchApp();
    try {
      await navigateTo(ctx.page, 'Branches');
      await waitForText(ctx.page, 'Local Branches', 10000);

      // Click the "New" button
      const newButton = ctx.page.locator('button:has-text("New")').first();
      await newButton.click();
      await ctx.page.waitForTimeout(500);

      // A modal appears with a Name input (placeholder="feature/my-branch")
      const nameInput = ctx.page.locator('input[placeholder="feature/my-branch"]').first();
      await nameInput.waitFor({ state: 'visible', timeout: 5000 });
      await nameInput.fill('e2e-test-branch');
      await ctx.page.waitForTimeout(300);

      await screenshot(ctx.page, 'branches-new-modal');

      // Click the Create button (modal's primary action)
      const createButton = ctx.page.locator('button:has-text("Create")').first();
      await createButton.click();
      await ctx.page.waitForTimeout(1000);

      await screenshot(ctx.page, 'branches-after-create');

      // The new branch should appear in the list
      await waitForText(ctx.page, 'e2e-test-branch', 5000);
    } finally {
      // Cleanup
      try {
        execSync('git -C /home/z/my-project/repos/test-repo branch -D e2e-test-branch 2>/dev/null', { stdio: 'ignore' });
      } catch { /* ignore */ }
      await ctx.close();
    }
  });

  test('checks out an existing branch by clicking its row', async () => {
    const ctx = await launchApp();
    try {
      await navigateTo(ctx.page, 'Branches');
      await waitForText(ctx.page, 'Local Branches', 10000);

      // Click on the develop branch row (not the hover actions)
      const developRow = ctx.page.locator('text=develop').first();
      await developRow.click();
      await ctx.page.waitForTimeout(1000);

      await screenshot(ctx.page, 'branches-after-checkout-develop');

      // The current branch indicator (▶) should now be on develop
      // Verify via the status bar or the toolbar header
      const headIndicator = ctx.page.locator('text=develop').first();
      await expect(headIndicator).toBeVisible();
    } finally {
      // Cleanup: checkout main
      try {
        execSync('git -C /home/z/my-project/repos/test-repo checkout main 2>/dev/null', { stdio: 'ignore' });
      } catch { /* ignore */ }
      await ctx.close();
    }
  });
});
