/**
 * E2E: Search tool usability + Pull-from-remote selector (Task 26).
 *
 * Uses the local test-lab repo. Skips when the repo is not present.
 *
 * Verifies:
 *   1. Search/Commits finds commits LIVE while typing (no button press)
 *   2. Search/Files finds tracked files by name substring
 *   3. Search/Content (git grep) returns grouped matches
 *   4. Pull options open with a REMOTE selector + fetched remote branches
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import { launchApp, navigateTo, screenshot } from './helpers';

const REPO = { path: '/home/z/my-project/repos/test-lab', name: 'test-lab' };
const hasRepo = fs.existsSync(REPO.path);

test.skip(!hasRepo, 'test-lab repo not available on this machine');

test.describe('Search tool', () => {
  test('commits search works live while typing', async () => {
    const ctx = await launchApp({ repos: [REPO] });
    try {
      await navigateTo(ctx.page, 'Search');
      const input = ctx.page.locator('input[placeholder*="live" i]').first();
      await input.waitFor({ state: 'visible', timeout: 5000 });
      await input.type('octopus'); // type char-by-char, NO Enter, NO button click
      await ctx.page.waitForTimeout(1500); // debounce 300ms + git log
      const body = await ctx.page.evaluate(() => document.body.innerText);
      expect(body).toContain('merge: octopus x+y+z');
      expect(body).toMatch(/match(es)? “octopus”/);
      await screenshot(ctx.page, 'search-commits-live');
    } finally {
      await ctx.close();
    }
  });

  test('files tab finds tracked files by name', async () => {
    const ctx = await launchApp({ repos: [REPO] });
    try {
      await navigateTo(ctx.page, 'Search');
      await ctx.page.locator('button[title^="Find tracked files"]').first().click();
      const input = ctx.page.locator('input[placeholder*="Find tracked files" i]').first();
      await input.waitFor({ state: 'visible', timeout: 5000 });
      await input.fill('util');
      await ctx.page.waitForTimeout(1200);
      const body = await ctx.page.evaluate(() => document.body.innerText);
      expect(body).toContain('src/lib/util.ts');
      await screenshot(ctx.page, 'search-files');
    } finally {
      await ctx.close();
    }
  });

  test('content tab greps the working tree', async () => {
    const ctx = await launchApp({ repos: [REPO] });
    try {
      await navigateTo(ctx.page, 'Search');
      await ctx.page.locator('button[title^="git grep"]').first().click();
      const input = ctx.page.locator('input[placeholder*="pattern" i]').first();
      await input.waitFor({ state: 'visible', timeout: 5000 });
      await input.fill('alpha');
      await input.press('Enter');
      await ctx.page.waitForTimeout(2000);
      const body = await ctx.page.evaluate(() => document.body.innerText);
      expect(body).toMatch(/match(es)? in \d+ file/);
      await screenshot(ctx.page, 'search-grep');
    } finally {
      await ctx.close();
    }
  });
});

test.describe('Pull from remote', () => {
  test('pull options expose remote selector + remote branches', async () => {
    const ctx = await launchApp({ repos: [REPO] });
    try {
      // Open the Pull options menu (chevron next to the Pull button)
      const chevron = ctx.page.locator('button[title*="Pull options"]').first();
      await chevron.waitFor({ state: 'visible', timeout: 5000 });
      await chevron.click();
      await ctx.page.waitForTimeout(800);
      await screenshot(ctx.page, 'pull-options');

      const body = await ctx.page.evaluate(() => document.body.innerText);
      expect(body).toMatch(/pull from remote/i); // header is CSS-uppercased
      // Scope to the dropdown PANEL (the page behind has other <select>s)
      const panel = ctx.page.locator('div.absolute').filter({ hasText: 'Pull from remote' }).first();
      // Remote dropdown exists and the repo's origin is in it
      const remoteOptions = await panel.locator('select').nth(0).locator('option').allTextContents();
      expect(remoteOptions).toContain('origin');
      // The branch dropdown is scoped to origin/ and contains origin/main
      const branchOptions = await panel.locator('select').nth(1).locator('option').allTextContents();
      expect(branchOptions.some((o) => o.startsWith('origin/'))).toBe(true);
      expect(branchOptions).toContain('origin/main');
    } finally {
      await ctx.close();
    }
  });
});
