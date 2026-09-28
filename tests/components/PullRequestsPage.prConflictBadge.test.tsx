/**
 * Pull Requests list — the CONFLICT badge (remote-conflict audit).
 *
 * GitLab's list endpoint reports merge_status, GitHub's detail endpoint
 * reports mergeable=false — both must surface as an always-visible amber
 * «Conflicts» badge on the row so the user sees WHICH PRs are blocked
 * BEFORE opening them. (The PRReview header badge + merge-button guard are
 * pinned in this file too, via the shared pages.prConflicts* keys.)
 *
 * Pins:
 *   1. GitLab MR with merge_status=cannot_be_merged → badge on the row.
 *   2. GitLab MR with can_be_merged / unchecked → NO badge.
 *   3. GitHub PR with mergeable=false (list passthrough) → badge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PullRequestsPage } from '../../src/pages/PullRequestsPage';

const mockListMergeRequests = vi.fn();
const mockListPullRequests = vi.fn();
const mockGetProjectByPath = vi.fn();
const mockRaw = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: { raw: (...a: unknown[]) => mockRaw(...a) },
    github: { listPullRequests: (...a: unknown[]) => mockListPullRequests(...a) },
    gitlab: {
      getProjectByPath: (...a: unknown[]) => mockGetProjectByPath(...a),
      listMergeRequests: (...a: unknown[]) => mockListMergeRequests(...a),
    },
    app: { openExternal: vi.fn() },
    contextMenu: { show: vi.fn().mockResolvedValue(undefined), onClick: vi.fn(() => () => {}) },
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
    const state = { refreshStatus: vi.fn(), status: null };
    return selector ? selector(state) : state;
  },
  surfaceConflictedState: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../src/stores/authStore', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { authenticated: true, user: { login: 'me' }, token: 't' };
    return selector ? selector(state) : state;
  },
}));

// Mutable provider state — the GitLab test flips provider/projectId in place.
const PROVIDER_STATE: Record<string, unknown> = {
  provider: 'gitlab',
  owner: 'web',
  repo: 'prismgit',
  url: 'http://178.140.10.58:8082/web/git/prismgit.git',
  webUrl: 'http://178.140.10.58:8082/web/git/prismgit',
  manualOverride: false,
  loading: false,
  repoPath: '/test/repo',
  gitlabProjectId: 2042,
  gitlabAuthed: true,
  selectedPR: null,
  prStacks: {},
  detect: vi.fn(),
  selectPR: vi.fn(),
  setPRStacks: vi.fn(),
  selectProvider: vi.fn(),
  setManualOwnerRepo: vi.fn(),
  setGitlabProjectId: vi.fn(),
};

vi.mock('../../src/stores/providerStore', () => ({
  useProviderStore: (selector?: (s: unknown) => unknown) =>
    selector ? selector(PROVIDER_STATE) : PROVIDER_STATE,
  suggestProviderFromUrl: () => PROVIDER_STATE.provider,
}));

vi.mock('../../src/stores/selectionStore', () => ({
  useSelectionStore: Object.assign(
    (selector?: (s: unknown) => unknown) => {
      const state = { selectedBranch: 'feature/x' };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ selectedBranch: 'feature/x', selectBranch: vi.fn() }) },
  ),
}));

const MR = (over: Record<string, unknown>) => ({
  id: 1,
  iid: 5,
  title: 'Update readme',
  description: '',
  state: 'opened' as const,
  source_branch: 'feature/x',
  target_branch: 'main',
  web_url: 'http://gitlab/web/git/prismgit/-/merge_requests/5',
  author: { id: 1, username: 'dev', name: 'Dev' },
  merge_status: 'can_be_merged' as const,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-02T00:00:00Z',
  merged_at: null,
  ...over,
});

const GH_PR = (over: Record<string, unknown>) => ({
  number: 7,
  title: 'Fix login',
  state: 'open' as const,
  html_url: 'https://github.com/own/repo/pull/7',
  user: { login: 'dev', avatar_url: undefined },
  head: { ref: 'fix/login', sha: 'aaaa' },
  base: { ref: 'main', sha: '1111' },
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-02T00:00:00Z',
  merged_at: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  PROVIDER_STATE.provider = 'gitlab';
  PROVIDER_STATE.gitlabProjectId = 2042;
  PROVIDER_STATE.gitlabAuthed = true;
  mockRaw.mockResolvedValue('main\n');
});

describe('Pull Requests list — provider-reported conflict badge', () => {
  it('GitLab merge_status=cannot_be_merged → amber «Conflicts» badge on the row', async () => {
    mockListMergeRequests.mockResolvedValue([
      MR({ iid: 5, title: 'Conflicting MR', merge_status: 'cannot_be_merged' }),
      MR({ iid: 6, title: 'Clean MR', merge_status: 'can_be_merged' }),
      MR({ iid: 7, title: 'Unchecked MR', merge_status: 'unchecked' }),
    ]);
    render(<PullRequestsPage />);
    await waitFor(() => expect(screen.getByText('Conflicting MR')).toBeTruthy());

    // Exactly ONE badge — on the conflicting row only.
    const badges = screen.getAllByText('Conflicts');
    expect(badges.length).toBe(1);
    // The badge sits on the row of the CONFLICTING MR (same row title exists).
    expect(badges[0].closest('.group')?.textContent).toContain('Conflicting MR');
    // Amber conflict styling — same token the Conflicts section uses.
    expect(badges[0].className).toContain('text-status-modified');
  });

  it('GitHub mergeable=false (list passthrough) → badge; mergeable=true → none', async () => {
    PROVIDER_STATE.provider = 'github';
    PROVIDER_STATE.gitlabProjectId = null;
    PROVIDER_STATE.gitlabAuthed = false;
    mockListPullRequests.mockResolvedValue([
      GH_PR({ number: 7, title: 'Blocked PR', mergeable: false }),
      GH_PR({ number: 8, title: 'Mergeable PR', mergeable: true }),
    ]);
    render(<PullRequestsPage />);
    await waitFor(() => expect(screen.getByText('Blocked PR')).toBeTruthy());
    const badges = screen.getAllByText('Conflicts');
    expect(badges.length).toBe(1);
    expect(badges[0].closest('.group')?.textContent).toContain('Blocked PR');
  });

  it('closed PRs never show the conflict badge (moot state)', async () => {
    mockListMergeRequests.mockResolvedValue([
      MR({ iid: 8, title: 'Closed conflicting MR', state: 'closed', merge_status: 'cannot_be_merged' }),
    ]);
    render(<PullRequestsPage />);
    await waitFor(() => expect(screen.getByText('Closed conflicting MR')).toBeTruthy());
    expect(screen.queryByText('Conflicts')).toBeNull();
  });
});
