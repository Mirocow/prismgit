/**
 * fileContextMenu — the unified SmartGit-style file menu.
 *
 * Covers: menu composition per mode (changes / diff / history), checkbox
 * state from live index flags, untracked-file specialization, and the real
 * git operations behind runFileAction (stage, discard, stash, move, flags,
 * clipboard, directory scoping).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- api mock (vi.hoisted — factories run before module top-level code) -----
const apiGitMock = vi.hoisted(() => ({
  add: vi.fn().mockResolvedValue(undefined),
  resetFile: vi.fn().mockResolvedValue(undefined),
  restore: vi.fn().mockResolvedValue(undefined),
  checkoutFile: vi.fn().mockResolvedValue(undefined),
  stashPush: vi.fn().mockResolvedValue('stash@{0}'),
  ignore: vi.fn().mockResolvedValue(undefined),
  editIgnoreFile: vi.fn().mockResolvedValue('/repo/.gitignore'),
  openFile: vi.fn().mockResolvedValue(true),
  revealInFileManager: vi.fn().mockResolvedValue(true),
  moveFile: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  setIndexFlag: vi.fn().mockResolvedValue(undefined),
  getIndexFlags: vi.fn().mockResolvedValue({ assumeUnchanged: false, skipWorktree: false, tracked: true }),
}));

vi.mock('../../src/lib/api', () => ({ api: { git: apiGitMock } }));

// --- dialogs mock (auto-confirm; configurable per test) ----------------------
let confirmAnswer = true;
let promptAnswer: string | null = null;
vi.mock('../../src/components/ConfirmDialog', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(confirmAnswer)),
  promptDialog: vi.fn(() => Promise.resolve(promptAnswer)),
}));

import {
  buildFileMenu,
  runFileAction,
  getIndexFlagsAsync,
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

  it('offers Resolve Conflict for conflicted files', () => {
    const items = labels(buildFileMenu(baseCtx({ isConflict: true })));
    expect(items).toContain('Resolve Conflict...');
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

describe('runFileAction', () => {
  it('stages via api.git.add and refreshes', async () => {
    const ctx = baseCtx();
    const handled = await runFileAction('stage', ctx);
    expect(handled).toBe(true);
    expect(apiGitMock.add).toHaveBeenCalledWith('/repo', ['src/app/main.ts']);
    expect(ctx.refresh).toHaveBeenCalled();
  });

  it('unstages via api.git.resetFile', async () => {
    await runFileAction('unstage', baseCtx({ isStaged: true }));
    expect(apiGitMock.resetFile).toHaveBeenCalledWith('/repo', 'src/app/main.ts');
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
    expect(apiGitMock.resetFile).toHaveBeenCalledWith('/repo', 'src/app/main.ts');
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
    expect(apiGitMock.setIndexFlag).toHaveBeenCalledWith('/repo', 'src/app/main.ts', 'skip-worktree', true);

    await runFileAction(
      'toggle-skip-worktree',
      baseCtx({ indexFlags: { assumeUnchanged: false, skipWorktree: true, tracked: true } })
    );
    expect(apiGitMock.setIndexFlag).toHaveBeenLastCalledWith('/repo', 'src/app/main.ts', 'skip-worktree', false);
  });

  it('deletes through the universal deleteFile (tracked and untracked)', async () => {
    confirmAnswer = true;
    await runFileAction('delete-file', baseCtx());
    expect(apiGitMock.deleteFile).toHaveBeenCalledWith('/repo', 'src/app/main.ts');

    await runFileAction('delete-file', baseCtx({ isUntracked: true, indexFlags: undefined }));
    expect(apiGitMock.deleteFile).toHaveBeenCalledTimes(2);
  });

  it('does not delete when the confirmation is declined', async () => {
    confirmAnswer = false;
    await runFileAction('delete-file', baseCtx());
    expect(apiGitMock.deleteFile).not.toHaveBeenCalled();
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
