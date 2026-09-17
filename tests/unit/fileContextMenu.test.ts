/**
 * fileContextMenu — the unified SmartGit-style file menu.
 *
 * Covers: menu composition per mode (changes / diff / history), checkbox
 * state from live index flags, untracked-file specialization, and the real
 * git operations behind runFileAction (stage, discard, stash, move, flags,
 * clipboard, directory scoping).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSelectionStore } from '../../src/stores/selectionStore';

// --- api mock (vi.hoisted — factories run before module top-level code) -----
const apiVscodeMock = vi.hoisted(() => ({
  open: vi.fn().mockResolvedValue({ ok: true, via: 'cli' }),
  openFileDiff: vi.fn().mockResolvedValue({ ok: true }),
  openMerge: vi.fn().mockResolvedValue({ ok: true }),
  openFileVersion: vi.fn().mockResolvedValue({ ok: true }),
  openCommitFileDiff: vi.fn().mockResolvedValue({ ok: true }),
  openCommitPatch: vi.fn().mockResolvedValue({ ok: true }),
  openWorkspace: vi.fn().mockResolvedValue({ ok: true }),
}));
const apiGitMock = vi.hoisted(() => ({
  add: vi.fn().mockResolvedValue(undefined),
  resetFile: vi.fn().mockResolvedValue(undefined),
  resetFiles: vi.fn().mockResolvedValue(undefined),
  restore: vi.fn().mockResolvedValue(undefined),
  checkoutFile: vi.fn().mockResolvedValue(undefined),
  checkoutFiles: vi.fn().mockResolvedValue(undefined),
  stashPush: vi.fn().mockResolvedValue('stash@{0}'),
  ignore: vi.fn().mockResolvedValue(undefined),
  editIgnoreFile: vi.fn().mockResolvedValue('/repo/.gitignore'),
  openFile: vi.fn().mockResolvedValue(true),
  revealInFileManager: vi.fn().mockResolvedValue(true),
  moveFile: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  deleteFiles: vi.fn().mockResolvedValue(undefined),
  setIndexFlag: vi.fn().mockResolvedValue(undefined),
  setIndexFlagBatch: vi.fn().mockResolvedValue(undefined),
  getIndexFlags: vi.fn().mockResolvedValue({ assumeUnchanged: false, skipWorktree: false, tracked: true }),
  raw: vi.fn().mockResolvedValue(''),
}));

vi.mock('../../src/lib/api', () => ({ api: { git: apiGitMock, vscode: apiVscodeMock } }));

// --- dialogs mock (auto-confirm; configurable per test) ----------------------
let confirmAnswer = true;
let promptAnswer: string | null = null;
vi.mock('../../src/components/ConfirmDialog', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(confirmAnswer)),
  // 4.5 — discard now flows through confirmWithRemember → confirmDialogEx;
  // checked: false keeps the unit tests free of settings persistence.
  confirmDialogEx: vi.fn(() => Promise.resolve({ ok: confirmAnswer, checked: false })),
  promptDialog: vi.fn(() => Promise.resolve(promptAnswer)),
}));

import {
  buildFileMenu,
  runFileAction,
  getIndexFlagsAsync,
  actionTargets,
  bulkSuffix,
  baseName,
  dirName,
  fullPathOf,
  type FileMenuCtx,
} from '../../src/lib/fileContextMenu';

const baseCtx = (over: Partial<FileMenuCtx> = {}): FileMenuCtx => ({
  repoPath: '/repo',
  path: 'src/app/main.ts',
  mode: 'changes',
  indexFlags: { assumeUnchanged: false, skipWorktree: false, tracked: true },
  onShowChanges: vi.fn(),
  onSelectDirectory: vi.fn(),
  onFocusCommit: vi.fn(),
  refresh: vi.fn(),
  ...over,
});

const labels = (items: { label?: string }[]) => items.map((i) => i.label ?? '---');

beforeEach(() => {
  vi.clearAllMocks();
  confirmAnswer = true;
  promptAnswer = null;
  // jsdom has no clipboard — stub it
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe('buildFileMenu — changes mode', () => {
  it('offers the full SmartGit-like working set for a modified tracked file', () => {
    const items = labels(buildFileMenu(baseCtx()));
    expect(items).toContain('Open');
    expect(items).toContain('Reveal in File Manager');
    expect(items).toContain('Show Changes');
    expect(items).toContain('File History (Log)');
    expect(items).toContain('Blame this file');
    expect(items).toContain('Stage');
    expect(items).toContain('Commit...');
    expect(items).toContain('Stash Selection...');
    expect(items).toContain('Discard Changes...');
    expect(items).toContain('Restore from Ref...');
    expect(items).toContain("Toggle 'Assume Unchanged'");
    expect(items).toContain("Toggle 'Skip Worktree'");
    expect(items).toContain('Move or Rename...');
    expect(items).toContain('Remove...');
    expect(items).toContain('Copy Name');
    expect(items).toContain('Copy Relative Path');
    expect(items).toContain('Copy Full Path');
    expect(items).toContain('Select Directory');
    expect(items).toContain('Select Repository Root');
  });

  it('reflects live index flags in the checkbox items', () => {
    const items = buildFileMenu(baseCtx({ indexFlags: { assumeUnchanged: true, skipWorktree: true, tracked: true } }));
    const au = items.find((i) => i.clickId === 'toggle-assume-unchanged');
    const sw = items.find((i) => i.clickId === 'toggle-skip-worktree');
    expect(au?.type).toBe('checkbox');
    expect(au?.checked).toBe(true);
    expect(sw?.checked).toBe(true);
  });

  it('switches Stage→Unstage and Discard→Discard Staged for a staged file', () => {
    const items = labels(buildFileMenu(baseCtx({ isStaged: true })));
    expect(items).toContain('Unstage');
    expect(items).not.toContain('Stage');
    expect(items).toContain('Discard Staged Changes...');
  });

  it('specializes untracked files: ignore/delete instead of git history ops', () => {
    const items = labels(
      buildFileMenu(baseCtx({ isUntracked: true, indexFlags: undefined }))
    );
    expect(items).toContain('Add to .gitignore');
    expect(items).toContain('Delete File...');
    expect(items).not.toContain('Discard Changes...');
    expect(items).not.toContain('Stash Selection...');
    expect(items).not.toContain("Toggle 'Skip Worktree'");
  });

  it('offers Resolve submenu for conflicted files', () => {
    const items = buildFileMenu(baseCtx({ isConflicted: true }));
    const labels = items.map(i => i.label).filter(Boolean);
    // After the SmartGit-style refactor, the menu has a "Resolve" submenu
    // (Take Ours / Take Theirs / Open Diff Tool / Discard) instead of a
    // flat "Resolve Conflict..." item.
    expect(labels).toContain('Resolve');
    expect(labels).toContain('Resolve Conflict...');
  });
});

describe('buildFileMenu — diff / history modes', () => {
  it('diff mode has no working-tree mutations', () => {
    const items = labels(buildFileMenu(baseCtx({ mode: 'diff' })));
    expect(items).not.toContain('Stage');
    expect(items).not.toContain('Discard Changes...');
    expect(items).not.toContain('Move or Rename...');
    expect(items).toContain('Blame this file');
  });

  it('history mode adds Open in Diff tool', () => {
    const items = labels(buildFileMenu(baseCtx({ mode: 'history', onOpenDiff: vi.fn() })));
    expect(items).toContain('Open in Diff tool');
  });
});

describe('VS Code commit archaeology — history mode with commitSha', () => {
  it('offers version-open and parent-diff items ONLY when commitSha is present', () => {
    const withSha = labels(buildFileMenu(baseCtx({ mode: 'history', commitSha: 'abc1234' })));
    expect(withSha).toContain('Open this version in VS Code');
    expect(withSha).toContain('Open file diff (parent vs commit) in VS Code');

    const withoutSha = labels(buildFileMenu(baseCtx({ mode: 'history' })));
    expect(withoutSha).not.toContain('Open this version in VS Code');
    expect(withoutSha).not.toContain('Open file diff (parent vs commit) in VS Code');
  });

  it('changes mode never shows the commit-archaeology items', () => {
    const items = labels(buildFileMenu(baseCtx({ mode: 'changes', commitSha: 'abc1234' })));
    expect(items).not.toContain('Open this version in VS Code');
    expect(items).not.toContain('Open file diff (parent vs commit) in VS Code');
  });

  it('open-vscode-version passes repo, commitSha and file to the IPC layer', async () => {
    await runFileAction('open-vscode-version', baseCtx({ mode: 'history', commitSha: 'deadbeef' }));
    expect(apiVscodeMock.openFileVersion).toHaveBeenCalledWith('/repo', 'deadbeef', 'src/app/main.ts');
  });

  it('open-vscode-commit-diff passes repo, commitSha and file to the IPC layer', async () => {
    await runFileAction('open-vscode-commit-diff', baseCtx({ mode: 'history', commitSha: 'feedface' }));
    expect(apiVscodeMock.openCommitFileDiff).toHaveBeenCalledWith('/repo', 'feedface', 'src/app/main.ts');
  });

  it('open-vscode-version is a no-op without commitSha', async () => {
    await runFileAction('open-vscode-version', baseCtx({ mode: 'history' }));
    expect(apiVscodeMock.openFileVersion).not.toHaveBeenCalled();
  });

  it('open-vscode-diff still routes to the working-tree diff (HEAD vs WT)', async () => {
    await runFileAction('open-vscode-diff', baseCtx({ mode: 'changes' }));
    expect(apiVscodeMock.openFileDiff).toHaveBeenCalledWith('/repo', 'src/app/main.ts');
  });
});

describe('runFileAction', () => {
  it('stages via api.git.add and refreshes', async () => {
    const ctx = baseCtx();
    const handled = await runFileAction('stage', ctx);
    expect(handled).toBe(true);
    expect(apiGitMock.add).toHaveBeenCalledWith('/repo', ['src/app/main.ts']);
    expect(ctx.refresh).toHaveBeenCalled();
  });

  it('unstages via api.git.resetFiles batch call', async () => {
    await runFileAction('unstage', baseCtx({ isStaged: true }));
    // BATCH: single resetFiles call with one path (was resetFile before)
    expect(apiGitMock.resetFiles).toHaveBeenCalledWith('/repo', ['src/app/main.ts']);
  });

  it('discards only after confirmation', async () => {
    const ctx = baseCtx();
    confirmAnswer = false;
    await runFileAction('discard', ctx);
    expect(apiGitMock.restore).not.toHaveBeenCalled();

    confirmAnswer = true;
    await runFileAction('discard', ctx);
    expect(apiGitMock.restore).toHaveBeenCalledWith('/repo', ['src/app/main.ts']);
  });

  it('discarding a staged file unstages AND restores', async () => {
    await runFileAction('discard', baseCtx({ isStaged: true }));
    expect(apiGitMock.resetFiles).toHaveBeenCalledWith('/repo', ['src/app/main.ts']);
    expect(apiGitMock.restore).toHaveBeenCalledWith('/repo', ['src/app/main.ts']);
  });

  it('stash-file prompts for a message and stashes only that path', async () => {
    promptAnswer = 'WIP: experiment';
    await runFileAction('stash-file', baseCtx());
    expect(apiGitMock.stashPush).toHaveBeenCalledWith('/repo', 'WIP: experiment', false, false, ['src/app/main.ts']);

    promptAnswer = null; // cancelled
    await runFileAction('stash-file', baseCtx());
    expect(apiGitMock.stashPush).toHaveBeenCalledTimes(1);
  });

  it('stash-file on an UNTRACKED file passes includeUntracked=true (otherwise git refuses: "No local changes to save")', async () => {
    promptAnswer = 'WIP: new file';
    await runFileAction('stash-file', baseCtx({ isUntracked: true }));
    expect(apiGitMock.stashPush).toHaveBeenCalledWith('/repo', 'WIP: new file', true, false, ['src/app/main.ts']);
  });

  it('move-rename calls moveFile with the prompted target', async () => {
    promptAnswer = 'src/renamed.ts';
    await runFileAction('move-rename', baseCtx());
    expect(apiGitMock.moveFile).toHaveBeenCalledWith('/repo', 'src/app/main.ts', 'src/renamed.ts');
  });

  it('toggling skip-worktree flips the current flag value', async () => {
    await runFileAction('toggle-skip-worktree', baseCtx()); // currently false → set true
    expect(apiGitMock.setIndexFlagBatch).toHaveBeenCalledWith('/repo', ['src/app/main.ts'], 'skip-worktree', true);

    await runFileAction(
      'toggle-skip-worktree',
      baseCtx({ indexFlags: { assumeUnchanged: false, skipWorktree: true, tracked: true } })
    );
    expect(apiGitMock.setIndexFlagBatch).toHaveBeenLastCalledWith('/repo', ['src/app/main.ts'], 'skip-worktree', false);
  });

  it('deletes through the universal deleteFiles batch call (tracked and untracked)', async () => {
    confirmAnswer = true;
    await runFileAction('delete-file', baseCtx());
    expect(apiGitMock.deleteFiles).toHaveBeenCalledWith('/repo', ['src/app/main.ts']);

    await runFileAction('delete-file', baseCtx({ isUntracked: true, indexFlags: undefined }));
    expect(apiGitMock.deleteFiles).toHaveBeenCalledTimes(2);
  });

  it('does not delete when the confirmation is declined', async () => {
    confirmAnswer = false;
    await runFileAction('delete-file', baseCtx());
    expect(apiGitMock.deleteFiles).not.toHaveBeenCalled();
  });

  it('copies name / relative path / full path to the clipboard', async () => {
    await runFileAction('copy-name', baseCtx());
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('main.ts');

    await runFileAction('copy-rel-path', baseCtx());
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('src/app/main.ts');

    await runFileAction('copy-full-path', baseCtx());
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('/repo/src/app/main.ts');
  });

  it('scopes the directory tree: file dir for Select Directory, null for root', async () => {
    const onSelectDirectory = vi.fn();
    await runFileAction('select-directory', baseCtx({ onSelectDirectory }));
    expect(onSelectDirectory).toHaveBeenCalledWith('src/app');

    await runFileAction('select-directory', baseCtx({ path: 'README.md', onSelectDirectory }));
    expect(onSelectDirectory).toHaveBeenCalledWith(null);

    await runFileAction('select-root', baseCtx({ onSelectDirectory }));
    expect(onSelectDirectory).toHaveBeenLastCalledWith(null);
  });

  it('file-history navigates to /file-history page with file path and commit context', async () => {
    // We can't observe window.location.hash mutations in jsdom without a router,
    // but we CAN assert that selectFile + setPathFilter are called so the
    // FileHistoryPage receives the file context via the selection store.
    const sel = useSelectionStore.getState();
    const selectFileSpy = vi.spyOn(sel, 'selectFile');
    const setPathFilterSpy = vi.spyOn(sel, 'setPathFilter');
    const originalHash = window.location.hash;
    try {
      await runFileAction('file-history', baseCtx({ mode: 'history', commitSha: '6168d300a8cce986eaf147d20aa911fe9bcdc61a' }));
      expect(selectFileSpy).toHaveBeenCalledWith('src/app/main.ts');
      expect(setPathFilterSpy).toHaveBeenCalledWith('src/app/main.ts');
      // Hash should now point at /file-history with file + commit params.
      expect(window.location.hash).toContain('#/file-history');
      expect(window.location.hash).toContain('file=src%2Fapp%2Fmain.ts');
      expect(window.location.hash).toContain('commit=6168d300a8cce986eaf147d20aa911fe9bcdc61a');
    } finally {
      selectFileSpy.mockRestore();
      setPathFilterSpy.mockRestore();
      window.location.hash = originalHash;
    }
  });

  it('file-history works without commitSha (omits commit param)', async () => {
    const originalHash = window.location.hash;
    try {
      await runFileAction('file-history', baseCtx({ mode: 'changes' }));
      expect(window.location.hash).toContain('#/file-history');
      expect(window.location.hash).toContain('file=src%2Fapp%2Fmain.ts');
      expect(window.location.hash).not.toContain('commit=');
    } finally {
      window.location.hash = originalHash;
    }
  });

  it('returns false for unknown action ids', async () => {
    expect(await runFileAction('no-such-action', baseCtx())).toBe(false);
  });
});

describe('helpers', () => {
  it('getIndexFlagsAsync falls back to tracked=true on IPC errors', async () => {
    expect(await getIndexFlagsAsync('/repo', 'a.ts')).toEqual({
      assumeUnchanged: false,
      skipWorktree: false,
      tracked: true,
    });
  });

  it('path helpers split names and dirs', () => {
    expect(baseName('src/app/main.ts')).toBe('main.ts');
    expect(baseName('README.md')).toBe('README.md');
    expect(dirName('src/app/main.ts')).toBe('src/app');
    expect(dirName('README.md')).toBe('');
    expect(fullPathOf('/repo', 'src/a.ts')).toBe('/repo/src/a.ts');
  });
});

// =====================================================================
// Multi-selection (Ctrl/Cmd+click, Ctrl/Cmd+A): bulk menu operations
// =====================================================================
describe('multi-selection — actionTargets / bulkSuffix', () => {
  it('falls back to the clicked file when no selection is given', () => {
    expect(actionTargets({ path: 'a.ts' })).toEqual(['a.ts']);
    expect(actionTargets({ path: 'a.ts', paths: [] })).toEqual(['a.ts']);
    expect(bulkSuffix({ path: 'a.ts' })).toBe('');
  });

  it('returns the full selection (dedup, always includes the clicked file)', () => {
    expect(actionTargets({ path: 'b.ts', paths: ['a.ts', 'b.ts', 'c.ts'] }))
      .toEqual(['a.ts', 'b.ts', 'c.ts']);
    // clicked file missing from the selection → still included first
    expect(actionTargets({ path: 'z.ts', paths: ['a.ts', 'b.ts'] }))
      .toEqual(['z.ts', 'a.ts', 'b.ts']);
    // duplicates are dropped
    expect(actionTargets({ path: 'a.ts', paths: ['a.ts', 'a.ts', 'b.ts'] }))
      .toEqual(['a.ts', 'b.ts']);
    expect(bulkSuffix({ path: 'b.ts', paths: ['a.ts', 'b.ts', 'c.ts'] })).toBe(' (3 files)');
  });
});

describe('multi-selection — buildFileMenu labels show the file count', () => {
  const multi = { paths: ['a.ts', 'b.ts', 'c.ts'], path: 'a.ts' };

  it('annotates bulk operations with " (N files)"', () => {
    const items = labels(buildFileMenu(baseCtx(multi)));
    expect(items).toContain('Open (3 files)');
    expect(items).toContain('Reveal in File Manager (3 files)');
    expect(items).toContain('Stage (3 files)');
    expect(items).toContain('Stash Selection... (3 files)');
    expect(items).toContain('Discard Changes... (3 files)');
    expect(items).toContain('Restore from Ref... (3 files)');
    expect(items).toContain('Remove... (3 files)');
  });

  it('annotates staged bulk operations too', () => {
    const items = labels(buildFileMenu(baseCtx({ ...multi, isStaged: true })));
    expect(items).toContain('Unstage (3 files)');
    expect(items).toContain('Discard Staged Changes... (3 files)');
  });

  it('single-file menu keeps the plain labels', () => {
    const items = labels(buildFileMenu(baseCtx()));
    expect(items).toContain('Stage');
    expect(items).not.toContain('Stage (1 files)');
  });
});

describe('multi-selection — runFileAction bulk operations', () => {
  const multi = { paths: ['a.ts', 'b.ts', 'c.ts'], path: 'a.ts' };

  it('stages EVERY selected file in one git add call', async () => {
    const ctx = baseCtx(multi);
    const handled = await runFileAction('stage', ctx);
    expect(handled).toBe(true);
    expect(apiGitMock.add).toHaveBeenCalledTimes(1);
    expect(apiGitMock.add).toHaveBeenCalledWith('/repo', ['a.ts', 'b.ts', 'c.ts']);
    expect(ctx.refresh).toHaveBeenCalled();
  });

  it('unstages EVERY selected file in one batch resetFiles call', async () => {
    await runFileAction('unstage', baseCtx({ ...multi, isStaged: true }));
    // BATCH: one call with all paths (was 3 sequential resetFile calls before)
    expect(apiGitMock.resetFiles).toHaveBeenCalledTimes(1);
    expect(apiGitMock.resetFiles).toHaveBeenCalledWith('/repo', ['a.ts', 'b.ts', 'c.ts']);
  });

  it('stashes EVERY selected file with one prompt', async () => {
    promptAnswer = 'WIP: batch';
    await runFileAction('stash-file', baseCtx(multi));
    expect(apiGitMock.stashPush).toHaveBeenCalledWith('/repo', 'WIP: batch', false, false, ['a.ts', 'b.ts', 'c.ts']);
  });

  it('discards EVERY selected file after ONE confirmation', async () => {
    confirmAnswer = true;
    await runFileAction('discard', baseCtx(multi));
    expect(apiGitMock.restore).toHaveBeenCalledTimes(1);
    expect(apiGitMock.restore).toHaveBeenCalledWith('/repo', ['a.ts', 'b.ts', 'c.ts']);
  });

  it('discarding a multi staged selection unstages AND restores all in ONE batch call', async () => {
    confirmAnswer = true;
    await runFileAction('discard', baseCtx({ ...multi, isStaged: true }));
    // BATCH: one resetFiles call with all paths (was 3 sequential resetFile calls)
    expect(apiGitMock.resetFiles).toHaveBeenCalledTimes(1);
    expect(apiGitMock.resetFiles).toHaveBeenCalledWith('/repo', ['a.ts', 'b.ts', 'c.ts']);
    expect(apiGitMock.restore).toHaveBeenCalledWith('/repo', ['a.ts', 'b.ts', 'c.ts']);
  });

  it('restores EVERY selected file from the prompted ref in ONE batch checkoutFiles call', async () => {
    promptAnswer = 'HEAD~1';
    await runFileAction('restore-from-ref', baseCtx(multi));
    // BATCH: one call with all paths (was 3 sequential checkoutFile calls)
    expect(apiGitMock.checkoutFiles).toHaveBeenCalledTimes(1);
    expect(apiGitMock.checkoutFiles).toHaveBeenCalledWith('/repo', ['a.ts', 'b.ts', 'c.ts'], 'HEAD~1');
  });

  it('deletes EVERY selected file in ONE batch deleteFiles call after ONE confirmation', async () => {
    confirmAnswer = true;
    await runFileAction('delete-file', baseCtx(multi));
    // BATCH: one call with all paths (was 3 sequential deleteFile calls)
    expect(apiGitMock.deleteFiles).toHaveBeenCalledTimes(1);
    expect(apiGitMock.deleteFiles).toHaveBeenCalledWith('/repo', ['a.ts', 'b.ts', 'c.ts']);
  });

  it('does not delete anything when the bulk confirmation is declined', async () => {
    confirmAnswer = false;
    await runFileAction('delete-file', baseCtx(multi));
    expect(apiGitMock.deleteFiles).not.toHaveBeenCalled();
  });

  it('ignores EVERY selected untracked file', async () => {
    await runFileAction('ignore', baseCtx({ ...multi, isUntracked: true, indexFlags: undefined }));
    expect(apiGitMock.ignore).toHaveBeenCalledWith('/repo', ['a.ts', 'b.ts', 'c.ts']);
  });

  it('toggles an index flag on EVERY selected file in ONE batch setIndexFlagBatch call', async () => {
    await runFileAction('toggle-skip-worktree', baseCtx(multi));
    // BATCH: one call with all paths (was 3 sequential setIndexFlag calls)
    expect(apiGitMock.setIndexFlagBatch).toHaveBeenCalledTimes(1);
    expect(apiGitMock.setIndexFlagBatch).toHaveBeenCalledWith('/repo', ['a.ts', 'b.ts', 'c.ts'], 'skip-worktree', true);
  });

  it('copies ALL selected paths (one per line) in the three copy variants', async () => {
    await runFileAction('copy-name', baseCtx(multi));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('a.ts\nb.ts\nc.ts');

    await runFileAction('copy-rel-path', baseCtx(multi));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('a.ts\nb.ts\nc.ts');

    await runFileAction('copy-full-path', baseCtx({ path: 'src/a.ts', paths: ['src/a.ts', 'src/b.ts'] }));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('/repo/src/a.ts\n/repo/src/b.ts');
  });

  it('opens/reveals EVERY selected file', async () => {
    await runFileAction('open', baseCtx(multi));
    expect(apiGitMock.openFile).toHaveBeenCalledTimes(3);
    expect(apiGitMock.openFile).toHaveBeenCalledWith('/repo/b.ts');

    await runFileAction('reveal', baseCtx(multi));
    expect(apiGitMock.revealInFileManager).toHaveBeenCalledTimes(3);
  });

  it('navigation actions stay on the CLICKED file (blame, file history)', async () => {
    const sel = useSelectionStore.getState();
    const selectFileSpy = vi.spyOn(sel, 'selectFile');
    await runFileAction('blame', baseCtx(multi));
    expect(selectFileSpy).toHaveBeenLastCalledWith('a.ts');
    selectFileSpy.mockRestore();
  });

  it('single-file behavior is unchanged (no paths in ctx)', async () => {
    confirmAnswer = true;
    await runFileAction('stage', baseCtx());
    expect(apiGitMock.add).toHaveBeenCalledWith('/repo', ['src/app/main.ts']);

    await runFileAction('delete-file', baseCtx());
    // BATCH: single deleteFiles call with one path in the array
    expect(apiGitMock.deleteFiles).toHaveBeenCalledTimes(1);
    expect(apiGitMock.deleteFiles).toHaveBeenCalledWith('/repo', ['src/app/main.ts']);
  });
});
