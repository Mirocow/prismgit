import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import chokidar, { type FSWatcher } from 'chokidar';

/**
 * File watcher for Git repository state changes.
 * Watches .git/HEAD, .git/index, .git/MERGE_HEAD, .git/refs, and working tree.
 * Debounces events to avoid spamming the renderer.
 *
 * Performance: switched from `fs.watch` to `chokidar` because:
 *  1. `fs.watch({recursive:true})` is silently ignored on Linux — only the
 *     top-level directory is watched, missing saves in subdirectories.
 *  2. On macOS/Windows recursive watch monitors EVERYTHING including
 *     `node_modules`, `dist`, `target`, `.git/objects` — firing a firehose of
 *     events on every file save in node_modules, each triggering a debounced
 *     `git status` re-run.
 *  3. chokidar normalizes behavior across platforms and supports an `ignored`
 *     glob so we can skip VCS-irrelevant directories.
 *
 * Memory: chokidar uses an internal Set of watched paths; with `ignored`
 * filtering out node_modules/dist/build, the set stays small (typically
 * <1k entries even for large repos). Each entry holds an inotify watch
 * descriptor (~80 bytes on Linux).
 */

interface WatcherEntry {
  repoPath: string;
  watchers: Array<FSWatcher | fs.FSWatcher>;
  debounceTimer: NodeJS.Timeout | null;
}

const watchers = new Map<string, WatcherEntry>();

const DEBOUNCE_MS = 500;

/**
 * Directories and files that never affect git status, but generate a
 * firehose of filesystem events. Excluded from the working-tree watch.
 *
 * Notes:
 *  - `.git/objects` and `.git/logs` are extremely write-heavy (every git
 *    operation touches them) and never affect `git status` output — skip.
 *  - `node_modules`, `dist`, `build`, `target`, `.next`, `.cache` are common
 *    build output directories whose save events are noise to git.
 *  - `.git/index.lock`, `*.log`, `*.swp` are file-level noise.
 */
const WORKTREE_IGNORED = (testPath: string): boolean => {
  // chokidar passes both absolute and relative paths depending on the
  // platform; match segment-wise to be robust.
  // Match: <sep>node_modules<sep>, <sep>dist<sep>, etc. anywhere in the path.
  return (
    /(^|[/\\])(node_modules|dist|build|target|out|\.next|\.cache|\.turbo|\.parcel-cache|coverage)([/\\]|$)/.test(testPath) ||
    /(^|[/\\])\.git[/\\](objects|logs|refs[/\\]stash|packed-refs\.lock)([/\\]|$)/.test(testPath) ||
    /(^|[/\\])\.DS_Store$/.test(testPath) ||
    /\.log$/.test(testPath) ||
    /\.swp$/.test(testPath) ||
    /\.lock$/.test(testPath)
  );
};

function notifyRenderer(repoPath: string, eventType: string) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    // Window may already be closed/destroyed (e.g. repo deleted during quit) —
    // sending to a destroyed webContents throws and can wedge app shutdown.
    try {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('watcher:changed', { repoPath, eventType, timestamp: Date.now() });
      }
    } catch {
      // ignore — window disappeared between check and send
    }
  }
}

function debounce(entry: WatcherEntry, eventType: string) {
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
  }
  entry.debounceTimer = setTimeout(() => {
    notifyRenderer(entry.repoPath, eventType);
    entry.debounceTimer = null;
  }, DEBOUNCE_MS);
}

/**
 * Watch a single git state file. Uses fs.watch (cheap, single-file).
 * chokidar is overkill for individual files.
 */
function watchFile(repoPath: string, filePath: string, entry: WatcherEntry, eventType: string) {
  try {
    if (!fs.existsSync(filePath)) return;
    const watcher = fs.watch(filePath, { persistent: false }, () => {
      debounce(entry, eventType);
    });
    entry.watchers.push(watcher);
  } catch {
    // File may not exist or be inaccessible
  }
}

/**
 * Watch a directory (e.g. .git/refs, rebase-merge state) with chokidar.
 * Small scope, no ignore filter needed.
 */
