import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RemotesPage } from '../../src/pages/RemotesPage';
import { api } from '../../src/lib/api';

// Mock the git API: two remotes — one with identical fetch/push URLs,
// one with a separate push URL (extra "Copy push URL" menu item).
const mockRemotes = vi.fn();
const mockShow = vi.fn().mockResolvedValue(true);

// Captured onClick callback — the singleton pattern in useContextMenu
// registers the callback once; we capture it here so the test can invoke it.
let capturedOnClick: ((clickId: string) => void) | null = null;

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      remotes: (...args: unknown[]) => mockRemotes(...args),
    },
    contextMenu: {
      show: (...args: unknown[]) => mockShow(...args),
      onClick: vi.fn((cb: (clickId: string) => void) => {
        capturedOnClick = cb;
        return () => { capturedOnClick = null; };
      }),
    },
  },
}));

// Stable toast mock: a fresh object per render would recreate `load`
// (useCallback dep) and re-trigger the load effect on every render.
const toastMock = { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() };
vi.mock('../../src/stores/toastStore', () => ({
  useToastActions: () => toastMock,
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
      'Repository Settings...',
      '---',
      "Remove remote 'origin'...",
    ]);
    // Checkbox item for the background poll toggle
    const checkbox = items.find((i) => i.clickId === 'toggle-background');
    expect(checkbox).toMatchObject({ type: 'checkbox', checked: false });
  });

  it('opening Repository Settings dispatches the same global event as the sidebar menu', async () => {
    const listener = vi.fn();
    window.addEventListener('prismgit:repo-settings', listener);
    render(<RemotesPage />);
    await waitFor(() => expect(screen.getByText('origin')).toBeInTheDocument());

    fireEvent.contextMenu(screen.getByText('origin'));
    await waitFor(() => expect(mockShow).toHaveBeenCalledTimes(1));

    // Simulate the user picking "Repository Settings..." in the native menu:
    // useContextMenu uses a global singleton listener — invoke the captured callback.
    expect(capturedOnClick).toBeDefined();
    capturedOnClick!('repo-settings');

    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    window.removeEventListener('prismgit:repo-settings', listener);
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
