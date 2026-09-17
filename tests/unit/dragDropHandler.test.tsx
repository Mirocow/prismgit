/**
 * Unit tests for the rewritten DragDropHandler.
 *
 * The previous implementation attached dragenter/dragleave/dragover/drop
 * to `window` AND rendered a full-screen blue overlay — the user
 * reported this as a bug ("drag-and-drop repos should be limited to
 * the repo list / groups section, and the blue dimming should go").
 *
 * The rewrite:
 *   - Listens to window-level events (still), but only renders the
 *     drop highlight when the cursor is over `[data-testid="repo-tree"]`.
 *   - Drops outside the repo list are ignored.
 *   - The drop highlight is a fixed-position layer sized to match
 *     the repo list's bounding rect (not full-window).
 *   - No more blue accent tint over the whole window.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { DragDropHandler } from '../../src/components/DragDropHandler';

// --- Mocks -------------------------------------------------------------

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: (selector?: (s: any) => any) => {
    const state = {
      currentRepo: null,
      openRepository: vi.fn(),
      loadRepos: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../src/stores/toastStore', () => ({
  useToastActions: () => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
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

vi.mock('../../src/lib/api', () => ({
  api: {
    git: { isRepo: vi.fn() },
    settings: { addRepo: vi.fn(), refreshRepoStats: vi.fn() },
  },
}));

vi.mock('../../src/lib/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

// --- Polyfills --------------------------------------------------------
// jsdom does NOT define DataTransfer or DragEvent constructors. Provide
// minimal stubs so the tests can synthesise drag events.

class MockDataTransfer {
  types: string[] = ['Files'];
  items: { add: (file: File) => void } = {
    add: (file: File) => {
      this.files.push(file);
      this.types.push(file.name);
    },
  };
  files: File[] = [];
  dropEffect: 'none' | 'copy' | 'move' | 'link' = 'none';
  effectAllowed: 'none' | 'copy' | 'copyLink' | 'copyMove' | 'link' | 'linkMove' | 'move' | 'all' = 'none';
  setData() {}
  getData() { return ''; }
  clearData() {}
}

class MockDragEvent extends Event {
  dataTransfer: MockDataTransfer | null;
  constructor(type: string, init: { dataTransfer?: MockDataTransfer; bubbles?: boolean; cancelable?: boolean } = {}) {
    super(type, { bubbles: init.bubbles, cancelable: init.cancelable });
    this.dataTransfer = init.dataTransfer ?? null;
  }
}

// Make them available on the global scope.
(globalThis as any).DataTransfer = MockDataTransfer;
(globalThis as any).DragEvent = MockDragEvent;

// --- Helpers ------------------------------------------------------------

function createDataTransferWithFiles(): MockDataTransfer {
  const dt = new MockDataTransfer();
  dt.items.add(new File([''], 'folder'));
  return dt;
}

function dispatchDragEvent(
  type: 'dragenter' | 'dragleave' | 'dragover' | 'drop',
  target: Node,
  dt: MockDataTransfer,
) {
  const event = new MockDragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
}

// --- Tests ---------------------------------------------------------------

describe('DragDropHandler — zone-restricted drop behavior', () => {
  let repoTreeEl: HTMLElement;
  let bodyEl: HTMLElement;

  beforeEach(() => {
    bodyEl = document.body;
    repoTreeEl = document.createElement('div');
    repoTreeEl.setAttribute('data-testid', 'repo-tree');
    repoTreeEl.style.width = '300px';
    repoTreeEl.style.height = '400px';
    bodyEl.appendChild(repoTreeEl);

    repoTreeEl.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 300, height: 400,
      right: 300, bottom: 400, x: 0, y: 0, toJSON: () => ({}),
    });
  });

  afterEach(() => {
    if (repoTreeEl.parentNode) repoTreeEl.parentNode.removeChild(repoTreeEl);
  });

  it('renders nothing when no drag is active', () => {
    const { container } = render(<DragDropHandler />);
    expect(container.firstChild).toBeNull();
  });

  it('does NOT show the drop highlight when drag enters a non-repo-list area', async () => {
    render(<DragDropHandler />);

    // Dispatch dragenter on document.body (not the repo tree).
    act(() => {
      dispatchDragEvent('dragenter', bodyEl, createDataTransferWithFiles());
    });

    await new Promise((r) => setTimeout(r, 50));

    // The drop highlight label should NOT be visible.
    const label = screen.queryByText('shell.dropReposTitle');
    expect(label).toBeNull();
  });

  it('shows the drop highlight when drag enters the repo list', async () => {
    render(<DragDropHandler />);

    act(() => {
      dispatchDragEvent('dragenter', repoTreeEl, createDataTransferWithFiles());
    });

    await waitFor(() => {
      expect(screen.getByText('shell.dropReposTitle')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('hides the drop highlight when drag leaves the repo list', async () => {
    render(<DragDropHandler />);

    act(() => {
      dispatchDragEvent('dragenter', repoTreeEl, createDataTransferWithFiles());
    });
    await waitFor(() => {
      expect(screen.getByText('shell.dropReposTitle')).toBeInTheDocument();
    }, { timeout: 3000 });

    act(() => {
      dispatchDragEvent('dragleave', repoTreeEl, createDataTransferWithFiles());
    });

    await waitFor(() => {
      expect(screen.queryByText('shell.dropReposTitle')).toBeNull();
    }, { timeout: 3000 });
  });

  it('does NOT render a full-window blue overlay', async () => {
    const { container } = render(<DragDropHandler />);

    act(() => {
      dispatchDragEvent('dragenter', repoTreeEl, createDataTransferWithFiles());
    });

    await waitFor(() => {
      expect(screen.getByText('shell.dropReposTitle')).toBeInTheDocument();
    }, { timeout: 3000 });

    // The OLD implementation used className="fixed inset-0 ..." with
    // backgroundColor: 'var(--accent-muted)'. The NEW implementation
    // uses left/top/width/height matching the repo tree (not inset-0).
    const overlays = container.querySelectorAll('.fixed.inset-0');
    expect(overlays.length).toBe(0);
  });
});
