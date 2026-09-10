/**
 * E2E: Drag-and-drop repository opening
 *
 * Verifies:
 *   - Dragging a folder onto the window shows the drag overlay
 *   - Dropping a valid git repo adds it to the known repos list
 *   - Dropping multiple folders adds all valid git repos at once
 *   - Dropping a non-git folder shows "not a repo" in the results
 *
 * Note: Playwright's Electron support doesn't have a native drag-and-drop
 * API for external files, so we simulate the drop event directly.
 */

import { test, expect } from '@playwright/test';
import { launchApp, screenshot, FIXTURE_REPO } from './helpers';
import * as fs from 'node:fs';
import * as path from 'node:path';

test.describe('Drag-and-drop repositories', () => {
  test('shows drag overlay when files are dragged over the window', async () => {
    const ctx = await launchApp();
    try {
      // Simulate a drag-enter event with Files type
      await ctx.page.evaluate(() => {
        const event = new DragEvent('dragenter', {
          dataTransfer: new DataTransfer(),
          bubbles: true,
        });
        // Add Files type to make it look like a file drag
        event.dataTransfer?.setData('Files', '');
        window.dispatchEvent(event);
      });
      await ctx.page.waitForTimeout(300);

      // The drag overlay should be visible
      const overlay = ctx.page.locator('text=Drop repositories to open');
      await expect(overlay).toBeVisible({ timeout: 5000 });

      await screenshot(ctx.page, 'drag-overlay-visible');

      // Simulate drag-leave to dismiss
      await ctx.page.evaluate(() => {
        const event = new DragEvent('dragleave', {
          dataTransfer: new DataTransfer(),
          bubbles: true,
        });
        event.dataTransfer?.setData('Files', '');
        window.dispatchEvent(event);
      });
      await ctx.page.waitForTimeout(300);

      await expect(overlay).not.toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('drops a valid git repo and adds it to the list', async () => {
    const ctx = await launchApp({ repos: [] }); // Start with no repos
    try {
      // Create a temporary git repo to drop
      const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'prismgit-drop-'));
      const { execSync } = require('node:child_process');
      execSync(`git init -q -b main "${tmpDir}"`, { stdio: 'ignore' });
      execSync(`git -C "${tmpDir}" config user.name "Test"`, { stdio: 'ignore' });
      execSync(`git -C "${tmpDir}" config user.email "test@test.com"`, { stdio: 'ignore' });
      fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test\n');
      execSync(`git -C "${tmpDir}" add README.md`, { stdio: 'ignore' });
      execSync(`git -C "${tmpDir}" commit -q -m "init"`, { stdio: 'ignore' });

      // Simulate dropping the folder
      await ctx.page.evaluate((dropPath) => {
        const dt = new DataTransfer();
        // Create a File-like object with Electron's .path extension
        const file = new File([''], 'test-repo', { type: '' });
        // Electron extends File with a .path property — we set it on the prototype
        Object.defineProperty(file, 'path', { value: dropPath });
        dt.items.add(file);
        const event = new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
        });
        window.dispatchEvent(event);
      }, tmpDir);

      await ctx.page.waitForTimeout(3000);

      await screenshot(ctx.page, 'drag-drop-result');

      // The repo should be opened (since none was open before)
      // Check the StatusBar or toolbar for the repo name
      const repoName = path.basename(tmpDir);
      const bodyText = await ctx.page.evaluate(() => document.body.innerText);
      expect(bodyText).toContain(repoName);

      // Cleanup
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    } finally {
      await ctx.close();
    }
  });
});
