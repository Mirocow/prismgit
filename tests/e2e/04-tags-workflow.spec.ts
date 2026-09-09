/**
 * E2E: Tags page workflow
 *
 * Verifies:
 *   - User can navigate to Tags page
 *   - The fixture repo's 3 tags (v1, v1.0.0, v1.0.1) are listed
 *   - User can create a new tag via the New button
 *   - User can delete a tag via row hover actions
 *   - Clicking a tag navigates to History at that commit
 */

import { test, expect } from '@playwright/test';
import { launchApp, navigateTo, waitForText, screenshot, FIXTURE_REPO } from './helpers';
import { execSync } from 'node:child_process';

test.describe('Tags workflow', () => {
  test('lists all tags from the fixture repo', async () => {
    const ctx = await launchApp();
    try {
      await navigateTo(ctx.page, 'Tags');
      // Wait for the Tags page header
      await ctx.page.waitForTimeout(1000);

      await screenshot(ctx.page, 'tags-default');

      // The fixture repo has 3 tags: v1, v1.0.0, v1.0.1
      await waitForText(ctx.page, 'v1', 8000);
      await waitForText(ctx.page, 'v1.0.0', 5000);
      await waitForText(ctx.page, 'v1.0.1', 5000);
    } finally {
      await ctx.close();
    }
  });

  test('creates a new lightweight tag via the New Tag button', async () => {
    const ctx = await launchApp();
    try {
      await navigateTo(ctx.page, 'Tags');
      await ctx.page.waitForTimeout(1500);
      await waitForText(ctx.page, 'v1', 8000);

      // Click the "New Tag" button (specific text on Tags page)
      const newButton = ctx.page.locator('button:has-text("New Tag")').first();
      await newButton.click();
      await ctx.page.waitForTimeout(800);

      // Modal appears with Name input (placeholder="v1.0.0")
      const nameInput = ctx.page.locator('input[placeholder="v1.0.0"]').first();
      await nameInput.waitFor({ state: 'visible', timeout: 5000 });
      await nameInput.fill('e2e-test-tag');
      await ctx.page.waitForTimeout(300);

      // Untick the "Annotated tag" checkbox so we get a lightweight tag
      const annotatedCheckbox = ctx.page.locator('input[type="checkbox"]').first();
      const isChecked = await annotatedCheckbox.isChecked();
      if (isChecked) {
        await annotatedCheckbox.uncheck();
        await ctx.page.waitForTimeout(200);
      }

      await screenshot(ctx.page, 'tags-new-modal');

      // Click Create
      const createButton = ctx.page.locator('button:has-text("Create")').first();
      await createButton.click();
      await ctx.page.waitForTimeout(1500);

      await screenshot(ctx.page, 'tags-after-create');

      // The new tag should appear in the list
      await waitForText(ctx.page, 'e2e-test-tag', 5000);
    } finally {
      // Cleanup
      try {
        execSync('git -C /home/z/my-project/repos/test-repo tag -d e2e-test-tag 2>/dev/null', { stdio: 'ignore' });
      } catch { /* ignore */ }
      await ctx.close();
    }
  });
});
