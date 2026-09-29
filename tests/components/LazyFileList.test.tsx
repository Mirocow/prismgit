/**
 * Component tests for LazyFileList — progressive file-row rendering.
 *
 * Covers:
 *   - initial batch (50 rows) + sentinel with the "loading more" hint
 *   - IntersectionObserver callback → next batch grows the visible count
 *   - full list rendered → sentinel disappears
 *   - files prop change → visible count resets to the first batch
 *   - empty files → renders nothing
 *   - scroll container reset: ancestor .overflow-y-auto gets scrollTop=0
 *     when the file list content changes
 *
 * The IntersectionObserver is globally mocked by tests/setup.ts; we grab
 * its captured callback to drive sentinel visibility deterministically.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { LazyFileList } from '../../src/components/LazyFileList';
import type { FileStatus } from '../../src/lib/api';

// ── Capture the IntersectionObserver callback installed by the component ──
type IOCallback = (entries: { isIntersecting: boolean }[]) => void;
let ioCallback: IOCallback | null = null;
const observeSpy = vi.fn();
const disconnectSpy = vi.fn();

class MockIO {
  constructor(cb: IOCallback) { ioCallback = cb; }
  observe = observeSpy;
  unobserve = vi.fn();
  disconnect = disconnectSpy;
  takeRecords = vi.fn();
}
Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIO,
});

function makeFiles(n: number): FileStatus[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `dir/file-${String(i).padStart(3, '0')}.ts`,
    index: 'M',
    working_dir: ' ',
  }));
}

function renderList(files: FileStatus[]) {
  return render(
    <LazyFileList
      files={files}
      isStaged={false}
      renderRow={(f) => <div key={f.path} data-testid="file-row">{f.path}</div>}
    />
  );
}

beforeEach(() => {
  ioCallback = null;
  observeSpy.mockClear();
  disconnectSpy.mockClear();
});

describe('LazyFileList — progressive rendering', () => {
  it('renders only the first 50 rows with a sentinel hint', () => {
    renderList(makeFiles(120));
    const rows = screen.getAllByTestId('file-row');
    expect(rows).toHaveLength(50);
    // The sentinel shows the loading hint with progress numbers.
    expect(screen.getByText(/50/)).toBeInTheDocument();
    expect(observeSpy).toHaveBeenCalled();
  });

  it('grows by one batch when the sentinel becomes visible', () => {
    renderList(makeFiles(120));
    expect(ioCallback).not.toBeNull();
    act(() => { ioCallback!([{ isIntersecting: true }]); });
    expect(screen.getAllByTestId('file-row')).toHaveLength(100);
    // Sentinel still present — more files remain.
    act(() => { ioCallback!([{ isIntersecting: true }]); });
    expect(screen.getAllByTestId('file-row')).toHaveLength(120);
  });

  it('hides the sentinel when every file is rendered', () => {
    renderList(makeFiles(60));
    act(() => { ioCallback!([{ isIntersecting: true }]); });
    expect(screen.getAllByTestId('file-row')).toHaveLength(60);
    // Second trigger: visible count already == files.length → no hint node.
    const hint = screen.queryByText(/loading/i);
    expect(hint).toBeNull();
  });

  it('renders fewer than a batch in one go (small lists)', () => {
    renderList(makeFiles(7));
    expect(screen.getAllByTestId('file-row')).toHaveLength(7);
  });

  it('renders nothing for an empty file list', () => {
    const { container } = renderList([]);
    expect(container.firstChild).toBeNull();
    expect(observeSpy).not.toHaveBeenCalled();
  });
});

describe('LazyFileList — list change resets progressive state', () => {
  it('resets to the first batch when the file CONTENT changes', () => {
    const { rerender } = renderList(makeFiles(120));
    act(() => { ioCallback!([{ isIntersecting: true }]); });
    expect(screen.getAllByTestId('file-row')).toHaveLength(100);

    // Same length, different content (user switched folders).
    const next = makeFiles(120).map((f) => ({ ...f, path: `other/${f.path}` }));
    rerender(
      <LazyFileList
        files={next}
        isStaged={false}
        renderRow={(f) => <div key={f.path} data-testid="file-row">{f.path}</div>}
      />
    );
    // Back to the first batch of the NEW list.
    const rows = screen.getAllByTestId('file-row');
    expect(rows).toHaveLength(50);
    expect(rows[0].textContent).toContain('other/');
  });

  it('does NOT reset when only the array reference changes (same content)', () => {
    const files = makeFiles(120);
    const { rerender } = renderList(files);
    act(() => { ioCallback!([{ isIntersecting: true }]); });
    expect(screen.getAllByTestId('file-row')).toHaveLength(100);

    // New array reference, identical paths/statuses — e.g. a
    // rename-detection refresh. visibleCount must be preserved.
    const same = files.map((f) => ({ ...f }));
    rerender(
      <LazyFileList
        files={same}
        isStaged={false}
        renderRow={(f) => <div key={f.path} data-testid="file-row">{f.path}</div>}
      />
    );
    expect(screen.getAllByTestId('file-row')).toHaveLength(100);
  });
});

describe('LazyFileList — scroll reset', () => {
  it('resets the nearest scrollable ancestor when the list changes', () => {
    // jsdom's getComputedStyle reflects INLINE styles (Tailwind classes
    // have no stylesheet) — so the scroll ancestor uses style=, not class=.
    const files = makeFiles(80);
    const utils = render(
      <div style={{ overflowY: 'auto' }}>
        <LazyFileList
          files={files}
          isStaged={false}
          renderRow={(f) => <div key={f.path} data-testid="file-row">{f.path}</div>}
        />
      </div>
    );
    const scrollEl = utils.container.firstElementChild as HTMLElement;
    scrollEl.scrollTop = 4242;

    // Switch to different content → effect walks up to the scroll
    // container and resets scrollTop.
    const next = files.map((f) => ({ ...f, path: `z-${f.path}` }));
    utils.rerender(
      <div style={{ overflowY: 'auto' }}>
        <LazyFileList
          files={next}
          isStaged={false}
          renderRow={(f) => <div key={f.path} data-testid="file-row">{f.path}</div>}
        />
      </div>
    );
    expect(scrollEl.scrollTop).toBe(0);
  });
});
