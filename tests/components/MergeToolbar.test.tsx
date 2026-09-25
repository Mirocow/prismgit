/**
 * MergeToolbar — the 3-way merge top bar.
 *
 * Contract:
 *  - the conflict counter shows current/total (1-based display of the
 *    0-based currentConflictIdx) via its tooltip;
 *  - Prev/Next fire their callbacks and disable correctly at the ends;
 *  - Save reflects the saving state; Undo reflects canUndo;
 *  - external actions fire their callbacks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as React from 'react';
import { MergeToolbar } from '../../src/components/merge/MergeToolbar';

vi.mock('../../src/lib/i18n', () => ({
  useI18n: () => ({
    // Minimal real translations for the titles the tests assert on;
    // unknown keys fall through unchanged (standard test convention).
    t: (k: string, p?: any) => {
      const dict: Record<string, string> = {
        'conflict.prevConflictTitle': 'Previous conflict (Shift+F7)',
        'conflict.nextConflictTitle': 'Next conflict (F7)',
        'conflict.saveStageTitle': 'Save resolved content and stage the file (Ctrl+Enter)',
        'action.title.openExternalEditor': 'Open in external editor',
        'conflict.vsCodeTitle': 'Open in VS Code',
        // v3.4 localized tooltips (previously hardcoded English)
        'conflict.undoLastResolution': 'Undo last resolution (⌘Z)',
        'conflict.toggleBasePane': 'Show / hide the base (common ancestor) pane',
        'conflict.moreActions': 'More actions',
        'conflict.unsavedChanges': 'Unsaved changes',
        'conflict.resetAll': 'Reset all',
      };
      const base = dict[k] ?? k;
      return p
        ? Object.entries(p).reduce((s, [k2, v]) => s.replace(`{${k2}}`, String(v)), base)
        : base;
    },
  }),
}));

const baseProps = {
  filePath: 'src/lib/deep/file.ts',
  totalConflicts: 7,
  currentConflictIdx: 2,
  dirty: true,
  saving: false,
  showBase: false,
  canUndo: true,
  onPrevConflict: vi.fn(),
  onNextConflict: vi.fn(),
  onToggleBase: vi.fn(),
  onUndo: vi.fn(),
  onResetAll: vi.fn(),
  onOpenExternal: vi.fn(),
  onOpenVscodeMerge: vi.fn(),
  onRunMergetool: vi.fn(),
  onSave: vi.fn(),
};

function setup(overrides: Partial<typeof baseProps> = {}) {
  const props = { ...baseProps, ...overrides };
  const utils = render(<MergeToolbar {...props} />);
  return { props, ...utils };
}

const prevBtn = () => screen.getByTitle('Previous conflict (Shift+F7)') as HTMLButtonElement;
const nextBtn = () => screen.getByTitle('Next conflict (F7)') as HTMLButtonElement;
const saveBtn = () => screen.getByTitle('Save resolved content and stage the file (Ctrl+Enter)') as HTMLButtonElement;

describe('MergeToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it('renders the file path and the 1-based conflict counter tooltip', () => {
    setup();
    expect(screen.getByText(/src\/lib\/deep\/file\.ts/)).toBeTruthy();
    // 0-based idx 2 → "3 of 7 conflicts" (counter tooltip).
    expect(screen.getByTitle('3 of 7 conflicts')).toBeTruthy();
  });

  it('First conflict → Prev disabled, Next enabled and fires onNextConflict', () => {
    const { props } = setup({ currentConflictIdx: 0 });
    expect(prevBtn().disabled).toBe(true);
    expect(nextBtn().disabled).toBe(false);
    fireEvent.click(nextBtn());
    expect(props.onNextConflict).toHaveBeenCalledTimes(1);
  });

  it('Last conflict → Next disabled', () => {
    setup({ currentConflictIdx: 6 });
    expect(nextBtn().disabled).toBe(true);
    expect(prevBtn().disabled).toBe(false);
  });

  it('Zero conflicts → navigation disabled entirely, counter tooltip says so', () => {
    setup({ totalConflicts: 0, currentConflictIdx: 0 });
    expect(prevBtn().disabled).toBe(true);
    expect(nextBtn().disabled).toBe(true);
    expect(screen.getByTitle('No conflicts')).toBeTruthy();
  });

  it('Undo is disabled when there is nothing to undo', () => {
    setup({ canUndo: false });
    const undo = screen.getByTitle(/Undo last resolution/i) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
  });

  it('Save fires onSave and is disabled while saving', () => {
    const { props } = setup();
    expect(saveBtn().disabled).toBe(false);
    fireEvent.click(saveBtn());
    expect(props.onSave).toHaveBeenCalledTimes(1);

    cleanup();
    setup({ saving: true });
    expect(saveBtn().disabled).toBe(true);
  });

  it('external actions fire their callbacks', () => {
    const { props } = setup();
    // jsdom viewport is wide (1024) → the External group renders directly.
    const external = screen.getAllByTitle(/Open in external editor/i)[0];
    fireEvent.click(external);
    expect(props.onOpenExternal).toHaveBeenCalledTimes(1);
    const vscode = screen.getAllByTitle(/Open in VS Code/i)[0];
    fireEvent.click(vscode);
    expect(props.onOpenVscodeMerge).toHaveBeenCalledTimes(1);
  });
});
