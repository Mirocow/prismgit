import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import chokidar, { type FSWatcher } from 'chokidar';
import { WORKTREE_IGNORED } from './watcherIgnore.js';
import { startWorkdirWatchExternal, stopWorkdirWatchExternal } from './gitPollProcess.js';

// Re-export the shared predicate from its electron-free module — the same
// ignore list is bundled into the git worker (Linux workdir watch, v3.6).
// The import above stays as the internal use; tests import it from HERE.
export { WORKTREE_IGNORED };

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
  /** WORKDIR-DEGRADE fallback: when the workdir watcher dies (ENOSPC /
   *  persistent errors — huge repos exhaust Linux inotify budgets), a
   *  synthetic 10s poll keeps status refreshes flowing. */
  fallbackTimer: NodeJS.Timeout | null;
  /** Linux: deferred start of the chokidar workdir scan (its initial walk
   *  blocks the event loop for ~100ms-2s on big trees — deferred past the
   *  repo-open git burst so it never competes with the status the user is
   *  waiting for). */
  deferredStartTimer: NodeJS.Timeout | null;
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
 * The predicate itself lives in watcherIgnore.ts (electron-free so the
 * git worker can bundle it); see the notes there.
 *
 * Notes (history):
 *  - The ENTIRE `.git` directory is ignored by the workdir watcher: every
 *    git-state file that matters (HEAD, index, MERGE_HEAD, refs/, rebase
 *    dirs) is covered by the TARGETED watchers in startWatching(). The
 *    rest of .git is noise — including `fsmonitor--daemon.ipc`, a Unix
 *    DOMAIN SOCKET that fs.watch CANNOT observe on some macOS volumes:
 *    watching it produced `UNKNOWN: unknown error` → chokidar 5's async
 *    error handler → unhandled promise rejection → app crash (fixed
 *    together with the blanket 'error' listeners below).
 */

/**
 * WATCHER RESOURCES (v3.6, repo-switch freeze fix).
 *
 * The workdir watcher used chokidar on every platform. chokidar allocates
 * ONE fs.watch handle PER FILE AND PER DIRECTORY (it needs per-file marks
 * to catch in-place writes) and performs a full readdir scan before it
 * reports 'ready'. On the MAIN process that meant, at every repo switch:
 *   - a 160ms-2s+ event-loop block while the tree is scanned (measured:
 *   2500 files -> p95 59ms IPC latency spikes; 24k files -> ENOSPC),
 *   - 2×N inotify watches on Linux — a 24k-file repo EXHAUSTS the default
 *   8192 budget, chokidar fires ENOSPC, our error handler swallowed it and
 *   the watcher silently DIED: no more auto-refresh at all.
 *
 * New platform strategy:
 *   - darwin / win32: fs.watch(repoPath, {recursive: true}) — ONE kernel
 *     handle (FSEvents / ReadDirectoryChangesW), NO initial scan, catches
 *     in-place writes + creates + renames + deep paths. The ignore list is
 *     applied to the emitted filenames instead of the walk.
 *   - linux: Node's recursive watch is a userspace per-dir shim without an
 *     ignore filter (it would burn inotify budget on node_modules), so we
 *     keep chokidar — but DEFER its start by ~1s (past the repo-open git
 *     burst) and DEGRADE to a 10s synthetic poll when inotify runs out.
 */
const IS_LINUX = process.platform === 'linux';

/** Linux fallback cadence when real watching is impossible. 10s matches the
 * slowest acceptable freshness for an editor auto-save pick-up. */
const WORKDIR_FALLBACK_POLL_MS = 10_000;

