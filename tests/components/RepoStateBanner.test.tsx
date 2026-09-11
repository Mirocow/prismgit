import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RepoStateBanner } from '../../src/components/RepoStateBanner';
import type { StatusResult } from '../../src/lib/api';
import { getRepoInProgressState, isCommitBlocked } from '../../src/lib/repoState';

// Pure component: everything comes via props — no API / store mocks needed.

function makeStatus(overrides: Partial<StatusResult> = {}): StatusResult {
  return {
    not_added: [],
    conflicted: [],
    created: [],
    deleted: [],
    modified: [],
    renamed: [],
    staged: [],
    ahead: 0,
    behind: 0,
    current: 'main',
    tracking: 'origin/main',
    files: [],
    isClean: true,
    isMerging: false,
    isRebasing: false,
    isCherryPicking: false,
    isReverting: false,
    isBisecting: false,
    detached: false,
    ...overrides,
  };
}

const handlers = {
  cherryPick: {
    onContinue: vi.fn(),
    onSkip: vi.fn(),
    onCommitEmpty: vi.fn(),
    onAbort: vi.fn(),
  },
  revert: { onContinue: vi.fn(), onSkip: vi.fn(), onAbort: vi.fn() },
  merge: { onAbort: vi.fn() },
  rebase: { onContinue: vi.fn(), onSkip: vi.fn(), onAbort: vi.fn() },
  bisect: { onGood: vi.fn(), onBad: vi.fn(), onSkip: vi.fn(), onReset: vi.fn() },
};

function renderBanner(status: StatusResult, busy = false) {
  return render(<RepoStateBanner status={status} busy={busy} handlers={handlers} />);
}

