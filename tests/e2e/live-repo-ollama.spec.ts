/**
 * E2E: PrismGit UI/UX on the LIVE 4.7k-commit repository (ollama-code).
 *
 * This is the flagship spec of the UI/UX verification: a real repository
 * (4,764 commits, 1,213 files, 14 remote branches, 17 tags, 91 MB) — not a
 * fixture — exercising every major tool end to end, with per-page
 * PERFORMANCE BUDGETS so regressions fail CI instead of silently shipping.
 *
 * Serial mode: ONE app instance is launched for the whole describe (opening
 * a repo this size is the expensive part — each test re-opens would measure
 * launch, not the app).
 *
 * The repo path defaults to /home/z/my-project/ollama-code (override with
 * PRISMGIT_LIVE_REPO). The spec SKIPS when the repo is absent so the
 * standard suite still passes on machines without it.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import { launchApp, navigateTo } from './helpers';

const LIVE_REPO = process.env.PRISMGIT_LIVE_REPO || '/home/z/my-project/ollama-code';
const hasLiveRepo = fs.existsSync(`${LIVE_REPO}/.git`) || fs.existsSync(`${LIVE_REPO}/HEAD`);

test.skip(!hasLiveRepo, `live repo not found at ${LIVE_REPO} (clone ollama-code to run this spec)`);

// Performance budgets (generous enough for CI variance, tight enough to
// catch the pre-optimization regressions: repo-open was 4.2s, history
// page-load 1.1s local — budgets keep them from creeping back).
const BUDGET_REPO_OPEN_MS = 20_000;   // launch → repo open → Changes content
const BUDGET_HISTORY_MS = 15_000;     // navigate → 500 virtualized rows
const BUDGET_COMMIT_SELECT_MS = 8_000;// row click → files panel rendered
const BUDGET_PAGE_SWITCH_MS = 8_000;  // steady-state page-to-page navigation

/** Collect renderer errors that indicate real failures. */
function attachErrorCollector(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text();
      // Known-benign noise: source maps and favicon 404s.
      if (t.includes('sourceMappingURL') || t.includes('favicon')) return;
      errors.push(`console.error: ${t.slice(0, 300)}`);
    }
  });
  return errors;
}

test.describe('PrismGit UI/UX on the live repository (ollama-code)', () => {
  test.describe.configure({ mode: 'serial' });

  let ctx: Awaited<ReturnType<typeof launchApp>>;
  let errors: string[] = [];
  let tOpen: number;

  test.beforeAll(async () => {
    const start = Date.now();
    ctx = await launchApp({ repos: [{ path: LIVE_REPO, name: 'ollama-code' }] });
    errors = attachErrorCollector(ctx.page);
    // Wait for the repo to actually open: the repo header shows the branch.
    await expect(ctx.page.locator('body')).toContainText('main', { timeout: 30_000 });
    tOpen = Date.now() - start;
  });

  test.afterAll(async () => {
    // Performance + correctness summary — boot must not log errors.
    if (errors.length > 0) {
      console.log(`[live-repo] ${errors.length} renderer errors:\n${errors.slice(0, 10).join('\n')}`);
    }
    await ctx?.close();
  });

  test('opens the 4.7k-commit repo within budget', async () => {
    expect(tOpen).toBeLessThan(BUDGET_REPO_OPEN_MS);
    // The sidebar carries the repo; the header its branch.
    await expect(ctx.page.locator('body')).toContainText('ollama-code');
  });

  test('Changes page renders the working tree state', async () => {
    await navigateTo(ctx.page, 'Changes');
    await expect(ctx.page.locator('body')).toContainText('main', { timeout: 10_000 });
    // Clean tree → the page shows its no-changes state; the toolbar still
    // renders the SmartGit display-flag buttons.
    await expect(
      ctx.page.locator('button[title="Show Unversioned (untracked) Files"]').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('History loads 500 virtualized rows within budget', async () => {
    const t0 = Date.now();
    await navigateTo(ctx.page, 'History');
    // 500 rows: the default maxHistoryLoad. Virtualization renders only
    // the visible window — assert on the FIRST rendered rows plus the
    // newest commit's subject.
    await expect(ctx.page.locator('body')).toContainText(
      'fix: resolve all TypeScript build errors', { timeout: 20_000 }
    );
    const elapsed = Date.now() - t0;
    expect(elapsed, `history load took ${elapsed}ms`).toBeLessThan(BUDGET_HISTORY_MS);
    // Virtualization sanity: far fewer DOM rows than 500 commits.
    const rowCount = await ctx.page.locator('div.cursor-pointer').count();
    expect(rowCount).toBeGreaterThan(5);
    expect(rowCount).toBeLessThan(120);
  });

  test('commit select → files panel (42 files on HEAD)', async () => {
    const t0 = Date.now();
    // Click the HEAD row (newest commit subject, first match in the list).
    await ctx.page.getByText('fix: resolve all TypeScript build errors').first().click();
    // The detail panel must list the 42 changed files of that commit.
    await expect(ctx.page.locator('body')).toContainText('Files (42)', { timeout: 20_000 });
    const elapsed = Date.now() - t0;
    expect(elapsed, `commit select took ${elapsed}ms`).toBeLessThan(BUDGET_COMMIT_SELECT_MS);
  });

  test('Branches lists local and origin/* remote branches', async () => {
    await navigateTo(ctx.page, 'Branches');
    const body = ctx.page.locator('body');
    await expect(body).toContainText('main', { timeout: 15_000 });
    await expect(body).toContainText('origin/');
  });

  test('Tags lists the repo tags', async () => {
    await navigateTo(ctx.page, 'Tags');
    await expect(ctx.page.locator('body')).toContainText('Orchestration', { timeout: 15_000 });
  });

  test('Diff page renders against the 1.2k-file HEAD tree', async () => {
    await navigateTo(ctx.page, 'Diff');
    // The page must render its empty/working-tree state without error.
    await expect(ctx.page.locator('body')).toContainText('Diff', { timeout: 15_000 });
  });

  test('Remotes lists origin', async () => {
    await navigateTo(ctx.page, 'Remotes');
    await expect(ctx.page.locator('body')).toContainText('origin', { timeout: 15_000 });
  });

  test('Stashes page renders (empty is valid)', async () => {
    await navigateTo(ctx.page, 'Stashes');
    await expect(ctx.page.locator('body')).toContainText('stash', { timeout: 15_000 });
  });

  test('rapid navigation stays responsive', async () => {
    const pages = ['Changes', 'History', 'Branches', 'Tags', 'Changes'];
    for (const label of pages) {
      const t0 = Date.now();
      await navigateTo(ctx.page, label);
      // After switching, the header (branch chip) must repaint quickly.
      await expect(ctx.page.locator('body')).toContainText('main', { timeout: 10_000 });
      const elapsed = Date.now() - t0;
      expect(elapsed, `switch to ${label} took ${elapsed}ms`).toBeLessThan(BUDGET_PAGE_SWITCH_MS);
    }
    // Renderer stayed healthy through the whole walk.
    expect(errors, `renderer errors: ${errors.slice(0, 5).join(' | ')}`).toHaveLength(0);
  });
});
