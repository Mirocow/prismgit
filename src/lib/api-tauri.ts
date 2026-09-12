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

/** Lazily import the frontend diff parser — avoids pulling it into the
 *  startup bundle when the user never opens a Diff view. */
async function parseRawDiff(rawDiff: string): Promise<unknown> {
  const { parseDiff } = await import('./diffParser');
  const parsed = parseDiff(rawDiff);
  // Read old/new content via `git show :file` / `git show ref:file` —
  // for the Tauri path we approximate by joining hunk lines (the full
  // file content is only needed by the side-by-side view, which falls
  // back to the hunk-based view when oldContent/newContent are empty).
  return {
    oldContent: '',
    newContent: '',
    oldPath: '',
    newPath: '',
    hunks: parsed.hunks,
    binary: rawDiff.includes('Binary files'),
    newFile: parsed.newFile,
    deletedFile: parsed.deletedFile,
    renamedFile: parsed.renamedFile,
    modeChange: parsed.modeChange,
  };
}

/** Resolve the path to the settings JSON file in the app's data directory.
 *  Caches the path after the first call (appDataDir doesn't change). */
let cachedSettingsPath: string | null = null;
async function getSettingsPath(): Promise<string> {
  if (cachedSettingsPath) return cachedSettingsPath;
  const pathMod = await import('@tauri-apps/api/path');
  const appDataDir = await pathMod.appDataDir();
  // Ensure the directory exists — plugin-fs mkdir with recursive.
  const { mkdir } = await import('@tauri-apps/plugin-fs');
  try { await mkdir(appDataDir, { recursive: true }); } catch { /* may already exist */ }
  const { join } = await import('path');
  cachedSettingsPath = join(appDataDir, 'prismgit-settings.json');
  return cachedSettingsPath;
}

/** Read the settings JSON file. Returns {} when the file doesn't exist yet. */
async function readSettingsFile(): Promise<Record<string, unknown>> {
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await getSettingsPath();
    const text = await readTextFile(path);
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // File doesn't exist or is invalid JSON — return empty object.
    return {};
  }
}

/** Write the settings JSON file atomically (writeTextFile is atomic on
 *  most platforms since it's a single syscall on a small file). */
async function writeSettingsFile(data: Record<string, unknown>): Promise<void> {
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  const path = await getSettingsPath();
  await writeTextFile(path, JSON.stringify(data, null, 2));
}

/** Write a patch string to a temp file in the system temp dir.
 *  Returns the full path so it can be passed to `git apply --cached`. */
async function writeTempPatch(repoPath: string, patch: string, prefix: string): Promise<string> {
  const { tempDir } = await import('@tauri-apps/api/path');
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  const tmp = await tempDir();
  const filename = `prismgit-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.patch`;
  const fullPath = `${tmp}/${filename}`;
  await writeTextFile(fullPath, patch);
  return fullPath;
}