function startWorkdirFallbackPoll(entry: WatcherEntry, reason: string): void {
  if (entry.fallbackTimer) return; // already degraded
  console.warn(`[watcher] workdir watch degraded to ${WORKDIR_FALLBACK_POLL_MS}ms poll (${reason}) for ${entry.repoPath}`);
  // notifyRenderer -> renderer's scheduleRefresh -> background git status.
  // unref'd: never keeps the app alive, and stopWatching clears it.
  entry.fallbackTimer = setInterval(() => {
    notifyRenderer(entry.repoPath, 'worktree-poll');
  }, WORKDIR_FALLBACK_POLL_MS);
  (entry.fallbackTimer as unknown as { unref?: () => void }).unref?.();
}

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
      // fs.watch failures fire LATER as 'error' events on the FSWatcher
      // (git atomically replacing the file, permission races). Without a
      // listener, EventEmitter 'error' semantics THROW — an uncaught
      // exception. Swallow: a dead single-file watch only means "no more
      // events for this file", never a crash.
      watcher.on('error', () => { /* degrade silently */ });
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
    // chokidar 5's internal fs.watch error handler is an ASYNC function —
    // any throw it triggers (including our own missing 'error' listener)
    // becomes an UNHANDLED PROMISE REJECTION. Attach a no-op 'error'
    // listener to every chokidar watcher: emit('error') then resolves
    // normally instead of crashing the app.
    watcher.on('error', () => { /* degrade silently */ });
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
    return { repoPath, watchers: [], debounceTimer: null, maxWaitTimer: null, fallbackTimer: null, deferredStartTimer: null };
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
    // See watchFile — prevents chokidar 5's async error path from turning
    // an fs.watch backend failure into an unhandled rejection.
    watcher.on('error', () => { /* degrade silently */ });
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
    fallbackTimer: null,
    deferredStartTimer: null,
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

  // ── Working tree watch ───────────────────────────────────────────────
  // v3.6: platform-tiered (see the WATCHER RESOURCES block above). macOS and
  // Windows use ONE native recursive handle — zero initial scan, zero per-file
  // watch storm, instant start (this was the repo-switch IPC latency spikes).
  // Linux keeps chokidar (its ignore filter skips node_modules), but deferred
  // past the repo-open burst, with an ENOSPC fallback poll.
  if (!IS_LINUX) {
    try {
      // Native recursive watch: FSEvents (mac) / ReadDirectoryChangesW (win)
      // — the filename arrives repo-relative; run it through the same ignore
      // filter at EVENT level (the walk itself is the kernel's business).
      const nativeWatcher = fs.watch(
        repoPath,
        { recursive: true, persistent: false },
        (_event: string, filename: string | Buffer | null) => {
          if (!filename) return; // rare: some platforms omit it on bulk ops
          const rel = filename.toString();
          if (WORKTREE_IGNORED(rel) || WORKTREE_IGNORED(path.join(repoPath, rel))) return;
          debounce(entry, 'worktree');
        },
      );
      // fs.watch errors fire asynchronously; without a listener the 'error'
      // event THROWS. ENOSPC-class failures degrade to the 10s poll instead
      // of dying silently (the old behavior: watcher dead, no auto-refresh).
      nativeWatcher.on('error', (err: NodeJS.ErrnoException) => {
        console.warn(`[watcher] native workdir watch error (${err.code}) for ${repoPath} — degrading to poll`);
        try { nativeWatcher.close(); } catch { /* already closed */ }
        const idx = entry.watchers.indexOf(nativeWatcher);
        if (idx >= 0) entry.watchers.splice(idx, 1);
        startWorkdirFallbackPoll(entry, `native watch error ${err.code ?? 'unknown'}`);
      });
      entry.watchers.push(nativeWatcher);
    } catch (e) {
      // Recursive unsupported / permission denied — degrade immediately.
      const code = (e as NodeJS.ErrnoException)?.code ?? 'unknown';
      startWorkdirFallbackPoll(entry, `native watch failed ${code}`);
    }
  } else {
    // Linux: the chokidar workdir watch runs in the DEDICATED git worker
    // process (v3.6) — its initial readdir scan (100ms-2s+ of event-loop
    // blockage on big trees) and its per-file inotify marks stay entirely
    // off the main loop. The .git targeted watchers above are already live
    // here in main, so index/HEAD/refs changes are caught instantly while
    // the worker-side watch warms up.
    void startWorkdirWatchExternal(repoPath, (event) => {
      // Repo may have been switched away before the async start resolved —
      // the entry is only meaningful while it is the REGISTERED one.
      if (watchers.get(repoPath) !== entry) return;
      if (event === 'worktree') {
        debounce(entry, 'worktree');
        return;
      }
      if (event === 'error') {
        // The worker-side watch DIED (ENOSPC on a huge repo, …) — degrade to
        // the 10s synthetic poll instead of silently losing auto-refresh.
        startWorkdirFallbackPoll(entry, 'worker watch error');
        return;
      }
      // 'lost' — the worker process itself died (crash/timeout kill). Fall
      // back to an in-process chokidar watch, DEFERRED ~1s so its scan never
      // collides with whatever git burst follows (the exact tier the worker
      // was doing for us).
      entry.deferredStartTimer = setTimeout(() => {
        entry.deferredStartTimer = null;
        if (watchers.get(repoPath) !== entry) return;
        try {
          const workdirWatcher = chokidar.watch(repoPath, {
            persistent: false,
            ignoreInitial: true,
            ignored: WORKTREE_IGNORED,
            // Coalesce rapid writes — many editors do "atomic save" (write
            // temp then rename) which fires multiple events in succession.
            awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
          });
          workdirWatcher.on('all', () => debounce(entry, 'worktree'));
          // chokidar 5's async error path (unhandled rejection) is guarded
          // by an 'error' listener; a real ENOSPC (inotify budget exhausted
          // on huge repos) DEGRADES to the 10s poll, never dies silently.
          workdirWatcher.on('error', (err) => {
            const code = (err as NodeJS.ErrnoException)?.code ?? 'unknown';
            console.warn(`[watcher] chokidar workdir error (${code}) for ${repoPath} — degrading to poll`);
            try { void workdirWatcher.close(); } catch { /* ignore */ }
            const idx = entry.watchers.indexOf(workdirWatcher);
            if (idx >= 0) entry.watchers.splice(idx, 1);
            startWorkdirFallbackPoll(entry, `chokidar error ${code}`);
          });
          entry.watchers.push(workdirWatcher);
        } catch {
          startWorkdirFallbackPoll(entry, 'chokidar start failed');
        }
      }, 1_000);
      (entry.deferredStartTimer as unknown as { unref?: () => void }).unref?.();
    }).then((started) => {
      // Worker unavailable (fork cooldown / non-Electron host) — run the
      // chokidar watch in-process right away (deferred: same burst-avoidance).
      if (!started && watchers.get(repoPath) === entry) {
        watchers.delete(repoPath); // let the fallback path re-register via recursion
        startWorkdirWatchInProcess(repoPath, entry);
      }
    });
  }

  watchers.set(repoPath, entry);
}

