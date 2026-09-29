/**
 * Component test for the group squash-to-branch integration in PRReview's
 * Commits tab — the Pull Requests / Reviews surface the user asked for
 * ("также этот функционал должен быть у Pull Request, Reviews").
 *
 * Verifies the full chain with the provider APIs mocked:
 *   1. Commits tab rows support History-style multi-selection
 *      (plain click = anchor, Shift+click = range).
 *   2. A 2+ selection shows the sticky action bar ("Commits selected: N").
 *   3. "Squash to branch…" checks that the PR commits exist locally
 *      (rev-parse) and then opens SquashToBranchDialog — WITHOUT fetching
 *      when the objects are already present.
 *   4. Submitting the dialog calls api.git.squashToBranch with the hashes
 *      OLDEST → NEWEST (the provider API order) and the new-branch target.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PRReview } from '../../src/components/PRReview';
import type { SelectedPR } from '../../src/stores/providerStore';

const mockGetPullRequest = vi.fn();
const mockListPRFiles = vi.fn();
const mockListPRIssueComments = vi.fn();
const mockListPRCommits = vi.fn();
const mockGetCommitFiles = vi.fn();
const mockGetMergeRequest = vi.fn();
const mockListMRChanges = vi.fn();
const mockListMRNotes = vi.fn();
const mockListMRCommits = vi.fn();
const mockGetProjectByPath = vi.fn();
const mockRaw = vi.fn();
const mockFetchRef = vi.fn();
const mockBranches = vi.fn();
const mockSquashToBranch = vi.fn();
const mockRefreshStatus = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      raw: (...args: unknown[]) => mockRaw(...args),
      fetchRef: (...args: unknown[]) => mockFetchRef(...args),
      branches: (...args: unknown[]) => mockBranches(...args),
      squashToBranch: (...args: unknown[]) => mockSquashToBranch(...args),
    },
    github: {
      getPullRequest: (...args: unknown[]) => mockGetPullRequest(...args),
      listPRFiles: (...args: unknown[]) => mockListPRFiles(...args),
      listPRIssueComments: (...args: unknown[]) => mockListPRIssueComments(...args),
      listPRCommits: (...args: unknown[]) => mockListPRCommits(...args),
      getCommitFiles: (...args: unknown[]) => mockGetCommitFiles(...args),
    },
    gitlab: {
      getMergeRequest: (...args: unknown[]) => mockGetMergeRequest(...args),
      listMRChanges: (...args: unknown[]) => mockListMRChanges(...args),
      listMRNotes: (...args: unknown[]) => mockListMRNotes(...args),
      listMRCommits: (...args: unknown[]) => mockListMRCommits(...args),
      getProjectByPath: (...args: unknown[]) => mockGetProjectByPath(...args),
    },
    app: { openExternal: vi.fn() },
    contextMenu: {
      show: vi.fn().mockResolvedValue(undefined),
      onClick: vi.fn(() => () => {}),
    },
  },
}));

vi.mock('../../src/stores/toastStore', () => ({
  useToastActions: () => ({
    error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn(), show: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: (selector?: (s: unknown) => unknown) => {
    const state = { currentRepo: { path: '/test/repo', name: 'repo' } };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../src/stores/gitStore', () => ({
  useGitStore: (selector?: (s: unknown) => unknown) => {
    const state = { refreshStatus: mockRefreshStatus, status: null };
    return selector ? selector(state) : state;
  },
}));

const PR: SelectedPR = {
  number: 9,
  title: 'Add feature X',
  state: 'open',
  html_url: 'https://github.com/own/repo/pull/9',
  author: { login: 'author' },
  head: { ref: 'feature/x', sha: '' },
  base: { ref: 'main', sha: '' },
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const SHAS = [
  '1111111111111111111111111111111111111111',
  '2222222222222222222222222222222222222222',
  '3333333333333333333333333333333333333333',
  '4444444444444444444444444444444444444444',
];

const prCommit = (sha: string, msg: string) => ({
  sha,
  commit: {
    message: msg,
    author: { name: 'Dev', email: 'dev@x.io', date: '2026-09-01T10:00:00Z' },
  },
  author: { login: 'dev' },
  html_url: `https://github.com/own/repo/c/${sha}`,
});

function renderReview(provider: 'github' | 'gitlab' = 'github') {
  return render(
    <PRReview
      pr={PR}
      owner="own"
      repo="repo"
      provider={provider}
      onActionComplete={() => {}}
      onClose={() => {} }
    />,
  );
}

async function openCommitsTab() {
  // The Commits tab button carries the commit-count badge ("Commits4")
  // once the provider load finishes.
  const tab = () => screen.getByRole('button', { name: /Commits\s*4/ });
  await waitFor(() => expect(tab()).toBeTruthy());
  fireEvent.click(tab());
  await waitFor(() => {
    expect(screen.getByText('feat: pr one')).toBeTruthy();
  });
}

describe('PRReview — Commits tab group squash-to-branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPullRequest.mockResolvedValue({
      number: 9, title: 'Add feature X', state: 'open',
      html_url: PR.html_url, user: { login: 'author' },
      head: { ref: 'feature/x', sha: '' }, base: { ref: 'main', sha: '' },
      created_at: PR.created_at, updated_at: PR.updated_at,
      body: '', commits: 4, comments: 0,
    });
    mockListPRFiles.mockResolvedValue([]);
    mockListPRIssueComments.mockResolvedValue([]);
    mockListPRCommits.mockResolvedValue([
      prCommit(SHAS[0], 'feat: pr one'),
      prCommit(SHAS[1], 'feat: pr two'),
      prCommit(SHAS[2], 'feat: pr three'),
      prCommit(SHAS[3], 'feat: pr four'),
    ]);
    mockGetCommitFiles.mockResolvedValue([]);
    // All commit objects exist locally → the rev-parse probe succeeds.
    mockRaw.mockImplementation((_p: string, args: string[]) =>
      Promise.resolve(args[3] ? `${args[3].replace('^{commit}', '')}\n` : ''));
    mockBranches.mockResolvedValue([
      { name: 'main', current: true, remote: false },
      { name: 'dev', current: false, remote: false },
    ]);
    mockSquashToBranch.mockResolvedValue({ status: 'ok', branch: 'release-x', commit: 'ffff' });
  });

  it('multi-selects a range (Shift+click), shows the action bar, opens the dialog, and squashes OLDEST→NEWEST', async () => {
    renderReview();
    await openCommitsTab();

    // Plain click anchors on the FIRST (oldest) commit row.
    fireEvent.click(screen.getByText('feat: pr one'));
    // Shift+click the LAST row → the whole 4-commit range is selected.
    fireEvent.click(screen.getByText('feat: pr four'), { shiftKey: true });

    await waitFor(() => {
      expect(screen.getByText('Commits selected: 4')).toBeTruthy();
    });

    // Trigger the group action. TWO buttons read "Squash to branch…": the
    // header one (whole PR) and the action-bar one (selected group) — the
    // action bar renders later in the DOM, so take the LAST match.
    const squashButtons = screen.getAllByRole('button', { name: 'Squash to branch…' });
    fireEvent.click(squashButtons[squashButtons.length - 1]);

    // The dialog opens — no fetch needed because all objects were present.
    await waitFor(() => {
      expect(screen.getByText('Squash commits to a branch')).toBeTruthy();
    });
    expect(mockFetchRef).not.toHaveBeenCalled();

    // Fill the new-branch name (targetKind 'new' is the default).
    fireEvent.change(screen.getByPlaceholderText('branch-name'), {
      target: { value: 'release-x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Squash 4 commits' }));

    await waitFor(() => {
      expect(mockSquashToBranch).toHaveBeenCalledTimes(1);
    });
    const [repoPath, params] = mockSquashToBranch.mock.calls[0];
    expect(repoPath).toBe('/test/repo');
    expect(params.commits).toEqual(SHAS); // provider order = OLDEST → NEWEST
    expect(params.target).toEqual({ kind: 'new', name: 'release-x', base: 'range-base' });
    expect(params.keepAuthor).toBe(true);
    expect(params.proceedOnConflict).toBe(false);

    // The dialog refreshes the repo state and closes itself.
    await waitFor(() => {
      expect(mockRefreshStatus).toHaveBeenCalledWith('/test/repo');
      expect(screen.queryByText('Squash commits to a branch')).toBeNull();
    });
  });

  it('fetches the PR head ref when commit objects are missing locally', async () => {
    // First probe round: nothing resolves → ensureCommitsLocal fetches.
    // The group is {two, three} (2 SHAs probed before the fetch).
    let probes = 0;
    mockRaw.mockImplementation((_p: string, args: string[]) => {
      probes++;
      const sha = args[3]?.replace('^{commit}', '') ?? '';
      return Promise.resolve(probes <= 2 ? '' : `${sha}\n`);
    });
    mockFetchRef.mockResolvedValue(undefined);

    renderReview();
    await openCommitsTab();

    fireEvent.click(screen.getByText('feat: pr one'));
    fireEvent.click(screen.getByText('feat: pr two'), { ctrlKey: true });
    fireEvent.click(screen.getByText('feat: pr three'), { ctrlKey: true });

    // Plain click RESETS the group (anchor only), so the group = {two, three}.
    await waitFor(() => {
      expect(screen.getByText('Commits selected: 2')).toBeTruthy();
    });
    const squashButtons = screen.getAllByRole('button', { name: 'Squash to branch…' });
    fireEvent.click(squashButtons[squashButtons.length - 1]);

    await waitFor(() => {
      // refs/pull/9/head on the default remote — the GitHub canonical PR ref.
      expect(mockFetchRef).toHaveBeenCalledWith('/test/repo', 'origin', 'refs/pull/9/head');
      expect(screen.getByText('Squash commits to a branch')).toBeTruthy();
    });
  });

  it('plain click resets the group and keeps the single-commit diff view', async () => {
    renderReview();
    await openCommitsTab();

    fireEvent.click(screen.getByText('feat: pr one'));
    fireEvent.click(screen.getByText('feat: pr three'), { shiftKey: true });
    await waitFor(() => expect(screen.getByText('Commits selected: 3')).toBeTruthy());

    // Plain click clears the selection (no action bar anymore).
    fireEvent.click(screen.getByText('feat: pr four'));
    await waitFor(() => expect(screen.queryByText('Commits selected: 3')).toBeNull());
    // The inline diff pane for the single commit is still loaded.
    expect(mockGetCommitFiles).toHaveBeenCalledWith('own', 'repo', SHAS[3]);
  });

  it('GitLab: MR commits arrive NEWEST-first and get normalized to OLDEST→NEWEST', async () => {
    // GitLab's /merge_requests/:iid/commits lists the HEAD commit FIRST.
    // A group selected in the Commits tab must still reach squashToBranch
    // oldest→newest — otherwise the backend contiguity check would refuse
    // the range with a confusing error.
    mockGetMergeRequest.mockResolvedValue({
      id: 9, iid: 9, title: 'Add feature X', state: 'opened',
      web_url: 'https://gitlab/own/repo/-/merge_requests/9',
      author: { username: 'author', avatar_url: null },
      source_branch: 'feature/x', target_branch: 'main',
      created_at: PR.created_at, updated_at: PR.updated_at,
      merged_at: null, work_in_progress: false, mergeable: true,
      additions: 0, deletions: 0, changed_files: 0,
      body: '', description: '',
    });
    mockListMRChanges.mockResolvedValue([]);
    mockListMRNotes.mockResolvedValue([]);
    // PRReview resolves the GitLab project ID on demand when the prop is null.
    mockGetProjectByPath.mockResolvedValue({ id: 4242, path_with_namespace: 'own/repo' });
    mockListMRCommits.mockResolvedValue([
      // NEWEST FIRST (head first) — the raw GitLab order.
      { sha: SHAS[3], commit: { message: 'feat: pr four', author: { name: 'Dev', email: 'dev@x.io', date: '2026-09-04T10:00:00Z' } }, web_url: 'u' },
      { sha: SHAS[2], commit: { message: 'feat: pr three', author: { name: 'Dev', email: 'dev@x.io', date: '2026-09-03T10:00:00Z' } }, web_url: 'u' },
      { sha: SHAS[1], commit: { message: 'feat: pr two', author: { name: 'Dev', email: 'dev@x.io', date: '2026-09-02T10:00:00Z' } }, web_url: 'u' },
      { sha: SHAS[0], commit: { message: 'feat: pr one', author: { name: 'Dev', email: 'dev@x.io', date: '2026-09-01T10:00:00Z' } }, web_url: 'u' },
    ]);

    renderReview('gitlab');
    await openCommitsTab();

    // The list is displayed chronologically (oldest at the top).
    const rows = screen.getAllByText(/feat: pr (one|two|three|four)/);
    expect(rows.map((r) => r.textContent)).toEqual([
      'feat: pr one', 'feat: pr two', 'feat: pr three', 'feat: pr four',
    ]);

    // Group = the last two commits (pr three + pr four in display order).
    fireEvent.click(screen.getByText('feat: pr three'));
    fireEvent.click(screen.getByText('feat: pr four'), { shiftKey: true });
    await waitFor(() => expect(screen.getByText('Commits selected: 2')).toBeTruthy());

    const squashButtons = screen.getAllByRole('button', { name: 'Squash to branch…' });
    fireEvent.click(squashButtons[squashButtons.length - 1]);
    await waitFor(() => {
      expect(screen.getByText('Squash commits to a branch')).toBeTruthy();
    });

    // The GitLab canonical MR head ref is the one fetched when objects
    // are missing (mockRaw resolves everything here — no fetch expected).
    expect(mockFetchRef).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('branch-name'), {
      target: { value: 'gitlab-sqx' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Squash 2 commits' }));
    await waitFor(() => expect(mockSquashToBranch).toHaveBeenCalledTimes(1));
    // OLDEST → NEWEST even though the API listed them head-first.
    expect(mockSquashToBranch.mock.calls[0][1].commits).toEqual([SHAS[2], SHAS[3]]);
  });
});
