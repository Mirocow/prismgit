/**
 * E2E regression: NO modal dialog may be open after app launch + repo open.
 *
 * The LFS false-positive bug (detectLfsConfigured matched the app's own
 * env-injected empty filter.lfs.* overrides on every repo) popped the
 * "Git LFS is configured but not installed" ConfirmDialog (z-[60] overlay)
 * right after opening a repository — intercepting EVERY click and timing
 * out half the e2e suite. This spec pins the fix at the UI level: after
 * launchApp() (which opens the fixture repo), no [role="dialog"] may be
 * present. The dialog would appear within ~1s of repo open (the check
 * runs 100ms after open + a git subprocess), so we sample for several
 * seconds before declaring victory.
 */
import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

test('no modal dialog opens on repo launch (LFS false-positive regression)', async () => {
  const ctx = await launchApp();
  try {
    const page = ctx.page;
    // The app is on the Changes page with the repo open. Sample the DOM
    // for any modal dialog over the next ~4.5s.
    for (let round = 0; round < 3; round++) {
      await page.waitForTimeout(1500);
      const dialogs = await page.locator('[role="dialog"]').all();
      for (const d of dialogs) {
        const txt = (await d.textContent().catch(() => '')) || '';
        // Fail with the offending dialog's text for instant diagnosis.
        expect(
          txt.replace(/\s+/g, ' ').trim(),
          `unexpected modal open after repo launch (round ${round})`,
        ).toBe('');
      }
      // Also guard the specific blocking overlay class the ConfirmDialog
      // uses — role="dialog" alone would miss a future dialog without it.
      const overlays = await page.locator('.fixed.inset-0.z-\\[60\\]').count();
      expect(overlays, 'z-60 confirm overlay must not be open').toBe(0);
    }
  } finally {
    await ctx.close();
  }
});
