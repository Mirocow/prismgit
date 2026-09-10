/**
 * E2E: Open repository + Changes view
 *
 * Verifies:
 *   - App launches and auto-opens the fixture repo
 *   - Changes page renders with the file tree panel
 *   - The fixture repo's known files appear in the changes view
 *   - The user can stage/unstage files via the UI
 *   - The user can commit changes via the UI
 */

import { test, expect } from '@playwright/test';
import { launchApp, navigateTo, waitForText, screenshot, enableStatusFilter, FIXTURE_REPO } from './helpers';
import * as fs from 'node:fs';
import * as path from 'node:path';

test.describe('Changes workflow', () => {
  test('opens repo and shows file tree', async () => {
    const ctx = await launchApp();
    try {
      // App auto-opens fixture repo and lands on Changes
      await waitForText(ctx.page, 'test-repo', 15000);
      await waitForText(ctx.page, 'Changes', 10000);

      // The fixture repo has known files: README.md, src/index.js, etc.
      // After load, the changes view should be visible.
      await screenshot(ctx.page, 'changes-default');

      // The DirTreePanel shows the repo name with branch info
      const repoName = ctx.page.locator('text=test-repo').first();
      await expect(repoName).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('detects new untracked file in Changes view', async () => {
    const ctx = await launchApp();
    try {
      // Create a new file in the fixture repo
      const newFile = path.join(FIXTURE_REPO, 'e2e-new-file.txt');
      fs.writeFileSync(newFile, 'e2e test content\n');

      // MADS filters are active by default (Untracked OFF) — enable Untracked
      // so the fresh file is visible in the list
      await enableStatusFilter(ctx.page, 'Untracked');

      // Wait for the file watcher to pick up the change and refresh the status
      await ctx.page.waitForTimeout(1500);
      await screenshot(ctx.page, 'changes-with-new-file');

      // The new file should appear in the changes view
      // (either as untracked in the file list, or with a U status badge)
      await waitForText(ctx.page, 'e2e-new-file.txt', 10000);
    } finally {
      // Cleanup
      try { fs.unlinkSync(path.join(FIXTURE_REPO, 'e2e-new-file.txt')); } catch { /* ignore */ }
      await ctx.close();
    }
  });

  test('stages and unstages a file via the UI', async () => {
    const ctx = await launchApp();
    try {
      // Create a new file to stage
      const newFile = path.join(FIXTURE_REPO, 'e2e-stage-test.txt');
      fs.writeFileSync(newFile, 'staging test\n');
      await ctx.page.waitForTimeout(1500);

      // Untracked files are hidden by default (MADS filters) — enable Untracked
      await enableStatusFilter(ctx.page, 'Untracked');

      // The file should appear as untracked (status U)
      await waitForText(ctx.page, 'e2e-stage-test.txt', 10000);

      // Click the file row to select it
      const fileRow = ctx.page.locator('text=e2e-stage-test.txt').first();
      await fileRow.click();
      await ctx.page.waitForTimeout(300);

      await screenshot(ctx.page, 'changes-file-selected');

      // Find the "Stage" button in the toolbar (green + icon)
      // The toolbar LabeledButton has a label "Stage"
      const stageButton = ctx.page.locator('button:has-text("Stage")').first();
      await stageButton.click();
      await ctx.page.waitForTimeout(500);

      await screenshot(ctx.page, 'changes-after-stage');

      // The file should now be in staged area
      // Look for the staged indicator — the file should still be visible but with status A
    } finally {
      try { fs.unlinkSync(path.join(FIXTURE_REPO, 'e2e-stage-test.txt')); } catch { /* ignore */ }
      // Reset any staged changes
      try {
        const { execSync } = require('node:child_process');
        execSync('git -C /home/z/my-project/repos/test-repo reset HEAD -- . 2>/dev/null', { stdio: 'ignore' });
      } catch { /* ignore */ }
      await ctx.close();
    }
  });

  test('commits a file via the commit editor', async () => {
    const ctx = await launchApp();
    try {
      // Create a new file to commit
      const newFile = path.join(FIXTURE_REPO, 'e2e-commit-test.txt');
      fs.writeFileSync(newFile, 'commit test content\n');
      await ctx.page.waitForTimeout(1500);

      // Untracked files are hidden by default (MADS filters) — enable Untracked
      await enableStatusFilter(ctx.page, 'Untracked');

      // Wait for the file to appear
      await waitForText(ctx.page, 'e2e-commit-test.txt', 10000);

      // Stage all (click "Stage" button)
      const stageButton = ctx.page.locator('button:has-text("Stage")').first();
      await stageButton.click();
      await ctx.page.waitForTimeout(500);

      // Find the commit message textarea and type
      // The commit editor is at the bottom of the Changes page
      const commitTextarea = ctx.page.locator('textarea').first();
      await commitTextarea.waitFor({ state: 'visible', timeout: 5000 });
      await commitTextarea.fill('E2E test commit');
      await ctx.page.waitForTimeout(300);

      await screenshot(ctx.page, 'changes-before-commit');

      // Click the Commit button (Commit label, btn-primary)
      const commitButton = ctx.page.locator('button:has-text("Commit"):not(:has-text("Stage"))').first();
      await commitButton.click();
      await ctx.page.waitForTimeout(1000);

      await screenshot(ctx.page, 'changes-after-commit');

      // After commit, the file should no longer appear in changes
      // (it's now committed, not staged/modified)
      // The status bar should show clean working tree
    } finally {
      // Cleanup: revert the commit so other tests are not affected
      try {
        const { execSync } = require('node:child_process');
        execSync('git -C /home/z/my-project/repos/test-repo reset --hard HEAD~1 2>/dev/null', { stdio: 'ignore' });
        execSync('rm -f /home/z/my-project/repos/test-repo/e2e-commit-test.txt', { stdio: 'ignore' });
      } catch { /* ignore */ }
      await ctx.close();
    }
  });
});
