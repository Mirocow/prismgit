import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
import type { SimpleGit } from 'simple-git';
import { GIT_UNSAFE_OPTIONS, withMergedGitEnv } from './git-env.js';
import type { StatusResult } from '../types/git-api';

/**
 * GIT STATUS JOB CORE — the working-tree/status computation of
 * `gitService.status()`, extracted so the WATCHER's background refresh can
 * run it in a SEPARATE PROCESS (see gitPollWorker.ts / gitPollProcess.ts).
 *
 * Why a separate process: the watcher fires on every IDE auto-save / build
 * churn (`.git/index`, HEAD, refs, worktree — debounced 500ms/2s, then
 * rate-limited 5s in the renderer). Each refresh used to spawn
 * `status --porcelain -b -z` plus state-detection reads ON THE MAIN event
 * loop — the same loop that brokers every renderer IPC. On big repos the
 * porcelain output (thousands of entries) is pumped and parsed right there,
 * queueing UI interactions ("интерфейс тупит" while builds/auto-saves run).
 * In the background worker process that work cannot contend with the UI.
 *
 * This module is DELIBERATELY free of `electron` and of the shared getGit()
 * queue/caches: the caller either passes its own SimpleGit instance
 * (foreground — keeps read coalescing + command-log instrumentation) or lets
 * the job create a private short-lived one (worker/vitest hosts).
 *
 * Everything the job needs is plain data (repoPath + a pre-resolved gitDir),
 * and everything it returns is plain serializable data — the exact
 * StatusResult contract the renderer already consumes.
 */

/** One status job, fully described by plain data. */
export interface StatusJobRequest {
  /** Absolute repository path. */
  repoPath: string;
  /**
   * Absolute .git directory, resolved by the MAIN-side caller
   * (`resolveGitDir` — session-cached there, so the worker never spends a
   * `rev-parse --absolute-git-dir` subprocess on it).
   */
  gitDir: string;
}

/** Plain-data result — structurally the renderer's StatusResult. */
export type StatusJobResult = StatusResult;

/**
 * Resolve the commit SHA that HEAD points at, PURELY via filesystem reads —
 * no git subprocess. (Moved from git.ts; used by both the foreground status
 * and the background worker job.)
 *
 * A failed/unreadable ref resolves to undefined — the renderer treats a
 * hash→undefined transition as "HEAD moved" (repo just became unborn) which
 * is correct; a steady undefined (fresh repo) triggers nothing.
 */
export function resolveHeadSha(gitDir: string): string | undefined {
  try {
    const headRaw = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (!headRaw) return undefined;
    // Detached HEAD: the file stores the raw commit SHA.
    if (!headRaw.startsWith('ref:')) {
      return /^[0-9a-f]{40,64}$/i.test(headRaw) ? headRaw : undefined;
    }
    // Symbolic ref: resolve refs/heads/<branch> — loose ref first, then packed-refs.
    const refName = headRaw.slice(4).trim();
    const loosePath = path.join(gitDir, ...refName.split('/'));
    if (fs.existsSync(loosePath)) {
      const sha = fs.readFileSync(loosePath, 'utf8').trim();
      if (/^[0-9a-f]{40,64}$/i.test(sha)) return sha;
    }
    const packedPath = path.join(gitDir, 'packed-refs');
    if (fs.existsSync(packedPath)) {
      for (const line of fs.readFileSync(packedPath, 'utf8').split('\n')) {
        if (line.startsWith('#') || line.startsWith('^')) continue;
        const [sha, name] = line.trim().split(' ');
        if (name === refName && /^[0-9a-f]{40,64}$/i.test(sha)) return sha;
      }
    }
  } catch {
    /* unborn or unreadable — fall through to undefined */
  }
  return undefined;
}

/**
 * Repo-state flags from PURE filesystem probes of the .git dir (merge /
 * rebase / cherry-pick / revert / bisect markers). No subprocesses.
 * (The fs-only half of git.ts's detectRepoState — the gitDir resolution
 * stays main-side where its cache lives.)
 */
export function detectRepoStateFromGitDir(gitDir: string): {
  isMerging: boolean;
  isRebasing: boolean;
  isCherryPicking: boolean;
  isReverting: boolean;
  isBisecting: boolean;
} {
  const isMerging = fs.existsSync(path.join(gitDir, 'MERGE_HEAD'));
  const rebaseApplyDir = path.join(gitDir, 'rebase-apply');
  const rebaseMergeDir = path.join(gitDir, 'rebase-merge');
  const isRebasing = fs.existsSync(rebaseApplyDir) || fs.existsSync(rebaseMergeDir);
  const isCherryPicking = fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'));
  const isReverting = fs.existsSync(path.join(gitDir, 'REVERT_HEAD'));
  let isBisecting = false;
  try {
    isBisecting = fs.existsSync(path.join(gitDir, 'BISECT_LOG'));
  } catch {
    /* ignore */
  }
  return { isMerging, isRebasing, isCherryPicking, isReverting, isBisecting };
}

