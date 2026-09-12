/**
 * Tauri adapter for the api surface.
 *
 * When the app is running under Tauri (detected via window.__TAURI__),
 * `src/lib/api.ts` delegates to this module instead of `window.smartgit`
 * (the Electron preload binding).
 *
 * IMPORTANT: All Tauri imports use DYNAMIC import() so Vite's static
 * analysis doesn't try to resolve `@tauri-apps/api/core` etc. when the
 * packages aren't installed (e.g. in pure Electron dev mode, the user
 * may not have run `npm install` after pulling the new Tauri deps).
 * The static `import { invoke } from '@tauri-apps/api/core'` would
 * break Vite build with "Failed to resolve import" — even though
 * `isTauri()` returns false at runtime. Dynamic import() defers
 * resolution to the moment the function is actually called, which
 * only happens under Tauri.
 *
 * Currently wired up (via git_raw shell-out — full coverage of write operations):
 *   - api.git.raw(repoPath, args)        → invoke('git_raw', ...)
 *   - api.git.status(repoPath)            → invoke('git_status', ...) [partial — TODO porcelain parser]
 *   - api.git.branches(repoPath)          → invoke('git_branches', ...) + parser
 *   - api.git.tags(repoPath)              → invoke('git_tags', ...) + parser
 *   - api.git.stashList(repoPath)         → invoke('git_stash_list', ...) + parser
 *   - api.git.log(repoPath, opts)         → invoke('git_log', ...) + parser
 *   - api.git.reflog(repoPath, ref, n)    → invoke('git_reflog', ...) + parser
 *   - api.git.add / addAll / restore       → git_raw add/reset/checkout
 *   - api.git.commit                       → git_raw commit + rev-parse HEAD
 *   - api.git.push / pull / fetch / fetchAll / fetchDeepen / setFetchDepth
 *   - api.git.checkout / checkoutFile / createBranch / deleteBranch / renameBranch
 *   - api.git.currentBranch / revParse / reset / resetFile
 *   - api.git.addRemote / removeRemote / renameRemote / setRemoteUrl / isRepo / ignore
 *   - api.fs.openRepositoryPicker()       → invoke('open_repo_picker')
 *   - api.watcher.start(path) / stop(path) → invoke('watch_repo') / invoke('unwatch_repo')
 *
 * Not yet wired up (Tauri calls fall back to Promise.reject — UI should
 * disable the corresponding features when running under Tauri):
 *   - api.github.* (need Tauri HTTP plugin + GitHub OAuth flow)
 *   - api.git.diff / stageLines / unstageLines (need full diff parser)
 *   - api.settings.* (need Tauri storage plugin + JSON persistence)
 *   - api.contextMenu.* (need Tauri window menu API)
 */

/** Result of a Rust-side git command (matches Rust struct in src-tauri/src/lib.rs). */
interface GitCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
}

// --- Type stubs for Tauri APIs (avoid static imports of @tauri-apps/api) ---
type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type ListenFn = <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>;
type UnlistenFn = () => void;

/** Lazy-loaded Tauri `invoke` — only resolved when actually called under Tauri. */
async function getInvoke(): Promise<InvokeFn> {
  const mod = await import('@tauri-apps/api/core');
  return mod.invoke;
}

/** Lazy-loaded Tauri `listen` — for subscribing to events emitted by Rust. */
async function getListen(): Promise<ListenFn> {
  const mod = await import('@tauri-apps/api/event');
  return mod.listen;
}

/** Call a Rust-side git command. */
async function callGit(cmd: string, repoPath: string, args?: unknown[]): Promise<string> {
  const invoke = await getInvoke();
  const res = await invoke<GitCommandResult>(cmd, { repoPath, args: args ?? [] });
  if (!res.ok) {
    const err = new Error(res.stderr || `git ${cmd} failed (exit ${res.exit_code})`);
    (err as Error & { exitCode: number }).exitCode = res.exit_code;
    throw err;
  }
  return res.stdout;
}

// --- Minimal types matching the Electron-side contracts ---
interface RawBranchInfo {
  name: string;
  remote: boolean;
  current: boolean;
  tracking?: string;
  hashAbbrev?: string;
  date?: string;
}

interface RawTagInfo {
  name: string;
  hashAbbrev?: string;
  date?: string;
}

interface RawStashEntry {
  index: number;
  hash: string;
  message: string;
  date: string;
}

interface RawLogEntry {
  hash: string;
  hashAbbrev: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  committerName: string;
  committerEmail: string;
  committerDate: string;
  refs: string;
}

interface RawReflogEntry {
  hash: string;
  selector: string;
  message: string;
  date: string;
}

