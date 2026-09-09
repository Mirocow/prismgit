import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';

/**
 * File watcher for Git repository state changes.
 * Watches .git/HEAD, .git/index, .git/MERGE_HEAD, .git/refs, and working tree.
 * Debounces events to avoid spamming the renderer.
 */

interface WatcherEntry {
  repoPath: string;
  watchers: fs.FSWatcher[];
  debounceTimer: NodeJS.Timeout | null;
}

const watchers = new Map<string, WatcherEntry>();

const DEBOUNCE_MS = 300;

function notifyRenderer(repoPath: string, eventType: string) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send('watcher:changed', { repoPath, eventType, timestamp: Date.now() });
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

function watchDirectory(repoPath: string, dirPath: string, entry: WatcherEntry, eventType: string) {
  try {
    if (!fs.existsSync(dirPath)) return;
    const watcher = fs.watch(dirPath, { persistent: false, recursive: true }, () => {
      debounce(entry, eventType);
    });
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

  // Watch key Git state files
  watchFile(repoPath, path.join(gitDir, 'HEAD'), entry, 'head');
  watchFile(repoPath, path.join(gitDir, 'ORIG_HEAD'), entry, 'head');
  watchFile(repoPath, path.join(gitDir, 'index'), entry, 'index');
  watchFile(repoPath, path.join(gitDir, 'MERGE_HEAD'), entry, 'merge');
  watchFile(repoPath, path.join(gitDir, 'CHERRY_PICK_HEAD'), entry, 'cherry-pick');
  watchFile(repoPath, path.join(gitDir, 'REVERT_HEAD'), entry, 'revert');
  watchFile(repoPath, path.join(gitDir, 'BISECT_LOG'), entry, 'bisect');

  // Watch refs directory (branch/tag changes)
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

  // Watch working tree (debounced more aggressively)
  try {
    const workdirWatcher = fs.watch(repoPath, { persistent: false, recursive: true }, () => {
      debounce(entry, 'worktree');
    });
    entry.watchers.push(workdirWatcher);
  } catch {
    // Some platforms don't support recursive watch
  }

  watchers.set(repoPath, entry);
}

export function stopWatching(repoPath: string): void {
  const entry = watchers.get(repoPath);
  if (!entry) return;
  for (const watcher of entry.watchers) {
    try {
      watcher.close();
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
