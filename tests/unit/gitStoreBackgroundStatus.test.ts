/**
 * gitStore.refreshStatus — background transport routing (v3.5).
 *
 * The WATCHER-driven refreshes must go through api.git.statusBackground
 * (the dedicated git worker process — "фоновые status-обновления watcher'а в
 * отдельном процессе"), while every foreground refresh (page switch, repo
 * open, post-mutation) keeps the shared in-process path with its read
 * coalescing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGitStore } from '../../src/stores/gitStore';
import { api } from '../../src/lib/api';

// --- Mocks -------------------------------------------------------------

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      status: vi.fn(),
      statusBackground: vi.fn(),
    },
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
      loadMetadata: vi.fn(),
      checkRemotes: vi.fn(),
      currentRepo: { path: '/repos/alpha' },
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

const STATUS = {
  current: 'main',
  tracking: 'origin/main',
  ahead: 1,
  behind: 2,
  detached: false,
  files: [],
  not_added: [],
  conflicted: [],
  created: [],
  deleted: [],
  modified: [],
  renamed: [],
  staged: [],
  head: 'abc123',
  isClean: true,
  isMerging: false,
  isRebasing: false,
  isCherryPicking: false,
  isReverting: false,
  isBisecting: false,
} as const;

beforeEach(() => {
  useGitStore.getState().clearStatus();
  vi.mocked(api.git.status).mockReset().mockResolvedValue({ ...STATUS });
  vi.mocked(api.git.statusBackground).mockReset().mockResolvedValue({ ...STATUS });
});

describe('gitStore.refreshStatus — background transport', () => {
  it('routes the WATCHER path through statusBackground ({ background: true })', async () => {
    await useGitStore.getState().refreshStatus('/repos/alpha', { background: true });
    expect(api.git.statusBackground).toHaveBeenCalledWith('/repos/alpha');
    expect(api.git.status).not.toHaveBeenCalled();
    expect(useGitStore.getState().status).toMatchObject({ current: 'main', head: 'abc123' });
  });

  it('keeps the FOREGROUND path on the shared status transport (default opts)', async () => {
    await useGitStore.getState().refreshStatus('/repos/alpha');
    expect(api.git.status).toHaveBeenCalledWith('/repos/alpha');
    expect(api.git.statusBackground).not.toHaveBeenCalled();
    expect(useGitStore.getState().status).toMatchObject({ current: 'main' });
  });

  it('a background refresh still commits the result through the content-equality gate', async () => {
    await useGitStore.getState().refreshStatus('/repos/alpha', { background: true });
    const firstCommit = useGitStore.getState().status;
    expect(firstCommit).not.toBeNull();

    // Identical content → the SAME object identity is kept (zero store
    // notifications) even when it arrives over the background transport.
    vi.mocked(api.git.statusBackground).mockResolvedValue({ ...STATUS });
    await useGitStore.getState().refreshStatus('/repos/alpha', { background: true });
    expect(useGitStore.getState().status).toBe(firstCommit);
  });

  it('a failed background refresh surfaces the error without wedging loading', async () => {
    vi.mocked(api.git.statusBackground).mockRejectedValue(new Error('worker gone'));
    await useGitStore.getState().refreshStatus('/repos/alpha', { background: true });
    expect(useGitStore.getState().loading).toBe(false);
    expect(useGitStore.getState().error).toContain('worker gone');
    // The in-flight key was cleaned up — a subsequent refresh is not
    // coalesced onto the dead promise.
    await useGitStore.getState().refreshStatus('/repos/alpha', { background: true });
    expect(api.git.statusBackground).toHaveBeenCalledTimes(2);
  });
});
