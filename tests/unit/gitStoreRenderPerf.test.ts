/**
 * gitStore — RENDER-PERF content-equality gate in refreshStatus.
 *
 * The bug (user report: "интерфейс тупит сильно" / UI is sluggish):
 * every refreshStatus committed a NEW status object + lastRefresh bump
 * unconditionally. Since the watcher fires refreshes every ~5s (IDE
 * auto-save, builds, git itself touching .git/index), and most of those
 * refreshes return a status that is CONTENT-IDENTICAL to the current one,
 * the store notified all subscribers with a new object identity on every
 * tick — re-rendering the App tree, Sidebar, Toolbars and the active page
 * (thousands of file rows) every few seconds while the user was trying
 * to interact.
 *
 * The fix: statusContentEquals() walks the fields the UI renders; when
 * nothing visible changed, refreshStatus keeps the previous status object
 * (stable identity) and does NOT bump lastRefresh → zero notifications.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGitStore } from '../../src/stores/gitStore';
import { api } from '../../src/lib/api';

// --- Mocks -------------------------------------------------------------

vi.mock('../../src/lib/api', () => ({
  api: {
    git: { status: vi.fn() },
  },
}));

vi.mock('../../src/lib/i18n', () => ({
  t: (key: string) => key,
}));

vi.mock('../../src/lib/remotes', () => ({
  resolveDefaultRemote: vi.fn().mockResolvedValue('origin'),
}));

vi.mock('../../src/stores/operationLogStore', () => ({
  useOperationLogStore: {
    getState: () => ({
      startOp: vi.fn().mockReturnValue('1'),
      finishOp: vi.fn(),
      failOp: vi.fn(),
    }),
  },
}));

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: {
    getState: () => ({
      currentRepo: { path: '/repo/a', name: 'a' },
      loadMetadata: vi.fn(),
      checkRemotes: vi.fn(),
    }),
  },
}));

vi.mock('../../src/stores/toastStore', () => ({
  useToastStore: {
    getState: () => ({
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    }),
  },
}));

const mockedStatus = api.git.status as ReturnType<typeof vi.fn>;

function makeStatus(overrides: Record<string, unknown> = {}) {
  return {
    not_added: [],
    conflicted: [],
    created: [],
    deleted: [],
    modified: ['src/a.ts'],
    renamed: [],
    staged: [{ path: 'src/b.ts', index: 'M', working_dir: ' ' }],
    files: [
      { path: 'src/a.ts', index: ' ', working_dir: 'M' },
      { path: 'src/b.ts', index: 'M', working_dir: ' ' },
    ],
    ahead: 1,
    behind: 2,
    current: 'main',
    tracking: 'origin/main',
    head: 'abc123def',
    detached: false,
    isClean: false,
    isMerging: false,
    isRebasing: false,
    isCherryPicking: false,
    isReverting: false,
    isBisecting: false,
    ...overrides,
  } as any;
}

describe('gitStore.refreshStatus — content-equality gate', () => {
  beforeEach(() => {
    useGitStore.getState().clearStatus();
    mockedStatus.mockReset();
  });

  it('commits a NEW status object when content differs (identity change + lastRefresh bump)', async () => {
    mockedStatus.mockResolvedValueOnce(makeStatus());
    await useGitStore.getState().refreshStatus('/repo/a');
    const first = useGitStore.getState().status;
    const firstStamp = useGitStore.getState().lastRefresh;
    expect(first).not.toBeNull();
    expect(firstStamp).toBeGreaterThan(0);

    // Content differs: one more modified file → must commit the new object.
    mockedStatus.mockResolvedValueOnce(
      makeStatus({
        files: [
          { path: 'src/a.ts', index: ' ', working_dir: 'M' },
          { path: 'src/b.ts', index: 'M', working_dir: ' ' },
          { path: 'src/c.ts', index: '?', working_dir: '?' },
        ],
        modified: ['src/a.ts', 'src/c.ts'],
        not_added: ['src/c.ts'],
      }),
    );
    await useGitStore.getState().refreshStatus('/repo/a');
    const second = useGitStore.getState().status!;
    expect(second).not.toBe(first); // NEW identity — subscribers re-render
    expect(second.files.length).toBe(3);
    expect(useGitStore.getState().lastRefresh).toBeGreaterThanOrEqual(firstStamp);
  });

  it('keeps the PREVIOUS status object when content is identical (no re-render storm)', async () => {
    // Two refreshes returning different objects with IDENTICAL content.
    mockedStatus.mockResolvedValueOnce(makeStatus());
    await useGitStore.getState().refreshStatus('/repo/a');
    const first = useGitStore.getState().status;
    const firstStamp = useGitStore.getState().lastRefresh;

    mockedStatus.mockResolvedValueOnce(makeStatus()); // new object, same content
    await useGitStore.getState().refreshStatus('/repo/a');

    expect(useGitStore.getState().status).toBe(first); // SAME identity
    expect(useGitStore.getState().lastRefresh).toBe(firstStamp); // no bump
  });

  it('detects scalar changes (branch switch, ahead/behind, HEAD hash)', async () => {
    mockedStatus.mockResolvedValueOnce(makeStatus());
    await useGitStore.getState().refreshStatus('/repo/a');
    const first = useGitStore.getState().status;

    // Branch switch: current changes, files identical.
    mockedStatus.mockResolvedValueOnce(makeStatus({ current: 'develop', tracking: 'origin/develop' }));
    await useGitStore.getState().refreshStatus('/repo/a');
    expect(useGitStore.getState().status).not.toBe(first);

    // HEAD moved (commit on same branch) — only the hash differs.
    const second = useGitStore.getState().status;
    mockedStatus.mockResolvedValueOnce(makeStatus({ head: 'fff000fff' }));
    await useGitStore.getState().refreshStatus('/repo/a');
    expect(useGitStore.getState().status).not.toBe(second);
  });

  it('detects per-file status changes (same paths, different index/working_dir)', async () => {
    mockedStatus.mockResolvedValueOnce(makeStatus());
    await useGitStore.getState().refreshStatus('/repo/a');
    const first = useGitStore.getState().status;

    // Same file list, but b.ts became unstaged: index 'M' → ' '.
    mockedStatus.mockResolvedValueOnce(
      makeStatus({
        staged: [],
        files: [
          { path: 'src/a.ts', index: ' ', working_dir: 'M' },
          { path: 'src/b.ts', index: ' ', working_dir: 'M' },
        ],
        modified: ['src/a.ts', 'src/b.ts'],
      }),
    );
    await useGitStore.getState().refreshStatus('/repo/a');
    expect(useGitStore.getState().status).not.toBe(first);
  });

  it('detects sequencer-state changes (merge started / ended)', async () => {
    mockedStatus.mockResolvedValueOnce(makeStatus());
    await useGitStore.getState().refreshStatus('/repo/a');
    const first = useGitStore.getState().status;

    // Merge starts — conflicted files + isMerging.
    mockedStatus.mockResolvedValueOnce(
      makeStatus({
        isMerging: true,
        conflicted: ['conflict.ts'],
        merge: { message: 'Merge branch x' },
        files: [{ path: 'conflict.ts', index: 'U', working_dir: 'U' }],
        modified: [],
        staged: [],
      }),
    );
    await useGitStore.getState().refreshStatus('/repo/a');
    expect(useGitStore.getState().status).not.toBe(first);
    expect(useGitStore.getState().status?.isMerging).toBe(true);

    // Merge resolves back to the ORIGINAL content → identity changes again
    // (a new object with old content is still a change relative to the
    // in-merge snapshot). No-op suppression only applies to CONSECUTIVE
    // equal snapshots.
    mockedStatus.mockResolvedValueOnce(makeStatus());
    await useGitStore.getState().refreshStatus('/repo/a');
    expect(useGitStore.getState().status?.isMerging).toBe(false);
  });

  it('notifies ZERO status-subscribers for a no-op refresh', async () => {
    mockedStatus.mockResolvedValueOnce(makeStatus());
    await useGitStore.getState().refreshStatus('/repo/a');

    // Subscribe like a COMPONENT would: zustand notifies the raw listener
    // on every set(), but a component re-renders only when its SELECTOR
    // value changes. Selector-relevant fields are status + lastRefresh —
    // count listener runs where either identity changed.
    let selectorNotifications = 0;
    const unsub = useGitStore.subscribe((s, prev) => {
      if (s.status !== prev.status || s.lastRefresh !== prev.lastRefresh) {
        selectorNotifications++;
      }
    });

    mockedStatus.mockResolvedValueOnce(makeStatus()); // same content
    await useGitStore.getState().refreshStatus('/repo/a');

    expect(selectorNotifications).toBe(0); // the entire point of the gate

    unsub();
  });

  it('still refreshes after clearStatus (prev=null is never "equal")', async () => {
    mockedStatus.mockResolvedValueOnce(makeStatus());
    await useGitStore.getState().refreshStatus('/repo/a');
    useGitStore.getState().clearStatus();
    expect(useGitStore.getState().status).toBeNull();

    // Same content as the pre-clear status — must still commit: the UI is
    // showing the cleared (null) state and needs the object back.
    mockedStatus.mockResolvedValueOnce(makeStatus());
    await useGitStore.getState().refreshStatus('/repo/a');
    expect(useGitStore.getState().status).not.toBeNull();
    expect(useGitStore.getState().lastRefresh).toBeGreaterThan(0);
  });

  it('settles the loading flag on a no-op refresh without status notifications', async () => {
    mockedStatus.mockResolvedValueOnce(makeStatus());
    await useGitStore.getState().refreshStatus('/repo/a');

    let selectorNotifications = 0;
    const unsub = useGitStore.subscribe((s, prev) => {
      if (s.status !== prev.status || s.lastRefresh !== prev.lastRefresh) {
        selectorNotifications++;
      }
    });

    mockedStatus.mockResolvedValueOnce(makeStatus());
    const p = useGitStore.getState().refreshStatus('/repo/a');
    expect(useGitStore.getState().loading).toBe(true); // in-flight
    await p;
    expect(useGitStore.getState().loading).toBe(false); // settled
    // loading has no component subscribers → silent for the render tree.
    // (The raw store listener DOES fire for the loading set()s — but no
    // component subscribes to `loading`, verified across src/.)
    expect(selectorNotifications).toBe(0);

    unsub();
  });
});
