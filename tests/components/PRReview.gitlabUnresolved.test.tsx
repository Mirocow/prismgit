/**
 * Regression test for the MR-acceptance false-success bug (task 27,
 * «выполни прием mr с помощью prismgit и отчитайся о найденых ошибках»).
 *
 * LIVE-VERIFIED DEFECT: opening a GitLab MR in Reviews briefly leaves
 * providerStore.gitlabProjectId null (the store resets it on detection and
 * PRReview re-resolves on demand). In that window the action bar was
 * clickable and handleApprove silently skipped the API call
 * (`else if (provider === 'gitlab' && gitlabProjectId != null)`) while
 * toast.success ran unconditionally → «PR #6 одобрен» with ZERO IPC traffic
 * and NO approval on the server. Same shape for merge/comment.
 *
 * The fix: buttons disabled + tooltip while unresolved, and a loud guard
 * in every handler. This test pins the disabled state and the stats
 * fallback (+/− sums from files when the GitLab detail has no totals —
 * was a misleading «+0 −0»).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PRReview } from '../../src/components/PRReview';
import type { SelectedPR } from '../../src/stores/providerStore';

const mockGetMergeRequest = vi.fn();
const mockListMRChanges = vi.fn();
const mockListMRNotes = vi.fn();
const mockListMRCommits = vi.fn();
const mockGetProjectByPath = vi.fn();
const mockApproveMergeRequest = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      raw: vi.fn().mockResolvedValue(''),
      fetchRef: vi.fn(),
      branches: vi.fn().mockResolvedValue([{ name: 'main', current: true, remote: false }]),
      squashToBranch: vi.fn(),
    },
    github: {},
    gitlab: {
      getMergeRequest: (...a: unknown[]) => mockGetMergeRequest(...a),
      listMRChanges: (...a: unknown[]) => mockListMRChanges(...a),
      listMRNotes: (...a: unknown[]) => mockListMRNotes(...a),
      listMRCommits: (...a: unknown[]) => mockListMRCommits(...a),
      getProjectByPath: (...a: unknown[]) => mockGetProjectByPath(...a),
      approveMergeRequest: (...a: unknown[]) => mockApproveMergeRequest(...a),
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
    const state = { refreshStatus: vi.fn(), status: null };
    return selector ? selector(state) : state;
  },
}));

const PR: SelectedPR = {
  number: 6,
  title: 'Release v2.2.0',
  state: 'open',
  html_url: 'http://gitlab/web/git/prismgit/-/merge_requests/6',
  author: { login: 'z.ai' },
  head: { ref: 'feature/smartgit-electron-v3', sha: '' },
  base: { ref: 'main', sha: '' },
  created_at: '2026-09-28T06:00:00Z',
  updated_at: '2026-09-28T06:00:00Z',
};

// Service-normalized GitLab MR detail (what api.gitlab.getMergeRequest
// returns after the service post-processing: mergeable from merge_status,
// body from description, draft from work_in_progress).
const MR_DETAIL = {
  id: 60, iid: 6, title: 'Release v2.2.0', state: 'opened',
  web_url: PR.html_url,
  author: { username: 'z.ai', avatar_url: '' },
  source_branch: 'feature/smartgit-electron-v3', target_branch: 'main',
  created_at: PR.created_at, updated_at: PR.updated_at,
  description: 'Release checklist', body: 'Release checklist',
  merged_at: null, work_in_progress: false, draft: false,
  merge_status: 'can_be_merged', mergeable: true,
  // GitLab has no +/- totals — the bug showed a misleading "+0 −0".
  additions: null, deletions: null, changed_files: 2,
};

const FILES = [
  { filename: 'README.md', status: 'modified', additions: 10, deletions: 2, diff: '@@ -1 +1 @@\n+a', blob_url: '', old_path: 'README.md', renamed_file: false },
  { filename: 'package.json', status: 'modified', additions: 5, deletions: 1, diff: '@@ -1 +1 @@\n+b', blob_url: '', old_path: 'package.json', renamed_file: false },
];

const MR_COMMITS = [
  { sha: '7af67cd522997ab5b78117939426328a78f8c2bb', commit: { message: 'chore(release)', author: { name: 'z.ai', email: 'bot@x.io', date: '2026-09-28T06:00:00Z' } } },
  { sha: 'c8690c3ff0a3625fbdf0d72a11e5e738e3d14a92', commit: { message: 'fix(pr)', author: { name: 'z.ai', email: 'bot@x.io', date: '2026-09-28T05:00:00Z' } } },
];

function renderGitlabReview(gitlabProjectId?: number | null) {
  return render(
    <PRReview
      pr={PR}
      owner="web/git"
      repo="prismgit"
      provider="gitlab"
      gitlabProjectId={gitlabProjectId ?? null}
      onActionComplete={() => {}}
      onClose={() => {}}
      onGitlabProjectIdResolved={() => {}}
    />,
  );
}

async function waitForReviewLoaded() {
  await waitFor(() => {
    expect(screen.getByText('Release v2.2.0')).toBeTruthy();
  });
}

describe('PRReview — GitLab actions while projectId unresolved (false-success regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMergeRequest.mockResolvedValue(MR_DETAIL);
    mockListMRChanges.mockResolvedValue(FILES);
    mockListMRNotes.mockResolvedValue([]);
    mockListMRCommits.mockResolvedValue(MR_COMMITS);
    mockGetProjectByPath.mockResolvedValue({ id: 2042, path_with_namespace: 'web/git/prismgit' });
  });

  it('disables Approve and Merge while gitlabProjectId is unresolved (was: clickable + false success toast)', async () => {
    renderGitlabReview(null);
    await waitForReviewLoaded();

    const approve = screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
    const merge = screen.getByRole('button', { name: 'Merge' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(merge.disabled).toBe(true);

    // A disabled click must never reach the API — the OLD bug approved
    // nothing while showing «PR #6 одобрен».
    expect(mockApproveMergeRequest).not.toHaveBeenCalled();
  });

  it('heals a null projectId: the standalone resolution effect re-resolves and reports the id', async () => {
    const resolved = vi.fn();
    render(
      <PRReview
        pr={PR}
        owner="web/git"
        repo="prismgit"
        provider="gitlab"
        gitlabProjectId={null}
        onActionComplete={() => {}}
        onClose={() => {}}
        onGitlabProjectIdResolved={resolved}
      />,
    );
    await waitForReviewLoaded();
    // Both load()'s on-demand resolution and the heal effect report the id —
    // the heal path is what recovers the prop AFTER a store reset (the
    // lastLoadKeyRef guard blocks any re-load).
    await waitFor(() => {
      expect(resolved).toHaveBeenCalledWith(2042);
    });
  });

  it('enables Approve and Merge once gitlabProjectId is resolved', async () => {
    renderGitlabReview(2042);
    await waitForReviewLoaded();

    const approve = screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
    const merge = screen.getByRole('button', { name: 'Merge' }) as HTMLButtonElement;
    await waitFor(() => expect(approve.disabled).toBe(false));
    expect(merge.disabled).toBe(false);
  });

  it('falls back to per-file +/− sums when the GitLab detail has no totals (was: «+0 −0»)', async () => {
    renderGitlabReview(2042);
    await waitForReviewLoaded();

    // FILES: +10+5 = 15 additions, 2+1 = 3 deletions.
    await waitFor(() => {
      expect(screen.getByText('+15')).toBeTruthy();
    });
    expect(screen.getByText('-3')).toBeTruthy();
  });
});
