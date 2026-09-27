/**
 * Component tests — the conflict-reaction audit (v3.6) for the four flows
 * that used to «промолчать и отчитаться в лог».
 *
 * Every conflicted operation must REACT: navigate the user to the Changes
 * resolver (surfaceConflictedState) with operation-specific wording, never
 * show a false success, and never continue a multi-step flow (git-flow)
 * past a conflict. The gitStore is mocked with a surface spy; the REAL
 * engine behavior is pinned in tests/unit/surfaceConflictedState.test.ts.
 *
 *  1. GitFlow finish feature — merge returns conflicts → GitFlowConflictError:
 *     branch NOT deleted, nothing pushed, NO success toast, resolver opened,
 *     dialog closed.
 *  2. Stash pop conflict — stashPop throws with .conflicts → resolver opened
 *     with the "stash kept" wording, no raw error toast.
 *  3. MergePanel REBASE strategy — rebase throws → resolver opened with the
 *     rebase wording (Continue/Skip/Abort hint), no «Merge failed» error.
 *  4. ApplyPatchModal — a "does not apply" failure offers the 3-way retry;
 *     the conflicted 3-way result routes to the resolver.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const surfaceSpy = vi.fn().mockResolvedValue(true);
const toastError = vi.fn();
const toastWarning = vi.fn();
const toastSuccess = vi.fn();

const mockMerge = vi.fn();
const mockRebase = vi.fn();
const mockStashPop = vi.fn();
const mockApplyPatch = vi.fn();
const mockDeleteBranch = vi.fn();
const mockPush = vi.fn();
const mockCheckout = vi.fn();
const mockRaw = vi.fn();
const mockStatus = vi.fn();
const mockBranches = vi.fn();
const mockStashList = vi.fn();
const mockRefreshStatus = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      merge: (...a: unknown[]) => mockMerge(...a),
      rebase: (...a: unknown[]) => mockRebase(...a),
      stashPop: (...a: unknown[]) => mockStashPop(...a),
      applyPatch: (...a: unknown[]) => mockApplyPatch(...a),
      deleteBranch: (...a: unknown[]) => mockDeleteBranch(...a),
      push: (...a: unknown[]) => mockPush(...a),
      checkout: (...a: unknown[]) => mockCheckout(...a),
      raw: (...a: unknown[]) => mockRaw(...a),
      status: (...a: unknown[]) => mockStatus(...a),
      branches: (...a: unknown[]) => mockBranches(...a),
      stashList: (...a: unknown[]) => mockStashList(...a),
      stashPush: vi.fn().mockResolvedValue(''),
      stashFiles: vi.fn().mockResolvedValue([]),
      createTag: vi.fn(),
      pushTag: vi.fn(),
      mergeTree: vi.fn().mockResolvedValue({}),
    },
    contextMenu: {
      show: vi.fn().mockResolvedValue(undefined),
      onClick: vi.fn(() => () => {}),
    },
  },
}));

vi.mock('../../src/stores/gitStore', () => ({
  useGitStore: (selector?: (s: unknown) => unknown) => {
    const state = { refreshStatus: mockRefreshStatus, status: null };
    return selector ? selector(state) : state;
  },
  surfaceConflictedState: (...a: unknown[]) => surfaceSpy(...a),
}));

vi.mock('../../src/stores/toastStore', () => ({
  useToastStore: (selector?: (s: unknown) => unknown) => {
    const state = { warning: toastWarning, success: toastSuccess, error: toastError };
    return selector ? selector(state) : state;
  },
  useToastActions: () => ({
    warning: toastWarning, success: toastSuccess, error: toastError, info: vi.fn(),
    show: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('../../src/stores/repositoryStore', () => {
  const state = { currentRepo: { path: '/test/repo', name: 'repo' } };
  const fn = (selector?: (s: unknown) => unknown) => (selector ? selector(state) : state);
  return { useRepositoryStore: Object.assign(fn, { getState: () => state }) };
});

vi.mock('../../src/stores/selectionStore', () => ({
  useSelectionStore: Object.assign(
    (selector?: (s: unknown) => unknown) => {
      const state = { selectedStashIndex: null, selectedBranch: null };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ selectedStashIndex: null, selectedBranch: null, selectStash: vi.fn(), selectBranch: vi.fn() }) },
  ),
}));

vi.mock('../../src/components/ConfirmDialog', () => ({
  confirmDialog: vi.fn().mockResolvedValue(true),
  confirmWithRemember: vi.fn().mockResolvedValue(true),
  promptDialog: vi.fn().mockResolvedValue(''),
}));

vi.mock('../../src/lib/i18n', () => ({
  // StashesPage's date formatter subscribes to the locale store.
  useI18nStore: Object.assign(
    (selector?: (s: unknown) => unknown) => {
      const state = { locale: 'en', dictVersion: 0, setLocale: vi.fn() };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ locale: 'en', dictVersion: 0, setLocale: vi.fn() }), setState: vi.fn() },
  ),
  useI18n: () => ({
    t: (k: string, p?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        'toast.gitflow.finishConflicts': 'Git-flow finish stopped — merge conflicts',
        'toast.gitflow.finishConflictsHint': 'The branch was NOT deleted and nothing was pushed',
        'toast.git.rebaseConflicts': 'Rebase resulted in conflicts',
        'toast.git.rebaseConflictsHint': 'Resolve them in the Changes tool',
        'stashes.popConflicts': 'Stash pop resulted in conflicts',
        'stashes.popConflictsHint': 'The stash entry was KEPT',
        'dialogs.applyPatch3wayRetry': 'Retry with 3-way merge',
        'dialogs.applyPatch3wayDone': 'Patch applied with conflicts',
        'dialogs.applyPatch3wayHint': 'Files get conflict markers',
        'changes.rebasedOnto': 'Rebased onto {branch}',
        'changes.strategyRebase': 'Rebase',
        'changes.mergeButton': 'Merge',
        'pages.flowFinishWord': 'Finish',
        'pages.operationFailed': 'Operation failed',
        'stashes.popFailed': 'Stash pop failed',
        'changes.mergeFailed': 'Merge failed',
        'common.cancel': 'Cancel',
        'dialogs.applyPatchButton': 'Apply',
        'dialogs.applyPatchTitle': 'Apply Patch',
        'dialogs.patchContentRequired': 'Patch content required',
      };
      const base = dict[k] ?? k;
      return p
        ? Object.entries(p).reduce((s, [k2, v]) => s.replace(`{${k2}}`, String(v)), base)
        : base;
    },
  }),
}));

const { GitFlowDialog } = await import('../../src/components/GitFlowDialog');
const { MergePanel } = await import('../../src/components/MergePanel');
const { StashesPage } = await import('../../src/pages/StashesPage');
const { ApplyPatchModal } = await import('../../src/components/ApplyPatchModal');
const { MemoryRouter } = await import('react-router-dom');

beforeEach(() => {
  vi.clearAllMocks();
  surfaceSpy.mockResolvedValue(true);
  window.location.hash = '';
});

describe('1. Git-flow finish — conflicted merge STOPS the flow (branch kept, resolver opened)', () => {
  it('throws GitFlowConflictError → no delete/push, no success toast, surface with git-flow wording, dialog closed', async () => {
    // git-flow config + branch list for the dialog's mount effect.
    mockRaw.mockResolvedValue(
      'gitflow.branch.master master\ngitflow.branch.develop develop\ngitflow.prefix.feature feature/\ngitflow.prefix.release release/\ngitflow.prefix.hotfix hotfix/\ngitflow.prefix.support support/\ngitflow.prefix.fix fix/\ngitflow.prefix.versiontag v'
    );
    mockBranches.mockResolvedValue([
      { name: 'develop', current: true, remote: false },
      { name: 'master', current: false, remote: false },
      { name: 'feature/x', current: false, remote: false },
    ]);
    mockCheckout.mockResolvedValue(undefined);
    mockMerge.mockResolvedValue({ conflicts: ['shared.txt'], fastForward: false, alreadyUpToDate: false });

    const onClose = vi.fn();
    render(
      <GitFlowDialog
        open
        onClose={onClose}
        initialFlow="feature"
        initialAction="finish"
        initialName="x"
      />,
    );
    await waitFor(() => expect(mockBranches).toHaveBeenCalled());

    // Execute (name + flow + action are preset through the initial props).
    const run = screen.getByRole('button', { name: 'Finish feature' });
    fireEvent.click(run);

    await waitFor(() => expect(surfaceSpy).toHaveBeenCalled());
    // THE audit assertions: the flow STOPS at the conflicted merge.
    expect(mockDeleteBranch).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalledWith(expect.stringContaining('Finished'), expect.anything());
    // The git-flow specific wording was used for the resolver reaction.
    expect(surfaceSpy).toHaveBeenCalledWith('/test/repo', expect.objectContaining({
      title: 'Git-flow finish stopped — merge conflicts',
    }));
    // Dialog closed so the modal doesn't cover the resolver.
    expect(onClose).toHaveBeenCalled();
  });
});

describe('2. Stash pop — conflicted pop surfaces the kept-stash message', () => {
  it('stashPop rejects with .conflicts → resolver reaction, no raw error toast', async () => {
    mockStashList.mockResolvedValue([{
      hash: 'abc', index: 0, message: 'WIP', date: '2026-09-01', branch: 'main',
      files: [], subject: 'WIP',
    }]);
    mockStatus.mockResolvedValue({
      current: 'main', isClean: false, files: [], conflicted: ['shared.txt'],
      isMerging: false, isRebasing: false,
    });
    const conflictErr = Object.assign(new Error('stash: conflicts in shared.txt'), { conflicts: ['shared.txt'] });
    mockStashPop.mockRejectedValue(conflictErr);

    render(
      <MemoryRouter>
        <StashesPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(mockStashList).toHaveBeenCalled());

    const popBtn = screen.getAllByTitle(/pop/i)[0] ?? screen.getAllByText(/pop/i)[0];
    fireEvent.click(popBtn.closest('button') ?? popBtn);

    await waitFor(() => expect(surfaceSpy).toHaveBeenCalledWith('/test/repo', expect.objectContaining({
      title: 'Stash pop resulted in conflicts',
      detail: 'The stash entry was KEPT',
    })));
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('3. MergePanel — REBASE strategy conflict routes to the resolver', () => {
  it('rebase throws → surface with the rebase wording, no «Merge failed» error toast, panel closed', async () => {
    mockStatus.mockResolvedValue({
      current: 'main', isClean: true, files: [], conflicted: ['shared.txt'],
      isMerging: false, isRebasing: true,
    });
    mockBranches.mockResolvedValue([{ name: 'feature/x', current: false, remote: false }]);
    mockRebase.mockRejectedValue(new Error('CONFLICT (content): Merge conflict in shared.txt'));

    const onClose = vi.fn();
    render(<MergePanel targetBranch="feature/x" onClose={onClose} />);
    await waitFor(() => expect(mockStatus).toHaveBeenCalled());

    // Pick the rebase strategy radio, then the primary action button
    // (its label becomes "Rebase" for that strategy).
    fireEvent.click(screen.getByLabelText('Rebase'));
    fireEvent.click(screen.getByRole('button', { name: 'Rebase' }));

    await waitFor(() => expect(surfaceSpy).toHaveBeenCalledWith('/test/repo', expect.objectContaining({
      title: 'Rebase resulted in conflicts',
      detail: 'Resolve them in the Changes tool',
    })));
    expect(toastError).not.toHaveBeenCalledWith('Merge failed', expect.anything());
    expect(onClose).toHaveBeenCalled();
  });
});

describe('4. ApplyPatchModal — 3-way retry after "does not apply"', () => {
  it('failed apply offers the 3-way retry; a conflicted 3-way routes to the resolver', async () => {
    mockApplyPatch.mockRejectedValueOnce(new Error('error: patch failed: shared.txt:1\nerror: shared.txt: patch does not apply'))
      .mockRejectedValueOnce(new Error('Applied patch to \'shared.txt\' with conflicts.'));
    mockStatus.mockResolvedValue({
      current: 'main', isClean: false, files: [], conflicted: ['shared.txt'],
      isMerging: false, isRebasing: false,
    });

    render(<ApplyPatchModal open onClose={vi.fn()} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'diff --git a/shared.txt b/shared.txt\n--- a/shared.txt\n+++ b/shared.txt\n@@ -1 +1 @@\n-x\n+y\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    // The 3-way retry button appears after the plain failure.
    const retry = await screen.findByRole('button', { name: 'Retry with 3-way merge' });
    expect(retry).toBeTruthy();
    fireEvent.click(retry);

    await waitFor(() => expect(mockApplyPatch).toHaveBeenNthCalledWith(
      2, '/test/repo', expect.anything(), expect.arrayContaining(['--3way']),
    ));
    await waitFor(() => expect(surfaceSpy).toHaveBeenCalledWith('/test/repo', expect.objectContaining({
      title: 'Patch applied with conflicts',
    })));
  });
});
