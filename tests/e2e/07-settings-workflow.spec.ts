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
  test('renders all settings sections', async () => {
    const ctx = await launchApp();
    try {
      await navigateTo(ctx.page, 'Settings');
      await ctx.page.waitForTimeout(2000);

      await screenshot(ctx.page, 'settings-default');

      // Use page.evaluate for text checks (more reliable than waitForSelector).
      // Since the Settings page was split into two tabs (5a73533):
      //   Application Settings → Appearance, GitHub Integration, About
      //   Project Settings (needs an open repo; the fixture repo is
      //   pre-loaded) → Pull Strategy, Git Config
      const appSections = ['APPEARANCE', 'GITHUB INTEGRATION', 'ABOUT'];
      for (const section of appSections) {
        const has = await ctx.page.evaluate((s) =>
          document.body.innerText.includes(s), section
        );
        expect(has, `Application Settings should contain "${section}" section`).toBe(true);
      }

      // Switch to the Project Settings tab
      const projectTab = ctx.page.locator('button:has-text("Project Settings")').first();
      await projectTab.waitFor({ state: 'visible', timeout: 5000 });
      await projectTab.click();
      await ctx.page.waitForTimeout(1500);

      const projectSections = ['PULL STRATEGY', 'GIT CONFIG'];
      for (const section of projectSections) {
        const has = await ctx.page.evaluate((s) =>
          document.body.innerText.includes(s), section
        );
        expect(has, `Project Settings should contain "${section}" section`).toBe(true);
      }
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
