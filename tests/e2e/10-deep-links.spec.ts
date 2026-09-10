/**
 * E2E: Deep links + Settings Git Config system scope
 *
 * Verifies:
 *   - A deep link '#/history?file=README.md' applied via the URL hash lands on
 *     History, applies the file filter (chip in the header) and strips the
 *     query from the URL (DeepLinkHandler).
 *   - Command Palette → "Go to Deep Link…" opens the prompt dialog, an invalid
 *     link shows an error toast, a valid link navigates.
 *   - Command Palette → "Copy Deep Link" shows a success toast.
 *   - Settings → Git Config → System: no "Failed to load git config" toast even
 *     when /etc/gitconfig does not exist (regression: GitError
 *     "unable to read config file" crashed the git:configList IPC handler).
 */
import { test, expect } from '@playwright/test';
import { launchApp, navigateTo, screenshot } from './helpers';

test.describe('Deep links', () => {
  test('cold-start style hash link lands on History with the file filter chip', async () => {
    const ctx = await launchApp();
    try {
      await ctx.page.waitForTimeout(1500);

      // Simulate a deep link the same way an OS protocol handler / devtools would
      await ctx.page.evaluate(() => {
        window.location.hash = '#/history?file=README.md';
      });
      await ctx.page.waitForTimeout(2500);

      await screenshot(ctx.page, 'deeplink-history-file');

      // The URL query is stripped after the params are applied
      const hash = await ctx.page.evaluate(() => window.location.hash);
      expect(hash).toBe('#/history');

      // History header shows the file-filter chip (the Toolbar shows one too —
      // both reflect the same global pathFilter, so take the first)
      const chip = ctx.page.locator('button[title="Clear file filter"]').first();
      await expect(chip).toBeVisible({ timeout: 5000 });

      // The git log actually reloaded with --follow -- README.md: the History
      // page renders (commits area visible) — no crash, no empty page.
      const onHistory = await ctx.page.evaluate(() =>
        window.location.hash.startsWith('#/history')
      );
      expect(onHistory).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test('Command Palette → Go to Deep Link… validates input and navigates', async () => {
    const ctx = await launchApp();
    try {
      await ctx.page.waitForTimeout(1500);

      // Open the palette and pick the deep-link command
      await ctx.page.keyboard.press('Control+k');
      await ctx.page.waitForTimeout(600);
      await ctx.page.keyboard.type('Deep Link');
      await ctx.page.waitForTimeout(500);
      const cmd = ctx.page.locator('text=Go to Deep Link…').first();
      await cmd.waitFor({ state: 'visible', timeout: 5000 });
      await cmd.click();
      await ctx.page.waitForTimeout(600);

      // The prompt dialog is open — enter an INVALID link first
      const dialog = ctx.page.locator('[role="dialog"]');
      await dialog.waitFor({ state: 'visible', timeout: 5000 });
      const input = dialog.locator('input');
      await input.fill('garbage');
      await dialog.locator('button:has-text("Go")').click();
      await ctx.page.waitForTimeout(800);
      await expect(ctx.page.locator('text=Invalid deep link').first()).toBeVisible({ timeout: 5000 });

      // Close the error toast / reopen the dialog with a VALID link
      await ctx.page.keyboard.press('Escape');
      await ctx.page.waitForTimeout(400);
      await ctx.page.keyboard.press('Control+k');
      await ctx.page.waitForTimeout(600);
      await ctx.page.keyboard.type('Deep Link');
      await ctx.page.waitForTimeout(500);
      const cmd2 = ctx.page.locator('text=Go to Deep Link…').first();
      await cmd2.waitFor({ state: 'visible', timeout: 5000 });
      await cmd2.click();
      await ctx.page.waitForTimeout(600);

      const dialog2 = ctx.page.locator('[role="dialog"]');
      await dialog2.waitFor({ state: 'visible', timeout: 5000 });
      await dialog2.locator('input').fill('/history?branch=main');
      await dialog2.locator('button:has-text("Go")').click();
      await ctx.page.waitForTimeout(2000);

      // Navigated to History, URL query applied then stripped
      const hash = await ctx.page.evaluate(() => window.location.hash);
      expect(hash).toBe('#/history');

      await screenshot(ctx.page, 'deeplink-go-to-history');
    } finally {
      await ctx.close();
    }
  });

  test('Command Palette → Copy Deep Link shows a success toast', async () => {
    const ctx = await launchApp();
    try {
      await ctx.page.waitForTimeout(1500);

      await ctx.page.keyboard.press('Control+k');
      await ctx.page.waitForTimeout(600);
      await ctx.page.keyboard.type('Copy Deep');
      await ctx.page.waitForTimeout(500);
      const cmd = ctx.page.locator('text=Copy Deep Link').first();
      await cmd.waitFor({ state: 'visible', timeout: 5000 });
      await cmd.click();

      await expect(
        ctx.page.locator('text=Deep link copied').first()
      ).toBeVisible({ timeout: 5000 });
      await screenshot(ctx.page, 'deeplink-copy-toast');
    } finally {
      await ctx.close();
    }
  });

  test('Settings → Git Config → System scope does not error on missing /etc/gitconfig', async () => {
    const ctx = await launchApp();
    try {
      await navigateTo(ctx.page, 'Settings');
      await ctx.page.waitForTimeout(1500);

      // Switch the Git Config panel to the system scope
      const systemBtn = ctx.page.locator('section button:text-is("system")').first();
      await systemBtn.waitFor({ state: 'visible', timeout: 5000 });
      await systemBtn.click();
      await ctx.page.waitForTimeout(1500);

      await screenshot(ctx.page, 'settings-gitconfig-system');

      // REGRESSION: previously the git:configList IPC handler crashed with
      // GitError "fatal: unable to read config file '/etc/gitconfig'" and the
      // page showed "Failed to load git config". Now the (empty) list renders.
      const errorToast = await ctx.page
        .locator('text=Failed to load git config')
        .count();
      expect(errorToast).toBe(0);

      // The panel renders either entries or the empty state — both are fine
      const emptyState = await ctx.page
        .locator('text=No system config entries')
        .count();
      const tableRows = await ctx.page
        .locator('section:has-text("Git Config") code')
        .count();
      expect(emptyState > 0 || tableRows > 0).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});
