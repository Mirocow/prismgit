/**
 * Unit test for the GENERALIZED conflict-reaction engine (v3.6 audit).
 *
 * surfaceConflictedState is the single place every conflicted operation funnels
 * through («предоставить пользователю возможность реагировать, а не молчать и
 * отчитаться в лог»). Contract under test with the REAL gitStore (only the
 * api layer + repository store are mocked):
 *   1. conflicted repo state (unmerged paths) → navigate to #/changes +
 *      warning toast with the CALLER's operation-specific wording;
 *   2. rebasing state (no conflicted files listed yet) → same reaction —
 *      the generalized isRebasing clause from the audit;
 *   3. clean repo → NO navigation, NO toast, returns false;
 *   4. defaults to the pull wording when no opts are passed (backward
 *      compatibility for the four existing pull entry points).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGitStore, surfaceConflictedState } from '../../src/stores/gitStore';
import { useToastStore } from '../../src/stores/toastStore';

const mockStatus = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      status: (...args: unknown[]) => mockStatus(...args),
      statusBackground: (...args: unknown[]) => mockStatus(...args),
    },
  },
}));

vi.mock('../../src/lib/i18n', () => ({
  t: (k: string) => {
    const dict: Record<string, string> = {
      'toast.git.pullConflicts': 'Pull resulted in conflicts',
      'pages.pullConflictsHint': 'Resolve them in the Changes tool',
    };
    return dict[k] ?? k;
  },
}));

vi.mock('../../src/lib/remotes', () => ({ resolveDefaultRemote: vi.fn() }));
vi.mock('../../src/lib/pollingBoost', () => ({ bumpPolling: vi.fn() }));
vi.mock('../../src/stores/repositoryStore', () => {
  const state = { currentRepo: { path: '/test/repo', name: 'repo' } };
  const fn = (selector?: (s: unknown) => unknown) => (selector ? selector(state) : state);
  return { useRepositoryStore: Object.assign(fn, { getState: () => state }) };
});
vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (selector?: (s: unknown) => unknown) => {
      const state = { settings: {} };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ settings: {} }), setState: vi.fn() },
  ),
}));

const conflictedStatus = (over: Record<string, unknown> = {}) => ({
  current: 'main',
  isClean: false,
  files: [{ path: 'a.txt', index: 'U', workingTree: 'U' }],
  conflicted: ['a.txt'],
  isMerging: true,
  isRebasing: false,
  isCherryPicking: false,
  isReverting: false,
  isBisecting: false,
  ...over,
});

describe('surfaceConflictedState — the conflict-reaction engine', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Zustand actions are stable properties of the store state object —
    // spy on the live instance.
    warnSpy = vi.spyOn(useToastStore.getState(), 'warning');
    // Fresh status per call: refreshStatus gates on content equality, so a
    // CHANGED status object is committed to the store every time.
    useGitStore.setState({ status: null as never, lastRefresh: 0 });
    window.location.hash = '#/history';
  });

  it('conflicted repo → navigates to the Changes tool and warns with the CALLER wording', async () => {
    mockStatus.mockResolvedValue(conflictedStatus());
    const out = await surfaceConflictedState('/test/repo', { title: 'T-op', detail: 'D-op' });
    expect(out).toBe(true);
    expect(window.location.hash).toBe('#/changes');
    expect(warnSpy).toHaveBeenCalledWith('T-op', 'D-op');
  });

  it('rebasing state (conflicts listed by git) → same reaction', async () => {
    mockStatus.mockResolvedValue(conflictedStatus({ isMerging: false, isRebasing: true }));
    const out = await surfaceConflictedState('/test/repo', { title: 'T-rb', detail: 'D-rb' });
    expect(out).toBe(true);
    expect(window.location.hash).toBe('#/changes');
    expect(warnSpy).toHaveBeenCalledWith('T-rb', 'D-rb');
  });

  it('bare unmerged index (conflicted stash pop shape: no sequencer state) → still reacts', async () => {
    mockStatus.mockResolvedValue(conflictedStatus({ isMerging: false, isRebasing: false, isCherryPicking: false }));
    const out = await surfaceConflictedState('/test/repo', { title: 'T-st', detail: 'D-st' });
    expect(out).toBe(true);
    expect(window.location.hash).toBe('#/changes');
  });

  it('clean repo → no navigation, no toast, false', async () => {
    mockStatus.mockResolvedValue(conflictedStatus({
      isClean: true, files: [], conflicted: [], isMerging: false,
    }));
    const out = await surfaceConflictedState('/test/repo', { title: 'T', detail: 'D' });
    expect(out).toBe(false);
    expect(window.location.hash).toBe('#/history');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('defaults to the pull wording (the four existing pull entry points rely on it)', async () => {
    mockStatus.mockResolvedValue(conflictedStatus());
    await surfaceConflictedState('/test/repo');
    expect(warnSpy).toHaveBeenCalledWith(
      'Pull resulted in conflicts',
      'Resolve them in the Changes tool',
    );
  });
});
