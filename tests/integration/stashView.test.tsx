/**
 * Integration: "View Stash" flow — StashesPage → diffRequest → DiffPage.
 *
 * REGRESSION: the old viewer ran `git diff stash^..stash`, which renders EMPTY
 * whenever the stash contains untracked files — git stores them ONLY in the
 * stash's THIRD parent (untracked-files commit), not in the stash tree. Real
 * reproduction (repo with alpha.txt modified, beta.txt modified, stashed.txt
 * untracked; `git stash push --include-untracked -m ... -- stashed.txt`):
 *
 *   git diff --name-status stash^..stash   →  (empty!)
 *   git diff-tree --root --name-status stash^3  →  A  stashed.txt
 *
 * The fix: stashFiles/stashFileRawDiff read BOTH parts. These tests assert
 * what the UI actually renders for both a tracked-only and an untracked stash.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const HASH = '415be634a696b2aa8354df05d02d41afebb7e91f';

const apiGitMock = vi.hoisted(() => ({
  raw: vi.fn(),
  branches: vi.fn().mockResolvedValue([]),
  log: vi.fn().mockResolvedValue([]),
  stashList: vi.fn(),
  stashFiles: vi.fn(),
  stashFileRawDiff: vi.fn(),
}));
const apiContextMenuMock = vi.hoisted(() => ({
  show: vi.fn().mockResolvedValue(undefined),
  onClick: vi.fn(() => () => {}),
}));

vi.mock('../../src/lib/api', () => ({
  api: { git: apiGitMock, app: {}, contextMenu: apiContextMenuMock },
}));

import { StashesPage } from '../../src/pages/StashesPage';
import { DiffPage } from '../../src/pages/DiffPage';
import { useSelectionStore } from '../../src/stores/selectionStore';
import { useRepositoryStore } from '../../src/stores/repositoryStore';

beforeEach(() => {
  vi.clearAllMocks();
  useSelectionStore.getState().clearAll();
  useRepositoryStore.setState({ currentRepo: { path: '/repo', name: 'repo' } as any });
  apiGitMock.stashList.mockResolvedValue([
    { index: 0, hash: HASH, hashAbbrev: HASH.slice(0, 7), message: 'On main: stash only alpha', date: '2026-01-01 12:00:00 +0000' },
  ]);
});

describe('View Stash → Diff request construction', () => {
  it('clicking the stash row sets diffRequest base=stash^ compare=stash stashHash and navigates to /diff', async () => {
    render(
      <MemoryRouter initialEntries={['/stashes']}>
        <StashesPage />
      </MemoryRouter>,
    );

    await screen.findByText('On main: stash only alpha');
    fireEvent.click(screen.getByText('On main: stash only alpha'));

    const req = useSelectionStore.getState().diffRequest;
    expect(req).not.toBeNull();
    expect(req!.baseRef).toBe(`${HASH}^`);
    expect(req!.compareRef).toBe(HASH);
    expect(req!.filePath).toBe('.');
    expect(req!.stashHash).toBe(HASH);
  });
});

describe('DiffPage stash viewer — tracked-only stash', () => {
  it('lists exactly the stashed file and renders its content via stashFiles/stashFileRawDiff', async () => {
    apiGitMock.stashFiles.mockResolvedValue([
      { path: 'alpha.txt', status: 'M', additions: 1, deletions: 1, binary: false, mode: '' },
    ]);
    apiGitMock.stashFileRawDiff.mockResolvedValue(`diff --git a/alpha.txt b/alpha.txt
--- a/alpha.txt
+++ b/alpha.txt
@@ -1,2 +1,2 @@
-alpha line1
+alpha line1 MODIFIED
 alpha line2
`);

    useSelectionStore.getState().setDiffRequest({
      baseRef: `${HASH}^`,
      compareRef: HASH,
      filePath: '.',
      stashHash: HASH,
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/diff']}>
        <DiffPage />
      </MemoryRouter>,
    );

    // File list comes from the stash anatomy API — exactly the stashed file
    await waitFor(() => {
      expect(screen.getAllByText('alpha.txt').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('beta.txt')).toBeNull();
    expect(apiGitMock.stashFiles).toHaveBeenCalledWith('/repo', HASH);

    // The content pane shows the stashed change (word-diff splits text into
    // multiple spans → assert on textContent, not on single elements)
    await waitFor(() => {
      expect(container.textContent).toContain('alpha line1 MODIFIED');
    });
  });

  it('clicking another file in the list loads its stashed diff', async () => {
    apiGitMock.stashFiles.mockResolvedValue([
      { path: 'alpha.txt', status: 'M', additions: 1, deletions: 1, binary: false, mode: '' },
      { path: 'beta.txt', status: 'M', additions: 1, deletions: 0, binary: false, mode: '' },
    ]);
    apiGitMock.stashFileRawDiff.mockImplementation(async (_p: string, _h: string, file: string) => {
      if (file === 'beta.txt') {
        return 'diff --git a/beta.txt b/beta.txt\n--- a/beta.txt\n+++ b/beta.txt\n@@ -1 +1,2 @@\n beta line1\n+beta line2 NEW\n';
      }
      return 'diff --git a/alpha.txt b/alpha.txt\n--- a/alpha.txt\n+++ b/alpha.txt\n@@ -1 +1 @@\n-alpha line1\n+alpha line1 MODIFIED\n';
    });

    useSelectionStore.getState().setDiffRequest({
      baseRef: `${HASH}^`,
      compareRef: HASH,
      filePath: '.',
      stashHash: HASH,
    });

    render(
      <MemoryRouter initialEntries={['/diff']}>
        <DiffPage />
      </MemoryRouter>,
    );

    await screen.findByText('beta.txt');
    fireEvent.click(screen.getByText('beta.txt'));

    expect(apiGitMock.stashFileRawDiff).toHaveBeenCalledWith('/repo', HASH, 'beta.txt');
    await waitFor(() => {
      expect(document.body.textContent).toContain('beta line2 NEW');
    });
  });
});

describe('DiffPage stash viewer — REGRESSION: stash with UNTRACKED files (was empty)', () => {
  it('lists the untracked file (A status from stash^3) and renders its stashed content', async () => {
    // Real git: stash contains ONLY an untracked file → stash^..stash is EMPTY.
    // stashFiles must surface it from the third parent with status A.
    apiGitMock.stashFiles.mockResolvedValue([
      { path: 'stashed.txt', status: 'A', additions: 1, deletions: 0, binary: false, mode: '' },
    ]);
    apiGitMock.stashFileRawDiff.mockResolvedValue(`diff --git a/stashed.txt b/stashed.txt
new file mode 100644
--- /dev/null
+++ b/stashed.txt
@@ -0,0 +1 @@
+stashed content
`);

    useSelectionStore.getState().setDiffRequest({
      baseRef: `${HASH}^`,
      compareRef: HASH,
      filePath: '.',
      stashHash: HASH,
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/diff']}>
        <DiffPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('stashed.txt').length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(container.textContent).toContain('stashed content');
    });
    // The old broken path (plain two-ref diff) must not be used at all
    expect(apiGitMock.raw).not.toHaveBeenCalledWith('/repo', expect.arrayContaining([`${HASH}^..${HASH}`]));
  });
});
