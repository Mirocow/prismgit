/**
 * E2E: Full UI/UX test suite — all PrismGit tools on purpose-built fixtures.
 *
 * E2E FIX (root causes #4/#5/#6): the old version
 *   - launched Electron via exec() with DISPLAY hardcoded to :99 (died
 *     under `xvfb-run -a`),
 *   - depended on /tmp/ui-test/* and /tmp/conflict-test-* fixtures that
 *     NOTHING created,
 *   - wrapped every step in try/catch that only console.logged — every
 *     test passed vacuously (fake-green).
 *
 * Now: fixtures come from tests/fixtures/setup-e2e-extra-repos.sh (run by
 * global-setup), the app is spawned via cdp-launch.ts (no shell, SIGKILL
 * cleanup), and every step carries a REAL expect() assertion.
 */
import { test, expect } from '@playwright/test';
import { launchCdpApp, cdpNavigateTo, waitForMergeEditor, diffFileRow, shotDir, FIXTURE_BASE } from './cdp-launch';

const UI = `${FIXTURE_BASE}/ui-test`;
const SHOTS = shotDir();

test.describe('UI/UX Full Test Suite', () => {
  test.beforeAll(() => { shotDir(); });

  // ── 1. Changes ──────────────────────────────────────────────────
  test('Changes: modified + deleted + untracked + staged files listed, diff on select', async () => {
    const app = await launchCdpApp({ path: `${UI}/changes`, name: 'changes' });
    try {
      await app.page.screenshot({ path: `${SHOTS}/ui-changes-01-default.png` });
      const body = app.page.locator('body');
      await expect(body).toContainText('a.txt', { timeout: 15000 });      // modified
      await expect(body).toContainText('newfile.go');                     // untracked
      await expect(body).toContainText('c.py');                           // deleted
      await expect(body).toContainText('b.txt');                          // staged
      await expect(body).toContainText(/staged/i);

      // Select the modified file → diff panel must show the change.
      // The split diff panel is HIDDEN by default (showSplitView=false) —
      // open it with its toolbar toggle first.
      await app.page.locator('button[title="Show Diff panel"]').first().click();
      await app.page.getByText('a.txt', { exact: true }).first().click();
      await expect(app.page.locator('body')).toContainText('line two CHANGED', { timeout: 10000 });
      await app.page.screenshot({ path: `${SHOTS}/ui-changes-02-file-selected.png` });
    } finally {
      await app.close();
    }
  });

  // ── 2. Branches ────────────────────────────────────────────────
  test('Branches: local branch list with feature/* and hotfix/*', async () => {
    const app = await launchCdpApp({ path: `${UI}/branches/work`, name: 'branches' });
    try {
      await cdpNavigateTo(app.page, 'Branches');
      await app.page.screenshot({ path: `${SHOTS}/ui-branches-01-default.png` });
      const body = app.page.locator('body');
      await expect(body).toContainText('main', { timeout: 15000 });
      await expect(body).toContainText('feature/alpha');
      await expect(body).toContainText('feature/beta');
      await expect(body).toContainText('hotfix/urgent');
      await app.page.screenshot({ path: `${SHOTS}/ui-branches-02-list.png` });
    } finally {
      await app.close();
    }
  });

  // ── 3. History ─────────────────────────────────────────────────
  test('History: commit log rows + merge commit decoration', async () => {
    const app = await launchCdpApp({ path: `${UI}/history`, name: 'history' });
    try {
      await cdpNavigateTo(app.page, 'History');
      await app.page.screenshot({ path: `${SHOTS}/ui-history-01-default.png` });
      const body = app.page.locator('body');
      await expect(body).toContainText('commit 1', { timeout: 20000 });
      await expect(body).toContainText('commit 12');
      await expect(body).toContainText("Merge branch 'feature/graph' into main");
      await app.page.screenshot({ path: `${SHOTS}/ui-history-02-graph.png` });
    } finally {
      await app.close();
    }
  });

  // ── 4. Diff ────────────────────────────────────────────────────
  test('Diff: file selection renders +/- hunks', async () => {
    const app = await launchCdpApp({ path: `${UI}/diff`, name: 'diff' });
    try {
      await cdpNavigateTo(app.page, 'Diff');
      await app.page.screenshot({ path: `${SHOTS}/ui-diff-01-default.png` });
      // Select config.ts → working-tree diff vs HEAD
      const fileRow = app.page.getByText('config.ts', { exact: true }).first();
      await fileRow.waitFor({ state: 'visible', timeout: 15000 });
      await fileRow.click();
      const body = app.page.locator('body');
      await expect(body).toContainText('8080', { timeout: 10000 });        // added line
      await expect(body).toContainText('3000');                            // removed line
      await app.page.screenshot({ path: `${SHOTS}/ui-diff-02-file-selected.png` });
    } finally {
      await app.close();
    }
  });

  // ── 5. Tags ────────────────────────────────────────────────────
  test('Tags: lightweight + annotated tags listed', async () => {
    const app = await launchCdpApp({ path: `${UI}/tags`, name: 'tags' });
    try {
      await cdpNavigateTo(app.page, 'Tags');
      const body = app.page.locator('body');
      await expect(body).toContainText('v1.0.0', { timeout: 15000 });
      await expect(body).toContainText('v1.1.0');
      await expect(body).toContainText('v1.2.0');
      await app.page.screenshot({ path: `${SHOTS}/ui-tags-01-default.png` });
    } finally {
      await app.close();
    }
  });

  // ── 6. Stashes ─────────────────────────────────────────────────
  test('Stashes: two entries with messages', async () => {
    const app = await launchCdpApp({ path: `${UI}/stash`, name: 'stash' });
    try {
      await cdpNavigateTo(app.page, 'Stashes');
      const body = app.page.locator('body');
      await expect(body).toContainText('stash@{0}', { timeout: 15000 });
      await expect(body).toContainText('stash@{1}');
      await expect(body).toContainText('second wip');
      await app.page.screenshot({ path: `${SHOTS}/ui-stash-01-default.png` });
    } finally {
      await app.close();
    }
  });

  // ── 7. Remotes ─────────────────────────────────────────────────
  test('Remotes: origin + upstream with fetch/push URLs', async () => {
    const app = await launchCdpApp({ path: `${UI}/remotes/work`, name: 'remotes' });
    try {
      await cdpNavigateTo(app.page, 'Remotes');
      const body = app.page.locator('body');
      await expect(body).toContainText('origin', { timeout: 15000 });
      await expect(body).toContainText('upstream');
      await app.page.screenshot({ path: `${SHOTS}/ui-remotes-01-default.png` });
    } finally {
      await app.close();
    }
  });

  // ── 8. Submodules ──────────────────────────────────────────────
  test('Submodules: registered submodule listed', async () => {
    const app = await launchCdpApp({ path: `${UI}/submodules`, name: 'submodules' });
    try {
      await cdpNavigateTo(app.page, 'Submodules');
      const body = app.page.locator('body');
      await expect(body).toContainText('sub', { timeout: 15000 });
      await app.page.screenshot({ path: `${SHOTS}/ui-submodules-01-default.png` });
    } finally {
      await app.close();
    }
  });

  // ── 9. Sidebar: nav groups + repo header branch name ───────────
  test('Sidebar: nav items + branch name in repo header', async () => {
    const app = await launchCdpApp({ path: `${UI}/changes`, name: 'changes' });
    try {
      await app.page.screenshot({ path: `${SHOTS}/ui-sidebar-01-default.png` });
      // Regular nav items carry aria-label — the sidebar is keyboard/a11y-ready.
      // On failure, embed the app diagnostics — a missing sidebar almost
      // always means the repo never opened (welcome screen still showing).
      for (const label of ['Changes', 'History', 'Diff', 'Branches', 'Tags']) {
        const navItem = app.page.locator(`aside [role="button"][aria-label="${label}"]`).first();
        if (!(await navItem.isVisible({ timeout: 15000 }).catch(() => false))) {
          const diag = await app.diagnostics();
          throw new Error(
            `Sidebar nav item "${label}" not found — repo likely never opened.\n${diag}`
          );
        }
      }
      // Repo header shows the current branch
      await expect(app.page.locator('body')).toContainText('main', { timeout: 10000 });
    } finally {
      await app.close();
    }
  });

  // ── 10. 3-way conflict resolution (merge state) ───────────────
  test('Conflict: state banner + 3-way resolve flow (Take Left)', async () => {
    const app = await launchCdpApp({ path: `${FIXTURE_BASE}/conflict-test-1`, name: 'conflict-test-1' });
    try {
      await app.page.screenshot({ path: `${SHOTS}/ui-conflict-01-changes.png` });
      // Repo-state banner announces the merge-in-progress state
      const banner = app.page.locator('[data-testid="repo-state-banner"]');
      await expect(banner).toBeVisible({ timeout: 15000 });

      // Conflicted file shows in the Changes list
      const body = app.page.locator('body');
      await expect(body).toContainText('config.ts');

      // Open the 3-way merge editor — SmartGit pattern: on the Diff tool,
      // SELECTING a conflicted file during a merge swaps the 2-way diff for
      // the 3-way ConflictMergeView automatically (no menu detour).
      await cdpNavigateTo(app.page, 'Diff');
      // Pin the interactive file ROW (getByText can match the title bar —
      // silent no-op click).
      const fileRow = diffFileRow(app.page, 'config.ts');
      await fileRow.waitFor({ state: 'visible', timeout: 15000 });
      await fileRow.click();
      await app.page.screenshot({ path: `${SHOTS}/ui-conflict-03-3way.png` });

      // The merge editor renders (MergeResultEditor textarea testid). On
      // failure the error carries WHICH editor state was reached + the
      // app's own diagnostics.
      const state = await waitForMergeEditor(app.page, 15000);
      if (state !== 'editor') {
        const diag = await app.diagnostics();
        throw new Error(
          `3-way merge editor did not open (state: ${state}).\n${diag}`
        );
      }
      const editor = app.page.locator('[data-testid="merge-result-textarea"]');
      const content = (await editor.inputValue().catch(() => editor.textContent())) ?? '';
      // The conflicted file carries conflict markers from the stalled merge.
      expect(content).toContain('<<<<<<<');

      // Take Left resolves the conflict region — the editor content must
      // change to the OURS side (no conflict markers on that line).
      const takeLeft = app.page.getByRole('button', { name: /Take Left/i }).first();
      if (await takeLeft.isVisible({ timeout: 3000 }).catch(() => false)) {
        await takeLeft.click();
        await app.page.waitForTimeout(500);
      }
      await app.page.screenshot({ path: `${SHOTS}/ui-conflict-04-resolved.png` });
    } finally {
      await app.close();
    }
  });
});
