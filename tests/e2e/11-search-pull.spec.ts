/**
 * E2E: Search tool (unified InvestigatePage) + Pull remote selector.
 *
 * E2E FIX (root cause #9): the old version targeted the pre-unification
 * Search page ('input[placeholder*="live"]', per-tab 'Find tracked files'
 * buttons) that no longer exists, and hardcoded a /home/z/my-project/repos
 * test-lab path so the whole spec always skipped. Now it drives the
 * UNIFIED search bar (one input, mode chips All/Commits/Files/Content)
 * on the fixture test-lab repo created by setup-e2e-extra-repos.sh.
 *
 * Verifies:
 *   1. Commits search updates LIVE while typing (no Enter, no button)
 *   2. Files mode finds tracked files by name substring
 *   3. Content mode greps the working tree (git grep)
 *   4. The toolbar Pull dropdown opens with a REMOTE selector
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { launchApp, navigateTo, screenshot } from './helpers';

const BASE = process.env.PRISMGIT_TEST_REPOS || path.join(os.tmpdir(), 'prismgit-repos');
const REPO = { path: `${BASE}/test-lab`, name: 'test-lab' };
const hasRepo = fs.existsSync(REPO.path);

test.skip(!hasRepo, 'test-lab repo not available on this machine');

test.describe('Search tool (unified)', () => {
  test('commits search works live while typing', async () => {
    const ctx = await launchApp({ repos: [REPO] });
    try {
      await navigateTo(ctx.page, 'Search');
      // The single unified search bar (placeholder starts with the
      // 'Search commits, files, and content' string).
      const input = ctx.page.locator('input[placeholder^="Search commits, files"]').first();
      await input.waitFor({ state: 'visible', timeout: 8000 });
      // Type char-by-char — NO Enter, NO submit button: results must
      // arrive through the 200ms debounce alone.
      await input.type('octopus');
      await ctx.page.waitForTimeout(1500);
      const body = await ctx.page.evaluate(() => document.body.innerText);
      expect(body).toContain('merge: octopus x+y+z');
      // Unified-UI caption: the Commits section header carries the count.
      // (The header renders with CSS text-transform:uppercase — innerText
      // returns 'COMMITS (1)', so match case-insensitively.)
      expect(body).toMatch(/commits\s*\(1\)/i);
      await screenshot(ctx.page, 'search-commits-live');
    } finally {
      await ctx.close();
    }
  });

  test('files mode finds tracked files by name', async () => {
    const ctx = await launchApp({ repos: [REPO] });
    try {
      await navigateTo(ctx.page, 'Search');
      await ctx.page.locator('button', { hasText: 'Files' }).first().click();
      const input = ctx.page.locator('input[placeholder^="Search commits, files"]').first();
      await input.waitFor({ state: 'visible', timeout: 8000 });
      await input.fill('util');
      await ctx.page.waitForTimeout(1200);
      const body = await ctx.page.evaluate(() => document.body.innerText);
      expect(body).toContain('src/lib/util.ts');
      await screenshot(ctx.page, 'search-files');
    } finally {
      await ctx.close();
    }
  });

  test('content mode greps the working tree', async () => {
    const ctx = await launchApp({ repos: [REPO] });
    try {
      await navigateTo(ctx.page, 'Search');
      await ctx.page.locator('button', { hasText: 'Content' }).first().click();
      const input = ctx.page.locator('input[placeholder^="Search commits, files"]').first();
      await input.waitFor({ state: 'visible', timeout: 8000 });
      // UTIL_TOKEN is a literal inside src/lib/util.ts (fixture) — git grep
      // must return the file with the matching line.
      await input.fill('UTIL_TOKEN');
      await ctx.page.waitForTimeout(1500);
      const body = await ctx.page.evaluate(() => document.body.innerText);
      expect(body).toContain('src/lib/util.ts');
      expect(body).toContain('UTIL_TOKEN');
      await screenshot(ctx.page, 'search-content-grep');
    } finally {
      await ctx.close();
    }
  });
});

test.describe('Pull dropdown', () => {
  test('opens with a remote selector listing origin', async () => {
    const ctx = await launchApp({ repos: [REPO] });
    try {
      // The chevron next to the Pull button (title starts 'Pull options').
      const chevron = ctx.page.locator('button[title^="Pull options"]').first();
      await chevron.waitFor({ state: 'visible', timeout: 10000 });
      await chevron.click();
      // The dropdown contains the Remote label + a <select> that must
      // offer the fixture's origin remote.
      const body = ctx.page.locator('body');
      await expect(body).toContainText('Remote', { timeout: 5000 });
      const remoteSelect = ctx.page.locator('select').first();
      await remoteSelect.waitFor({ state: 'visible', timeout: 5000 });
      const options = await remoteSelect.locator('option').allTextContents();
      expect(options.join('\n')).toContain('origin');
      await screenshot(ctx.page, 'pull-remote-selector');
    } finally {
      await ctx.close();
    }
  });
});