/** In-process chokidar workdir watch (Linux fallback when the git worker is
 *  unavailable). DEFERRED ~1s past the repo-open git burst — the scan blocks
 *  the main loop, so it must never race the status the user waits for. */
function startWorkdirWatchInProcess(repoPath: string, entry: WatcherEntry): void {
  entry.deferredStartTimer = setTimeout(() => {
    entry.deferredStartTimer = null;
    if (watchers.get(repoPath) !== entry) return;
    try {
      const workdirWatcher = chokidar.watch(repoPath, {
        persistent: false,
        ignoreInitial: true,
        ignored: WORKTREE_IGNORED,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
      });
      workdirWatcher.on('all', () => debounce(entry, 'worktree'));
      workdirWatcher.on('error', (err) => {
        const code = (err as NodeJS.ErrnoException)?.code ?? 'unknown';
        console.warn(`[watcher] chokidar workdir error (${code}) for ${repoPath} — degrading to poll`);
        try { void workdirWatcher.close(); } catch { /* ignore */ }
        const idx = entry.watchers.indexOf(workdirWatcher);
        if (idx >= 0) entry.watchers.splice(idx, 1);
        startWorkdirFallbackPoll(entry, `chokidar error ${code}`);
      });
      entry.watchers.push(workdirWatcher);
    } catch {
      startWorkdirFallbackPoll(entry, 'chokidar start failed');
    }
  }, 1_000);
  (entry.deferredStartTimer as unknown as { unref?: () => void }).unref?.();
  watchers.set(repoPath, entry);
}

export function stopWatching(repoPath: string): void {
  const entry = watchers.get(repoPath);
  if (!entry) return;
  // Linux worker-side watch (fire-and-forget; no-op when never started).
  try { stopWorkdirWatchExternal(repoPath); } catch { /* ignore */ }
  if (entry.deferredStartTimer) {
    clearTimeout(entry.deferredStartTimer);
    entry.deferredStartTimer = null;
  }
  if (entry.fallbackTimer) {
    clearInterval(entry.fallbackTimer);
    entry.fallbackTimer = null;
  }
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
