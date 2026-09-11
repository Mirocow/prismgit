import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockAbortMerge = vi.fn(async () => {});
const mockCherryPickAbort = vi.fn(async () => {});
const mockRevertAbort = vi.fn(async () => {});
const mockBisectReset = vi.fn(async () => {});
const mockCherryPickSkip = vi.fn(async () => {});
const mockRevertSkip = vi.fn(async () => {});
const mockBisectGood = vi.fn(async () => {});
const mockBisectBad = vi.fn(async () => {});
const mockStashPush = vi.fn(async () => {});

vi.mock('../../src/lib/api', () => ({ api: { git: {
  abortMerge: (...a: unknown[]) => mockAbortMerge(...a),
  cherryPickAbort: (...a: unknown[]) => mockCherryPickAbort(...a),
  revertAbort: (...a: unknown[]) => mockRevertAbort(...a),
  bisectReset: (...a: unknown[]) => mockBisectReset(...a),
  cherryPickSkip: (...a: unknown[]) => mockCherryPickSkip(...a),
  revertSkip: (...a: unknown[]) => mockRevertSkip(...a),
  bisectGood: (...a: unknown[]) => mockBisectGood(...a),
  bisectBad: (...a: unknown[]) => mockBisectBad(...a),
  stashPush: (...a: unknown[]) => mockStashPush(...a),
  raw: vi.fn(), add: vi.fn(), rebase: vi.fn(),
  cherryPickContinue: vi.fn(), revertContinue: vi.fn(), continueMerge: vi.fn(), bisectSkip: vi.fn(),
}, fs: { readFile: vi.fn(), writeFile: vi.fn() },
contextMenu: { show: vi.fn().mockResolvedValue(undefined), onClick: vi.fn(() => () => {}) } } }));

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: (s?: any) => s ? s({ currentRepo: { path: '/test/repo', name: 'r' } }) : { currentRepo: { path: '/test/repo', name: 'r' } },
}));
vi.mock('../../src/stores/gitStore', () => ({
  useGitStore: (s?: any) => s ? s({ refreshStatus: vi.fn(), status: null }) : { refreshStatus: vi.fn(), status: null },
}));
vi.mock('../../src/stores/toastStore', () => ({ useToastStore: () => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('../../src/stores/selectionStore', () => ({ useSelectionStore: (s?: any) => s ? s({ selectedFilePath: null, selectFile: vi.fn() }) : { selectedFilePath: null, selectFile: vi.fn() } }));
vi.mock('../../src/lib/i18n', () => ({ useI18n: () => ({ t: (k: string, p?: any) => p ? Object.entries(p).reduce((s, [k2, v]) => s.replace(`{${k2}}`, String(v)), k) : k }) }));
vi.mock('../../src/components/ConfirmDialog', () => ({ confirmDialog: vi.fn(() => Promise.resolve(true)), promptDialog: vi.fn(() => Promise.resolve(null)) }));

import { RepoStateBanner } from '../../src/components/RepoStateBanner';
import type { StatusResult } from '../../src/lib/api';

const makeStatus = (o: Partial<StatusResult> = {}): StatusResult => ({
  not_added: [], modified: [], deleted: [], staged: [], conflicted: [], files: [],
  current: 'main', detached: false, ahead: 0, behind: 0,
  isMerging: false, isRebasing: false, isCherryPicking: false, isReverting: false, isBisecting: false,
  ...o,
} as StatusResult);

describe('Conflict Resolution — ALL 5 States', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('isMerging', () => {
    it('shows merging-state + Abort Merge + Stash All', () => {
      render(<RepoStateBanner status={makeStatus({ isMerging: true, conflicted: ['f.ts'] })} handlers={{ merge: { onAbort: mockAbortMerge }, onStashAll: mockStashPush }} />);
      expect(screen.getByText(/merging/i)).toBeInTheDocument();
      expect(screen.getByText('Abort Merge')).toBeInTheDocument();
      expect(screen.getByText('Stash All')).toBeInTheDocument();
    });
    it('Abort Merge calls git merge --abort', async () => {
      render(<RepoStateBanner status={makeStatus({ isMerging: true })} handlers={{ merge: { onAbort: mockAbortMerge }, onStashAll: vi.fn() }} />);
      fireEvent.click(screen.getByText('Abort Merge'));
      await waitFor(() => expect(mockAbortMerge).toHaveBeenCalled());
    });
  });

  describe('isCherryPicking', () => {
    it('shows cherry-picking-state + Continue/Skip/Abort', () => {
      render(<RepoStateBanner status={makeStatus({ isCherryPicking: true, cherryPick: { commit: 'a', subject: 's', empty: false } as any })} handlers={{ cherryPick: { onContinue: vi.fn(), onSkip: mockCherryPickSkip, onCommitEmpty: vi.fn(), onAbort: mockCherryPickAbort }, onStashAll: vi.fn() }} />);
      expect(screen.getByText(/cherry-picking/i)).toBeInTheDocument();
      expect(screen.getByText('Continue')).toBeInTheDocument();
      expect(screen.getByText('Skip')).toBeInTheDocument();
      expect(screen.getByText('Abort')).toBeInTheDocument();
    });
    it('Skip calls git cherry-pick --skip', async () => {
      render(<RepoStateBanner status={makeStatus({ isCherryPicking: true, cherryPick: { commit: 'a', subject: 's', empty: false } as any })} handlers={{ cherryPick: { onContinue: vi.fn(), onSkip: mockCherryPickSkip, onCommitEmpty: vi.fn(), onAbort: vi.fn() }, onStashAll: vi.fn() }} />);
      fireEvent.click(screen.getByText('Skip'));
      await waitFor(() => expect(mockCherryPickSkip).toHaveBeenCalled());
    });
    it('Abort calls git cherry-pick --abort', async () => {
      render(<RepoStateBanner status={makeStatus({ isCherryPicking: true, cherryPick: { commit: 'a', subject: 's' } as any })} handlers={{ cherryPick: { onContinue: vi.fn(), onSkip: vi.fn(), onCommitEmpty: vi.fn(), onAbort: mockCherryPickAbort }, onStashAll: vi.fn() }} />);
      fireEvent.click(screen.getByText('Abort'));
      await waitFor(() => expect(mockCherryPickAbort).toHaveBeenCalled());
    });
  });

  describe('isReverting', () => {
    it('shows reverting-state + Continue/Skip/Abort', () => {
      render(<RepoStateBanner status={makeStatus({ isReverting: true, revert: { commit: 'a', subject: 's' } as any })} handlers={{ revert: { onContinue: vi.fn(), onSkip: mockRevertSkip, onAbort: mockRevertAbort }, onStashAll: vi.fn() }} />);
      expect(screen.getAllByText(/reverting/i).length).toBeGreaterThan(0);
      expect(screen.getByText('Skip')).toBeInTheDocument();
      expect(screen.getByText('Abort')).toBeInTheDocument();
    });
    it('Skip calls git revert --skip', async () => {
      render(<RepoStateBanner status={makeStatus({ isReverting: true, revert: { commit: 'a', subject: 's' } as any })} handlers={{ revert: { onContinue: vi.fn(), onSkip: mockRevertSkip, onAbort: vi.fn() }, onStashAll: vi.fn() }} />);
      fireEvent.click(screen.getByText('Skip'));
      await waitFor(() => expect(mockRevertSkip).toHaveBeenCalled());
    });
  });

  describe('isRebasing', () => {
    it('shows rebasing-state + Step progress + Continue/Skip/Abort', () => {
      render(<RepoStateBanner status={makeStatus({ isRebasing: true, rebase: { step: 2, total: 5 } as any })} handlers={{ rebase: { onContinue: vi.fn(), onSkip: vi.fn(), onAbort: vi.fn() }, onStashAll: vi.fn() }} />);
      expect(screen.getByText(/rebasing/i)).toBeInTheDocument();
      expect(screen.getByText(/Step 2 of 5/)).toBeInTheDocument();
      expect(screen.getByText('Continue')).toBeInTheDocument();
      expect(screen.getByText('Skip')).toBeInTheDocument();
    });
  });

  describe('isBisecting', () => {
    it('shows bisecting-state + Good/Bad/Skip/Reset', () => {
      render(<RepoStateBanner status={makeStatus({ isBisecting: true, bisect: { rev: 'abc' } as any })} handlers={{ bisect: { onGood: mockBisectGood, onBad: mockBisectBad, onSkip: vi.fn(), onReset: mockBisectReset }, onStashAll: vi.fn() }} />);
      expect(screen.getByText(/bisecting/i)).toBeInTheDocument();
      expect(screen.getByText('Mark Good')).toBeInTheDocument();
      expect(screen.getByText('Mark Bad')).toBeInTheDocument();
      expect(screen.getByText('Reset')).toBeInTheDocument();
    });
    it('Mark Good calls git bisect good', async () => {
      render(<RepoStateBanner status={makeStatus({ isBisecting: true, bisect: { rev: 'abc' } as any })} handlers={{ bisect: { onGood: mockBisectGood, onBad: vi.fn(), onSkip: vi.fn(), onReset: vi.fn() }, onStashAll: vi.fn() }} />);
      fireEvent.click(screen.getByText('Mark Good'));
      await waitFor(() => expect(mockBisectGood).toHaveBeenCalled());
    });
    it('Reset calls git bisect reset', async () => {
      render(<RepoStateBanner status={makeStatus({ isBisecting: true, bisect: { rev: 'abc' } as any })} handlers={{ bisect: { onGood: vi.fn(), onBad: vi.fn(), onSkip: vi.fn(), onReset: mockBisectReset }, onStashAll: vi.fn() }} />);
      fireEvent.click(screen.getByText('Reset'));
      await waitFor(() => expect(mockBisectReset).toHaveBeenCalled());
    });
  });

  describe('Stash All visible for all states', () => {
    it('merge', () => { render(<RepoStateBanner status={makeStatus({ isMerging: true })} handlers={{ merge: { onAbort: vi.fn() }, onStashAll: vi.fn() }} />); expect(screen.getByText('Stash All')).toBeInTheDocument(); });
    it('cherry-pick', () => { render(<RepoStateBanner status={makeStatus({ isCherryPicking: true, cherryPick: { commit: 'a', subject: 's' } as any })} handlers={{ cherryPick: { onContinue: vi.fn(), onSkip: vi.fn(), onCommitEmpty: vi.fn(), onAbort: vi.fn() }, onStashAll: vi.fn() }} />); expect(screen.getByText('Stash All')).toBeInTheDocument(); });
    it('revert', () => { render(<RepoStateBanner status={makeStatus({ isReverting: true, revert: { commit: 'a', subject: 's' } as any })} handlers={{ revert: { onContinue: vi.fn(), onSkip: vi.fn(), onAbort: vi.fn() }, onStashAll: vi.fn() }} />); expect(screen.getByText('Stash All')).toBeInTheDocument(); });
    it('rebase', () => { render(<RepoStateBanner status={makeStatus({ isRebasing: true, rebase: { step: 1, total: 3 } as any })} handlers={{ rebase: { onContinue: vi.fn(), onSkip: vi.fn(), onAbort: vi.fn() }, onStashAll: vi.fn() }} />); expect(screen.getByText('Stash All')).toBeInTheDocument(); });
    it('bisect', () => { render(<RepoStateBanner status={makeStatus({ isBisecting: true, bisect: { rev: 'a' } as any })} handlers={{ bisect: { onGood: vi.fn(), onBad: vi.fn(), onSkip: vi.fn(), onReset: vi.fn() }, onStashAll: vi.fn() }} />); expect(screen.getByText('Stash All')).toBeInTheDocument(); });
  });
});
