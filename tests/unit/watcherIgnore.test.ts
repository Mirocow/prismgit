/**
 * WORKTREE_IGNORED — the workdir watcher's ignore predicate.
 *
 * Regression pin: the watcher used to descend into .git and fs.watch
 * `.git/fsmonitor--daemon.ipc` — a Unix DOMAIN SOCKET that fs.watch
 * cannot observe on some macOS volumes. The resulting UNKNOWN error hit
 * chokidar 5's ASYNC error handler; with no 'error' listener attached,
 * EventEmitter throw semantics inside an async function turned it into an
 * UNHANDLED PROMISE REJECTION that crashed the app (user-reported stack:
 * "UNKNOWN: unknown error, watch .../.git/fsmonitor--daemon.ipc").
 *
 * The .git directory is now ignored ENTIRELY by the workdir watcher (the
 * git-state files that matter are covered by the targeted watchers in
 * startWatching: HEAD, index, MERGE_HEAD, refs/, rebase dirs).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
  net: {},
}));

import { WORKTREE_IGNORED } from '../../electron/services/watcher';

describe('WORKTREE_IGNORED — .git coverage (crash trigger)', () => {
  it('ignores the fsmonitor socket file (the exact crash path)', () => {
    expect(WORKTREE_IGNORED('/repo/.git/fsmonitor--daemon.ipc')).toBe(true);
    expect(WORKTREE_IGNORED('/Volumes/Storage/Projects/X/.git/fsmonitor--daemon.ipc')).toBe(true);
  });

  it('ignores the .git directory itself and everything under it', () => {
    expect(WORKTREE_IGNORED('/repo/.git')).toBe(true);
    expect(WORKTREE_IGNORED('/repo/.git/HEAD')).toBe(true);
    expect(WORKTREE_IGNORED('/repo/.git/objects/ab/cdef')).toBe(true);
    expect(WORKTREE_IGNORED('/repo/.git/refs/heads/main')).toBe(true);
    expect(WORKTREE_IGNORED('/repo/.git/hooks/pre-commit')).toBe(true);
    expect(WORKTREE_IGNORED('C:\\repo\\.git\\HEAD')).toBe(true);
  });

  it('ignores a submodule .git FILE (gitdir pointer)', () => {
    expect(WORKTREE_IGNORED('/repo/sub/.git')).toBe(true);
  });

  it('does NOT swallow .git-adjacent files that matter for status', () => {
    expect(WORKTREE_IGNORED('/repo/.gitignore')).toBe(false);
    expect(WORKTREE_IGNORED('/repo/.gitmodules')).toBe(false);
    expect(WORKTREE_IGNORED('/repo/.gitattributes')).toBe(false);
  });

  it('does NOT match a directory that merely ends with .git', () => {
    expect(WORKTREE_IGNORED('/repo/foo.git')).toBe(false);
    expect(WORKTREE_IGNORED('/repo/foo.github/workflows')).toBe(false);
  });
});

describe('WORKTREE_IGNORED — build-output and noise patterns (unchanged)', () => {
  it('ignores build output directories anywhere in the tree', () => {
    for (const dir of ['node_modules', 'dist', 'build', 'target', 'out', '.next', '.cache', '.turbo', '.parcel-cache', 'coverage']) {
      expect(WORKTREE_IGNORED(`/repo/${dir}/x.js`)).toBe(true);
      expect(WORKTREE_IGNORED(`/repo/nested/${dir}/x.js`)).toBe(true);
    }
  });

  it('ignores file-level noise (.log, .swp, .lock, .DS_Store)', () => {
    expect(WORKTREE_IGNORED('/repo/debug.log')).toBe(true);
    expect(WORKTREE_IGNORED('/repo/.vim.swp')).toBe(true);
    expect(WORKTREE_IGNORED('/repo/package.lock')).toBe(true);
    expect(WORKTREE_IGNORED('/repo/.DS_Store')).toBe(true);
  });

  it('watches normal source files', () => {
    expect(WORKTREE_IGNORED('/repo/src/main.ts')).toBe(false);
    expect(WORKTREE_IGNORED('/repo/src/components/App.tsx')).toBe(false);
    expect(WORKTREE_IGNORED('C:\\repo\\src\\main.ts')).toBe(false);
    expect(WORKTREE_IGNORED('src/main.ts')).toBe(false);
  });
});
