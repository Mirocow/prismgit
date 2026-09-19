/**
 * Unit test for MergeEditor3Way (re-exported as ConflictMergeView).
 *
 * The previous tests asserted on the old contentEditable-based implementation
 * (testid "conflict-editor", highlighted HTML strings, etc.). The new
 * textarea+pre overlay uses a different DOM structure:
 *
 *   <textarea data-testid="merge-result-textarea" defaultValue="..."/>
 *   <pre aria-hidden="true">...highlighted HTML...</pre>
 *
 * Tests updated to assert on the new structure. The render-loop regression
 * guard (test #1) is preserved — that's the most important assertion.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import * as React from 'react';

// ===== Mocks =====
const mockGitRaw = vi.fn(async (repoPath: string, args: string[]) => {
  if (args[0] === 'ls-files' && args.includes('-u')) {
    return '100644 abc123 1\tfile.ts\n100644 def456 2\tfile.ts\n100644 ghi789 3\tfile.ts\n';
  }
  const arg = args[args.length - 1];
  if (arg === ':1:file.ts') return 'base line';
  if (arg === ':2:file.ts') return 'ours line';
  if (arg === ':3:file.ts') return 'theirs line';
  return '';
});

const mockFsReadFile = vi.fn(async () => {
  return 'line1\n<<<<<<< HEAD\nours line\n=======\ntheirs line\n>>>>>>> feature\nline3\n';
});

const mockFsWriteFile = vi.fn(async () => undefined);
const mockGitAdd = vi.fn(async () => undefined);
const mockGitOpenFile = vi.fn(async () => undefined);

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      raw: (...a: any[]) => mockGitRaw(...a),
      add: (...a: any[]) => mockGitAdd(...a),
      openFile: (...a: any[]) => mockGitOpenFile(...a),
    },
    fs: {
      readFile: (...a: any[]) => mockFsReadFile(...a),
      writeFile: (...a: any[]) => mockFsWriteFile(...a),
    },
    vscode: {
      openMerge: vi.fn(async () => ({ ok: false, detail: 'no vscode' })),
      openFileDiff: vi.fn(async () => ({ ok: false, detail: 'no vscode' })),
    },
  },
}));

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: (s?: any) => s ? s({ currentRepo: { path: '/test/repo', name: 'repo' } }) : { currentRepo: { path: '/test/repo', name: 'repo' } },
}));
vi.mock('../../src/stores/gitStore', () => ({
  useGitStore: (s?: any) => s ? s({ refreshStatus: vi.fn() }) : { refreshStatus: vi.fn() },
}));
vi.mock('../../src/stores/toastStore', () => {
  const toastActions = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  };
  return {
    useToastActions: () => toastActions,
    useToastStore: () => toastActions,
  };
});
vi.mock('../../src/lib/i18n', () => ({
  useI18n: () => ({
    t: (k: string, p?: any) => p
      ? Object.entries(p).reduce((s, [k2, v]) => s.replace(`{${k2}}`, String(v)), k)
      : k,
  }),
}));

describe('ConflictMergeView (MergeEditor3Way)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the 3-way panel without render loop', async () => {
    const { ConflictMergeView } = await import('../../src/components/ConflictMergeView');
    const onResolved = vi.fn();

    let renderCount = 0;
    const Wrapper = () => {
      renderCount++;
      return React.createElement(ConflictMergeView, { filePath: 'file.ts', onResolved });
    };

    const { unmount } = render(React.createElement(Wrapper));

    // Wait for loading to complete — if there's a render loop, this will timeout.
    // The new component renders a <textarea data-testid="merge-result-textarea">.
    await waitFor(() => {
      expect(screen.queryByTestId('merge-result-textarea')).toBeTruthy();
    }, { timeout: 5000 });

    // Should NOT have caused excessive renders (render loop = 100+).
    expect(renderCount).toBeLessThan(80);

    // Should have called git.raw for stages 1, 2, 3 (exactly once each — no loop).
    expect(mockGitRaw).toHaveBeenCalledWith('/test/repo', ['show', ':1:file.ts']);
    expect(mockGitRaw).toHaveBeenCalledWith('/test/repo', ['show', ':2:file.ts']);
    expect(mockGitRaw).toHaveBeenCalledWith('/test/repo', ['show', ':3:file.ts']);

    const stage1Calls = mockGitRaw.mock.calls.filter(c =>
      c[1] && c[1][c[1].length - 1] === ':1:file.ts'
    ).length;
    expect(stage1Calls).toBe(1);

    unmount();
  }, 10000);

  it('renders the conflict counter in the toolbar', async () => {
    const { ConflictMergeView } = await import('../../src/components/ConflictMergeView');

    render(React.createElement(ConflictMergeView, {
      filePath: 'file.ts',
      onResolved: vi.fn(),
    }));

    await waitFor(() => {
      expect(screen.queryByTestId('merge-result-textarea')).toBeTruthy();
    }, { timeout: 5000 });

    // The conflict counter ("1 of 1 conflicts" or similar) should appear.
    // i18n mock returns the key as-is when no params — search by "conflicts" word.
    const conflictsText = screen.queryAllByText(/conflicts/i);
    expect(conflictsText.length).toBeGreaterThan(0);
  }, 10000);

  it('textarea contains the conflict markers (editable)', async () => {
    const { ConflictMergeView } = await import('../../src/components/ConflictMergeView');

    render(React.createElement(ConflictMergeView, {
      filePath: 'file.ts',
      onResolved: vi.fn(),
    }));

    await waitFor(() => {
      expect(screen.queryByTestId('merge-result-textarea')).toBeTruthy();
    }, { timeout: 5000 });

    // The textarea's value should contain the conflict markers — this is the
    // KEY assertion that proves the user CAN edit the middle pane (the old
    // contentEditable+dangerouslySetInnerHTML approach did not expose this
    // text reliably; the new textarea's defaultValue does).
    const editor = screen.getByTestId('merge-result-textarea') as HTMLTextAreaElement;
    expect(editor.value).toContain('<<<<<<<');
    expect(editor.value).toContain('=======');
    expect(editor.value).toContain('>>>>>>>');
  }, 10000);

  it('Take Left button applies OURS resolution (textarea value updates)', async () => {
    const { ConflictMergeView } = await import('../../src/components/ConflictMergeView');

    render(React.createElement(ConflictMergeView, {
      filePath: 'file.ts',
      onResolved: vi.fn(),
    }));

    await waitFor(() => {
      expect(screen.queryByTestId('merge-result-textarea')).toBeTruthy();
    }, { timeout: 5000 });

    const editorBefore = screen.getByTestId('merge-result-textarea') as HTMLTextAreaElement;
    expect(editorBefore.value).toContain('<<<<<<<');

    // Find any "Take Left" button — there are floating per-conflict bars.
    const takeLeftButtons = screen.getAllByRole('button', { name: /takeLeft|Take Left/i });
    expect(takeLeftButtons.length).toBeGreaterThan(0);

    await act(async () => {
      takeLeftButtons[0].click();
      await new Promise(r => setTimeout(r, 50));
    });

    // After clicking Take Left, the textarea value should NO LONGER contain
    // the conflict markers (they've been replaced with the OURS content).
    // Note: the textarea is uncontrolled, but handleResolve explicitly sets
    // textareaRef.current.value = newText.
    const editorAfter = screen.getByTestId('merge-result-textarea') as HTMLTextAreaElement;
    expect(editorAfter.value).not.toContain('<<<<<<<');
    expect(editorAfter.value).toContain('ours line');
  }, 10000);

  it('Save & Stage button writes the textarea content to disk', async () => {
    const { ConflictMergeView } = await import('../../src/components/ConflictMergeView');

    render(React.createElement(ConflictMergeView, {
      filePath: 'file.ts',
      onResolved: vi.fn(),
    }));

    await waitFor(() => {
      expect(screen.queryByTestId('merge-result-textarea')).toBeTruthy();
    }, { timeout: 5000 });

    const saveButton = screen.getByRole('button', { name: /saveStage/i });
    expect(saveButton).toBeTruthy();
    expect(saveButton.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      saveButton.click();
      await new Promise(r => setTimeout(r, 100));
    });

    // writeFile should have been called with the textarea's content.
    expect(mockFsWriteFile).toHaveBeenCalled();
  }, 10000);

  it('syntax-highlighted <pre> layer contains the conflict markers', async () => {
    const { ConflictMergeView } = await import('../../src/components/ConflictMergeView');

    render(React.createElement(ConflictMergeView, {
      filePath: 'file.ts',
      onResolved: vi.fn(),
    }));

    await waitFor(() => {
      expect(screen.queryByTestId('merge-result-textarea')).toBeTruthy();
    }, { timeout: 5000 });

    // The <pre> layer is aria-hidden and shows the highlighted HTML.
    // It should contain the conflict markers as HTML-escaped text.
    const pre = document.querySelector('pre[aria-hidden="true"]');
    expect(pre).toBeTruthy();
    const preHtml = pre?.innerHTML || '';
    expect(preHtml).toContain('&lt;&lt;&lt;&lt;&lt;&lt;&lt;'); // HTML-escaped <<<<<<<
  }, 10000);
});
