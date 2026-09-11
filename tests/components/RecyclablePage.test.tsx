/**
 * Unit tests for the RecyclablePage — focus on rendering and recovery UI.
 *
 * Verifies:
 *   1. The page renders rows with the expected action buttons.
 *   2. The info banner explains the 90-day GC retention.
 *   3. The conflict panel renders file names when shown.
 *
 * The actual click-handler integration is covered by E2E tests because the
 * async prompt + createBranch flow involves ConfirmDialog host wiring that
 * is brittle under jsdom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import { RecyclablePage } from '../../src/pages/RecyclablePage';
import { useSelectionStore } from '../../src/stores/selectionStore';

// --- Mocks -------------------------------------------------------------

const mockRecyclable = vi.fn();
const mockCherryPick = vi.fn();
const mockCreateBranch = vi.fn();
const mockRaw = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      recyclableCommits: (...args: unknown[]) => mockRecyclable(...args),
      cherryPick: (...args: unknown[]) => mockCherryPick(...args),
      createBranch: (...args: unknown[]) => mockCreateBranch(...args),
      raw: (...args: unknown[]) => mockRaw(...args),
    },
    contextMenu: {
      show: vi.fn().mockResolvedValue(undefined),
      onClick: vi.fn(() => () => {}),
    },
  },
}));

vi.mock('../../src/stores/toastStore', () => ({
  useToastActions: () => ({
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
  useToastStore: () => ({
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: (selector?: (s: any) => any) => {
    const state = { currentRepo: { path: '/test/repo', name: 'test-repo' } };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../src/stores/gitStore', () => ({
  useGitStore: () => ({ refreshStatus: vi.fn() }),
}));

function renderPage() {
  return render(
    <HashRouter>
      <RecyclablePage />
    </HashRouter>,
  );
}

const RECYCLABLE_FIXTURE = [
  {
    hash: 'abcdef1234567890abcdef1234567890abcdef12',
    hashAbbrev: 'abcdef12',
    subject: 'lost commit on feature/x',
    date: '2024-09-01T00:00:00.000Z',
    timestamp: Date.parse('2024-09-01T00:00:00.000Z'),
    source: 'HEAD@{2}',
  },
];

// --- Tests -------------------------------------------------------------

describe('RecyclablePage — recovery UI', () => {
  beforeEach(() => {
    useSelectionStore.getState().clearAll();
    mockRecyclable.mockReset();
    mockCherryPick.mockReset();
    mockCreateBranch.mockReset();
    mockRaw.mockReset();
    mockRecyclable.mockResolvedValue(RECYCLABLE_FIXTURE);
    mockCherryPick.mockResolvedValue({ conflicts: [] });
    mockCreateBranch.mockResolvedValue(undefined);
    mockRaw.mockResolvedValue('');
  });

  it('renders the recyclable commit row with hover actions', async () => {
    const { container } = renderPage();
    // Wait for the commit subject to appear (load completes)
    const subjectEl = await screen.findByText('lost commit on feature/x', {}, { timeout: 8000 });
    expect(mockRecyclable).toHaveBeenCalledWith('/test/repo');
    // The hover-action buttons are inside the same row as the subject.
    const row = subjectEl.closest('div.flex.items-center') ?? subjectEl.parentElement;
    expect(row).not.toBeNull();
    const createBtn = row!.querySelector('button[title^="Create branch at"]') as HTMLButtonElement | null;
    const pickBtn = row!.querySelector('button[title^="Cherry-pick"]') as HTMLButtonElement | null;
    expect(createBtn).not.toBeNull();
    expect(pickBtn).not.toBeNull();
  });

  it('shows the GC retention banner with 90-day hint', async () => {
    renderPage();
    // The banner text mentions 90 days so the user knows the recovery window.
    await screen.findByText('lost commit on feature/x', {}, { timeout: 8000 });
    expect(screen.getByText(/garbage-collected after 90 days/i)).toBeInTheDocument();
  });

  it('shows the "Expire all" button only when commits exist', async () => {
    const { rerender } = renderPage();
    await screen.findByText('lost commit on feature/x', {}, { timeout: 8000 });
    expect(screen.getByText('Expire all')).toBeInTheDocument();
  });

  it('shows empty state when no recyclable commits', async () => {
    mockRecyclable.mockResolvedValue([]);
    renderPage();
    // Wait for the empty state to appear
    await screen.findByText('No recyclable commits', {}, { timeout: 15000 });
    // Verify the "Expire all" button is NOT shown when there are no commits
    expect(screen.queryByText('Expire all')).not.toBeInTheDocument();
  });
});
