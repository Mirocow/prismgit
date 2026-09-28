/**
 * Stacked PR/MR visibility — the «Stacked PRs» hosting feature plain git
 * has no concept of (user: «Жаль что не видно фишек гитхаба… типа
 * "Stacked PRs" — уж больно удобная вещь»).
 *
 * Pins:
 *   PullRequestsPage rows:
 *     1. A chained MR pair → BOTH rows show the stack badge «1/2» / «2/2».
 *     2. An unrelated MR → no badge.
 *     3. The badge tooltip carries the chain (merge order, bottom first).
 *   PRReview header:
 *     4. The stack strip renders for a stacked PR; hidden otherwise.
 *     5. Chips navigate: clicking a member calls selectPR with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PullRequestsPage } from '../../src/pages/PullRequestsPage';
import { PRReview } from '../../src/components/PRReview';

const mockListMergeRequests = vi.fn();
const mockRaw = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: { raw: (...a: unknown[]) => mockRaw(...a) },
    github: { listPullRequests: vi.fn() },
    gitlab: {
      getProjectByPath: vi.fn(),
      listMergeRequests: (...a: unknown[]) => mockListMergeRequests(...a),
      getMergeRequest: vi.fn().mockResolvedValue(null),
      listMRChanges: vi.fn().mockResolvedValue([]),
      listMRNotes: vi.fn().mockResolvedValue([]),
      listMRCommits: vi.fn().mockResolvedValue([]),
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

const mockSelectPR = vi.fn();
// Mutable provider state — PRReview tests set prStacks before render.
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
  selectPR: (...a: unknown[]) => mockSelectPR(...a),
  selectProvider: vi.fn(),
  setManualOwnerRepo: vi.fn(),
  setGitlabProjectId: vi.fn(),
  setPRStacks: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  PROVIDER_STATE.provider = 'gitlab';
  PROVIDER_STATE.gitlabProjectId = 2042;
  PROVIDER_STATE.gitlabAuthed = true;
  PROVIDER_STATE.prStacks = {};
  PROVIDER_STATE.selectedPR = null;
  mockRaw.mockResolvedValue('main\n');
});

describe('Pull Requests list — stacked chains badge', () => {
  it('chained MR pair → stack badges 1/2 and 2/2 on BOTH rows; unrelated MR has none', async () => {
    mockListMergeRequests.mockResolvedValue([
      MR({ iid: 4, title: 'Auth module', source_branch: 'stack/auth', target_branch: 'main' }),
      MR({ iid: 5, title: 'Profile on auth', source_branch: 'stack/profile', target_branch: 'stack/auth' }),
      MR({ iid: 6, title: 'Unrelated fix', source_branch: 'fix/thing', target_branch: 'main' }),
    ]);
    render(<PullRequestsPage />);
    await waitFor(() => expect(screen.getByText('Unrelated fix')).toBeTruthy());

    // i18n is NOT mocked here → real keys. The badge shows position/total.
    const b4 = screen.queryByTestId('pr-stack-badge-4');
    const b5 = screen.queryByTestId('pr-stack-badge-5');
    const b6 = screen.queryByTestId('pr-stack-badge-6');
    expect(b4).toBeTruthy();
    expect(b5).toBeTruthy();
    expect(b6).toBeNull();
    expect(b4!.textContent).toContain('1/2');
    expect(b5!.textContent).toContain('2/2');
    // Accent styling (distinct from the amber conflict badge).
    expect(b4!.className).toContain('text-accent');
    // Tooltip = the chain, bottom first (merge order).
    expect(b5!.getAttribute('title')).toContain('!4');
    expect(b5!.getAttribute('title')).toContain('!5');
  });
});

describe('PRReview header — stacked chain strip', () => {
  const SELECTED = {
    number: 5,
    title: 'Profile on auth',
    state: 'open' as const,
    html_url: 'http://gitlab/web/git/prismgit/-/merge_requests/5',
    author: { login: 'dev' },
    head: { ref: 'stack/profile', sha: 'bbbb' },
    base: { ref: 'stack/auth', sha: 'aaaa' },
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-02T00:00:00Z',
    merged_at: null,
  };
  const MEMBER4 = {
    ...SELECTED,
    number: 4,
    title: 'Auth module',
    head: { ref: 'stack/auth', sha: '1111' },
    base: { ref: 'main', sha: '0000' },
    html_url: 'http://gitlab/web/git/prismgit/-/merge_requests/4',
  };

  const noop = () => {};

  it('renders the stack strip with chips bottom→top; chip click navigates via selectPR', async () => {
    PROVIDER_STATE.prStacks = { 5: [MEMBER4, SELECTED] };
    PROVIDER_STATE.prStacks = { 5: [MEMBER4, SELECTED] };
    const { PRReview: FreshPRReview } = await import('../../src/components/PRReview');
    render(
      <FreshPRReview
        pr={SELECTED}
        owner="web"
        repo="prismgit"
        provider="gitlab"
        gitlabProjectId={2042}
        onActionComplete={noop}
        onClose={noop}
      />,
    );

    await waitFor(() => {
      const strip = screen.queryByTestId('pr-stack-strip');
      expect(strip).toBeTruthy();
    });
    // Both chips present; the CURRENT one is marked.
    const chip4 = screen.getByTestId('pr-stack-chip-4');
    const chip5 = screen.getByTestId('pr-stack-chip-5');
    expect(chip4.textContent).toContain('!4');
    expect(chip5.textContent).toContain('!5');
    // GitLab uses ! prefix (GitHub #).
    // Clicking another member navigates the review via selectPR.
    fireEvent.click(chip4);
    expect(mockSelectPR).toHaveBeenCalledWith(MEMBER4);
  });

  it('no stack in the store → no strip', async () => {
    const { PRReview: FreshPRReview } = await import('../../src/components/PRReview');
    render(
      <FreshPRReview
        pr={SELECTED}
        owner="web"
        repo="prismgit"
        provider="gitlab"
        gitlabProjectId={2042}
        onActionComplete={noop}
        onClose={noop}
      />,
    );
    await waitFor(() => expect(screen.queryByText('Profile on auth')).toBeTruthy());
    expect(screen.queryByTestId('pr-stack-strip')).toBeNull();
  });
});
