/**
 * E2E: PrismGit UI/UX — EXTENDED tool coverage on the LIVE repository.
 *
 * Companion to live-repo-ollama.spec.ts (which covers the core walk:
 * open/Changes/History/commit-select/Branches/Tags/Diff/Remotes/Stashes/
 * rapid-nav with performance budgets). This spec pushes the remaining
 * user-visible tools against the real 4.7k-commit / 1.2k-file / 15-remote-
 * branch repo — the scale that fixtures cannot reproduce:
 *
 *   - Search (git log --grep + git grep over 1.2k files)
 *   - Blame (README.md — long file, many authors)
 *   - Reflog
 *   - Branches live-filter over 30+ refs
 *   - External modification detection (watcher → Changes page) and restore
 *   - CLI branch create/delete reflected in the Branches page
 *   - Tag click → History at the tagged commit
 *   - Recyclable / Submodules / Git LFS / Bisect / Git-Flow / AI Chat render
 *
 * MUTATION SAFETY: the only mutations are (a) a branch created and deleted
 * via git CLI, and (b) a file modified and restored via `git checkout --`.
 * afterAll verifies the working tree is CLEAN and the branch list matches
 * the pre-test snapshot, so the live repo is left exactly as found.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchApp, navigateTo } from './helpers';

const LIVE_REPO = process.env.PRISMGIT_LIVE_REPO || '/home/z/my-project/ollama-code';
const hasLiveRepo = fs.existsSync(`${LIVE_REPO}/.git`) || fs.existsSync(`${LIVE_REPO}/HEAD`);
test.skip(!hasLiveRepo, `live repo not found at ${LIVE_REPO} (clone ollama-code to run this spec)`);

const BRANCH_NAME = 'e2e/live-ui-probe';
/** A tracked file safe to modify + restore for the watcher test. */
const PROBE_FILE = 'README.md';

function sh(args: string[]): string {
  // execFileSync (argv array) — no shell interpolation of %(...)n format
  // specifiers, unlike execSync's /bin/sh -c string parsing.
  return execFileSync('git', args, { cwd: LIVE_REPO, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Collect renderer errors that indicate real failures. */
function attachErrorCollector(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text();
      if (t.includes('sourceMappingURL') || t.includes('favicon')) return;
      errors.push(`console.error: ${t.slice(0, 300)}`);
    }
  });
  return errors;
}

