/**
 * 401 handling in the Pull Requests tool — the user's report:
 * «Не должно быть на отсутствующих интеграциях столько запросов. Сейчас при
 * переключении всплывает 3 тоста: Не удалось загрузить pull requests / Error
 * invoking remote method 'github:listPullRequests': GitHub API 401: Bad
 * credentials».
 *
 * Pins the fix:
 *   1. A 401 "Bad credentials" rejection is an AUTH problem, not a load
 *      failure: NO error toast fires; the auth flag flips so the in-page
 *      sign-in gate renders; the stale PR list clears.
 *   2. The anti-spam guard: the same provider+repo+state+auth key is
 *      fetched ONCE (mounting with a stale GitHub PAT used to fire 3 loads
 *      because provider detection flips `loading` twice and re-creates the
 *      effect); the Refresh button (force=true) is the explicit retry path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PullRequestsPage } from '../../src/pages/PullRequestsPage';

// vi.mock factories are hoisted above const initializers — every value they
// capture must come from vi.hoisted (vitest requirement).
const {
  mockListPullRequests, mockRaw, mockToastError, mockDetect, authSetState, AUTH_STATE, PROVIDER_STATE,
} = vi.hoisted(() => {
  const AUTH_STATE = { authenticated: true, user: { login: 'me' }, token: 'stale' };
  const PROVIDER_STATE = {
    provider: 'github',
    owner: 'own',
    repo: 'repo',
    url: 'https://github.com/own/repo.git',
    webUrl: 'https://github.com/own/repo',
    manualOverride: false,
    loading: false,
    repoPath: '/test/repo',
    gitlabProjectId: null,
    gitlabAuthed: false,
    selectedPR: null,
    prStacks: {},
    detect: vi.fn().mockResolvedValue(undefined),
    selectPR: vi.fn(),
    selectProvider: vi.fn(),
    setManualOwnerRepo: vi.fn(),
    setGitlabProjectId: vi.fn(),
    setPRStacks: vi.fn(),
  };
  return {
    mockListPullRequests: vi.fn(),
    mockRaw: vi.fn().mockResolvedValue('main'),
    mockToastError: vi.fn(),
    mockDetect: PROVIDER_STATE.detect,
    authSetState: vi.fn(),
    AUTH_STATE,
    PROVIDER_STATE,
  };
});

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      raw: (...args: unknown[]) => mockRaw(...args),
    },
    github: {
      listPullRequests: (...args: unknown[]) => mockListPullRequests(...args),
    },
    gitlab: {
      getProjectByPath: vi.fn(),
      listMergeRequests: vi.fn(),
    },
    app: { openExternal: vi.fn() },
    contextMenu: { show: vi.fn().mockResolvedValue(undefined), onClick: vi.fn(() => () => {}) },
  },
}));

vi.mock('../../src/lib/remotes', () => ({
  resolveDefaultRemote: vi.fn().mockResolvedValue('origin'),
}));

vi.mock('../../src/stores/toastStore', () => ({
  useToastActions: () => ({
    error: mockToastError, warning: vi.fn(), success: vi.fn(), info: vi.fn(), show: vi.fn(), dismiss: vi.fn(),
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
  useAuthStore: Object.assign(
    (selector?: (s: unknown) => unknown) => (selector ? selector(AUTH_STATE) : AUTH_STATE),
    { setState: authSetState, getState: () => AUTH_STATE },
  ),
}));

vi.mock('../../src/stores/providerStore', () => ({
  useProviderStore: (selector?: (s: unknown) => unknown) =>
    selector ? selector(PROVIDER_STATE) : PROVIDER_STATE,
  suggestProviderFromUrl: () => 'github',
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

beforeEach(() => {
  vi.clearAllMocks();
  mockRaw.mockResolvedValue('main');
  mockDetect.mockResolvedValue(undefined);
});

describe('PullRequestsPage — 401 from a stale GitHub PAT', () => {
  it('401 flips the auth gate WITHOUT an error toast (the 3-toast barrage fix)', async () => {
    mockListPullRequests.mockRejectedValueOnce(
      new Error('GitHub API 401: {"message":"Bad credentials","status":"401"}')
    );
    render(<PullRequestsPage />);

    await waitFor(() => expect(mockListPullRequests).toHaveBeenCalledTimes(1));

    // No toast flood — 401 is silent by design (the auth gate is the UI).
    await waitFor(() => expect(authSetState).toHaveBeenCalledWith({ authenticated: false }));
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('the same provider+repo+state+auth key is fetched exactly ONCE (anti-spam guard)', async () => {
    mockListPullRequests.mockResolvedValue([]);
    render(<PullRequestsPage />);
    // Mount fires the load once; subsequent effect re-runs (locale ticks,
    // providerInfo identity churn) are skipped by the last-key guard.
    await waitFor(() => expect(mockListPullRequests).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 150));
    expect(mockListPullRequests).toHaveBeenCalledTimes(1);
  });

  it('the Refresh button forces a re-fetch (the explicit retry path)', async () => {
    mockListPullRequests.mockResolvedValue([]);
    render(<PullRequestsPage />);
    await waitFor(() => expect(mockListPullRequests).toHaveBeenCalledTimes(1));
    const refresh = await screen.findByTitle('Refresh');
    fireEvent.click(refresh);
    await waitFor(() => expect(mockListPullRequests).toHaveBeenCalledTimes(2));
  });
});
