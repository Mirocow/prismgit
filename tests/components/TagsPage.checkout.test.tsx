/**
 * Integration tests for the new "Checkout tag" feature in TagsPage.
 *
 * Verifies:
 *   - Tags render from api.git.tags()
 *   - The checkout action appears as a hover button (always in DOM)
 *   - Clicking the button opens a confirmation dialog
 *   - Confirming the dialog calls api.git.checkout(repoPath, tagName)
 *   - The operation is wrapped in logOperation so the OUTPUT panel shows it
 *   - Errors (e.g. git-lfs filter-process crash) are caught and shown as
 *     a toast — the app does NOT freeze / hang.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { TagsPage } from '../../src/pages/TagsPage';

const apiGitMock = vi.hoisted(() => ({
  tags: vi.fn(),
  checkout: vi.fn().mockResolvedValue(undefined),
  deleteTag: vi.fn().mockResolvedValue(undefined),
  createTag: vi.fn().mockResolvedValue(undefined),
  addAnnotatedTag: vi.fn().mockResolvedValue('taghash'),
  raw: vi.fn().mockResolvedValue(''),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    git: apiGitMock,
    fs: {},
    commandLog: { onEntry: () => () => {}, list: vi.fn().mockResolvedValue([]), clear: vi.fn() },
    clipboard: { writeText: vi.fn() },
    app: { openExternal: vi.fn(), getVersion: vi.fn().mockResolvedValue('test') },
    settings: { getAll: vi.fn().mockResolvedValue({}), set: vi.fn() },
  },
}));

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: (sel: any) => sel({
    currentRepo: { path: '/test/repo', name: 'test-repo' },
  }),
}));

vi.mock('../../src/stores/gitStore', () => ({
  useGitStore: (sel: any) => sel({
    refreshStatus: vi.fn().mockResolvedValue(undefined),
    status: null,
  }),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
vi.mock('../../src/stores/toastStore', () => ({
  useToastStore: () => toastMock,
  useToastActions: () => toastMock,
}));

vi.mock('../../src/stores/selectionStore', () => ({
  useSelectionStore: (sel?: any) => sel
    ? sel({ selectedTag: null, selectedCommitHash: null })
    : ({
        selectedTag: null,
        selectedCommitHash: null,
        getState: () => ({ selectTag: vi.fn(), selectCommit: vi.fn() }),
      }),
}));

const logOpMock = vi.hoisted(() => ({
  startOp: vi.fn().mockReturnValue('op-1'),
  finishOp: vi.fn(),
  failOp: vi.fn(),
  logOperation: vi.fn(async (_action: string, _repo: string, _cmd: string, fn: () => Promise<any>) => {
    return await fn();
  }),
}));
vi.mock('../../src/stores/operationLogStore', () => {
  const storeObj = {
    getState: () => logOpMock,
    startOp: logOpMock.startOp,
    finishOp: logOpMock.finishOp,
    failOp: logOpMock.failOp,
    logOperation: logOpMock.logOperation,
  };
  // useOperationLogStore is BOTH: a React hook (called with a selector) AND
  // a zustand store (with .getState() called directly). We need to provide
  // both APIs. The hook form: `(sel) => sel(storeObj)` returns the selected
  // slice. The store form: `useOperationLogStore.getState()` returns the
  // whole store.
  const hook = (sel?: any) => sel ? sel(storeObj) : storeObj;
  (hook as any).getState = () => logOpMock;
  (hook as any).setState = () => {};
  (hook as any).subscribe = () => () => {};
  return { useOperationLogStore: hook };
});

let confirmAnswer = true;
vi.mock('../../src/components/ConfirmDialog', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(confirmAnswer)),
  promptDialog: vi.fn(() => Promise.resolve(null)),
  ConfirmDialogHost: () => null,
}));

vi.mock('../../src/components/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('../../src/components/StatusBar', () => ({
  CommitHashLink: ({ hash }: { hash: string }) => <span>{String(hash).slice(0, 7)}</span>,
}));

vi.mock('../../src/hooks/useEscapeKey', () => ({
  useEscapeKey: () => {},
}));

vi.mock('../../src/lib/useContextMenu', () => ({
  useContextMenu: () => vi.fn(),
}));

vi.mock('../../src/lib/i18n', () => ({
  useI18n: () => ({
    t: (key: string, opts?: any) => {
      if (!opts) return key;
      let s = key;
      for (const [k, v] of Object.entries(opts)) {
        s = s.replace(`{${k}}`, String(v));
      }
      return s;
    },
  }),
  t: (key: string) => key,
}));

const TEST_TAGS = [
  {
    name: 'v1.0.0',
    hash: 'abcdef1234567890abcdef1234567890abcdef12',
    hashAbbrev: 'abcdef1',
    annotation: 'Release 1.0.0',
    date: '2026-09-13T10:00:00',
    author: 'Alice',
    lightweight: false,
    targetHash: 'abcdef1234567890abcdef1234567890abcdef12',
  },
  {
    name: 'v1.1.0',
    hash: 'bbcdcef1234567890abcdef1234567890abcdef12',
    hashAbbrev: 'bbcdcef',
    annotation: undefined,
    date: undefined,
    author: undefined,
    lightweight: true,
    targetHash: undefined,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  confirmAnswer = true;
  apiGitMock.tags.mockResolvedValue(TEST_TAGS);
});

describe('TagsPage — Checkout tag feature', () => {
  it('renders tags from api.git.tags()', async () => {
    render(<TagsPage />);
    await waitFor(() => expect(apiGitMock.tags).toHaveBeenCalledWith('/test/repo'));
    expect(await screen.findByText('v1.0.0')).toBeInTheDocument();
    expect(screen.getByText('v1.1.0')).toBeInTheDocument();
  });

  it('renders a GitBranch checkout button on every tag row (always in DOM)', async () => {
    render(<TagsPage />);
    await screen.findByText('v1.0.0');
    const checkoutButtons = screen.getAllByTitle(/tags\.checkoutTag/);
    expect(checkoutButtons.length).toBe(2);
  });

  it('clicking checkout button → confirmation dialog → api.git.checkout called', async () => {
    render(<TagsPage />);
    await screen.findByText('v1.0.0');
    const checkoutBtn = screen.getAllByTitle(/tags\.checkoutTag/)[0];
    fireEvent.click(checkoutBtn);
    await waitFor(() => {
      expect(apiGitMock.checkout).toHaveBeenCalledWith('/test/repo', 'v1.0.0');
    });
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('cancellation does NOT call api.git.checkout', async () => {
    confirmAnswer = false;
    render(<TagsPage />);
    await screen.findByText('v1.0.0');
    const checkoutBtn = screen.getAllByTitle(/tags\.checkoutTag/)[0];
    fireEvent.click(checkoutBtn);
    await new Promise((r) => setTimeout(r, 50));
    expect(apiGitMock.checkout).not.toHaveBeenCalled();
  });

  it('wraps the call in logOperation so OUTPUT panel shows the command', async () => {
    render(<TagsPage />);
    await screen.findByText('v1.0.0');
    const checkoutBtn = screen.getAllByTitle(/tags\.checkoutTag/)[0];
    fireEvent.click(checkoutBtn);
    await waitFor(() => {
      expect(logOpMock.logOperation).toHaveBeenCalled();
    });
    const call = logOpMock.logOperation.mock.calls[0];
    expect(call[0]).toMatch(/Checkout Tag v1\.0\.0/);
    expect(call[1]).toBe('/test/repo');
    expect(call[2]).toBe('git checkout v1.0.0');
  });

  it('shows a friendly LFS toast when git-lfs filter-process crashes (NO app freeze)', async () => {
    apiGitMock.checkout.mockRejectedValueOnce(
      new Error('git-lfs filter-process: git-lfs: command not found\nfatal: the remote end hung up unexpectedly'),
    );
    render(<TagsPage />);
    await screen.findByText('v1.0.0');
    const checkoutBtn = screen.getAllByTitle(/tags\.checkoutTag/)[0];
    fireEvent.click(checkoutBtn);
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
    const errorCall = toastMock.error.mock.calls[0];
    expect(errorCall[0]).toBe('tags.checkoutFailed');
    expect(errorCall[1]).toContain('toast.git.lfsFilterFailed');
    expect(errorCall[1]).toContain('git-lfs');
  });

  it('shows a generic error toast for non-LFS git failures', async () => {
    apiGitMock.checkout.mockRejectedValueOnce(new Error('some other git error'));
    render(<TagsPage />);
    await screen.findByText('v1.0.0');
    const checkoutBtn = screen.getAllByTitle(/tags\.checkoutTag/)[0];
    fireEvent.click(checkoutBtn);
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
    const errorCall = toastMock.error.mock.calls[0];
    expect(errorCall[0]).toBe('tags.checkoutFailed');
    expect(errorCall[1]).toContain('some other git error');
    expect(errorCall[1]).not.toContain('toast.git.lfsFilterFailed');
  });
});
