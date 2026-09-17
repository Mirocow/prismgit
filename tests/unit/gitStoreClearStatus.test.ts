/**
 * gitStore — clearStatus action.
 *
 * Verifies the action that clears the cached `status` when switching
 * repositories. The user reported: "после переключения репозитория
 * теряется информация о текущей HEAD ветке" — switching repos left
 * the previous repo's HEAD branch name visible until the new git
 * status resolved (1-5s on large/LFS repos).
 *
 * The fix: App.tsx calls `useGitStore.getState().clearStatus()` BEFORE
 * `refreshStatus()` on a repo switch. This sets status=null so the UI
 * shows an empty/loading state instead of the stale branch name.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGitStore } from '../../src/stores/gitStore';

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

describe('gitStore.clearStatus', () => {
  beforeEach(() => {
    useGitStore.getState().clearStatus();
  });

  it('clears the cached status to null', () => {
    useGitStore.setState({
      status: {
        current: 'main',
        tracking: 'origin/main',
        ahead: 0,
        behind: 0,
        detached: false,
      } as any,
      loading: false,
      error: null,
      lastRefresh: 12345,
    });

    expect(useGitStore.getState().status).not.toBeNull();
    expect(useGitStore.getState().status?.current).toBe('main');

    useGitStore.getState().clearStatus();

    expect(useGitStore.getState().status).toBeNull();
    expect(useGitStore.getState().loading).toBe(false);
    expect(useGitStore.getState().error).toBeNull();
    expect(useGitStore.getState().lastRefresh).toBe(0);
  });

  it('clears error and loading flags too', () => {
    useGitStore.setState({
      status: null,
      loading: true,
      error: 'something went wrong',
      lastRefresh: 999,
    });

    useGitStore.getState().clearStatus();

    expect(useGitStore.getState().loading).toBe(false);
    expect(useGitStore.getState().error).toBeNull();
  });

  it('is safe to call when status is already null', () => {
    expect(() => useGitStore.getState().clearStatus()).not.toThrow();
    expect(useGitStore.getState().status).toBeNull();
  });
});
