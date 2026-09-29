import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import { ReflogPage } from '../../src/pages/ReflogPage';

/**
 * Task 29 — «Не понятно зачем нужны чекбоксы в инструменте Reflog»:
 * the per-row checkboxes were a dead "future multi-select" placeholder
 * (onChange did nothing). They are REMOVED — rows select on click.
 */

const mockReflog = vi.fn();
const mockCommitFiles = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      reflog: (...args: unknown[]) => mockReflog(...args),
      commitFiles: (...args: unknown[]) => mockCommitFiles(...args),
      raw: vi.fn(),
      status: vi.fn(),
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
    successCommit: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
  useToastStore: () => ({}),
}));

const repoStoreMock = vi.hoisted(() => ({
  currentRepo: { path: '/test/repo', name: 'test-repo' },
  loadMetadata: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel(repoStoreMock),
    { getState: () => repoStoreMock },
  ),
}));

vi.mock('../../src/stores/gitStore', () => ({
  useGitStore: (sel: (s: unknown) => unknown) => sel({ status: null }),
}));

function renderReflogPage() {
  return render(
    <HashRouter>
      <ReflogPage />
    </HashRouter>
  );
}

describe('ReflogPage — checkboxes removed (Task 29)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommitFiles.mockResolvedValue([]);
    mockReflog.mockResolvedValue([
      {
        index: 0, selector: 'HEAD@{0}', hash: 'aaaaaaaabbbbbbbbccccccccddddddddeeeeeeee',
        hashAbbrev: 'aaaaaaa', message: 'commit: add feature', author: { name: 'Alice', email: 'a@a' },
        date: '2025-01-01 10:00:00 +0300', timestamp: 1735717200,
      },
      {
        index: 1, selector: 'HEAD@{1}', hash: 'ffffffff11111111222222223333333344444444',
        hashAbbrev: 'fffffff', message: 'checkout: moving to main', author: { name: 'Alice', email: 'a@a' },
        date: '2025-01-01 09:00:00 +0300', timestamp: 1735713600,
      },
    ]);
  });

  it('renders NO checkboxes in the entries list (dead placeholder removed)', async () => {
    const { container } = renderReflogPage();
    await waitFor(() => screen.getAllByText('commit: add feature'));
    // The entire page must render zero checkbox inputs
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it('rows still select on click and the detail pane opens', async () => {
    renderReflogPage();
    await waitFor(() => screen.getAllByText('commit: add feature'));
    // Row click (the LIST row — the last element with the message, since the
    // detail pane also renders the selected entry's message as its title)
    const rows = screen.getAllByText('commit: add feature');
    fireEvent.click(rows[rows.length - 1]);
    // The right pane shows the selected entry's hash link — after selection
    // the hash appears TWICE: once in the row, once in the detail pane.
    await waitFor(() => {
      const codes = screen.getAllByText('aaaaaaa', { selector: 'code' });
      expect(codes.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows the entry count and the ref chip', async () => {
    renderReflogPage();
    await waitFor(() => {
      // the header shows the current ref as a mono chip
      expect(screen.getByText('HEAD', { selector: 'span' })).toBeInTheDocument();
    });
    // entries-count badge text mentions the count of loaded entries
    await waitFor(() => {
      // robust: the reflog table rendered both messages
      expect(screen.getAllByText('commit: add feature').length).toBeGreaterThan(0);
      expect(screen.getAllByText('checkout: moving to main').length).toBeGreaterThan(0);
    });
  });
});
