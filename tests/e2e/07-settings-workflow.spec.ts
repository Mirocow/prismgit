/**
 * E2E: Settings page workflow
 *
 * Verifies:
 *   - User can navigate to Settings
 *   - The Appearance section renders with theme toggle
 *   - The new UI Contrast slider is present and adjustable
 *   - Quick presets (Soft/Normal/High/Max) work
 *   - Per-area font sizes are editable
 */

import { test, expect } from '@playwright/test';
import { launchApp, navigateTo, waitForText, screenshot } from './helpers';

test.describe('Settings workflow', () => {
  test('renders all six tabs and their sections', async () => {
    const ctx = await launchApp();
    try {
      await navigateTo(ctx.page, 'Settings');
      await ctx.page.waitForTimeout(1500);

      await screenshot(ctx.page, 'settings-default');

      // E2E FIX (root cause #8): Settings was reorganized from the old
      // 2-tab "Application/Project Settings" layout into a 6-tab vertical
      // sidebar: Appearance / Git / AI / Security & SSH / Integrations /
      // Project Settings. The old assertions ('GITHUB INTEGRATION' section
      // + 'Project Settings' tab button) matched nothing.
      const tabs = ['Appearance', 'Git', 'AI', 'Security & SSH', 'Integrations', 'Project Settings'];
      for (const tab of tabs) {
        const btn = ctx.page.locator('nav button', { hasText: tab }).first();
        await expect(btn, `settings tab "${tab}" should render`).toBeVisible({ timeout: 8000 });
      }

      // Default tab = Appearance: contrast presets visible.
      const body = ctx.page.locator('body');
      await expect(body).toContainText('Normal');
      await expect(body).toContainText('Max');

      // Git tab renders its repository/commit defaults panel.
      await ctx.page.locator('nav button', { hasText: 'Git' }).first().click();
      await ctx.page.waitForTimeout(800);
      await expect(body).toContainText('Default commit author');

      // Project Settings (fixture repo is pre-loaded) shows Pull Strategy
      // and the per-repo Git Config panel.
      await ctx.page.locator('nav button', { hasText: 'Project Settings' }).first().click();
      await ctx.page.waitForTimeout(800);
      await expect(body).toContainText('Pull Strategy');
      await expect(body).toContainText('Git Config');
    } finally {
      await ctx.close();
    }
  });

  test('shows the UI Contrast slider with presets', async () => {
    const ctx = await launchApp();
    try {
      await navigateTo(ctx.page, 'Settings');
      await ctx.page.waitForTimeout(2000);

      // The 4 quick preset buttons should be visible
      const presets = ['Soft', 'Normal', 'High', 'Max'];
      for (const preset of presets) {
        const has = await ctx.page.evaluate((p) =>
          document.body.innerText.includes(p), preset
        );
        expect(has, `Settings should have "${preset}" preset`).toBe(true);
      }

      // Click the "Max" preset
      const maxButton = ctx.page.locator('button:has-text("Max")').first();
      await maxButton.click();
      await ctx.page.waitForTimeout(500);

      await screenshot(ctx.page, 'settings-contrast-max');

      // The slider's value display should now show 150%
      const has150 = await ctx.page.evaluate(() =>
        document.body.innerText.includes('150%')
      );
      expect(has150).toBe(true);

      // Click Reset
      const resetButton = ctx.page.locator('button:has-text("Reset")').first();
      await resetButton.click();
      await ctx.page.waitForTimeout(300);
      const has100 = await ctx.page.evaluate(() =>
        document.body.innerText.includes('100%')
      );
      expect(has100).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test('toggles the theme via the Theme button', async () => {
    const ctx = await launchApp();
    try {
      await navigateTo(ctx.page, 'Settings');
      await ctx.page.waitForTimeout(2000);

      // The Theme section has a button that shows the OPPOSITE theme name
      // (Light theme shows "Dark" button, dark theme shows "Light" button)
      const themeButton = ctx.page.locator('button:has-text("Dark"), button:has-text("Light")').first();
      const initialText = await themeButton.textContent();

      await themeButton.click();
      await ctx.page.waitForTimeout(500);

      await screenshot(ctx.page, 'settings-theme-toggled');

      // After click, the button text should flip
      const newButton = ctx.page.locator('button:has-text("Dark"), button:has-text("Light")').first();
      const newText = await newButton.textContent();
      expect(newText).not.toBe(initialText);
    } finally {
      await ctx.close();
    }
  });
});