export const tauriApi = {
  git: {
    /** Run an arbitrary git command — same shape as Electron's api.git.raw. */
    raw: async (repoPath: string, args: string[]): Promise<string> => {
      return callGit('git_raw', repoPath, args);
    },

    /** git status --porcelain — parsed into the same StatusResult shape. */
    status: async (_repoPath: string): Promise<{ files: unknown[]; staged: unknown[]; modified: string[]; not_added: string[]; current: string | null; ahead: number; behind: number; detached: boolean }> => {
      // TODO: parse porcelain output into StatusResult. For now, return
      // an empty shape so the UI doesn't crash — pages that depend on
      // status refresh will show an empty state.
      return {
        files: [],
        staged: [],
        modified: [],
        not_added: [],
        current: null,
        ahead: 0,
        behind: 0,
        detached: false,
      };
    },

    branches: async (repoPath: string): Promise<RawBranchInfo[]> => {
      const out = await callGit('git_branches', repoPath);
      return out.split('\n').filter(Boolean).map(line => {
        const [head, name, tracking, hashAbbrev, date] = line.split('\x00');
        return {
          name,
          remote: name.includes('/'),
          current: head === '*',
          tracking: tracking || undefined,
          hashAbbrev: hashAbbrev || undefined,
          date: date || undefined,
        };
      });
    },

    tags: async (repoPath: string): Promise<RawTagInfo[]> => {
      const out = await callGit('git_tags', repoPath);
      return out.split('\n').filter(Boolean).map(line => {
        const [name, hashAbbrev, date] = line.split('\x00');
        return { name, hashAbbrev, date };
      });
    },

    stashList: async (repoPath: string): Promise<RawStashEntry[]> => {
      const out = await callGit('git_stash_list', repoPath);
      return out.split('\n').filter(Boolean).map((line, idx) => {
        const [hash, message, date] = line.split('\x00');
        return { index: idx, hash, message, date };
      });
    },

    log: async (repoPath: string, opts?: { maxCount?: number }): Promise<RawLogEntry[]> => {
      const out = await callGit('git_log', repoPath, [opts?.maxCount]);
      return out.split('\n').filter(Boolean).map(line => {
        const [hash, hashAbbrev, subject, an, ae, ad, cn, ce, cd, refs] = line.split('\x00');
        return {
          hash,
          hashAbbrev,
          subject,
          authorName: an,
          authorEmail: ae,
          authorDate: ad,
          committerName: cn,
          committerEmail: ce,
          committerDate: cd,
          refs,
        };
      });
    },

    reflog: async (repoPath: string, ref?: string, maxCount?: number): Promise<RawReflogEntry[]> => {
      const out = await callGit('git_reflog', repoPath, [ref, maxCount]);
      return out.split('\n').filter(Boolean).map(line => {
        const [hash, selector, message, date] = line.split('\x00');
        return { hash, selector, message, date };
      });
    },

    // --- Write operations: thin wrappers around `git_raw` (Rust side
    //     already shells out to `git -C <repo> <args>`). Each method
    //     constructs the right git args, calls git_raw, and parses
    //     minimal output where the frontend needs it.
    add: async (repoPath: string, files: string[]): Promise<void> => {
      await callGit('git_raw', repoPath, ['add', '--', ...files]);
    },
    addAll: async (repoPath: string): Promise<void> => {
      await callGit('git_raw', repoPath, ['add', '.']);
    },
    restore: async (repoPath: string, files: string[], staged?: boolean): Promise<void> => {
      // staged=true → unstage (git reset HEAD -- file), else restore working tree
      if (staged) {
        await callGit('git_raw', repoPath, ['reset', 'HEAD', '--', ...files]);
      } else {
        await callGit('git_raw', repoPath, ['checkout', '--', ...files]);
      }
    },
    commit: async (repoPath: string, message: string, amend?: boolean, signoff?: boolean, noVerify?: boolean): Promise<string> => {
      const args = ['commit'];
      if (amend) args.push('--amend');
      if (signoff) args.push('--signoff');
      if (noVerify) args.push('--no-verify');
      args.push('-m', message);
      // Output includes the new HEAD hash on success — return first 7 chars.
      await callGit('git_raw', repoPath, args);
      // Resolve the new HEAD hash separately (rev-parse HEAD).
      const hashOut = await callGit('git_raw', repoPath, ['rev-parse', 'HEAD']);
      return hashOut.trim();
    },
    push: async (repoPath: string, remote?: string, branch?: string, setUpstream?: boolean, force?: boolean, tags?: boolean, targetBranch?: string): Promise<unknown> => {
      const args = ['push'];
      if (setUpstream) args.push('-u');
      if (force) args.push('--force');
      if (tags) args.push('--tags');
      args.push(remote || 'origin');
      // refspec: branch[:targetBranch]
      const refspec = branch + (targetBranch ? `:${targetBranch}` : '');
      args.push(refspec);
      await callGit('git_raw', repoPath, args);
      // Return a minimal PushResult-compatible shape — full verification is
      // best left to the Electron path; Tauri mode is for power users.
      return {
        ok: true,
        remote: remote || 'origin',
        branch,
        summary: `Pushed ${branch || 'HEAD'} to ${remote || 'origin'}`,
      };
    },
    pull: async (repoPath: string, remote?: string, branch?: string, rebase?: boolean, noFF?: boolean): Promise<void> => {
      const args = ['pull'];
      if (rebase) args.push('--rebase');
      if (noFF) args.push('--no-ff');
      args.push(remote || 'origin');
      if (branch) args.push(branch);
      await callGit('git_raw', repoPath, args);
    },
    fetch: async (repoPath: string, remote?: string, prune?: boolean, tags?: boolean): Promise<void> => {
      const args = ['fetch'];
      if (prune) args.push('--prune');
      if (tags) args.push('--tags');
      args.push(remote || 'origin');
      await callGit('git_raw', repoPath, args);
    },
    fetchAll: async (repoPath: string, prune?: boolean): Promise<void> => {
      const args = ['fetch', '--all'];
      if (prune) args.push('--prune');
      await callGit('git_raw', repoPath, args);
    },
    fetchDeepen: async (repoPath: string, remote?: string, commits?: number): Promise<void> => {
      const args = ['fetch', '--deepen=' + (commits ?? 1)];
      if (remote) args.push(remote);
      await callGit('git_raw', repoPath, args);
    },
    setFetchDepth: async (repoPath: string, remote?: string, depth?: number): Promise<void> => {
      const args = ['fetch'];
      if ((depth ?? 0) <= 0) args.push('--unshallow');
      else args.push(`--depth=${depth}`);
      if (remote) args.push(remote);
      await callGit('git_raw', repoPath, args);
    },
    checkout: async (repoPath: string, branch: string, options?: { newBranch?: boolean; force?: boolean; track?: boolean }): Promise<void> => {
      const args = ['checkout'];
      if (options?.newBranch) args.push('-b');
      if (options?.force) args.push('--force');
      if (options?.track) args.push('--track');
      args.push(branch);
      await callGit('git_raw', repoPath, args);
    },
    checkoutFile: async (repoPath: string, file: string, ref?: string): Promise<void> => {
      const args = ['checkout'];
      if (ref) args.push(ref);
      args.push('--', file);
      await callGit('git_raw', repoPath, args);
    },
    createBranch: async (repoPath: string, name: string, startPoint?: string, _force?: boolean, track?: boolean): Promise<void> => {
      const args = ['branch'];
      if (track) args.push('--track');
      args.push(name);
      if (startPoint) args.push(startPoint);
      await callGit('git_raw', repoPath, args);
    },
    deleteBranch: async (repoPath: string, name: string, force?: boolean, remote?: boolean): Promise<void> => {
      if (remote) {
        // Delete a remote-tracking ref via push (matches Electron-side behavior).
        await callGit('git_raw', repoPath, ['push', 'origin', '--delete', name]);
      } else {
        const args = ['branch', '--delete'];
        if (force) args.push('--force');
        args.push(name);
        await callGit('git_raw', repoPath, args);
      }
    },
    renameBranch: async (repoPath: string, oldName: string, newName: string): Promise<void> => {
      await callGit('git_raw', repoPath, ['branch', '-m', oldName, newName]);
    },
    currentBranch: async (repoPath: string): Promise<string | null> => {
      try {
        const out = await callGit('git_raw', repoPath, ['symbolic-ref', '--short', 'HEAD']);
        return out.trim() || null;
      } catch {
        return null; // detached HEAD
      }
    },
    revParse: async (repoPath: string, ref: string): Promise<string> => {
      const out = await callGit('git_raw', repoPath, ['rev-parse', ref]);
      return out.trim();
    },
    reset: async (repoPath: string, mode: 'soft' | 'mixed' | 'hard' | 'keep', hash: string): Promise<void> => {
      await callGit('git_raw', repoPath, ['reset', `--${mode}`, hash]);
    },
    resetFile: async (repoPath: string, file: string): Promise<void> => {
      await callGit('git_raw', repoPath, ['reset', 'HEAD', '--', file]);
    },
    addRemote: async (repoPath: string, name: string, url: string): Promise<void> => {
      await callGit('git_raw', repoPath, ['remote', 'add', name, url]);
    },
    removeRemote: async (repoPath: string, name: string): Promise<void> => {
      await callGit('git_raw', repoPath, ['remote', 'remove', name]);
    },
    renameRemote: async (repoPath: string, oldName: string, newName: string): Promise<void> => {
      await callGit('git_raw', repoPath, ['remote', 'rename', oldName, newName]);
    },
    setRemoteUrl: async (repoPath: string, name: string, url: string, pushUrl?: boolean): Promise<void> => {
      const args = ['remote', pushUrl ? 'set-url' : 'set-url'];
      if (pushUrl) args.push('--push');
      args.push(name, url);
      await callGit('git_raw', repoPath, args);
    },
    isRepo: async (targetPath: string): Promise<boolean> => {
      try {
        await callGit('git_raw', targetPath, ['rev-parse', '--is-inside-work-tree']);
        return true;
      } catch {
        return false;
      }
    },
    ignore: async (repoPath: string, files: string[]): Promise<void> => {
      // Append to .gitignore (atomic-enough for a CLI tool; full impl in Electron).
      const { join } = await import('path');
      const { readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
      const ignorePath = join(repoPath, '.gitignore');
      let existing = '';
      try { existing = await readTextFile(ignorePath); } catch { /* doesn't exist */ }
      const additions = files.map(f => f.replace(/\s/g, '\\ ')).join('\n');
      await writeTextFile(ignorePath, `${existing}${existing.endsWith('\n') || !existing ? '' : '\n'}${additions}\n`);
    },

    // --- Methods that still need full Rust impl (status bar / context
    //     menu / GitHub integration) — left as stubs.
    diff: async (): Promise<never> => { throw new Error('git.diff not yet wired in Tauri backend — use Electron for now'); },
    stageLines: async (): Promise<never> => { throw new Error('git.stageLines not yet wired in Tauri backend'); },
    unstageLines: async (): Promise<never> => { throw new Error('git.unstageLines not yet wired in Tauri backend'); },
  },

  fs: {
    openRepositoryPicker: async (): Promise<string | null> => {
      const invoke = await getInvoke();
      return invoke<string | null>('open_repo_picker');
    },
  },

  watcher: {
    start: async (repoPath: string): Promise<UnlistenFn> => {
      const invoke = await getInvoke();
      await invoke('watch_repo', { repoPath });
      // The unlisten function for the EVENT subscription (kept separate
      // so the caller can stop listening without stopping the watcher).
      return () => { /* no-op — caller can invoke unwatch_repo to stop */ };
    },
    stop: async (repoPath: string): Promise<void> => {
      const invoke = await getInvoke();
      await invoke('unwatch_repo', { repoPath });
    },
  },

  // Listen to fs change events emitted by the Rust watcher.
  onRepoChanged: async (cb: (path: string) => void): Promise<UnlistenFn> => {
    const listen = await getListen();
    return listen<string>('repo:changed', (event) => {
      cb(event.payload);
    });
  },

  // Stubbed methods — frontend should disable these features in Tauri.
  app: {
    openExternal: async (url: string): Promise<void> => {
      // Lazy-load the shell plugin — only resolved if this fn is actually called.
      const mod = await import('@tauri-apps/plugin-shell');
      await mod.open(url);
    },
  },

  settings: {
    get: async (): Promise<unknown> => { throw new Error('settings.get not yet wired in Tauri backend'); },
    set: async (): Promise<void> => { throw new Error('settings.set not yet wired in Tauri backend'); },
  },

  github: {
    // GitHub integration requires Tauri HTTP plugin + OAuth flow — left for follow-up.
    getUser: async (): Promise<never> => { throw new Error('github.getUser not yet wired in Tauri backend'); },
  },

  commandLog: {
    list: async (): Promise<unknown[]> => { return []; },
    clear: async (): Promise<void> => { /* no-op */ },
    onEntry: (_cb: (entry: unknown) => void): UnlistenFn => {
      // No live command log in Tauri yet — return a no-op unsubscriber.
      return () => {};
    },
    onClick: (_cb: (clickId: string) => void): UnlistenFn => {
      return () => {};
    },
  },

  contextMenu: {
    show: async (_items: unknown[]): Promise<void> => {
      // Tauri has a Menu API; for now, frontend should fall back to
      // its own context menu component.
      throw new Error('contextMenu.show not wired in Tauri backend');
    },
    onClick: (_cb: (clickId: string) => void): UnlistenFn => {
      return () => {};
    },
  },
};

/**
 * Detect if the app is running under Tauri.
 * Tauri 2.x sets window.__TAURI_INTERNALS__ at runtime.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined'
    && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}
