import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockAbortMerge = vi.fn(async () => {});
const mockCherryPickAbort = vi.fn(async () => {});
const mockRevertAbort = vi.fn(async () => {});
const mockBisectReset = vi.fn(async () => {});
const mockCherryPickContinue = vi.fn(async () => {});
const mockRevertContinue = vi.fn(async () => {});
const mockRebaseContinue = vi.fn(async () => {});
const mockRebaseAbort = vi.fn(async () => {});
const mockBisectGood = vi.fn(async () => {});
const mockBisectBad = vi.fn(async () => {});

vi.mock('../../src/lib/api', () => ({ api: { git: {
  abortMerge: (...a: unknown[]) => mockAbortMerge(...a),
  cherryPickAbort: (...a: unknown[]) => mockCherryPickAbort(...a),
  revertAbort: (...a: unknown[]) => mockRevertAbort(...a),
  bisectReset: (...a: unknown[]) => mockBisectReset(...a),
  cherryPickContinue: (...a: unknown[]) => mockCherryPickContinue(...a),
  revertContinue: (...a: unknown[]) => mockRevertContinue(...a),
  rebase: (...a: unknown[]) => mockRebaseContinue(...a),
  bisectGood: (...a: unknown[]) => mockBisectGood(...a),
  bisectBad: (...a: unknown[]) => mockBisectBad(...a),
  raw: vi.fn(), add: vi.fn(),
  rebaseAbort: (...a: unknown[]) => mockRebaseAbort(...a),
}, fs: { readFile: vi.fn(), writeFile: vi.fn() },
contextMenu: { show: vi.fn().mockResolvedValue(undefined), onClick: vi.fn(() => () => {}) } } }));

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: (s?: any) => s ? s({ currentRepo: { path: '/test/repo', name: 'r' } }) : { currentRepo: { path: '/test/repo', name: 'r' } },
}));
vi.mock('../../src/stores/gitStore', () => ({
  useGitStore: (s?: any) => s ? s({ refreshStatus: vi.fn(), status: null }) : { refreshStatus: vi.fn(), status: null },
}));
vi.mock('../../src/stores/toastStore', () => ({ useToastActions: () => ({
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
  useToastStore: () => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('../../src/stores/selectionStore', () => ({ useSelectionStore: (s?: any) => s ? s({ selectedFilePath: null, selectFile: vi.fn() }) : { selectedFilePath: null, selectFile: vi.fn() } }));
vi.mock('../../src/lib/i18n', async () => {
  // Use the real English dictionary so button labels (e.g. 'Continue', 'Abort',
  // 'Mark HEAD as Bad') resolve to their user-facing English text — this keeps
  // the test assertions stable while exercising the real translation chain.
  const locales = await import('../../src/i18n/locales');
  return {
    useI18n: () => ({
      t: (k: string, p?: any) => {
        let s = locales.en[k] ?? k;
        if (p) {
          for (const [k2, v] of Object.entries(p)) {
            s = s.replace(new RegExp(`\\{${k2}\\}`, 'g'), String(v));
          }
        }
        return s;
      },
      locale: 'en',
      setLocale: () => {},
    }),
  };
});
vi.mock('../../src/components/ConfirmDialog', () => ({ confirmDialog: vi.fn(() => Promise.resolve(true)), promptDialog: vi.fn(() => Promise.resolve(null)) }));

import { RepoStateBanner } from '../../src/components/RepoStateBanner';
import type { StatusResult } from '../../src/lib/api';

const makeStatus = (o: Partial<StatusResult> = {}): StatusResult => ({
  not_added: [], modified: [], deleted: [], staged: [], conflicted: [], files: [],
  current: 'main', detached: false, ahead: 0, behind: 0,
  isMerging: false, isRebasing: false, isCherryPicking: false, isReverting: false, isBisecting: false,
  ...o,
} as StatusResult);

/**
 * Strict button-set spec per repo state (NO other buttons rendered):
 *   cherry-picking (incl. conflict & empty) → Continue, Abort
 *   reverting                                   → Continue, Abort
 *   merging (incl. multi-conflict)            → Abort
 *   rebasing (incl. multi-step)                → Continue, Abort
 *   bisecting (incl. multi)                    → Mark HEAD as Bad, Mark HEAD as Good, Abort
 */
describe('Conflict Resolution — ALL 5 States (strict button set)', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('isMerging (incl. multi-conflict): Abort only', () => {
    it('shows merging-state + Abort (no Continue, no Skip, no Stash All)', () => {
      render(<RepoStateBanner status={makeStatus({ isMerging: true, conflicted: ['f.ts'] })} handlers={{ merge: { onAbort: mockAbortMerge } }} />);
      expect(screen.getByText(/merging/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Abort' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
      // Stash All is intentionally NOT rendered per spec
      expect(screen.queryByText('Stash All')).not.toBeInTheDocument();
    });
    it('Abort calls git merge --abort', async () => {
      render(<RepoStateBanner status={makeStatus({ isMerging: true })} handlers={{ merge: { onAbort: mockAbortMerge } }} />);
      fireEvent.click(screen.getByRole('button', { name: 'Abort' }));
      await waitFor(() => expect(mockAbortMerge).toHaveBeenCalled());
    });
  });

  describe('isCherryPicking (incl. conflict & empty): Continue, Abort', () => {
    it('shows cherry-picking-state + Continue/Abort (NO Skip, NO Commit Empty, NO Stash All)', () => {
      render(<RepoStateBanner status={makeStatus({ isCherryPicking: true, cherryPick: { commit: 'a', subject: 's', empty: false } as any })} handlers={{ cherryPick: { onContinue: mockCherryPickContinue, onAbort: mockCherryPickAbort } }} />);
      expect(screen.getByText(/cherry-picking/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Abort' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Commit Empty' })).not.toBeInTheDocument();
      expect(screen.queryByText('Stash All')).not.toBeInTheDocument();
    });
    it('empty pick ALSO shows only Continue/Abort (no Commit Empty)', () => {
      render(<RepoStateBanner status={makeStatus({ isCherryPicking: true, cherryPick: { commit: 'a', subject: 's', empty: true } as any })} handlers={{ cherryPick: { onContinue: vi.fn(), onAbort: vi.fn() } }} />);
      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Abort' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Commit Empty' })).not.toBeInTheDocument();
    });
    it('Abort calls git cherry-pick --abort', async () => {
      render(<RepoStateBanner status={makeStatus({ isCherryPicking: true, cherryPick: { commit: 'a', subject: 's' } as any })} handlers={{ cherryPick: { onContinue: vi.fn(), onAbort: mockCherryPickAbort } }} />);
      fireEvent.click(screen.getByRole('button', { name: 'Abort' }));
      await waitFor(() => expect(mockCherryPickAbort).toHaveBeenCalled());
    });
  });

  describe('isReverting: Continue, Abort', () => {
    it('shows reverting-state + Continue/Abort (NO Skip)', () => {
      render(<RepoStateBanner status={makeStatus({ isReverting: true, revert: { commit: 'a', subject: 's' } as any })} handlers={{ revert: { onContinue: mockRevertContinue, onAbort: mockRevertAbort } }} />);
      expect(screen.getAllByText(/reverting/i).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Abort' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    });
    it('Continue calls git revert --continue', async () => {
      render(<RepoStateBanner status={makeStatus({ isReverting: true, revert: { commit: 'a', subject: 's' } as any })} handlers={{ revert: { onContinue: mockRevertContinue, onAbort: vi.fn() } }} />);
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() => expect(mockRevertContinue).toHaveBeenCalled());
    });
  });

  describe('isRebasing (incl. multi-step): Continue, Abort', () => {
    it('shows rebasing-state + Step progress + Continue/Abort (NO Skip)', () => {
      render(<RepoStateBanner status={makeStatus({ isRebasing: true, rebase: { step: 2, total: 5 } as any })} handlers={{ rebase: { onContinue: mockRebaseContinue, onAbort: mockRebaseAbort } }} />);
      expect(screen.getByText(/rebasing/i)).toBeInTheDocument();
      expect(screen.getByText(/Step 2 of 5/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Abort' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    });
  });

  describe('isBisecting (incl. multi): Mark HEAD as Bad, Mark HEAD as Good, Abort', () => {
    it('shows bisecting-state + Mark HEAD as Bad/Good + Abort (NO Skip, NO Reset button)', () => {
      render(<RepoStateBanner status={makeStatus({ isBisecting: true, bisect: { rev: 'abc' } as any })} handlers={{ bisect: { onGood: mockBisectGood, onBad: mockBisectBad, onReset: mockBisectReset } }} />);
      expect(screen.getByText(/bisecting/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mark HEAD as Good' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mark HEAD as Bad' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Abort' })).toBeInTheDocument();
      // NO Skip / Reset buttons (Reset action is labeled "Abort")
      expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
    });
    it('Mark HEAD as Good calls git bisect good', async () => {
      render(<RepoStateBanner status={makeStatus({ isBisecting: true, bisect: { rev: 'abc' } as any })} handlers={{ bisect: { onGood: mockBisectGood, onBad: vi.fn(), onReset: vi.fn() } }} />);
      fireEvent.click(screen.getByRole('button', { name: 'Mark HEAD as Good' }));
      await waitFor(() => expect(mockBisectGood).toHaveBeenCalled());
    });
    it('Abort (labeled) calls git bisect reset', async () => {
      render(<RepoStateBanner status={makeStatus({ isBisecting: true, bisect: { rev: 'abc' } as any })} handlers={{ bisect: { onGood: vi.fn(), onBad: vi.fn(), onReset: mockBisectReset } }} />);
      fireEvent.click(screen.getByRole('button', { name: 'Abort' }));
      await waitFor(() => expect(mockBisectReset).toHaveBeenCalled());
    });
  });
});
