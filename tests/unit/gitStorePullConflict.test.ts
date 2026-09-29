/**
 * Unit tests — unified conflicted-pull surfacing (gitStore.surfaceConflictedState
 * + gitStore.pull error path).
 *
 * User-reported: a pull that hit merge conflicts (exit 1) produced NO visible
 * app reaction ("И ничего не произошло") — the repo was left mid-merge with
 * conflict markers, but the UI neither refreshed, navigated to the Conflicts
 * view, nor warned persistently. Conflict detection used to branch on the
 * ERROR MESSAGE containing 'CONFLICT' (brittle — git streams those lines to
 * stdout); the fix detects the merge-in-progress state from `git status`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the electron bridge BEFORE importing the store.
vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      status: vi.fn(),
      pull: vi.fn(),
    },
    settings: {
      refreshRepoStats: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

import { api } from '../../src/lib/api';
import { useGitStore, surfaceConflictedState } from '../../src/stores/gitStore';
import { useRepositoryStore } from '../../src/stores/repositoryStore';
import { useToastStore } from '../../src/stores/toastStore';
import type { StatusResult } from '../../electron/types/git-api';

const REPO = '/repos/prismgit';

function mergeConflictStatus(): StatusResult {
  return {
    not_added: [], conflicted: ['electron/main.ts', 'src/App.tsx'], created: [], deleted: [],
    modified: [], renamed: [], staged: [], ahead: 0, behind: 3,
    current: 'feature/smartgit-electron-v3', tracking: 'origin/feature/smartgit-electron-v3',
    files: [], isClean: false, isMerging: true, isRebasing: false, isCherryPicking: false,
    isReverting: false, isBisecting: false, detached: false,
  } as unknown as StatusResult;
}

function cleanStatus(): StatusResult {
  return {
    not_added: [], conflicted: [], created: [], deleted: [], modified: [], renamed: [],
    staged: [], ahead: 0, behind: 0, current: 'main', tracking: 'origin/main',
    files: [], isClean: true, isMerging: false, isRebasing: false, isCherryPicking: false,
    isReverting: false, isBisecting: false, detached: false,
  } as unknown as StatusResult;
}

describe('surfaceConflictedState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The repo must be the CURRENT one, otherwise refreshStatus drops the result.
    useRepositoryStore.setState({ currentRepo: { path: REPO } as never });
    useGitStore.setState({ status: null });
    useToastStore.setState({ toasts: [] });
    window.location.hash = '';
  });

  it('detects a mid-merge repo state, navigates to the Conflicts page and warns', async () => {
    vi.mocked(api.git.status).mockResolvedValue(mergeConflictStatus());

    const conflicted = await surfaceConflictedState(REPO);

    expect(conflicted).toBe(true);
    expect(api.git.status).toHaveBeenCalledWith(REPO);
    expect(useGitStore.getState().status?.isMerging).toBe(true);
    // The Conflicts section + RepoStateBanner live on the Changes page.
    expect(window.location.hash).toBe('#/changes');
    // A warning toast was fired.
    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((x) => x.type === 'warning')).toBe(true);
  });

  it('conflicted files alone (isMerging flag missing) still count as conflicted', async () => {
    const st = mergeConflictStatus();
    (st as { isMerging: boolean }).isMerging = false;
    vi.mocked(api.git.status).mockResolvedValue(st);

    expect(await surfaceConflictedState(REPO)).toBe(true);
    expect(window.location.hash).toBe('#/changes');
  });

  it('clean repo → no navigation, no toast, returns false', async () => {
    vi.mocked(api.git.status).mockResolvedValue(cleanStatus());

    expect(await surfaceConflictedState(REPO)).toBe(false);
    expect(window.location.hash).toBe('');
    expect(useToastStore.getState().toasts.some((x) => x.type === 'warning')).toBe(false);
  });

  it('status failure degrades gracefully (returns false, no throw)', async () => {
    vi.mocked(api.git.status).mockRejectedValue(new Error('not a repo'));
    await expect(surfaceConflictedState(REPO)).resolves.toBe(false);
  });
});

describe('gitStore.pull — conflicted pull error path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRepositoryStore.setState({ currentRepo: { path: REPO } as never });
    useGitStore.setState({ status: null });
    window.location.hash = '';
    useToastStore.setState({ toasts: [] });
  });

  it('rethrows the pull error AND surfaces the mid-merge state (refresh + navigate + warn)', async () => {
    // The pull "fails" the way a conflicted pull does — but the message is a
    // WORST CASE with no 'CONFLICT' word at all (proves state-based, not
    // message-based, detection).
    vi.mocked(api.git.pull).mockRejectedValue(new Error('From http://remote\n * branch v1 -> FETCH_HEAD'));
    vi.mocked(api.git.status).mockResolvedValue(mergeConflictStatus());

    await expect(useGitStore.getState().pull(REPO, 'origin', 'feature/smartgit-electron-v1'))
      .rejects.toThrow('FETCH_HEAD');

    // The store refreshed the status from the REAL repo state…
    expect(api.git.status).toHaveBeenCalledWith(REPO);
    expect(useGitStore.getState().status?.conflicted).toContain('electron/main.ts');
    // …took the user to the Conflicts UI…
    expect(window.location.hash).toBe('#/changes');
    // …and warned.
    expect(useToastStore.getState().toasts.some((x) => x.type === 'warning')).toBe(true);
  });

  it('non-conflict failure: rethrows, refreshes, but does NOT navigate or warn', async () => {
    vi.mocked(api.git.pull).mockRejectedValue(new Error('fatal: Authentication failed'));
    vi.mocked(api.git.status).mockResolvedValue(cleanStatus());

    await expect(useGitStore.getState().pull(REPO)).rejects.toThrow('Authentication failed');

    expect(window.location.hash).toBe('');
    expect(useToastStore.getState().toasts.some((x) => x.type === 'warning')).toBe(false);
  });
});
