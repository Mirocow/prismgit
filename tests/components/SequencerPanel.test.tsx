/**
 * Unit tests for SequencerPanel — focus on the Skip button (new) and the
 * empty-commit detection that drives the banner copy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import { SequencerPanel } from '../../src/components/SequencerPanel';

// --- Mocks -------------------------------------------------------------

const mockStatus = vi.fn();
const mockCherryPickContinue = vi.fn();
const mockCherryPickAbort = vi.fn();
const mockCherryPickSkip = vi.fn();
const mockRevertContinue = vi.fn();
const mockRevertAbort = vi.fn();
const mockRevertSkip = vi.fn();
const mockRefreshStatus = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      status: (...args: unknown[]) => mockStatus(...args),
      cherryPickContinue: (...args: unknown[]) => mockCherryPickContinue(...args),
      cherryPickAbort: (...args: unknown[]) => mockCherryPickAbort(...args),
      cherryPickSkip: (...args: unknown[]) => mockCherryPickSkip(...args),
      revertContinue: (...args: unknown[]) => mockRevertContinue(...args),
      revertAbort: (...args: unknown[]) => mockRevertAbort(...args),
      revertSkip: (...args: unknown[]) => mockRevertSkip(...args),
    },
    contextMenu: {
      show: vi.fn().mockResolvedValue(undefined),
      onClick: vi.fn(() => () => {}),
    },
  },
}));

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: () => ({ currentRepo: { path: '/test/repo' } }),
}));

vi.mock('../../src/stores/gitStore', () => ({
  useGitStore: () => ({ refreshStatus: mockRefreshStatus }),
}));

vi.mock('../../src/stores/toastStore', () => ({
  useToastStore: () => ({
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../../src/components/ConfirmDialog', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
  promptDialog: vi.fn(() => Promise.resolve(null)),
}));

function renderPanel(kind: 'cherry-pick' | 'revert' = 'cherry-pick') {
  return render(
    <HashRouter>
      <SequencerPanel kind={kind} repoPath="/test/repo" onClose={vi.fn()} />
    </HashRouter>,
  );
}

// --- Tests -------------------------------------------------------------

describe('SequencerPanel — Skip + empty-commit UX', () => {
  beforeEach(() => {
    mockStatus.mockReset();
    mockCherryPickContinue.mockReset();
    mockCherryPickAbort.mockReset();
    mockCherryPickSkip.mockReset();
    mockRevertContinue.mockReset();
    mockRevertAbort.mockReset();
    mockRevertSkip.mockReset();
    mockRefreshStatus.mockReset();
    mockStatus.mockResolvedValue({ conflicted: [] });
    mockCherryPickContinue.mockResolvedValue(undefined);
    mockCherryPickSkip.mockResolvedValue(undefined);
    mockCherryPickAbort.mockResolvedValue(undefined);
    mockRefreshStatus.mockResolvedValue(undefined);
  });

  it('renders a Skip button next to Continue and Abort', async () => {
    renderPanel('cherry-pick');
    // Wait for the loadState to settle
    await waitFor(() => expect(mockStatus).toHaveBeenCalledWith('/test/repo'));
    expect(screen.getByText('Skip')).toBeInTheDocument();
    expect(screen.getByText('Continue')).toBeInTheDocument();
    expect(screen.getByText('Abort')).toBeInTheDocument();
  });

  it('shows the empty-commit hint when there are no conflicts', async () => {
    mockStatus.mockResolvedValue({ conflicted: [] });
    renderPanel('cherry-pick');
    await waitFor(() => expect(mockStatus).toHaveBeenCalledWith('/test/repo'));
    // The empty-commit copy mentions "Skip to drop it"
    expect(screen.getByText(/empty commit — Skip to drop it, or Abort/i)).toBeInTheDocument();
  });

  it('shows conflict count when there are conflicts', async () => {
    mockStatus.mockResolvedValue({ conflicted: ['src/a.ts', 'src/b.ts'] });
    renderPanel('cherry-pick');
    await waitFor(() => expect(mockStatus).toHaveBeenCalledWith('/test/repo'));
    expect(screen.getByText(/2 conflicted files/i)).toBeInTheDocument();
  });

  it('clicking Skip calls api.git.cherryPickSkip for cherry-pick kind', async () => {
    renderPanel('cherry-pick');
    await waitFor(() => expect(mockStatus).toHaveBeenCalledWith('/test/repo'));
    fireEvent.click(screen.getByText('Skip'));
    await waitFor(() => expect(mockCherryPickSkip).toHaveBeenCalledWith('/test/repo'));
  });

  it('clicking Skip calls api.git.revertSkip for revert kind', async () => {
    renderPanel('revert');
    await waitFor(() => expect(mockStatus).toHaveBeenCalledWith('/test/repo'));
    fireEvent.click(screen.getByText('Skip'));
    await waitFor(() => expect(mockRevertSkip).toHaveBeenCalledWith('/test/repo'));
  });

  it('mentions that other operations are blocked in the banner copy', async () => {
    renderPanel('cherry-pick');
    await waitFor(() => expect(mockStatus).toHaveBeenCalledWith('/test/repo'));
    expect(screen.getByText(/other branch operations are blocked/i)).toBeInTheDocument();
  });
});