/** Private short-lived instance for worker/non-shared hosts. */
function privateGitInstance(repoPath: string): SimpleGit {
  // maxConcurrentProcesses=4 mirrors the poll job's dedicated instance: the
  // conditional detail reads (cherry-pick/revert log, bisect rev-parse) may
  // run in parallel with the status call itself.
  return withMergedGitEnv(simpleGit({
    baseDir: repoPath,
    binary: 'git',
    maxConcurrentProcesses: 4,
    trimmed: false,
    ...GIT_UNSAFE_OPTIONS,
  }));
}

/**
 * Compute the full StatusResult for one repository. Byte-identical to the
 * pre-extraction gitService.status() body — same commands, same parsing,
 * same state detection, same error semantics (unborn-HEAD fallback) — so
 * foreground and background callers cannot drift apart.
 *
 * @param req    plain-data job description (repoPath + pre-resolved gitDir)
 * @param git    optional caller instance: foreground passes its shared
 *               getGit() instance (read coalescing + command log); the
 *               worker/vitest hosts omit it and get a private instance.
 */
export async function runStatusJob(req: StatusJobRequest, git?: SimpleGit): Promise<StatusJobResult> {
  const { repoPath, gitDir } = req;
  const instance = git ?? privateGitInstance(repoPath);

  // ─── Unborn-HEAD handling ───────────────────────────────────────────
  // PERF (v3): a fresh `git init`'d repo (no commits) used to cost TWO
  // git subprocesses here — a `rev-parse --verify -q HEAD` preflight plus
  // the status call itself — because the code assumed simple-git's
  // `.status()` throws on unborn HEAD. It does NOT (verified against
  // simple-git 3.36: `status --porcelain -b -z` reports
  // `## No commits yet on <branch>` which simple-git parses into
  // current='<branch>', tracking=null). The preflight was therefore
  // a pure waste of one subprocess on the MOST-INVOKED API of the whole app
  // (watcher refresh every 5s, every page switch, every repo open).
  let s: Awaited<ReturnType<SimpleGit['status']>>;
  try {
    // Normal repo with commits — use simple-git's status with
    // --ignore-submodules=all to skip the `.gitmodules` check that git
    // does on EVERY status call (even on repos without .gitmodules).
    s = await instance.status(['--ignore-submodules=all']);
  } catch {
    // Unborn HEAD (or a repo simple-git can't summarise) — fall back to
    // the single raw porcelain call.
    const rawFiles = await instance.raw(['status', '--porcelain', '-z', '--ignore-submodules=all']);
    const files: { path: string; index: string; working_dir: string }[] = [];
    for (const entry of rawFiles.split('\u0000').filter(Boolean)) {
      const index = entry[0] || '?';
      const workingDir = entry[1] || ' ';
      const filePath = entry.slice(3);
      files.push({ path: filePath, index, working_dir: workingDir });
    }
    const notAdded = files.filter(f => f.index === '?').map(f => f.path);
    return {
      not_added: notAdded,
      conflicted: [],
      created: [],
      deleted: [],
      modified: [],
      renamed: [],
      staged: [],
      files: files as StatusJobResult['files'],
      ahead: 0,
      behind: 0,
      current: 'main',
      tracking: null,
      detached: false,
      isMerging: false,
      isRebasing: false,
      isCherryPicking: false,
      isReverting: false,
      isBisecting: false,
      isClean: files.length === 0,
    } as unknown as StatusJobResult;
  }
  const state = detectRepoStateFromGitDir(gitDir);
  // Full HEAD hash (fs-only read — see resolveHeadSha) — the renderer's
  // History graph watches this field to detect `git reset --hard` /
  // commit / rebase / pull: all of those move HEAD WITHOUT changing the
  // branch name or tracking pair, so only the hash proves the graph is stale.
  const headHash = resolveHeadSha(gitDir);
  // Cherry-pick details — which commit is being picked and whether the pick has
  // become EMPTY (its changes are already applied to HEAD, so there is nothing
  // to commit). SmartGit surfaces this as "The working tree is in
  // cherry-picking-state." and only allows Abort / Continue until it resolves.
  let cherryPick: StatusJobResult['cherryPick'];
  if (state.isCherryPicking) {
    // Untracked ('?') entries don't block an empty pick — only tracked changes
    // (staged or unstaged) and unresolved conflicts do.
    const hasRealChanges = s.files.some((f) => f.index !== '?' && f.working_dir !== '?');
    const empty = s.conflicted.length === 0 && !hasRealChanges;
    let commit = '';
    let subject = '';
    try {
      const out = await instance.raw(['log', '-1', '--format=%H%x1f%s', 'CHERRY_PICK_HEAD']);
      const [h, sub] = out.trim().split('\x1f');
      commit = h || '';
      subject = sub || '';
    } catch {
      /* CHERRY_PICK_HEAD may point to a pruned object mid-cleanup */
    }
    cherryPick = { commit, subject, empty };
  }
  // Revert state details — which commit is being undone (REVERT_HEAD).
  let revert: StatusJobResult['revert'];
  if (state.isReverting) {
    let commit = '';
    let subject = '';
    try {
      const out = await instance.raw(['log', '-1', '--format=%H%x1f%s', 'REVERT_HEAD']);
      const [h, sub] = out.trim().split('\x1f');
      commit = h || '';
      subject = sub || '';
    } catch {
      /* REVERT_HEAD may point to a pruned object mid-cleanup */
    }
    revert = { commit, subject };
  }
  // Merge state details — the subject of the merge (MERGE_MSG first line).
  let merge: StatusJobResult['merge'];
  if (state.isMerging) {
    let message = '';
    try {
      const msgPath = path.join(gitDir, 'MERGE_MSG');
      if (fs.existsSync(msgPath)) {
        message = (fs.readFileSync(msgPath, 'utf8').split('\n')[0] || '').trim();
      }
    } catch {
      /* ignore unreadable MERGE_MSG */
    }
    merge = { message };
  }
  // Rebase state details — progress ("step/total") from the sequencer dirs.
  let rebase: StatusJobResult['rebase'];
  if (state.isRebasing) {
    let step: number | undefined;
    let total: number | undefined;
    try {
      const readNum = async (file: string): Promise<number | undefined> => {
        for (const dir of ['rebase-merge', 'rebase-apply']) {
          const p = path.join(gitDir, dir, file);
          if (fs.existsSync(p)) {
            const n = parseInt((await fs.promises.readFile(p, 'utf8')).trim(), 10);
            if (!Number.isNaN(n)) return n;
          }
        }
        return undefined;
      };
      step = await readNum('msgnum');
      total = await readNum('end');
    } catch {
      /* best-effort progress info */
    }
    rebase = { step, total };
  }
  // Bisect state details — HEAD is detached at the current candidate.
  let bisect: StatusJobResult['bisect'];
  if (state.isBisecting) {
    let rev = '';
    try {
      rev = (await instance.raw(['rev-parse', 'HEAD'])).trim();
    } catch {
      /* ignore */
    }
    bisect = { rev };
  }
  return {
    not_added: s.not_added,
    conflicted: s.conflicted,
    created: s.created,
    deleted: s.deleted,
    modified: s.modified,
    renamed: s.renamed.map((r) => ({ from: r.from, to: r.to })),
    staged: s.files
      .filter((f) => f.index !== ' ' && f.index !== '?' && f.index !== '!')
      .map((f) => ({ path: f.path, index: f.index, working_dir: f.working_dir })),
    ahead: s.ahead,
    behind: s.behind,
    current: s.current || undefined,
    tracking: s.tracking || undefined,
    head: headHash,
    files: s.files.map((f) => ({
      path: f.path,
      index: f.index as StatusResult['files'][number]['index'],
      working_dir: f.working_dir as StatusResult['files'][number]['working_dir'],
      old_path: (f as { from?: string }).from,
    })),
    isClean: s.isClean(),
    isMerging: state.isMerging,
    isRebasing: state.isRebasing,
    isCherryPicking: state.isCherryPicking,
    isReverting: state.isReverting,
    isBisecting: state.isBisecting,
    cherryPick,
    revert,
    merge,
    rebase,
    bisect,
    // simple-git's own `detached` (parsed from the `## HEAD (no branch)`
    // branch header) is the primary source; the legacy formula missed it —
    // on a detached HEAD the parser answers current="HEAD" (truthy!), so
    // `!s.current` was always false and every detached repo reported
    // detached=false. The formula stays as a fallback for parser variants
    // that leave current unset.
    detached: s.detached || (!s.current && s.files.length === 0 && !s.tracking),
  };
}
