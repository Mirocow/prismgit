/**
 * Polling boost (v3.2) — who is allowed to accelerate the remote poller.
 *
 * The boost used to be re-armed by a gitStore.subscribe listener on EVERY
 * `lastRefresh` change — i.e. on EVERY status refresh, including the ones
 * caused by the poll's own background fetch (refs watcher → refreshStatus →
 * bump) and by ordinary IDE auto-saves. The 30s boost interval therefore
 * became PERMANENT whenever a background-fetch remote was enabled, feeding a
 * self-sustaining fetch storm ("проверка удаленных репозиториев тормозит
 * приложение").
 *
 * Contract after the fix:
 *  - bumpPolling() (from lib/pollingBoost) arms a ~2-minute boost window;
 *  - gitStore MUTATION actions (commit/push/pull/fetch) bump the boost;
 *  - a plain refreshStatus (watcher tick, repo open) does NOT bump anything;
 *  - useRemotePolling no longer subscribes to gitStore at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the electron bridge BEFORE importing the store.
vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      status: vi.fn().mockResolvedValue({
        not_added: [], conflicted: [], created: [], deleted: [], modified: [], renamed: [],
        staged: [], ahead: 0, behind: 0, current: 'main', tracking: 'origin/main',
        files: [], isClean: true, isMerging: false, isRebasing: false, isCherryPicking: false,
        isReverting: false, isBisecting: false, detached: false,
      }),
      commit: vi.fn().mockResolvedValue('0123456789abcdef0123456789abcdef01234567'),
      push: vi.fn().mockResolvedValue({ summary: 'ok' }),
      pull: vi.fn().mockResolvedValue({}),
      fetch: vi.fn().mockResolvedValue(undefined),
      clearPollCache: vi.fn().mockResolvedValue(undefined),
      pollRemoteSummaries: vi.fn().mockResolvedValue({}),
    },
    settings: {
      refreshRepoStats: vi.fn().mockResolvedValue(undefined),
      getRepoMetadataAll: vi.fn().mockResolvedValue([]),
      getRepos: vi.fn().mockResolvedValue([]),
      getRepoGroups: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { api } from '../../src/lib/api';
import { useGitStore } from '../../src/stores/gitStore';
import { useRepositoryStore } from '../../src/stores/repositoryStore';
import { useToastStore } from '../../src/stores/toastStore';
import {
  bumpPolling,
  isPollingBoosted,
  __boostUntilForTests,
  BOOST_DURATION_MS,
} from '../../src/lib/pollingBoost';

const REPO = '/repos/prismgit';

describe('pollingBoost — bump semantics', () => {
  it('is not boosted before any mutation (first-run baseline)', () => {
    expect(isPollingBoosted()).toBe(false);
  });

  it('bumpPolling arms a ~2-minute window', () => {
    bumpPolling('test');
    expect(isPollingBoosted()).toBe(true);
    expect(__boostUntilForTests()).toBeGreaterThan(Date.now() + BOOST_DURATION_MS - 1_000);
    expect(__boostUntilForTests()).toBeLessThanOrEqual(Date.now() + BOOST_DURATION_MS);
  });
});

describe('gitStore mutations bump the remote poll (explicit, not via lastRefresh)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    useRepositoryStore.setState({ currentRepo: { path: REPO } as never });
    useGitStore.setState({ status: null, loading: false, error: null, lastRefresh: 0 });
    useToastStore.setState({ toasts: [] });
  });

  const boostDelta = (): number => __boostUntilForTests() - Date.now();

  it('commit arms the boost window', async () => {
    const before = boostDelta();
    await useGitStore.getState().commit(REPO, 'test commit');
    // Boost must now be armed for (nearly) the full 2 minutes.
    expect(boostDelta()).toBeGreaterThan(BOOST_DURATION_MS - 1_000);
    expect(boostDelta()).toBeGreaterThan(before);
  });

  it('push arms the boost window and clears the poll cache before re-checking', async () => {
    await useGitStore.getState().push(REPO, 'origin', 'main');
    expect(boostDelta()).toBeGreaterThan(BOOST_DURATION_MS - 1_000);
    // v3.2 badge-staleness fix: the post-push checkRemotes must see a cleared
    // poll cache, not the 60s-cached pre-push summary.
    await Promise.resolve(); // let the .then chain start
    expect(api.git.clearPollCache).toHaveBeenCalledWith(REPO);
  });

  it('pull arms the boost window', async () => {
    await useGitStore.getState().pull(REPO, 'origin', 'main');
    expect(boostDelta()).toBeGreaterThan(BOOST_DURATION_MS - 1_000);
  });

  it('fetch arms the boost window', async () => {
    await useGitStore.getState().fetch(REPO, 'origin', true);
    expect(boostDelta()).toBeGreaterThan(BOOST_DURATION_MS - 1_000);
  });

  it('a PLAIN refreshStatus does NOT re-arm the boost (loop broken)', async () => {
    // Consume the boost window armed by previous tests by checking it is
    // (possibly) active, then wait for it conceptually: simulate the old
    // feedback — many watcher-style refreshes must NOT extend the window.
    const windowBefore = __boostUntilForTests();
    for (let i = 0; i < 5; i++) {
      await useGitStore.getState().refreshStatus(REPO);
    }
    // No mutation happened → the boost window must not have grown.
    expect(__boostUntilForTests()).toBe(windowBefore);
  });
});
