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
  /** Guarantees a flush within DEBOUNCE_MAX_WAIT_MS of the FIRST event in a
   *  burst — see `debounce()` below. */
  maxWaitTimer: NodeJS.Timeout | null;
}

const watchers = new Map<string, WatcherEntry>();

const DEBOUNCE_MS = 500;
/**
 * PERF/latency guard (v3): the old debounce restarted its 500ms timer on
 * EVERY event, so a sustained event stream (git checkout of many files,
 * `git gc`, IDE auto-save on a watched dir) postponed the notification
 * FOREVER — the renderer's status could stay minutes stale while events
 * kept arriving. The max-wait cap guarantees the FIRST event of a burst is
 * delivered at most 2s later, no matter how many events follow it.
 * (Mirrors the renderer's leading+trailing strategy in App.tsx.)
 */
const DEBOUNCE_MAX_WAIT_MS = 2_000;

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
  // Start the max-wait timer on the FIRST event of a burst — it guarantees
  // a flush even if events keep arriving without pause (timer-restart
  // starvation). Later events only reset the SHORT trailing timer.
  if (!entry.maxWaitTimer) {
    entry.maxWaitTimer = setTimeout(() => {
      entry.maxWaitTimer = null;
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer);
        entry.debounceTimer = null;
      }
      notifyRenderer(entry.repoPath, eventType);
    }, DEBOUNCE_MAX_WAIT_MS);
    (entry.maxWaitTimer as unknown as { unref?: () => void }).unref?.();
  }
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
  }
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null;
    // The burst ended normally — cancel the max-wait guard.
    if (entry.maxWaitTimer) {
      clearTimeout(entry.maxWaitTimer);
      entry.maxWaitTimer = null;
    }
    notifyRenderer(entry.repoPath, eventType);
  }, DEBOUNCE_MS);
}

/**
 * Watch a single git state file. Uses fs.watch (cheap, single-file) when
 * the file exists. When it does NOT exist yet — MERGE_HEAD, CHERRY_PICK_HEAD,
 * REVERT_HEAD, BISECT_LOG, the rebase dirs — falls back to chokidar, which
 * supports not-yet-existing paths (it observes the parent directory and
 * emits when the target is created or deleted).
 *
 * This fixes a real staleness bug: fs.watch + existsSync meant optional
 * state files that were absent at watcher start were NEVER watched —
 * (a) a conflicted merge that started externally (or via a tool that
 * didn't refresh) produced no watcher event at all, and (b) after a merge
 * was committed/aborted, the MERGE_HEAD deletion was invisible and the
 * "merge in progress" banner stayed up.
 */
function watchFile(repoPath: string, filePath: string, entry: WatcherEntry, eventType: string) {
  try {
    if (fs.existsSync(filePath)) {
      const watcher = fs.watch(filePath, { persistent: false }, () => {
        debounce(entry, eventType);
      });
      entry.watchers.push(watcher);
      return;
    }
    // Not there yet — watch for its creation AND deletion via chokidar.
    const watcher = chokidar.watch(filePath, {
      persistent: false,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
    });
    watcher.on('all', () => debounce(entry, eventType));
    entry.watchers.push(watcher);
  } catch {
    // File may not be exist or be inaccessible
  }
}

/**
 * Test-only seam for the debounce logic (see tests/unit/watcherDebounce.test.ts).
 * Exposes entry construction + the debounce function so unit tests can drive
 * event bursts deterministically without real filesystem events, plus timer
 * cleanup so a test can assert "no late notification fired".
 */
export const __watcherTestHooks = {
  makeEntry(repoPath: string): WatcherEntry {
    return { repoPath, watchers: [], debounceTimer: null, maxWaitTimer: null };
  },
  debounce: (entry: WatcherEntry, eventType: string) => debounce(entry, eventType),
  clearTimers: (entry: WatcherEntry) => {
    if (entry.debounceTimer) { clearTimeout(entry.debounceTimer); entry.debounceTimer = null; }
    if (entry.maxWaitTimer) { clearTimeout(entry.maxWaitTimer); entry.maxWaitTimer = null; }
  },
};

/**
 * Watch a directory (e.g. .git/refs, rebase-merge state) with chokidar.
 * Small scope, no ignore filter needed. Handles directories that do not
 * exist yet (rebase-apply / rebase-merge are created when a rebase starts,
 * long after the watcher started — see watchFile).
 */
function watchDirectory(repoPath: string, dirPath: string, entry: WatcherEntry, eventType: string) {
  try {
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
    // Directory may not exist or be inaccessible
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
    maxWaitTimer: null,
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

  // Watch for rebase state — the dirs usually do NOT exist yet when the
  // watcher starts (they are created the moment a rebase begins). chokidar
  // handles not-yet-existing paths, so their creation is observed too.
  const rebaseApplyDir = path.join(gitDir, 'rebase-apply');
  const rebaseMergeDir = path.join(gitDir, 'rebase-merge');
  watchDirectory(repoPath, rebaseApplyDir, entry, 'rebase');
  watchDirectory(repoPath, rebaseMergeDir, entry, 'rebase');

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
  if (entry.maxWaitTimer) {
    clearTimeout(entry.maxWaitTimer);
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
