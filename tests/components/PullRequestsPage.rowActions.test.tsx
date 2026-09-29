/**
 * Component test for the Pull Requests LIST row actions — the visibility fix
 * for the user's feedback: «В инструменте Pull Requests кнопки не видны и не
 * понятны» (buttons are not visible and unclear).
 *
 * Before the fix the trailing row actions were hover-revealed icons
 * (opacity-0 until row hover): the squash action was a bare GitBranch glyph,
 * and the "external link" was a DEAD icon (no onClick, not even a button).
 *
 * Pins:
 *   1. Every PR row renders an ALWAYS-visible labeled "Squash to branch…"
 *      button — no `opacity-0` hover-reveal class (regression pin).
 *   2. Every PR row renders a REAL external-link button ("Open in browser"
 *      tooltip → api.app.openExternal).
 *   3. Right-click on a row opens the native context menu with the labeled
 *      actions: Open in Reviews / Open in browser / Squash to branch… / Copy
 *      submenu (title, number, link, head, base).
 *   4. Clicking the row's Squash button does NOT navigate to Reviews
 *      (stopPropagation) and opens SquashToBranchDialog after the provider +
 *      rev-parse round-trip (no fetch when objects exist).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PullRequestsPage } from '../../src/pages/PullRequestsPage';

const mockListPullRequests = vi.fn();
const mockListPRCommits = vi.fn();
const mockRaw = vi.fn();
const mockFetchRef = vi.fn();
const mockBranches = vi.fn();
const mockSquashToBranch = vi.fn();
const mockOpenExternal = vi.fn();
const mockMenuShow = vi.fn().mockResolvedValue(undefined);
const mockRefreshStatus = vi.fn();
const mockSelectPR = vi.fn();
const mockDetect = vi.fn();
const mockResolveDefaultRemote = vi.fn();
const mockSurfaceConflicted = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      raw: (...args: unknown[]) => mockRaw(...args),
      fetchRef: (...args: unknown[]) => mockFetchRef(...args),
      branches: (...args: unknown[]) => mockBranches(...args),
      squashToBranch: (...args: unknown[]) => mockSquashToBranch(...args),
    },
    github: {
      listPullRequests: (...args: unknown[]) => mockListPullRequests(...args),
      listPRCommits: (...args: unknown[]) => mockListPRCommits(...args),
    },
    gitlab: {
      getProjectByPath: vi.fn(),
      listMergeRequests: vi.fn(),
      listMRCommits: vi.fn(),
    },
    app: { openExternal: (...args: unknown[]) => mockOpenExternal(...args) },
    contextMenu: {
      show: (...args: unknown[]) => mockMenuShow(...args),
      onClick: vi.fn(() => () => {}),
    },
  },
}));

vi.mock('../../src/lib/remotes', () => ({
  resolveDefaultRemote: (...args: unknown[]) => mockResolveDefaultRemote(...args),
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
  surfaceConflictedState: (...args: unknown[]) => mockSurfaceConflicted(...args),
}));

vi.mock('../../src/stores/authStore', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { authenticated: true, user: { login: 'me' }, token: 't' };
    return selector ? selector(state) : state;
  },
}));

// Stable module-level state object — useShallow-wrapped selectors must see the
// SAME reference on every call or useSyncExternalStore loops forever.
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
  detect: mockDetect,
  selectPR: mockSelectPR,
  selectProvider: vi.fn(),
  setManualOwnerRepo: vi.fn(),
  setGitlabProjectId: vi.fn(),
};

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

const PR_A = {
  number: 1,
  title: 'Add feature A',
  state: 'open' as const,
  html_url: 'https://github.com/own/repo/pull/1',
  user: { login: 'author-a', avatar_url: undefined },
  head: { ref: 'feature/a', sha: 'aaaa' },
  base: { ref: 'main', sha: '1111' },
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-02T00:00:00Z',
  merged_at: null,
};

const PR_B = {
  ...PR_A,
  number: 2,
  title: 'Fix bug B',
  html_url: 'https://github.com/own/repo/pull/2',
  head: { ref: 'fix/b', sha: 'bbbb' },
};

const SHAS = [
  '1111111111111111111111111111111111111111',
  '2222222222222222222222222222222222222222',
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

beforeEach(() => {
  vi.clearAllMocks();
  mockListPullRequests.mockResolvedValue([PR_A, PR_B]);
  // symbolic-ref → '' (prefill falls back), rev-parse <sha>^{commit} → sha.
  mockRaw.mockImplementation((_p: string, args: string[]) =>
    Promise.resolve(args[3] ? `${String(args[3]).replace('^{commit}', '')}\n` : ''));
  mockResolveDefaultRemote.mockResolvedValue('origin');
  mockSurfaceConflicted.mockResolvedValue(false);
});

describe('PullRequestsPage — row action visibility (user feedback fix)', () => {
  it('every PR row shows an ALWAYS-visible labeled Squash button — no hover-reveal opacity class', async () => {
    render(<PullRequestsPage />);
    await waitFor(() => expect(screen.getByText('Add feature A')).toBeTruthy());

    const squashButtons = screen.getAllByRole('button', { name: /Squash to branch…/i });
    expect(squashButtons.length).toBe(2); // one per PR row

    // THE regression pin: the old bug was `opacity-0 group-hover:opacity-100`
    // (invisible until hover). The button must not carry opacity-0.
    for (const btn of squashButtons) {
      expect(btn.className).not.toContain('opacity-0');
      // A label span (not a bare icon) is what makes the action understandable.
      expect(btn.textContent).toMatch(/Squash to branch…/);
    }
  });

  it('every PR row has a REAL external-link button (was a dead icon) that opens the browser', async () => {
    render(<PullRequestsPage />);
    await waitFor(() => expect(screen.getByText('Add feature A')).toBeTruthy());

    const links = screen.getAllByTitle('Open in browser');
    expect(links.length).toBe(2);
    for (const el of links) {
      // Must be an actual <button> — the old version was a bare icon with no
      // onClick at all.
      expect(el.tagName).toBe('BUTTON');
    }
    fireEvent.click(links[0]);
    expect(mockOpenExternal).toHaveBeenCalledWith(PR_A.html_url);
  });

  it('right-click on a PR row opens a labeled native menu (Reviews / browser / squash / Copy group)', async () => {
    render(<PullRequestsPage />);
    await waitFor(() => expect(screen.getByText('Add feature A')).toBeTruthy());

    fireEvent.contextMenu(screen.getByText('Add feature A'));
    await waitFor(() => expect(mockMenuShow).toHaveBeenCalledTimes(1));

    const items = mockMenuShow.mock.calls[0][0] as Array<Record<string, unknown>>;
    const labels = items.map((i) => String(i.label ?? ''));
    expect(labels).toContain('Open in Reviews');
    expect(labels).toContain('Open in browser');
    expect(labels).toContain('Squash to branch…');
    expect(labels).toContain('Copy');

    const copyGroup = items.find((i) => i.label === 'Copy') as { submenu: Array<Record<string, unknown>> };
    const copyLabels = copyGroup.submenu.map((i) => String(i.label ?? ''));
    expect(copyLabels).toEqual([
      'Copy PR title',
      'Copy PR number',
      'Copy PR link',
      '', // separator between the link and branch items
      'Copy source branch',
      'Copy target branch',
    ]);
  });

  it('clicking the row Squash button opens SquashToBranchDialog WITHOUT navigating to Reviews', async () => {
    mockListPRCommits.mockResolvedValue([
      prCommit(SHAS[0], 'feat: a one'),
      prCommit(SHAS[1], 'feat: a two'),
    ]);
    mockBranches.mockResolvedValue([
      { name: 'main', current: true, remote: false },
      { name: 'dev', current: false, remote: false },
    ]);
    render(<PullRequestsPage />);
    await waitFor(() => expect(screen.getByText('Add feature A')).toBeTruthy());

    const initialHash = window.location.hash;
    fireEvent.click(screen.getAllByRole('button', { name: /Squash to branch…/i })[0]);

    // Dialog opens (rev-parse found the objects → no fetch).
    await waitFor(() => {
      expect(screen.getByText('Squash commits to a branch')).toBeTruthy();
    });
    expect(mockFetchRef).not.toHaveBeenCalled();
    // stopPropagation: the row click (navigate to Reviews) must NOT fire.
    expect(window.location.hash).toBe(initialHash);
    expect(mockSelectPR).not.toHaveBeenCalled();
  });
});