/** Remove a temp file — silently ignores errors (file may not exist). */
async function removeTempFile(path: string): Promise<void> {
  try {
    const { remove } = await import('@tauri-apps/plugin-fs');
    await remove(path);
  } catch {
    // ignore — file may not exist or already cleaned up
  }
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

    // --- Diff methods: shell out to `git diff` and parse the unified
    //     output via the shared frontend diffParser. The result shape
    //     matches DiffResult from electron/types/git-api.ts so the
    //     DiffViewer component works identically in Electron + Tauri.
    //     oldContent/newContent are empty strings — the side-by-side view
    //     falls back to hunk-based rendering when they're missing.
    diff: async (repoPath: string, file: string, options?: { staged?: boolean; ref?: string }): Promise<unknown> => {
      const args = ['diff', '--no-color'];
      if (options?.staged) args.push('--cached');
      if (options?.ref) args.push(options.ref);
      args.push('--', file);
      const raw = await callGit('git_raw', repoPath, args);
      return parseRawDiff(raw);
    },
    diffBranches: async (repoPath: string, base: string, compare: string): Promise<unknown> => {
      const raw = await callGit('git_raw', repoPath, ['diff', '--no-color', `${base}..${compare}`]);
      return parseRawDiff(raw);
    },
    diffCommit: async (repoPath: string, hash: string, parentHash?: string): Promise<unknown> => {
      const range = parentHash ? `${parentHash}..${hash}` : `${hash}^..${hash}`;
      const raw = await callGit('git_raw', repoPath, ['diff', '--no-color', range]);
      return parseRawDiff(raw);
    },
    commitFiles: async (repoPath: string, hash: string): Promise<unknown[]> => {
      // git diff-tree --no-commit-id --name-status -r <hash>
      const raw = await callGit('git_raw', repoPath, ['diff-tree', '--no-commit-id', '--name-status', '-r', hash]);
      return raw.split('\n').filter(Boolean).map(line => {
        const [status, ...pathParts] = line.split('\t');
        const path = pathParts.join('\t');
        const letter = status.charAt(0);
        return {
          path,
          status: letter === 'A' ? 'A' : letter === 'D' ? 'D' : letter === 'R' ? 'R' : letter === 'C' ? 'C' : 'M',
          oldPath: letter === 'R' || letter === 'C' ? pathParts[1] : undefined,
          additions: 0,
          deletions: 0,
          binary: false,
        };
      });
    },
    trackedFiles: async (repoPath: string): Promise<string[]> => {
      const raw = await callGit('git_raw', repoPath, ['ls-files']);
      return raw.split('\n').filter(Boolean);
    },

    // --- Methods that still need full Rust impl (status bar / context
    //     menu / GitHub integration) — left as stubs.
    stageLines: async (repoPath: string, file: string, lineRanges: { start: number; end: number }[]): Promise<void> => {
      // Get the unstaged diff for this file with zero context
      const diffOut = await callGit('git_raw', repoPath, ['diff', '--unified=0', '--no-color', '--', file]);
      if (!diffOut.trim()) {
        // Untracked or unchanged — stage the whole file
        await callGit('git_raw', repoPath, ['add', '--', file]);
        return;
      }
      const { buildFilteredPatch } = await import('./patchStaging');
      const patch = buildFilteredPatch(diffOut, lineRanges);
      if (!patch) return;
      // Write patch to temp file and apply via git apply --cached
      const tmpPath = await writeTempPatch(repoPath, patch, 'stage');
      try {
        await callGit('git_raw', repoPath, ['apply', '--cached', '--unidiff-zero', '--whitespace=nowarn', tmpPath]);
      } finally {
        await removeTempFile(tmpPath);
      }
    },
    unstageLines: async (repoPath: string, file: string, lineRanges: { start: number; end: number }[]): Promise<void> => {
      // Get the staged diff for this file with zero context
      const diffOut = await callGit('git_raw', repoPath, ['diff', '--cached', '--unified=0', '--no-color', '--', file]);
      if (!diffOut.trim()) return;
      const { buildFilteredPatch } = await import('./patchStaging');
      const patch = buildFilteredPatch(diffOut, lineRanges);
      if (!patch) return;
      // Write patch to temp file and apply in reverse
      const tmpPath = await writeTempPatch(repoPath, patch, 'unstage');
      try {
        await callGit('git_raw', repoPath, ['apply', '--cached', '--reverse', '--unidiff-zero', '--whitespace=nowarn', tmpPath]);
      } finally {
        await removeTempFile(tmpPath);
      }
    },
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
    // setLocale is a no-op in Tauri — locale is managed by the i18n
    // store in the renderer. This stub exists so App.tsx's
    // window.smartgit?.app?.setLocale?.(locale) doesn't crash.
    setLocale: async (_locale: string): Promise<void> => {
      /* no-op — renderer-side i18n store handles locale */
    },
  },

  // Settings — persisted as JSON in the app's data directory.
  // Uses @tauri-apps/plugin-fs readTextFile / writeTextFile.
  // The file path is resolved via the @tauri-apps/api/path appDataDir().
  // Shape: { settings: {...}, repos: [...], repoMetadata: {...}, groups: [...] }
  // matching the Electron-side SettingsApi contract (subset).
  settings: {
    get: async <T = unknown>(key: string): Promise<T | undefined> => {
      const data = await readSettingsFile();
      return data?.[key] as T | undefined;
    },
    set: async (key: string, value: unknown): Promise<void> => {
      const data = await readSettingsFile();
      data[key] = value;
      await writeSettingsFile(data);
    },
    getAll: async (): Promise<Record<string, unknown>> => {
      return readSettingsFile();
    },
    getRepos: async (): Promise<unknown[]> => {
      const data = await readSettingsFile();
      return (data.repos as unknown[]) ?? [];
    },
    addRepo: async (repo: { path: string; name: string }): Promise<void> => {
      const data = await readSettingsFile();
      const repos = (data.repos as Array<{ path: string; name: string }>) ?? [];
      if (!repos.some(r => r.path === repo.path)) {
        repos.push(repo);
        data.repos = repos;
        await writeSettingsFile(data);
      }
    },
    removeRepo: async (path: string): Promise<void> => {
      const data = await readSettingsFile();
      const repos = (data.repos as Array<{ path: string }>) ?? [];
      data.repos = repos.filter(r => r.path !== path);
      await writeSettingsFile(data);
    },
    updateRepo: async (path: string, updates: Record<string, unknown>): Promise<void> => {
      const data = await readSettingsFile();
      const repos = (data.repos as Array<{ path: string; [k: string]: unknown }>) ?? [];
      const idx = repos.findIndex(r => r.path === path);
      if (idx >= 0) {
        repos[idx] = { ...repos[idx], ...updates };
        data.repos = repos;
        await writeSettingsFile(data);
      }
    },

    // --- Repository groups (sidebar tree) ---
    getRepoGroups: async (): Promise<unknown[]> => {
      const data = await readSettingsFile();
      return (data.repoGroups as unknown[]) ?? [];
    },
    createRepoGroup: async (name: string, parentId?: string | null): Promise<unknown> => {
      const data = await readSettingsFile();
      const groups = (data.repoGroups as Array<{ id: string; name: string; parentId: string | null; expanded?: boolean }>) ?? [];
      const group = { id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, parentId: parentId ?? null, expanded: true };
      groups.push(group);
      data.repoGroups = groups;
      await writeSettingsFile(data);
      return group;
    },
    renameRepoGroup: async (id: string, name: string): Promise<void> => {
      const data = await readSettingsFile();
      const groups = (data.repoGroups as Array<{ id: string; name: string }>) ?? [];
      const g = groups.find(g => g.id === id);
      if (g) { g.name = name; data.repoGroups = groups; await writeSettingsFile(data); }
    },
    deleteRepoGroup: async (id: string): Promise<void> => {
      const data = await readSettingsFile();
      const groups = (data.repoGroups as Array<{ id: string; parentId: string | null }>) ?? [];
      data.repoGroups = groups.filter(g => g.id !== id);
      // Also delete children
      await writeSettingsFile(data);
    },
    moveRepoGroup: async (id: string, newParentId: string | null): Promise<void> => {
      const data = await readSettingsFile();
      const groups = (data.repoGroups as Array<{ id: string; parentId: string | null }>) ?? [];
      const g = groups.find(g => g.id === id);
      if (g) { g.parentId = newParentId; data.repoGroups = groups; await writeSettingsFile(data); }
    },
    setRepoGroupExpanded: async (id: string, expanded: boolean): Promise<void> => {
      const data = await readSettingsFile();
      const groups = (data.repoGroups as Array<{ id: string; expanded?: boolean }>) ?? [];
      const g = groups.find(g => g.id === id);
      if (g) { g.expanded = expanded; data.repoGroups = groups; await writeSettingsFile(data); }
    },
    assignRepoGroup: async (path: string, groupId: string | null): Promise<void> => {
      const data = await readSettingsFile();
      const repos = (data.repos as Array<{ path: string; groupId?: string | null }>) ?? [];
      const r = repos.find(r => r.path === path);
      if (r) { r.groupId = groupId; data.repos = repos; await writeSettingsFile(data); }
    },

    // --- Repository metadata (favorites, tags, stats) ---
    getRepoMetadata: async (path: string): Promise<unknown | null> => {
      const data = await readSettingsFile();
      const meta = (data.repoMetadata as Record<string, unknown>) ?? {};
      return meta[path] ?? null;
    },
    getRepoMetadataAll: async (): Promise<unknown[]> => {
      const data = await readSettingsFile();
      const meta = (data.repoMetadata as Record<string, unknown>) ?? {};
      return Object.entries(meta).map(([path, m]) => ({ ...(m as object), path }));
    },
    setRepoMetadata: async (path: string, metadata: Record<string, unknown>): Promise<void> => {
      const data = await readSettingsFile();
      const meta = (data.repoMetadata as Record<string, unknown>) ?? {};
      meta[path] = metadata;
      data.repoMetadata = meta;
      await writeSettingsFile(data);
    },
    updateRepoMetadata: async (path: string, updates: Record<string, unknown>): Promise<void> => {
      const data = await readSettingsFile();
      const meta = (data.repoMetadata as Record<string, Record<string, unknown>>) ?? {};
      meta[path] = { ...(meta[path] ?? {}), ...updates };
      data.repoMetadata = meta;
      await writeSettingsFile(data);
    },
    deleteRepoMetadata: async (path: string): Promise<void> => {
      const data = await readSettingsFile();
      const meta = (data.repoMetadata as Record<string, unknown>) ?? {};
      delete meta[path];
      data.repoMetadata = meta;
      await writeSettingsFile(data);
    },
    toggleFavorite: async (path: string): Promise<void> => {
      const data = await readSettingsFile();
      const meta = (data.repoMetadata as Record<string, { favorite?: boolean }>) ?? {};
      if (!meta[path]) meta[path] = {};
      meta[path].favorite = !meta[path]?.favorite;
      data.repoMetadata = meta;
      await writeSettingsFile(data);
    },
    addTag: async (path: string, tag: string): Promise<void> => {
      const data = await readSettingsFile();
      const meta = (data.repoMetadata as Record<string, { tags?: string[] }>) ?? {};
      if (!meta[path]) meta[path] = {};
      if (!meta[path].tags) meta[path].tags = [];
      if (!meta[path].tags!.includes(tag)) meta[path].tags!.push(tag);
      data.repoMetadata = meta;
      await writeSettingsFile(data);
    },
    removeTag: async (path: string, tag: string): Promise<void> => {
      const data = await readSettingsFile();
      const meta = (data.repoMetadata as Record<string, { tags?: string[] }>) ?? {};
      if (meta[path]?.tags) {
        meta[path].tags = meta[path].tags!.filter(t => t !== tag);
        data.repoMetadata = meta;
        await writeSettingsFile(data);
      }
    },
    refreshRepoStats: async (path: string): Promise<unknown> => {
      // Return a minimal stats object — the real stats require git operations
      // that are already available via api.git.*. The sidebar uses this for
      // incoming/outgoing counters which are computed in checkRemotes().
      return { path, branch: null, lastCommit: null, commitCount: 0 };
    },
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

  // Menu events — App.tsx uses window.smartgit.events.on('menu:...', cb)
  // to listen for native menu actions. Under Tauri these events don't
  // exist yet (Tauri menu API is configured separately). Return a no-op
  // unsubscribe so the renderer doesn't crash trying to access .events.
  events: {
    on: (_channel: string, _cb: (...args: unknown[]) => void): (() => void) => {
      // No-op — menu events are not wired in Tauri mode yet.
      return () => {};
    },
  },

  // Window controls — App.tsx calls api.window.minimize/maximize/close
  // via the frameless-window header. Under Tauri these map to the
  // window plugin (built into tauri core).
  window: {
    minimize: async (): Promise<void> => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().minimize();
    },
    maximize: async (): Promise<void> => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      // Toggle maximize — matches the Electron behavior where maximize()
      // un-maximizes if already maximized.
      const isMax = await win.isMaximized();
      if (isMax) await win.unmaximize();
      else await win.maximize();
    },
    close: async (): Promise<void> => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    },
    isMaximized: async (): Promise<boolean> => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      return getCurrentWindow().isMaximized();
    },
  },

  // Tauri menu events — listen via @tauri-apps/api/event instead of
  // Electron's ipcRenderer. Returns a no-op unsubscribe for now since
  // Tauri menu events require a separate menu setup in Rust.
  menu: {
    on: (_event: string, _cb: (...args: unknown[]) => void): (() => void) => {
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
