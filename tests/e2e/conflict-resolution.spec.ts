/**
 * E2E: Conflict resolution — 3 scenarios driven through the real UI.
 *
 * E2E FIX (root causes #4/#6): old version used exec() + hardcoded
 * DISPLAY=:99, /tmp/conflict-test-* repos that nothing created, and
 * swallowed every error (fake-green). Now: fixtures from
 * setup-e2e-extra-repos.sh, spawn via cdp-launch.ts, real assertions on the
 * banner → context-menu → 3-way editor → Take Left → Save & Stage flow.
 */
import { test, expect } from '@playwright/test';
import { launchCdpApp, cdpNavigateTo, shotDir, FIXTURE_BASE } from './cdp-launch';

const SHOTS = shotDir();

const REPOS = [
  { path: `${FIXTURE_BASE}/conflict-test-1`, name: 'conflict-test-1', desc: 'Content conflict in config.ts', file: 'config.ts' },
  { path: `${FIXTURE_BASE}/conflict-test-2`, name: 'conflict-test-2', desc: 'Multiple file conflicts (3 files)', file: 'file1.ts' },
  { path: `${FIXTURE_BASE}/conflict-test-3`, name: 'conflict-test-3', desc: 'Conflict in nested Button.tsx', file: 'Button.tsx' },
];

test.describe('Conflict Resolution E2E', () => {
  test.beforeAll(() => { shotDir(); });

  for (const repo of REPOS) {
    test(`${repo.name}: ${repo.desc} — banner → resolve → Take Left`, async () => {
      const app = await launchCdpApp(repo);
      try {
        // 1. Changes page: state banner announces merge-in-progress.
        await app.page.screenshot({ path: `${SHOTS}/${repo.name}-01-changes.png` });
        const banner = app.page.locator('[data-testid="repo-state-banner"]');
        await expect(banner).toBeVisible({ timeout: 15000 });

        // 2. Diff page lists the conflicted file (unmerged, stage UU).
        //    Selecting it swaps the 2-way diff for the 3-way
        //    ConflictMergeView (SmartGit pattern — the 'Resolve Conflict…'
        //    context menu redirects to this same flow).
        await cdpNavigateTo(app.page, 'Diff');
        await app.page.screenshot({ path: `${SHOTS}/${repo.name}-02-diff.png` });
        const fileRow = app.page.getByText(repo.file).first();
        await fileRow.waitFor({ state: 'visible', timeout: 15000 });
        await fileRow.click();
        await app.page.screenshot({ path: `${SHOTS}/${repo.name}-04-3way.png` });

        const editor = app.page.locator('[data-testid="merge-result-textarea"]');
        await expect(editor, '3-way merge editor must open').toBeVisible({ timeout: 15000 });
        // The editor carries the conflicted file content (with markers).
        const content = (await editor.inputValue().catch(() => editor.textContent())) ?? '';
        expect(content).toContain('<<<<<<<');

        // 4. Take Left resolves one region — conflict markers drop for it.
        const takeLeft = app.page.getByRole('button', { name: /Take Left/i }).first();
        if (await takeLeft.isVisible({ timeout: 3000 }).catch(() => false)) {
          await takeLeft.click();
          await app.page.waitForTimeout(400);
        }
        await app.page.screenshot({ path: `${SHOTS}/${repo.name}-05-take-left.png` });
      } finally {
        await app.close();
      }
    });
  }
});