describe('RepoStateBanner — SmartGit working-tree states (5 states)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when the working tree is idle', () => {
    const { container } = renderBanner(makeStatus());
    expect(container).toBeEmptyDOMElement();
  });

  // ===== cherry-picking (incl. conflict & empty): Continue, Abort =====
  it('cherry-picking: banner text, pick info, Continue / Abort (NO Skip, NO Commit Empty)', () => {
    renderBanner(makeStatus({
      isCherryPicking: true,
      cherryPick: { commit: '8962174c9225524cd57921f1150428aead800f21', subject: 'Add feature', empty: false },
    }));
    expect(screen.getByTestId('repo-state-banner')).toHaveTextContent(
      'The working tree is in cherry-picking-state.'
    );
    expect(screen.getByTestId('cherry-pick-commit')).toHaveTextContent('8962174');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abort' })).toBeInTheDocument();
    // NO Skip / Commit Empty buttons (strict spec)
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Commit Empty' })).not.toBeInTheDocument();
  });

  it('cherry-picking: empty pick ALSO shows only Continue / Abort (no Commit Empty button)', () => {
    renderBanner(makeStatus({
      isCherryPicking: true,
      cherryPick: { commit: '8962174c9225524cd57921f1150428aead800f21', subject: 'Add feature', empty: true },
    }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abort' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Commit Empty' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
  });

  it('cherry-picking: buttons fire Continue / Abort callbacks', () => {
    renderBanner(makeStatus({
      isCherryPicking: true,
      cherryPick: { commit: 'abc', subject: '', empty: false },
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abort' }));
    expect(handlers.cherryPick.onContinue).toHaveBeenCalledTimes(1);
    expect(handlers.cherryPick.onAbort).toHaveBeenCalledTimes(1);
  });

  // ===== reverting: Continue, Abort =====
  it('reverting: banner text, revert info, Continue / Abort (NO Skip)', () => {
    renderBanner(makeStatus({
      isReverting: true,
      revert: { commit: 'aaaabbbbccccddddeeeeffff0000111122223333', subject: 'Buggy change' },
    }));
    expect(screen.getByTestId('repo-state-banner')).toHaveTextContent(
      'The working tree is in reverting-state.'
    );
    expect(screen.getByTestId('revert-commit')).toHaveTextContent('Reverting aaaabbb');
    expect(screen.getByTestId('revert-commit')).toHaveTextContent('Buggy change');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(handlers.revert.onContinue).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Abort' }));
    expect(handlers.revert.onAbort).toHaveBeenCalledTimes(1);
    // NO Skip button
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
  });

  // ===== merging (incl. multi-conflict): Abort only =====
  it('merging: banner text, merge message and ONLY Abort (no Continue, no Skip)', () => {
    renderBanner(makeStatus({
      isMerging: true,
      merge: { message: "Merge branch 'feature/x'" },
    }));
    expect(screen.getByTestId('repo-state-banner')).toHaveTextContent(
      'The working tree is in merging-state.'
    );
    expect(screen.getByTestId('merge-message')).toHaveTextContent("Merge branch 'feature/x'");
    expect(screen.getByRole('button', { name: 'Abort' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abort' }));
    expect(handlers.merge.onAbort).toHaveBeenCalledTimes(1);
    // A plain Commit is the way to COMPLETE a merge — not blocked
    expect(isCommitBlocked(makeStatus({ isMerging: true }))).toBe(false);
  });

  // ===== rebasing (incl. multi-step): Continue, Abort =====
  it('rebasing: banner text, progress and Continue / Abort (NO Skip, but Step X of Y)', () => {
    renderBanner(makeStatus({
      isRebasing: true,
      rebase: { step: 2, total: 5 },
    }));
    expect(screen.getByTestId('repo-state-banner')).toHaveTextContent(
      'The working tree is in rebasing-state.'
    );
    expect(screen.getByTestId('rebase-progress')).toHaveTextContent('Step 2 of 5');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(handlers.rebase.onContinue).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Abort' }));
    expect(handlers.rebase.onAbort).toHaveBeenCalledTimes(1);
    // NO Skip button
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
  });

  // ===== bisecting (incl. multi): Mark HEAD as Bad, Mark HEAD as Good, Abort =====
  it('bisecting: banner text, candidate rev, Mark HEAD as Bad / Good / Abort (NO Skip, NO Reset button)', () => {
    renderBanner(makeStatus({
      isBisecting: true,
      bisect: { rev: '1111222233334444555566667777888899990000' },
      detached: true,
    }));
    expect(screen.getByTestId('repo-state-banner')).toHaveTextContent(
      'The working tree is in bisecting-state.'
    );
    expect(screen.getByTestId('bisect-rev')).toHaveTextContent('Testing 1111222');
    fireEvent.click(screen.getByRole('button', { name: 'Mark HEAD as Good' }));
    expect(handlers.bisect.onGood).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Mark HEAD as Bad' }));
    expect(handlers.bisect.onBad).toHaveBeenCalledTimes(1);
    // The "Abort" button is wired to onReset (git bisect reset ends the session)
    fireEvent.click(screen.getByRole('button', { name: 'Abort' }));
    expect(handlers.bisect.onReset).toHaveBeenCalledTimes(1);
    // NO Skip / Reset buttons (the Reset action is labeled "Abort")
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
  });

  // ===== busy =====
  it('disables every resolution button while busy', () => {
    renderBanner(makeStatus({
      isCherryPicking: true,
      cherryPick: { commit: 'abc', subject: '', empty: true },
    }), true);
    for (const name of ['Continue', 'Abort']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  // ===== shared lib rules =====
  it('lib: priority when several flags are set + Pull-blocking texts exist for every state', () => {
    // cherry-pick wins over the others
    const st = getRepoInProgressState(makeStatus({
      isCherryPicking: true, isMerging: true, isRebasing: true, isReverting: true, isBisecting: true,
    }));
    expect(st?.key).toBe('cherry-picking');
    expect(getRepoInProgressState(makeStatus({ isReverting: true, isMerging: true }))?.key).toBe('reverting');
    expect(getRepoInProgressState(makeStatus({ isMerging: true, isRebasing: true }))?.key).toBe('merging');
    expect(getRepoInProgressState(makeStatus({ isRebasing: true, isBisecting: true }))?.key).toBe('rebasing');
    expect(getRepoInProgressState(makeStatus({ isBisecting: true }))?.key).toBe('bisecting');

    // every state defines a Pull reason + blocked hint (Pull blocked, Fetch allowed)
    for (const key of ['cherry-picking', 'reverting', 'merging', 'rebasing', 'bisecting'] as const) {
      const s = getRepoInProgressState(makeStatus(
        key === 'cherry-picking' ? { isCherryPicking: true }
          : key === 'reverting' ? { isReverting: true }
          : key === 'merging' ? { isMerging: true }
          : key === 'rebasing' ? { isRebasing: true }
          : { isBisecting: true }
      ));
      expect(s?.pullReason).toMatch(/is in progress/);
      expect(s?.blockedHint).toMatch(/Changes page/);
    }
  });

  it('lib: Commit is blocked in every state EXCEPT merging', () => {
    expect(isCommitBlocked(makeStatus())).toBe(false);
    expect(isCommitBlocked(makeStatus({ isCherryPicking: true }))).toBe(true);
    expect(isCommitBlocked(makeStatus({ isReverting: true }))).toBe(true);
    expect(isCommitBlocked(makeStatus({ isRebasing: true }))).toBe(true);
    expect(isCommitBlocked(makeStatus({ isBisecting: true }))).toBe(true);
    expect(isCommitBlocked(makeStatus({ isMerging: true }))).toBe(false);
  });
});
