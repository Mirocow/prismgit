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
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import * as React from 'react';

// ===== Mocks =====
// Path-aware: file.ts carries real unmerged stages; resolved.ts has NO
// stages (already resolved / unborn HEAD — the fallback path).
const mockGitRaw = vi.fn(async (repoPath: string, args: string[]) => {
  if (args[0] === 'ls-files' && args.includes('-u')) {
    const file = args[args.length - 1];
    if (file === 'resolved.ts' || file === 'nocommit.ts') return '';
    return '100644 abc123 1\tfile.ts\n100644 def456 2\tfile.ts\n100644 ghi789 3\tfile.ts\n';
  }
  const arg = args[args.length - 1];
  if (arg === ':1:file.ts') return 'base line';
  if (arg === ':2:file.ts') return 'ours line';
  if (arg === ':3:file.ts') return 'theirs line';
  if (arg === 'HEAD:nocommit.ts') throw new Error('unknown revision: HEAD');
  if (arg === 'HEAD:resolved.ts') return 'head version line';
  return '';
});

// Path-aware working-tree reader: plain content (no markers) for the
// fallback files, marker content for file.ts.
const mockFsReadFile = vi.fn(async (p: string) => {
  if (String(p).endsWith('nocommit.ts')) return 'fresh worktree body\nsecond line';
  if (String(p).endsWith('resolved.ts')) return 'resolved worktree body';
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

  // ─── User-reported issues (2026-09): no unmerged stages ───
  // "В конфликтах если нет коммитов то должен выводится не 'Маркеры
  //  конфликта не найдены…' а тело самого изменения"
  it('NO unmerged stages (repo without commits) → shows the change BODY, editable, not the dead-end placeholder', async () => {
    const { ConflictMergeView } = await import('../../src/components/ConflictMergeView');

    render(React.createElement(ConflictMergeView, {
      filePath: 'nocommit.ts',
      onResolved: vi.fn(),
    }));

    // The editor (not a placeholder) must appear.
    await waitFor(() => {
      expect(screen.queryByTestId('merge-result-textarea')).toBeTruthy();
    }, { timeout: 5000 });

    // The center pane carries the working-tree body of the change — the
    // fallback loaded HEAD (failed — unborn) + working tree content.
    const editor = screen.getByTestId('merge-result-textarea') as HTMLTextAreaElement;
    expect(editor.value).toContain('fresh worktree body');
    expect(editor.value).toContain('second line');
    // No conflict markers in this fallback — but the content IS shown.
    expect(editor.value).not.toContain('<<<<<<<');

    // The informational banner is present (state probe), the ERROR toast
    // "Не удалось загрузить конфликт" must NOT fire.
    expect(screen.queryByTestId('merge-editor-noconflicts')).toBeTruthy();

    // The fallback read HEAD + working tree.
    expect(mockGitRaw).toHaveBeenCalledWith('/test/repo', ['show', 'HEAD:nocommit.ts']);
    expect(mockFsReadFile).toHaveBeenCalledWith('/test/repo/nocommit.ts');
  }, 10000);

  it('no unmerged stages (already resolved) → HEAD vs worktree shown, editable', async () => {
    const { ConflictMergeView } = await import('../../src/components/ConflictMergeView');

    render(React.createElement(ConflictMergeView, {
      filePath: 'resolved.ts',
      onResolved: vi.fn(),
    }));

    await waitFor(() => {
      expect(screen.queryByTestId('merge-result-textarea')).toBeTruthy();
    }, { timeout: 5000 });

    // Result = the working tree body (the current resolution).
    const editor = screen.getByTestId('merge-result-textarea') as HTMLTextAreaElement;
    expect(editor.value).toContain('resolved worktree body');

    // The panes loaded HEAD as ours (and base) + working tree as theirs.
    expect(mockGitRaw).toHaveBeenCalledWith('/test/repo', ['show', 'HEAD:resolved.ts']);
    expect(mockFsReadFile).toHaveBeenCalledWith('/test/repo/resolved.ts');
  }, 10000);

  it('zero conflict regions from real stages → editor STILL renders (no dead-end)', async () => {
    // Both stages identical: diff3 finds zero conflict regions. The old
    // code replaced the whole editor with the "Маркеры конфликта не
    // найдены" placeholder. Now the editor + info banner must render.
    const { ConflictMergeView } = await import('../../src/components/ConflictMergeView');

    // Override the stage contents for this test (and the rest of the file
    // — it is the last test): ours == theirs, so diff3 finds zero
    // conflict regions.
    mockGitRaw.mockImplementation(async (_p: string, args: string[]) => {
      if (args[0] === 'ls-files' && args.includes('-u')) {
        return '100644 abc123 1\tsame.ts\n100644 def456 2\tsame.ts\n100644 ghi789 3\tsame.ts\n';
      }
      const arg = args[args.length - 1];
      if (arg === ':1:same.ts') return 'base';
      if (arg === ':2:same.ts') return 'identical change';
      if (arg === ':3:same.ts') return 'identical change';
      return '';
    });

    render(React.createElement(ConflictMergeView, {
      filePath: 'same.ts',
      onResolved: vi.fn(),
    }));

    await waitFor(() => {
      expect(screen.queryByTestId('merge-result-textarea')).toBeTruthy();
    }, { timeout: 5000 });

    // The editor shows the agreed content (not a placeholder, not base).
    const editor = screen.getByTestId('merge-result-textarea') as HTMLTextAreaElement;
    expect(editor.value).toContain('identical change');
    // The info banner co-exists with the editor.
    expect(screen.queryByTestId('merge-editor-noconflicts')).toBeTruthy();
  }, 10000);

  // ─── v3: «средняя панель недоступна для редактирования» ────────────────
  // User report 2026-09-28: typing into the middle pane changed the hidden
  // textarea value but the VISIBLE highlight layer (<pre>) stayed frozen
  // (it only rebuilt on resolve/reset via initialResult) — editing looked
  // impossible. The highlight now follows the live content (90ms debounce).

  it('typing updates the VISIBLE highlight layer (live re-highlight)', async () => {
    // A previous test in this file permanently overrode mockGitRaw with a
    // same.ts implementation — restore the default file.ts one first.
    mockGitRaw.mockImplementation(async (_p: string, args: string[]) => {
      if (args[0] === 'ls-files' && args.includes('-u')) {
        return '100644 abc123 1\tfile.ts\n100644 def456 2\tfile.ts\n100644 ghi789 3\tfile.ts\n';
      }
      const arg = args[args.length - 1];
      if (arg === ':1:file.ts') return 'base line';
      if (arg === ':2:file.ts') return 'ours line';
      if (arg === ':3:file.ts') return 'theirs line';
      return '';
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { ConflictMergeView } = await import('../../src/components/ConflictMergeView');
      render(React.createElement(ConflictMergeView, { filePath: 'file.ts', onResolved: vi.fn() }));
      await waitFor(() => {
        expect(screen.queryByTestId('merge-result-textarea')).toBeTruthy();
      }, { timeout: 5000 });

      const ta = screen.getByTestId('merge-result-textarea') as HTMLTextAreaElement;
      const preBefore = document.querySelector('pre[aria-hidden="true"]')?.textContent ?? '';
      expect(preBefore).not.toContain('TYPED-TEXT');

      // Type into the (uncontrolled) textarea. fireEvent.input uses the
      // NATIVE value setter — a plain `ta.value = …` assignment goes
      // through React's value-tracker and the change is swallowed.
      await act(async () => {
        fireEvent.input(ta, { target: { value: `${ta.value}\nTYPED-TEXT` } });
        vi.advanceTimersByTime(150);
      });

      const preAfter = document.querySelector('pre[aria-hidden="true"]')?.textContent ?? '';
      expect(preAfter).toContain('TYPED-TEXT');
    } finally {
      vi.useRealTimers();
    }
  }, 10000);

  it('result column height tracks the live line count (tall files scroll via the shared container)', async () => {
    // 300-line conflicted file: the middle column must be a TALL element
    // (lines × 20px) inside the shared scroller — v2 wrapped it in a
    // fixed-height overflow-hidden box, so the scroller had nothing to
    // scroll and the side panes were frozen at the top of the file.
    const tallContent = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n');
    mockGitRaw.mockImplementation(async (_p: string, args: string[]) => {
      if (args[0] === 'ls-files' && args.includes('-u')) {
        return '100644 abc123 1\ttall.ts\n100644 def456 2\ttall.ts\n100644 ghi789 3\ttall.ts\n';
      }
      const arg = args[args.length - 1];
      if (arg === ':1:tall.ts') return tallContent;
      if (arg === ':2:tall.ts') return `${tallContent}\nours tail`;
      if (arg === ':3:tall.ts') return `${tallContent}\ntheirs tail`;
      return '';
    });

    const { ConflictMergeView } = await import('../../src/components/ConflictMergeView');
    render(React.createElement(ConflictMergeView, { filePath: 'tall.ts', onResolved: vi.fn() }));
    await waitFor(() => {
      expect(screen.queryByTestId('merge-result-textarea')).toBeTruthy();
    }, { timeout: 5000 });

    const column = document.querySelector('[data-testid="merge-result-column"]') as HTMLDivElement;
    expect(column).toBeTruthy();
    // 300 lines + 7 conflict-marker lines + ours/theirs tails in the
    // auto-merged result → the height is (result lines) × 20.
    const ta = screen.getByTestId('merge-result-textarea') as HTMLTextAreaElement;
    const expectedHeight = ta.value.split('\n').length * 20;
    expect(parseInt(column.style.height, 10)).toBeGreaterThanOrEqual(300 * 20);
    expect(column.style.height).toBe(`${expectedHeight}px`);
    // The textarea itself has no internal vertical scrolling — the shared
    // 3-pane container owns it.
    expect(ta.style.overflowY).toBe('hidden');
  }, 10000);

  it('Ctrl+Z stays NATIVE while typing in the middle pane (app undo only outside)', async () => {
    mockGitRaw.mockImplementation(async (_p: string, args: string[]) => {
      if (args[0] === 'ls-files' && args.includes('-u')) {
        return '100644 abc123 1\tfile.ts\n100644 def456 2\tfile.ts\n100644 ghi789 3\tfile.ts\n';
      }
      const arg = args[args.length - 1];
      if (arg === ':1:file.ts') return 'base line';
      if (arg === ':2:file.ts') return 'ours line';
      if (arg === ':3:file.ts') return 'theirs line';
      return '';
    });
    const { ConflictMergeView } = await import('../../src/components/ConflictMergeView');
    render(React.createElement(ConflictMergeView, { filePath: 'file.ts', onResolved: vi.fn() }));
    await waitFor(() => {
      expect(screen.queryByTestId('merge-result-textarea')).toBeTruthy();
    }, { timeout: 5000 });

    const ta = screen.getByTestId('merge-result-textarea') as HTMLTextAreaElement;
    ta.focus();

    // Ctrl+Z with the caret INSIDE the textarea → NOT intercepted (the
    // browser's native typing-undo runs; the app-level resolution-undo
    // must not hijack it).
    const evIn = new KeyboardEvent('keydown', {
      key: 'z', ctrlKey: true, bubbles: true, cancelable: true,
    });
    ta.dispatchEvent(evIn);
    expect(evIn.defaultPrevented).toBe(false);

    // Ctrl+Z with the caret OUTSIDE → intercepted by the app handler.
    ta.blur();
    const evOut = new KeyboardEvent('keydown', {
      key: 'z', ctrlKey: true, bubbles: true, cancelable: true,
    });
    window.dispatchEvent(evOut);
    expect(evOut.defaultPrevented).toBe(true);
  }, 10000);
  it('vertical splitters resize the Ours/Theirs panes', async () => {
    // Perf-round user report: «В инструменте 3-way нехватает вертикальных
    // сплиттеров для изменения размера левой и правой панели» — two
    // .split-divider handles must exist and dragging must change the
    // side-pane widths.
    const { ConflictMergeView } = await import('../../src/components/ConflictMergeView');

    const { container } = render(React.createElement(ConflictMergeView, {
      filePath: 'file.ts',
      onResolved: vi.fn(),
    }));

    await waitFor(() => {
      expect(container.querySelector('[data-testid="merge-result-textarea"]')).toBeTruthy();
    }, { timeout: 5000 });

    // Two splitters: Ours|Result and Result|Theirs (sticky wrappers).
    const splitters = container.querySelectorAll('.split-divider');
    expect(splitters.length).toBe(2);

    // Both side panes start at ~33% width.
    const scroll = container.querySelector('[data-testid="merge-scroll-container"]') as HTMLElement;
    const paneWidth = () => {
      const panes = scroll.querySelectorAll(':scope > div');
      const left = panes[0] as HTMLElement;
      return parseFloat(left.style.width);
    };
    const before = paneWidth();
    expect(before).toBeCloseTo(33.3, 0);

    // Drag the LEFT splitter 90px right → +10% width for Ours. The drag
    // listeners live on DOCUMENT (window-dispatched events never reach it).
    const leftSplitter = splitters[0];
    leftSplitter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 300, clientY: 100 }));
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 390, clientY: 100 }));
      await new Promise(r => setTimeout(r, 20));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await new Promise(r => setTimeout(r, 20));
    });

    const after = paneWidth();
    // 90px / 1000px fallback width = +9%.
    expect(after).toBeCloseTo(before + 9, 0);
    expect(after).toBeLessThanOrEqual(60); // clamped
  }, 10000);
});
