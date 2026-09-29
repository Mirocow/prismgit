import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MergeInProgressPanel } from '../../src/components/MergeInProgressPanel';

/**
 * Task 29 — «В тоасте Коммит создан не отображается хеш комита»:
 * the merge-continue flow (the one users hit right after resolving
 * conflicts in the 3-way tool) used to fire a bare «Merge-коммит создан»
 * toast with NO hash. continueMerge now returns the new HEAD hash and the
 * toast shows it as a copyable chip.
 */

const mockStatus = vi.fn();
const mockContinueMerge = vi.fn();
const mockRefreshStatus = vi.fn();
const toastActions = {
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  successCommit: vi.fn(),
  show: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      status: (...args: unknown[]) => mockStatus(...args),
      continueMerge: (...args: unknown[]) => mockContinueMerge(...args),
    },
    contextMenu: {
      show: vi.fn().mockResolvedValue(undefined),
      onClick: vi.fn(() => () => {}),
    },
  },
}));

vi.mock('../../src/stores/toastStore', () => ({
  useToastActions: () => toastActions,
  useToastStore: () => ({}),
}));

vi.mock('../../src/stores/gitStore', () => ({
  useGitStore: () => ({ refreshStatus: mockRefreshStatus }),
}));

describe('MergeInProgressPanel — merge-commit toast carries the hash (Task 29)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatus.mockResolvedValue({ conflicted: [] });
    mockContinueMerge.mockResolvedValue('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
    mockRefreshStatus.mockResolvedValue(undefined);
  });

  it('Continue → successCommit toast with the merge commit hash', async () => {
    render(<MergeInProgressPanel repoPath="/test/repo" />);
    const continueBtn = await screen.findByRole('button', { name: /continue|продолж/i });
    fireEvent.click(continueBtn);
    await waitFor(() => {
      expect(mockContinueMerge).toHaveBeenCalledWith('/test/repo');
    });
    await waitFor(() => {
      expect(toastActions.successCommit).toHaveBeenCalledWith(
        expect.any(String),
        'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'
      );
    });
    // the old bare success() call is gone
    expect(toastActions.success).not.toHaveBeenCalled();
  });

  it('Continue failure → error toast, no success', async () => {
    mockContinueMerge.mockRejectedValue(new Error('cannot commit'));
    render(<MergeInProgressPanel repoPath="/test/repo" />);
    const continueBtn = await screen.findByRole('button', { name: /continue|продолж/i });
    fireEvent.click(continueBtn);
    await waitFor(() => {
      expect(toastActions.error).toHaveBeenCalled();
    });
    expect(toastActions.successCommit).not.toHaveBeenCalled();
  });
});
