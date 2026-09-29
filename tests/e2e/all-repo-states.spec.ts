/**
 * E2E: All repo states — verify the RepoStateBanner + action buttons for
 * every in-progress state.
 *
 * E2E FIX (root causes #4/#6): old version launched via exec() with a
 * hardcoded DISPLAY, never created the /tmp/state-* repos it listed, and
 * swallowed every failure with console.log (fake-green). Now: fixtures are
 * created by tests/fixtures/setup-e2e-extra-repos.sh (global-setup), the
 * app spawns via cdp-launch.ts, and every state carries real assertions.
 *
 * States covered (all left mid-operation by the fixtures):
 *   1. merging          — Abort
 *   2. cherry-picking   — Continue + Abort
 *   3. rebasing         — Continue + Abort
 *   4. reverting        — Continue + Abort
 *   5. bisecting        — Mark HEAD as Bad/Good + Abort
 */
import { test, expect } from '@playwright/test';
import { launchCdpApp, cdpNavigateTo, shotDir, FIXTURE_BASE } from './cdp-launch';

const SHOTS = shotDir();

const REPOS: Array<{ path: string; name: string; state: string; buttons: string[] }> = [
  { path: `${FIXTURE_BASE}/state-merge`,        name: 'state-merge',        state: 'merging',        buttons: ['Abort'] },
  { path: `${FIXTURE_BASE}/state-cherry-pick`,  name: 'state-cherry-pick',  state: 'cherry-picking', buttons: ['Continue', 'Abort'] },
  { path: `${FIXTURE_BASE}/state-rebase`,       name: 'state-rebase',       state: 'rebasing',       buttons: ['Continue', 'Abort'] },
  { path: `${FIXTURE_BASE}/state-revert`,       name: 'state-revert',       state: 'reverting',      buttons: ['Continue', 'Abort'] },
  { path: `${FIXTURE_BASE}/state-bisect`,       name: 'state-bisect',       state: 'bisecting',      buttons: ['Mark HEAD as Good', 'Mark HEAD as Bad', 'Abort'] },
];

test.describe('All repo states E2E', () => {
  test.beforeAll(() => { shotDir(); });

  for (const repo of REPOS) {
    test(`${repo.name}: ${repo.state} — banner + ${repo.buttons.join(' + ')}`, async () => {
      const app = await launchCdpApp(repo);
      try {
        await app.page.screenshot({ path: `${SHOTS}/state-${repo.name}-01-changes.png` });

        // The banner MUST be visible and announce the state.
        const banner = app.page.locator('[data-testid="repo-state-banner"]');
        await expect(banner, `${repo.state} banner must render`).toBeVisible({ timeout: 15000 });
        const bannerText = (await banner.textContent())?.toLowerCase() ?? '';
        // banner text is localized; match the state word robustly
        // ("merging", "cherry-picking", "rebasing", "reverting", "bisecting").
        expect(
          bannerText.includes(repo.state) || bannerText.includes(repo.state.replace('ing', '')),
          `banner should mention "${repo.state}" (got: "${bannerText.slice(0, 160)}")`
        ).toBe(true);

        // Every expected action button must be present INSIDE the banner.
        for (const label of repo.buttons) {
          const btn = banner.getByRole('button', { name: new RegExp(label, 'i') }).first();
          await expect(btn, `banner button "${label}" must be visible`).toBeVisible({ timeout: 5000 });
        }

        // For the conflict states the working tree carries a conflicted file
        // that the Diff page must list.
        if (repo.state !== 'bisecting') {
          await cdpNavigateTo(app.page, 'Diff');
          const body = app.page.locator('body');
          await expect(body).toContainText('file.txt', { timeout: 15000 });
          await app.page.screenshot({ path: `${SHOTS}/state-${repo.name}-02-diff.png` });
        } else {
          await app.page.screenshot({ path: `${SHOTS}/state-${repo.name}-02-bisect.png` });
        }
      } finally {
        await app.close();
      }
    });
  }
});