function watchDirectory(repoPath: string, dirPath: string, entry: WatcherEntry, eventType: string) {
  try {
    if (!fs.existsSync(dirPath)) return;
    const watcher = chokidar.watch(dirPath, {
      persistent: false,
      ignoreInitial: true,
      // Use a short stability window so rapid writes (e.g. atomic git swaps)
      // coalesce into a single event.
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
    });
    watcher.on('all', () => debounce(entry, eventType));
    entry.watchers.push(watcher);
  } catch {
    // Directory may not exist
  }
}

export function startWatching(repoPath: string): void {
  // Stop existing watcher for this repo
  stopWatching(repoPath);

  const gitDir = path.join(repoPath, '.git');
  if (!fs.existsSync(gitDir)) return;

  const entry: WatcherEntry = {
    repoPath,
    watchers: [],
    debounceTimer: null,
  };

  // Watch key Git state files (single-file fs.watch — cheap)
  watchFile(repoPath, path.join(gitDir, 'HEAD'), entry, 'head');
  watchFile(repoPath, path.join(gitDir, 'ORIG_HEAD'), entry, 'head');
  watchFile(repoPath, path.join(gitDir, 'index'), entry, 'index');
  watchFile(repoPath, path.join(gitDir, 'MERGE_HEAD'), entry, 'merge');
  watchFile(repoPath, path.join(gitDir, 'CHERRY_PICK_HEAD'), entry, 'cherry-pick');
  watchFile(repoPath, path.join(gitDir, 'REVERT_HEAD'), entry, 'revert');
  watchFile(repoPath, path.join(gitDir, 'BISECT_LOG'), entry, 'bisect');

  // Watch refs directory (branch/tag changes) — chokidar handles atomic
  // git swaps correctly (fs.watch on Linux inotify follows inode, so an
  // atomic `mv` would leave the watcher pointing at the stale inode).
  watchDirectory(repoPath, path.join(gitDir, 'refs'), entry, 'refs');

  // Watch for rebase state
  const rebaseApplyDir = path.join(gitDir, 'rebase-apply');
  const rebaseMergeDir = path.join(gitDir, 'rebase-merge');
  if (fs.existsSync(rebaseApplyDir)) {
    watchDirectory(repoPath, rebaseApplyDir, entry, 'rebase');
  }
  if (fs.existsSync(rebaseMergeDir)) {
    watchDirectory(repoPath, rebaseMergeDir, entry, 'rebase');
  }

  // Watch working tree with chokidar + ignore patterns.
  // Key wins:
  //  - Linux: chokidar uses readdirp+inotify recursion to actually watch
  //    subdirectories (fs.watch recursive is silently ignored on Linux).
  //  - All platforms: ignore node_modules/dist/build/.git/objects/.git/logs
  //    to eliminate the firehose of irrelevant events that previously
  //    triggered a debounced `git status` re-run on every save inside
  //    node_modules.
  try {
    const workdirWatcher = chokidar.watch(repoPath, {
      persistent: false,
      ignoreInitial: true,
      ignored: WORKTREE_IGNORED,
      // Coalesce rapid writes — many editors do "atomic save" (write temp
      // then rename) which fires multiple events in quick succession.
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });
    workdirWatcher.on('all', () => debounce(entry, 'worktree'));
    entry.watchers.push(workdirWatcher);
  } catch {
    // Some platforms / repo paths (e.g. permission denied) can't be watched
  }

  watchers.set(repoPath, entry);
}

export function stopWatching(repoPath: string): void {
  const entry = watchers.get(repoPath);
  if (!entry) return;
  for (const watcher of entry.watchers) {
    try {
      // chokidar's close() returns a Promise; fs.watch's close() is sync.
      // Both have a `.close()` method — the return value can be ignored.
      const ret = watcher.close();
      if (ret && typeof (ret as Promise<void>).catch === 'function') {
        (ret as Promise<void>).catch(() => { /* ignore */ });
      }
    } catch {
      // ignore
    }
  }
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
  }
  watchers.delete(repoPath);
}

export function stopAllWatchers(): void {
  for (const repoPath of watchers.keys()) {
    stopWatching(repoPath);
  }
}

export function registerWatcherIpc(): void {
  const { ipcMain } = require('electron');
  ipcMain.handle('watcher:start', (_e: unknown, repoPath: string) => {
    startWatching(repoPath);
    return true;
  });
  ipcMain.handle('watcher:stop', (_e: unknown, repoPath: string) => {
    stopWatching(repoPath);
    return true;
  });
}
