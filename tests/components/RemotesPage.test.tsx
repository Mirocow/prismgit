import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RemotesPage } from '../../src/pages/RemotesPage';

// Mock the git API: two remotes — one with identical fetch/push URLs,
// one with a separate push URL (extra "Copy push URL" menu item).
const mockRemotes = vi.fn();
const mockShow = vi.fn().mockResolvedValue(true);

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      remotes: (...args: unknown[]) => mockRemotes(...args),
    },
    contextMenu: {
      show: (...args: unknown[]) => mockShow(...args),
      onClick: vi.fn(() => () => {}),
    },
  },
}));

// Stable toast mock: a fresh object per render would recreate `load`
// (useCallback dep) and re-trigger the load effect on every render.
const toastMock = { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() };
vi.mock('../../src/stores/toastStore', () => ({
  useToastStore: () => toastMock,
}));

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: () => ({
    currentRepo: { path: '/test/repo', name: 'test-repo' },
  }),
}));

function lastShownItems(): Array<Record<string, unknown>> {
  const calls = mockShow.mock.calls;
  return calls[calls.length - 1][0] as Array<Record<string, unknown>>;
}

describe('RemotesPage — right-click context menu on a remote row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRemotes.mockResolvedValue([
      {
        name: 'origin',
        refs: { fetch: 'https://git.example.com/team/repo.git', push: 'https://git.example.com/team/repo.git' },
      },
      {
        name: 'mirror',
        refs: { fetch: 'https://cdn.example.com/repo.git', push: 'ssh://git@host/team/repo.git' },
      },
    ]);
  });

  it('shows a native context menu with SmartGit-like actions on right click', async () => {
    render(<RemotesPage />);
    await waitFor(() => expect(screen.getByText('origin')).toBeInTheDocument());

    fireEvent.contextMenu(screen.getByText('origin'));

    await waitFor(() => expect(mockShow).toHaveBeenCalledTimes(1));
    const items = lastShownItems();
    const labels = items.map((i) => i.label ?? '---');

    expect(labels).toEqual([
      "Fetch 'origin' (with prune)",
      'Preview remote refs (ls-remote)',
      'Copy fetch URL',
      '---',
      'Browse branches',
      "Edit 'origin'...",
      "Rename 'origin'...",
      '---',
      'Perform background Poll or Fetch',
      '---',
      "Remove remote 'origin'...",
    ]);
    // Checkbox item for the background poll toggle
    const checkbox = items.find((i) => i.clickId === 'toggle-background');
    expect(checkbox).toMatchObject({ type: 'checkbox', checked: false });
  });

  it('adds "Copy push URL" for a remote with a separate push URL', async () => {
    render(<RemotesPage />);
    await waitFor(() => expect(screen.getByText('mirror')).toBeInTheDocument());

    fireEvent.contextMenu(screen.getByText('mirror'));

    await waitFor(() => expect(mockShow).toHaveBeenCalledTimes(1));
    const items = lastShownItems();
    const labels = items.map((i) => i.label ?? '---');
    expect(labels).toContain('Copy push URL');
    expect(labels.indexOf('Copy push URL')).toBeGreaterThan(labels.indexOf('Copy fetch URL'));
  });

  it('does not open a menu on plain left click', async () => {
    render(<RemotesPage />);
    await waitFor(() => expect(screen.getByText('origin')).toBeInTheDocument());

    fireEvent.click(screen.getByText('origin'));
    // Give any accidental async menu a chance to (wrongly) appear
    await new Promise((r) => setTimeout(r, 20));
    expect(mockShow).not.toHaveBeenCalled();
  });
});
