/**
 * E2E: Keyboard shortcuts overlay
 *
 * Verifies:
 *   - Pressing Ctrl+? opens the shortcuts overlay
 *   - The overlay shows all shortcut groups (Global, Navigation, Git Operations, History)
 *   - Pressing Escape closes the overlay
 *   - Clicking the X button closes the overlay
 *   - The toolbar has a Keyboard button that opens the overlay
 */

import { test, expect } from '@playwright/test';
import { launchApp, screenshot } from './helpers';

test.describe('Keyboard shortcuts overlay', () => {
  test('opens via Ctrl+? and shows all shortcut groups', async () => {
    const ctx = await launchApp();
    try {
      // Press Ctrl+? (Shift+/ produces ?). On most layouts, Ctrl+Shift+/ = Ctrl+?
      await ctx.page.keyboard.press('Control+Shift+Slash');
      await ctx.page.waitForTimeout(500);

      // The overlay should be visible
      const overlay = ctx.page.locator('.shortcut-overlay-panel');
      await expect(overlay).toBeVisible();

      await screenshot(ctx.page, 'shortcuts-overlay-open');

      // Verify all shortcut groups are present.
      // We use the overlay's textContent (not document.body.innerText) because
      // the overlay uses position:fixed which can be excluded from innerText.
      const overlayText = await overlay.textContent();
      const groups = ['Global', 'Navigation', 'Git Operations', 'History / Commit List'];
      for (const group of groups) {
        expect(overlayText, `Overlay should contain "${group}" section`).toContain(group);
      }

      // Close with Escape
      await ctx.page.keyboard.press('Escape');
      await ctx.page.waitForTimeout(500);

      // Overlay should be gone
      await expect(overlay).not.toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('opens via the Keyboard button in the toolbar', async () => {
    const ctx = await launchApp();
    try {
      // Find the Keyboard button in the toolbar (title="Keyboard Shortcuts (Ctrl+?)")
      const keyboardButton = ctx.page.locator('button[title="Keyboard Shortcuts (Ctrl+?)"]').first();
      await keyboardButton.waitFor({ state: 'visible', timeout: 10000 });
      await keyboardButton.click();
      await ctx.page.waitForTimeout(500);

      // The overlay should be visible
      const overlay = ctx.page.locator('.shortcut-overlay-panel');
      await expect(overlay).toBeVisible();

      await screenshot(ctx.page, 'shortcuts-via-toolbar-button');

      // Close via the X button inside the overlay
      const closeButton = overlay.locator('button').first();
      await closeButton.click();
      await ctx.page.waitForTimeout(500);

      await expect(overlay).not.toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('Alt+number navigates to pages', async () => {
    const ctx = await launchApp();
    try {
      // Wait for the app to load
      await ctx.page.waitForTimeout(2000);

      // Press Alt+2 to go to History
      await ctx.page.keyboard.press('Alt+2');
      await ctx.page.waitForTimeout(1500);

      // The History page should be visible — look for a commit subject
      const hasCommit = await ctx.page.evaluate(() =>
        document.body.innerText.includes('Main setup') ||
        document.body.innerText.includes('Merge') ||
        document.body.innerText.includes('commit')
      );
      expect(hasCommit).toBe(true);

      // Press Alt+4 to go to Branches
      await ctx.page.keyboard.press('Alt+4');
      await ctx.page.waitForTimeout(1500);

      const hasBranches = await ctx.page.evaluate(() =>
        document.body.innerText.includes('Local Branches') ||
        document.body.innerText.includes('main')
      );
      expect(hasBranches).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});