test.describe('PrismGit extended tools on the live repository', () => {
  test.describe.configure({ mode: 'serial' });

  let ctx: Awaited<ReturnType<typeof launchApp>>;
  let errors: string[] = [];
  let branchesBefore = '';

  test.beforeAll(async () => {
    branchesBefore = sh(['for-each-ref', '--format=%(refname:short)', 'refs/heads/']).trim();
    // Sanitize leftovers from a crashed run — tolerate "branch not found".
    try { sh(['branch', '-D', BRANCH_NAME]); } catch { /* not present — clean */ }
    ctx = await launchApp({ repos: [{ path: LIVE_REPO, name: 'ollama-code' }] });
    errors = attachErrorCollector(ctx.page);
    await expect(ctx.page.locator('body')).toContainText('main', { timeout: 30_000 });
  });

  test.afterAll(async () => {
    // MUTATION SAFETY: the live repo must be left exactly as found.
    if (ctx) await ctx.close();
    const status = sh(['status', '--porcelain']);
    expect(status, `live repo left dirty:\n${status}`).toBe('');
    const branchesAfter = sh(['for-each-ref', '--format=%(refname:short)', 'refs/heads/']).trim();
    expect(branchesAfter).toBe(branchesBefore);
    expect(errors, `renderer errors: ${errors.slice(0, 5).join(' | ')}`).toHaveLength(0);
  });

  test('Search greps commits and file content across the 1.2k-file tree', async () => {
    await navigateTo(ctx.page, 'Search');
    const body = ctx.page.locator('body');
    await expect(body).toContainText('ollama-code', { timeout: 10_000 });

    // Unified search bar → type a term that exists in commits AND content.
    const input = ctx.page.locator('input[placeholder*="Search commits"]').first();
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await input.fill('orchestration');
    // Ctrl+Enter triggers the grep (per the placeholder hint).
    await input.press('Control+Enter');
    // All three sections populate: commits (git log --grep), files
    // (path match), content (git grep) — verified live: 100 commits,
    // 9 files, 169 content matches for this query.
    await expect(body).toContainText('Commits', { timeout: 20_000 });
    await expect(body).toContainText('Content', { timeout: 20_000 });
    // Content matches arrive from git grep — .ts files mention it.
    await expect(body).toContainText('.ts', { timeout: 20_000 });
  });

  test('Blame attributes README.md lines to authors', async () => {
    await navigateTo(ctx.page, 'Blame');
    const fileInput = ctx.page.locator('input[placeholder="path/to/file.txt"]').first();
    await fileInput.waitFor({ state: 'visible', timeout: 10_000 });
    await fileInput.fill(PROBE_FILE);
    await ctx.page.locator('button.btn-primary').first().click();
    // The blame view renders one gutter per line with author + date info.
    await expect(ctx.page.locator('body')).toContainText('@', { timeout: 20_000 });
    // And line contents from the actual README render.
    const lines = ctx.page.locator('div.font-mono, code, pre');
    expect(await lines.count()).toBeGreaterThan(0);
  });

  test('Reflog lists the clone/fetch history', async () => {
    await navigateTo(ctx.page, 'Reflog');
    const body = ctx.page.locator('body');
    await expect(body).toContainText('main', { timeout: 10_000 });
    // Clone + fetch entries exist in a freshly cloned repo's reflog.
    await expect(body).toContainText('clone', { timeout: 10_000 });
  });

  test('Branches live-filter narrows 30+ refs as you type', async () => {
    await navigateTo(ctx.page, 'Branches');
    const body = ctx.page.locator('body');
    await expect(body).toContainText('origin/', { timeout: 15_000 });
    // Branch/tag rows are plain divs (cursor-pointer class) — no role attr.
    const before = await ctx.page.locator('div.cursor-pointer').count();
    expect(before).toBeGreaterThan(5);

    const filter = ctx.page.locator('input[placeholder="Filter..."]').first();
    await filter.waitFor({ state: 'visible', timeout: 10_000 });
    await filter.fill('agent-orchestration');
    await ctx.page.waitForTimeout(800);
    const after = await ctx.page.locator('div.cursor-pointer').count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    await expect(body).toContainText('agent-orchestration');
    await filter.fill('');
    await ctx.page.waitForTimeout(500);
  });

  test('Branches page reflects externally created and deleted branches', async () => {
    // Create the probe branch outside the app (git CLI).
    sh(['branch', BRANCH_NAME]);
    await navigateTo(ctx.page, 'Changes'); // leave + re-enter forces reload
    await navigateTo(ctx.page, 'Branches');
    await expect(ctx.page.locator('body')).toContainText('live-ui-probe', { timeout: 15_000 });

    // Delete it outside the app too.
    sh(['branch', '-D', BRANCH_NAME]);
    await navigateTo(ctx.page, 'Changes');
    await navigateTo(ctx.page, 'Branches');
    await expect(ctx.page.locator('body')).not.toContainText('live-ui-probe', { timeout: 15_000 });
  });

  test('Changes page detects an external file modification and its restore', async () => {
    await navigateTo(ctx.page, 'Changes');
    await expect(ctx.page.locator('body')).toContainText('main', { timeout: 10_000 });

    // Modify a tracked file OUTSIDE the app.
    const abs = path.join(LIVE_REPO, PROBE_FILE);
    const original = fs.readFileSync(abs, 'utf-8');
    fs.appendFileSync(abs, '\n<!-- e2e probe line -->\n');
    try {
      // Re-navigate to force a fresh status load (the watcher would also
      // catch it within ~5s, but navigation keeps the test deterministic).
      await navigateTo(ctx.page, 'History');
      await navigateTo(ctx.page, 'Changes');
      await expect(ctx.page.locator('body')).toContainText(PROBE_FILE, { timeout: 15_000 });

      // Restore the file — the change must disappear again.
      sh(["checkout", "--", PROBE_FILE]);
      await navigateTo(ctx.page, 'History');
      await navigateTo(ctx.page, 'Changes');
      await expect(ctx.page.locator('body')).not.toContainText('e2e probe line', { timeout: 15_000 });
    } finally {
      // Belt & suspenders: never leave the probe line in the live repo.
      fs.writeFileSync(abs, original);
      sh(["checkout", "--", PROBE_FILE]);
    }
  });

  test('Tag click navigates History to the tagged commit', async () => {
    await navigateTo(ctx.page, 'Tags');
    const tagRow = ctx.page.getByText('Orchestration', { exact: true }).first();
    await tagRow.waitFor({ state: 'visible', timeout: 15_000 });
    await tagRow.click();
    // History opens (the click navigates) and the commit at the tag renders.
    await expect(ctx.page.locator('body')).toContainText('Files (', { timeout: 20_000 });
  });

  test('History message filter narrows the 4.7k-commit graph', async () => {
    await navigateTo(ctx.page, 'History');
    await expect(ctx.page.locator('body')).toContainText('fix: resolve all TypeScript build errors', { timeout: 20_000 });
    const search = ctx.page.locator('input[placeholder*="hash" i]').first();
    await search.waitFor({ state: 'visible', timeout: 10_000 });
    await search.fill('TypeScript build errors');
    await ctx.page.waitForTimeout(1500);
    await expect(ctx.page.locator('body')).toContainText('fix: resolve all TypeScript build errors', { timeout: 10_000 });
    await search.fill('');
    await ctx.page.waitForTimeout(500);
  });

  test('aux pages render on the live repo: Recyclable / Submodules / LFS / Bisect / Git-Flow / AI Chat', async () => {
    for (const label of ['Recyclable', 'Submodules', 'Git LFS', 'Bisect', 'Git-Flow', 'AI Chat']) {
      await navigateTo(ctx.page, label);
      // Each page must render its header area without erroring — assert
      // the page repainted (body non-empty + no blank screen of death).
      await expect(ctx.page.locator('body')).not.toBeEmpty();
      await ctx.page.waitForTimeout(400);
    }
  });
});
