/**
 * E2E: History merge-commit + tag decorations regression (Task 26).
 *
 * Uses the local test-lab repo (octopus merge + many tags). Skips when the
 * repo is not present so the suite still passes on machines without it.
 *
 * Verifies:
 *   1. Tag badges render in History graph rows (v0.500)
 *   2. Selecting a MERGE commit (via live search filter) shows its detail
 *      panel — the selectedIdx/filtered index-space bug used to leave the
 *      panel stuck on "Select a commit"
 *   3. The merge detail shows "Merged commits" section with nested commits
 *   4. The merge detail shows the merged FILES (not "Files (0)")
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import { launchApp, navigateTo, screenshot } from './helpers';

const REPO = { path: '/home/z/my-project/repos/test-lab', name: 'test-lab' };
const hasRepo = fs.existsSync(REPO.path);

test.skip(!hasRepo, 'test-lab repo not available on this machine');

test.describe('History: merge commit + tags', () => {
  test('tags render in graph rows', async () => {
    const ctx = await launchApp({ repos: [REPO] });
    try {
      await navigateTo(ctx.page, 'History');
      await ctx.page.waitForTimeout(3500);
      const body = await ctx.page.evaluate(() => document.body.innerText);
      expect(body).toContain('v0.500'); // tag badge in the list rows
      expect(body).toContain('v-ui-test'); // annotated tag on the merge commit
    } finally {
      await ctx.close();
    }
  });

  test('merge commit: detail panel + merged files + nested commits', async () => {
    const ctx = await launchApp({ repos: [REPO] });
    try {
      await navigateTo(ctx.page, 'History');
      await ctx.page.waitForTimeout(3500);

      // Filter to the octopus merge, then click its row
      const search = ctx.page.locator('input[placeholder*="hash" i]').first();
      await search.waitFor({ state: 'visible', timeout: 5000 });
      await search.fill('octopus');
      await ctx.page.waitForTimeout(1200);
      await ctx.page.getByText('merge: octopus x+y+z').first().click({ timeout: 10000 });
      await ctx.page.waitForTimeout(2500);
      await screenshot(ctx.page, 'merge-detail-task26');

      const body = await ctx.page.evaluate(() => document.body.innerText);
      // The detail panel shows the MERGE with its nested content
      // (NOTE: the page help-banner also contains the phrase "Select a
      // commit" — never assert its absence against the whole body text)
      expect(body).toMatch(/merged commits/i);
      expect(body).toContain('chore: x branch commit');
      expect(body).toContain('chore: z branch commit');
      // Merged files vs first parent (x.txt/y.txt/z.txt were added by the merge)
      expect(body).toMatch(/Files \(\d+\)/);
      expect(body).toContain('x.txt');
    } finally {
      await ctx.close();
    }
  });
});
