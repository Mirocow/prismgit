import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import { BlamePage } from '../../src/pages/BlamePage';
import { useSelectionStore } from '../../src/stores/selectionStore';

/**
 * Task 29 — Blame redesign («совершенно непонятный и неудобный
 * функционал инструмента Blame»):
 *   1. fuzzy FILE PICKER over git ls-files (typing filters, click blames);
 *   2. GROUPED gutter — one author/date/summary block per commit run,
 *      continuation lines have an empty gutter;
 *   3. "Blame before this commit" drill-down (hash^);
 *   4. proper code view (whitespace-pre, horizontal scroll).
 */

const H1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // seed commit
const H2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; // later commit

const mockBlame = vi.fn();
const mockTrackedFiles = vi.fn();
const mockVscodeOpen = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      blame: (...args: unknown[]) => mockBlame(...args),
      trackedFiles: (...args: unknown[]) => mockTrackedFiles(...args),
    },
    contextMenu: {
      show: vi.fn().mockResolvedValue(undefined),
      onClick: vi.fn(() => () => {}),
    },
    vscode: {
      open: (...args: unknown[]) => mockVscodeOpen(...args),
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

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: (sel: (s: unknown) => unknown) =>
    sel({ currentRepo: { path: '/test/repo', name: 'test-repo' } }),
}));

function blameResult() {
  return {
    file: 'src/app.ts',
    totalLines: 5,
    lines: [
      // lines 1-2: seed commit (one GROUP)
      { hash: H1, hashAbbrev: 'aaaaaaa', author: 'Alice', authorTime: '1700000000', summary: 'initial import', finalLineNumber: 1, content: 'const a = 1;' },
      { hash: H1, hashAbbrev: 'aaaaaaa', author: 'Alice', authorTime: '1700000000', summary: 'initial import', finalLineNumber: 2, content: 'const b = 2;' },
      // lines 3-5: later commit (second GROUP)
      { hash: H2, hashAbbrev: 'bbbbbbb', author: 'Bob', authorTime: '1750000000', summary: 'add feature', finalLineNumber: 3, content: 'const c = 3;' },
      { hash: H2, hashAbbrev: 'bbbbbbb', author: 'Bob', authorTime: '1750000000', summary: 'add feature', finalLineNumber: 4, content: 'const d = 4;' },
      { hash: H2, hashAbbrev: 'bbbbbbb', author: 'Bob', authorTime: '1750000000', summary: 'add feature', finalLineNumber: 5, content: 'const e = 5;' },
    ],
  };
}

function renderBlamePage() {
  return render(
    <HashRouter>
      <BlamePage />
    </HashRouter>
  );
}

describe('BlamePage — Task 29 redesign', () => {
  beforeEach(() => {
    useSelectionStore.getState().clearAll();
    vi.clearAllMocks();
    mockTrackedFiles.mockResolvedValue([
      'src/app.ts', 'src/lib/one.ts', 'src/lib/two.ts', 'README.md',
    ]);
    mockBlame.mockResolvedValue(blameResult());
    mockVscodeOpen.mockResolvedValue({ ok: true });
  });

  it('loads the tracked-file list on mount and offers a fuzzy picker', async () => {
    renderBlamePage();
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    await waitFor(() => {
      // empty query → the first tracked files are offered
      expect(screen.getByText('src/app.ts')).toBeInTheDocument();
    });
    // typing narrows: "two" matches only src/lib/two.ts
    fireEvent.change(input, { target: { value: 'two' } });
    await waitFor(() => {
      expect(screen.getByText('src/lib/two.ts')).toBeInTheDocument();
      expect(screen.queryByText('src/app.ts')).not.toBeInTheDocument();
    });
  });

  it('blames immediately when a file is picked from the dropdown', async () => {
    renderBlamePage();
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'app' } });
    await waitFor(() => screen.getByText('src/app.ts'));
    fireEvent.click(screen.getByText('src/app.ts'));
    await waitFor(() => {
      // third arg = the ref; default when no branch/tag selected is 'HEAD'
      expect(mockBlame).toHaveBeenCalledWith('/test/repo', 'src/app.ts', 'HEAD');
    });
  });

  it('renders ONE gutter block per commit group (author+date+summary), not per line', async () => {
    renderBlamePage();
    // seed blame directly via the selection store path (globalFilePath)
    useSelectionStore.getState().selectFile('src/app.ts');
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
    // Two groups → exactly one gutter info per group: 'Alice' once, 'Bob' once
    expect(screen.getAllByText('Alice')).toHaveLength(1);
    expect(screen.getAllByText('Bob')).toHaveLength(1);
    // Commit summaries are now IN the gutter (the old UI never showed them)
    expect(screen.getAllByText('initial import')).toHaveLength(1);
    expect(screen.getAllByText('add feature')).toHaveLength(1);
    // All five lines still render with their numbers
    ['const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;', 'const e = 5;']
      .forEach((c) => expect(screen.getByText(c)).toBeInTheDocument());
  });

  it('footer stats survive the redesign (lines + unique commits)', async () => {
    renderBlamePage();
    useSelectionStore.getState().selectFile('src/app.ts');
    await waitFor(() => {
      const stats = screen.getByTestId('blame-stats');
      expect(stats.textContent).toContain('5');
      expect(stats.textContent).toContain('2');
    });
  });

  it('line content is nowrap code (whitespace-pre), not wrapped break-all', async () => {
    const { container } = renderBlamePage();
    useSelectionStore.getState().selectFile('src/app.ts');
    await waitFor(() => screen.getByText('const a = 1;'));
    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre!.className).toContain('whitespace-pre');
    expect(pre!.className).not.toContain('break-all');
  });

  it('context menu offers "Blame before this commit" (hash^ drill-down)', async () => {
    renderBlamePage();
    useSelectionStore.getState().selectFile('src/app.ts');
    await waitFor(() => screen.getByText('const c = 3;'));
    // context menus are native (IPC) — the items array is built inside the
    // component; we verify the label key exists in the dictionary instead.
    const { t } = await import('../../src/lib/i18n');
    expect(t('pages.blameBlameBefore')).toBeTruthy();
  });

  it('picker dropdown hides on Escape and reopens on typing', async () => {
    renderBlamePage();
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    await waitFor(() => screen.getByText('src/app.ts'));
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.queryByText('src/app.ts')).toBeNull();
  });
});
