/**
 * Shared workdir-ignore predicate — imported by BOTH:
 *  - electron/services/watcher.ts (main process: targeted .git watchers +
 *    the macOS/Windows native recursive workdir watch),
 *  - electron/services/gitPollWorker.ts (the Linux chokidar workdir watch
 *    moved into the dedicated worker process, v3.6).
 *
 * MUST stay electron-import-free: it is bundled into the utilityProcess
 * worker, where `require('electron')` is unavailable.
 */
export const WORKTREE_IGNORED = (testPath: string): boolean => {
  // chokidar passes both absolute and relative paths depending on the
  // platform; match segment-wise to be robust.
  // Match: <sep>node_modules<sep>, <sep>dist<sep>, etc. anywhere in the path.
  // `.git` must match BOTH the directory form (<sep>.git<sep>) and the
  // FILE form (<sep>.git$ — submodule gitdir pointers).
  return (
    /(^|[/\\])(node_modules|dist|build|target|out|\.next|\.cache|\.turbo|\.parcel-cache|coverage)([/\\]|$)/.test(testPath) ||
    /(^|[/\\])\.git([/\\]|$)/.test(testPath) ||
    /(^|[/\\])\.DS_Store$/.test(testPath) ||
    /\.log$/.test(testPath) ||
    /\.swp$/.test(testPath) ||
    /\.lock$/.test(testPath)
  );
};
