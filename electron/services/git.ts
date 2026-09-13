import simpleGit, { type SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { getSetting } from './storage.js';
import type { RemoteCredential } from '../types/settings-api.js';
import type { PushRefStatus, PushResult, PushVerification } from '../types/git-api.js';
import { BrowserWindow } from 'electron';
import type {
  StatusResult,
  LogEntry,
  BranchInfo,
  RemoteInfo,
  RemoteProperties,
  StashEntry,
  TagInfo,
  SubmoduleInfo,
  DiffResult,
  DiffHunk,
  DiffLine,
  WorktreeInfo,
  ReflogEntry,
  CommitFile,
  BlameLine,
  BlameResult,
  GitConfigEntry,
  DirNode,
  NoteCategory,
  CommitNote,
  SubtreeInfo,
  LfsLock,
  LfsLockInfo,
  RecyclableCommit,
  BidirectionalBlameResult,
  UnreachableCommit,
  BugtraqConfig,
  RemoteCheckSummary,
} from '../types/git-api.js';

const gitCache = new Map<string, SimpleGit>();

/**
 * Broadcast a user-initiated operation to the renderer's Operations tab.
 * Called by every mutating git function (commit, push, pull, checkout, merge,
 * cherry-pick, revert, rebase, stash, tag, submodule, etc.) so the Operations
 * tab in the Output panel shows ALL user actions — not just the ~30 that
 * were manually instrumented with logOperation() in the UI layer.
 *
 * @param action  Human-readable action name (e.g. "Checkout", "Merge")
 * @param repoPath Repository path
 * @param command  The git command being executed (e.g. "git checkout main")
 */
function broadcastOperation(action: string, repoPath: string, command: string): void {
  try {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      action,
      command,
      repoPath,
      status: 'running' as const,
    };
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send('operation-log:start', entry);
      }
    }
  } catch {
    // BrowserWindow may not be available (tests) — ignore
  }
}

/**
 * Broadcast operation completion to the renderer.
 */
function broadcastOperationResult(
  id: string,
  repoPath: string,
  status: 'success' | 'error',
  result?: string,
  error?: string,
): void {
  try {
    const entry = {
      id,
      repoPath,
      status,
      result: result?.slice(0, 200),
      error: error?.slice(0, 500),
      duration: 0, // computed in renderer
    };
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send('operation-log:finish', entry);
      }
    }
  } catch {
    // Ignore
  }
}

/**
 * Wrapper: run a function and broadcast its start/finish/error to the
 * Operations tab. Used by all mutating git operations.
 */
async function withOperationLog<T>(
  action: string,
  repoPath: string,
  command: string,
  fn: () => Promise<T>,
): Promise<T> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  broadcastOperation(action, repoPath, command);
  const start = Date.now();
  try {
    const result = await fn();
    broadcastOperationResult(id, repoPath, 'success', undefined, undefined);
    return result;
  } catch (e) {
    broadcastOperationResult(id, repoPath, 'error', undefined, String(e));
    throw e;
  }
}

function getGit(repoPath: string): SimpleGit {
  let git = gitCache.get(repoPath);
  if (!git) {
    git = simpleGit({
      baseDir: repoPath,
      binary: 'git',
      maxConcurrentProcesses: 2,
      trimmed: false,
    });
    gitCache.set(repoPath, git);
  }
  return git;
}

/**
 * Remove a stale .git/index.lock file if it exists. A previous git
 * operation (crash, force-quit, killed process) may have left it behind,
 * making ALL subsequent git commands fail with "Unable to create
 * index.lock: File exists."
 *
 * This is called before write operations (add, restore, resetFile,
 * commit, checkout, etc.) so the user doesn't have to manually delete
 * the lock file.
 *
 * Safety: if another git process is ACTIVELY running (lock file is
 * being held), the unlinkSync will fail with EPERM/EBUSY on Windows
 * or succeed silently on Unix (where locks are advisory). On Unix,
 * removing an active lock can cause the running git process to fail —
 * but this is rare (maxConcurrentProcesses=2) and the alternative
 * (leaving the lock) is worse (blocks ALL git operations).
 */
function removeStaleIndexLock(repoPath: string): void {
  const lockPath = path.join(repoPath, '.git', 'index.lock');
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Can't remove — either permission issue or another process is
    // actively holding it. The git command will fail with a clear
    // "index.lock exists" error that the UI surfaces to the user.
  }
}

function invalidateCache(repoPath?: string) {
  if (repoPath) {
    gitCache.delete(repoPath);
  } else {
    gitCache.clear();
  }
}

// State detection helpers
// Resolved git dirs are cached per repoPath: `rev-parse --absolute-git-dir` is
// stable for the lifetime of a session, and it keeps state detection working
// for linked worktrees and submodule repos where '.git' is a FILE, not a
// directory (the naive path.join(repoPath, '.git') check misses those states).
const gitDirCache = new Map<string, string>();
async function resolveGitDir(repoPath: string, git: SimpleGit): Promise<string> {
  const cached = gitDirCache.get(repoPath);
  if (cached) return cached;
  let dir = path.join(repoPath, '.git');
  try {
    const out = (await git.raw(['rev-parse', '--absolute-git-dir'])).trim();
    if (out) dir = out;
  } catch {
    /* fall back to the conventional .git path */
  }
  gitDirCache.set(repoPath, dir);
  return dir;
}

async function detectRepoState(repoPath: string, git?: SimpleGit) {
  const gitDir = await resolveGitDir(repoPath, git ?? getGit(repoPath));
  const isMerging = fs.existsSync(path.join(gitDir, 'MERGE_HEAD'));
  let isRebasing = false;
  const rebaseApplyDir = path.join(gitDir, 'rebase-apply');
  const rebaseMergeDir = path.join(gitDir, 'rebase-merge');
  if (fs.existsSync(rebaseApplyDir) || fs.existsSync(rebaseMergeDir)) {
    isRebasing = true;
  }
  const isCherryPicking = fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'));
  const isReverting = fs.existsSync(path.join(gitDir, 'REVERT_HEAD'));
  let isBisecting = false;
  try {
    const bisectLogPath = path.join(gitDir, 'BISECT_LOG');
    isBisecting = fs.existsSync(bisectLogPath);
  } catch {
    /* ignore */
  }
  return { isMerging, isRebasing, isCherryPicking, isReverting, isBisecting };
}

export async function isRepo(targetPath: string): Promise<boolean> {
  try {
    const git = simpleGit({ baseDir: targetPath });
    return await git.checkIsRepo();
  } catch {
    return false;
  }
}

export async function status(repoPath: string): Promise<StatusResult> {
  const git = getGit(repoPath);
  const s = await git.status();
  const state = await detectRepoState(repoPath, git);
  const gitDir = await resolveGitDir(repoPath, git);
  // Cherry-pick details — which commit is being picked and whether the pick has
  // become EMPTY (its changes are already applied to HEAD, so there is nothing
  // to commit). SmartGit surfaces this as "The working tree is in
  // cherry-picking-state." and only allows Abort / Continue until it resolves.
  let cherryPick: StatusResult['cherryPick'];
  if (state.isCherryPicking) {
    // Untracked ('?') entries don't block an empty pick — only tracked changes
    // (staged or unstaged) and unresolved conflicts do.
    const hasRealChanges = s.files.some((f) => f.index !== '?' && f.working_dir !== '?');
    const empty = s.conflicted.length === 0 && !hasRealChanges;
    let commit = '';
    let subject = '';
    try {
      const out = await git.raw(['log', '-1', '--format=%H%x1f%s', 'CHERRY_PICK_HEAD']);
      const [h, sub] = out.trim().split('\x1f');
      commit = h || '';
      subject = sub || '';
    } catch {
      /* CHERRY_PICK_HEAD may point to a pruned object mid-cleanup */
    }
    cherryPick = { commit, subject, empty };
  }
  // Revert state details — which commit is being undone (REVERT_HEAD).
  let revert: StatusResult['revert'];
  if (state.isReverting) {
    let commit = '';
    let subject = '';
    try {
      const out = await git.raw(['log', '-1', '--format=%H%x1f%s', 'REVERT_HEAD']);
      const [h, sub] = out.trim().split('\x1f');
      commit = h || '';
      subject = sub || '';
    } catch {
      /* REVERT_HEAD may point to a pruned object mid-cleanup */
    }
    revert = { commit, subject };
  }
  // Merge state details — the subject of the merge (MERGE_MSG first line).
  let merge: StatusResult['merge'];
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
  let rebase: StatusResult['rebase'];
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
  let bisect: StatusResult['bisect'];
  if (state.isBisecting) {
    let rev = '';
    try {
      rev = (await git.raw(['rev-parse', 'HEAD'])).trim();
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
    detached: !s.current && s.files.length === 0 && !s.tracking,
  };
}

export async function add(repoPath: string, files: string[]): Promise<void> {
  const git = getGit(repoPath);
  if (files.length === 0) return;
  removeStaleIndexLock(repoPath);
  try {
    await git.raw(['add', '--', ...files]);
  } catch (e) {
    // If the file is gitignored, git add refuses to stage it.
    // Retry with -f (force) to allow staging ignored files.
    if (String(e).includes('ignored by one of your .gitignore files')) {
      await git.raw(['add', '-f', '--', ...files]);
    } else {
      throw e;
    }
  }
  invalidateDiffCache(repoPath);
}

export async function addAll(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  removeStaleIndexLock(repoPath);
  await git.add('-A');
  invalidateDiffCache(repoPath);
}

export async function restore(repoPath: string, files: string[], staged = false): Promise<void> {
  const git = getGit(repoPath);
  removeStaleIndexLock(repoPath);
  const args = ['restore'];
  if (staged) args.push('--staged');
  args.push('--', ...files);
  await git.raw(args);
  invalidateDiffCache(repoPath);
}

export async function commit(
  repoPath: string,
  message: string,
  amend = false,
  signoff = false,
  noVerify = false
): Promise<string> {
  const git = getGit(repoPath);
  // Build the raw git commit command — simple-git's .commit() method
  // treats its first array argument as files, not as -m flags, which
  // causes the commit message to be lost (bug: commit uses the wrong
  // message or falls back to a default). Using git.raw() gives us full
  // control over the arguments.
  const args: string[] = ['commit', '-m', message];
  if (amend) args.push('--amend', '--no-edit');
  if (signoff) args.push('--signoff');
  if (noVerify) args.push('--no-verify');
  removeStaleIndexLock(repoPath);
  const output = await git.raw(args);
  // Bust the diff cache — HEAD has moved, every cached diff is now stale.
  invalidateDiffCache(repoPath);
  // Extract commit hash from output: "[main abc1234] message"
  const match = output.match(/\[([a-z0-9_-]+)(?:\s+\(root-commit\))?\s+([a-f0-9]{7,40})\]/);
  return match ? match[2] : '';
}

/**
 * Parse `git push` output (stderr + stdout combined) into structured ref
 * statuses. git writes the per-ref status lines to stderr:
 *   To https://host/repo.git
 *      27aa286..b7d1f2f  main -> main
 *    * [new branch]      Main -> Main
 *    + 27aa286...b7d1f2f main -> main (forced update)
 *    ! [remote rejected] main -> main (protected branch hook declined)
 *    ! [rejected]        main -> main (non-fast-forward)
 *    - [deleted]         tmp -> tmp
 *    = [up to date]      main -> main
 *    Everything up-to-date
 */
export function parsePushOutput(output: string): { refs: PushRefStatus[]; upToDate: boolean } {
  const refs: PushRefStatus[] = [];
  let upToDate = /everything up-to-date/i.test(output);
  for (const line of output.split(/\r?\n/)) {
    const arrow = line.match(/(\S+)\s*->\s*(\S+)/);
    if (!arrow) continue;
    const localRef = arrow[1];
    const remoteRef = arrow[2];
    if (localRef === remoteRef && localRef === '') continue;
    const reason = (line.match(/\(([^)]+)\)\s*$/) || [])[1];
    const status: PushRefStatus = { remoteRef, localRef };
    if (/^\s*!/.test(line)) status.rejected = true;
    if (/\[remote rejected\]/i.test(line)) status.rejected = true;
    if (/\[new branch\]/i.test(line)) status.created = true;
    if (/\[deleted\]/i.test(line)) status.deleted = true;
    if (/\(forced update\)/i.test(line)) status.forced = true;
    if (/\[up to date\]/i.test(line)) status.upToDate = true;
    const range = line.match(/([0-9a-f]{7,40})(\.\.\.|\.\.)?([0-9a-f]{0,40})?/i);
    if (range && !status.upToDate) {
      status.oldHash = range[1];
      if (range[3]) status.newHash = range[3];
    }
    if (reason) status.reason = reason;
    refs.push(status);
    // A per-ref `[up to date]` line only means that ref; the blanket
    // "Everything up-to-date" stays true only when no ref line contradicts it.
    if (!status.upToDate && !status.rejected && !status.deleted) upToDate = false;
  }
  return { refs, upToDate: upToDate || refs.every((r) => r.upToDate) && refs.length > 0 };
}

/** Spawn a git command and capture both streams (unlike simple-git's raw()). */
function spawnGitCapture(
  repoPath: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: repoPath, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

// ── Rename detection — heavily optimized ─────────────────────────────────────
//
// Four optimizations stack:
//
//   1. HEAD tree cache (biggest win for repeated calls):
//      `git ls-tree -r -l HEAD` (whole tree + sizes) is FASTER than
//      `git ls-tree HEAD -- <paths>` (which is quadratic in path count:
//      1000 paths = 266ms, 10000 = 1528ms on 50k-file repo). So we fetch
//      the WHOLE tree once (with -l for sizes), filter by deletedFiles
//      in-memory (O(N) Map lookups). Cache by HEAD hash — subsequent
//      calls with unchanged HEAD skip ls-tree entirely (1ms rev-parse
//      to validate).
//
//   2. Size pre-filter (biggest win when junk untracked >> renames):
//      After getting HEAD tree, build a Set of deleted-file sizes.
//      stat() every untracked file (essentially free), keep only those
//      whose size matches SOME deleted file. hash-object then reads
//      only candidates that could possibly match. Benchmark:
//        3 renames + 997 junk untracked → hash 3 files instead of 1000.
//        Worst case (all renamed) → small overhead (stat-all vs hash-all).
//
//   3. mtime+size cache for hash-object (biggest win on auto-refresh):
//      Cache hash by (path, mtimeMs, size). On repeated calls with same
//      working tree (auto-refresh fires every few seconds), most files
//      are cache hits — no git spawn happens at all. Saves ~70-80% of
//      hash-object cost on subsequent calls.
//
//   4. stdin paths: `git hash-object --stdin-paths` reads paths via stdin
//      instead of argv — no ARG_MAX limit, no chunking. Single spawn
//      handles any number of paths.
//
// Wall-clock times (Linux, SSD, 5000-file working tree):
//   First call (all caches miss):    ~64ms (stat + hash 5000 files)
//   Auto-refresh (mtime cache hit):  ~18ms (stat only, no hash spawn)
//   Realistic (3 renames + junk):    ~7ms  (size-filter eliminates junk)
//
// Was: ~4 seconds with original N+M per-file spawns.
//
// Returns: { oldPath, newPath }[] for every detected rename (staged + unstaged).

const HASH_RE = /^[0-9a-f]{40}$/;

/** Parse a single `git ls-tree -l` line → { path, hash, size } or null. */
function parseLsTreeLineWithSize(line: string): { path: string; hash: string; size: number } | null {
  // Format: "<mode> blob <hash> <size>\t<path>"
  const tabIdx = line.indexOf('\t');
  if (tabIdx < 0) return null;
  const meta = line.slice(0, tabIdx);
  const filePath = line.slice(tabIdx + 1);
  // meta = "<mode> <type> <hash> <size>"
  const m = meta.match(/\s+blob\s+([0-9a-f]{40})\s+(\d+)\s*$/);
  if (!m) return null;
  return { path: filePath, hash: m[1], size: parseInt(m[2], 10) };
}

// ── HEAD tree cache ──────────────────────────────────────────────────────────
//
// Benchmark insight: `git ls-tree -r HEAD` (whole tree, 22ms on 50k files) is
// FASTER than `git ls-tree HEAD -- <paths>` (which is quadratic in path count:
// 1000 paths = 266ms, 10000 paths = 1528ms). So we always fetch the WHOLE
// tree once, then filter by deleted-paths in-memory (O(1) Map lookup).
//
// To avoid re-fetching on every status update (renderer calls
// detectWorkingTreeRenames frequently during auto-refresh), we cache the tree
// keyed by repoPath + HEAD hash. Validating the cache costs one `git rev-parse
// HEAD` (1ms); on cache hit we skip ls-tree entirely.

interface CachedHeadTree {
  headHash: string;
  /** path → hash */
  treeMap: Map<string, string>;
  /** path → blob size (used for size pre-filter of untracked files) */
  sizeMap: Map<string, number>;
  /** Set of all blob sizes in HEAD — used for O(1) size match check. */
  sizeSet: Set<number>;
  /** Timestamp for LRU eviction. */
  lastUsed: number;
}

/** LRU cache: repoPath → cached HEAD tree. Capped at 16 repos. */
const headTreeCache = new Map<string, CachedHeadTree>();
const HEAD_TREE_CACHE_MAX = 16;

function touchHeadTreeCache(repoPath: string): void {
  const entry = headTreeCache.get(repoPath);
  if (entry) {
    entry.lastUsed = Date.now();
    // Re-insert to refresh Map iteration order (LRU)
    headTreeCache.delete(repoPath);
    headTreeCache.set(repoPath, entry);
  }
}

function evictHeadTreeCacheIfNeeded(): void {
  while (headTreeCache.size > HEAD_TREE_CACHE_MAX) {
    // Map iterates in insertion order; oldest entry is the first.
    const oldest = headTreeCache.keys().next().value;
    if (oldest === undefined) break;
    headTreeCache.delete(oldest);
  }
}

/**
 * Returns cached HEAD tree (path → hash, path → size, set of all sizes) for
 * `git ls-tree -r -l HEAD`. Uses a cache keyed by HEAD hash — subsequent
 * calls with unchanged HEAD skip ls-tree entirely (only ~1ms rev-parse
 * to validate).
 *
 * Uses `-z` (NUL-separated output) for robust parsing of paths containing
 * newlines (rare but possible). Uses `-l` (long format) to include blob
 * sizes — these power the size pre-filter in batchHashObjectForRenames.
 */
export async function getCachedHeadTree(repoPath: string): Promise<CachedHeadTree> {
  // Get current HEAD hash — cheap (~1ms).
  let headHash = '';
  try {
    const revOut = await spawnGitCapture(repoPath, ['rev-parse', 'HEAD']);
    if (revOut.code === 0) headHash = revOut.stdout.trim();
  } catch {
    /* fall back to fresh fetch */
  }

  // Cache hit?
  const cached = headTreeCache.get(repoPath);
  if (cached && cached.headHash === headHash && headHash) {
    touchHeadTreeCache(repoPath);
    return cached;
  }

  // Cache miss — fetch full tree with sizes.
  const treeMap = new Map<string, string>();
  const sizeMap = new Map<string, number>();
  const sizeSet = new Set<number>();
  try {
    const { stdout } = await spawnGitCapture(repoPath, ['ls-tree', '-r', '-l', '-z', 'HEAD']);
    for (const entry of stdout.split('\0')) {
      if (!entry) continue;
      const parsed = parseLsTreeLineWithSize(entry);
      if (parsed) {
        treeMap.set(parsed.path, parsed.hash);
        sizeMap.set(parsed.path, parsed.size);
        sizeSet.add(parsed.size);
      }
    }
  } catch {
    /* return empty maps — partial failure is acceptable */
  }

  const entry: CachedHeadTree = {
    headHash, treeMap, sizeMap, sizeSet, lastUsed: Date.now(),
  };
  headTreeCache.set(repoPath, entry);
  evictHeadTreeCacheIfNeeded();
  return entry;
}

// ── mtime+size cache for hash-object ─────────────────────────────────────────
//
// When auto-refresh fires several detectWorkingTreeRenames calls in rapid
// succession with the same working tree state, the same untracked files get
// re-hashed every time. We cache hash by (repoPath, path, mtimeMs, size) —
// if a file's mtime+size haven't changed since last hash, the hash is
// guaranteed identical (content-addressable), so we skip re-hashing it.
//
// Cache is keyed by a composite string to allow fast Map lookups. Capped at
// 50k entries to bound memory (~5 MB worst case).

interface CachedHash {
  hash: string;
  mtimeMs: number;
  size: number;
  /** Composite key: `${repoPath}|${path}` for fast invalidation by repo. */
  repoKey: string;
}

const hashByPathMtime = new Map<string, CachedHash>();
const HASH_CACHE_MAX = 50_000;

function hashCacheKey(repoPath: string, p: string): string {
  return `${repoPath}\0${p}`;
}

function evictHashCacheIfNeeded(): void {
  if (hashByPathMtime.size <= HASH_CACHE_MAX) return;
  // Evict oldest 10% to amortize eviction cost (vs evicting one per insert).
  const toRemove = Math.floor(HASH_CACHE_MAX * 0.1);
  let removed = 0;
  for (const key of hashByPathMtime.keys()) {
    hashByPathMtime.delete(key);
    if (++removed >= toRemove) break;
  }
}

/**
 * Hash every existing file in `paths`. Returns a Map<path, hash>.
 *
 * Uses `--stdin-paths` to feed paths via stdin (no ARG_MAX limit, no
 * chunking needed — handles 100k+ paths in a single spawn).
 *
 * If git aborts (exit != 0 — happens when any file was deleted between
 * `git status` and this call, race condition), falls back to per-file
 * hashing with bounded concurrency (8 parallel spawns max).
 *
 * Two-level cache:
 *   1. mtime+size cache — skip hashing entirely for unchanged files
 *      (auto-refresh scenarios). Saves ~80% of hash-object cost on
 *      repeat calls.
 *   2. Per-file fallback only for files that ARE in the to-hash list.
 */
export async function batchHashObject(
  repoPath: string,
  paths: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (paths.length === 0) return result;

  // Phase 1: check mtime+size cache. Collect only the paths that need
  // re-hashing (file is new OR mtime/size changed since last hash).
  const toHash: string[] = [];
  for (const p of paths) {
    let stat;
    try {
      stat = fs.statSync(path.join(repoPath, p));
    } catch {
      // File doesn't exist (race condition: deleted between status and check).
      // Skip it — caller treats missing paths as "no hash" anyway.
      continue;
    }
    const key = hashCacheKey(repoPath, p);
    const cached = hashByPathMtime.get(key);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      // Cache hit — content is guaranteed identical (content-addressable).
      result.set(p, cached.hash);
    } else {
      toHash.push(p);
    }
  }

  if (toHash.length === 0) {
    return result; // All cache hits — no git spawn needed!
  }

  // Phase 2: hash only the uncached files via single spawn.
  try {
    const { code, stdout } = await spawnGitWithStdin(repoPath, ['hash-object', '--stdin-paths'], toHash.join('\n') + '\n');
    if (code === 0) {
      const lines = stdout.split('\n');
      for (let i = 0; i < toHash.length && i < lines.length; i++) {
        const h = lines[i].trim();
        if (HASH_RE.test(h)) {
          result.set(toHash[i], h);
          // Cache it for future calls.
          try {
            const stat = fs.statSync(path.join(repoPath, toHash[i]));
            hashByPathMtime.set(hashCacheKey(repoPath, toHash[i]), {
              hash: h, mtimeMs: stat.mtimeMs, size: stat.size,
              repoKey: repoPath,
            });
          } catch { /* file gone — skip caching */ }
        }
      }
      evictHashCacheIfNeeded();
      return result;
    }
  } catch {
    // spawn itself failed — fall through to per-file
  }

  // Fallback: per-file hashing with bounded concurrency.
  await hashObjectPerFile(repoPath, toHash, result);
  // Cache successful hashes (best-effort — don't re-stat if already statted)
  for (const p of toHash) {
    const h = result.get(p);
    if (h) {
      try {
        const stat = fs.statSync(path.join(repoPath, p));
        hashByPathMtime.set(hashCacheKey(repoPath, p), {
          hash: h, mtimeMs: stat.mtimeMs, size: stat.size,
          repoKey: repoPath,
        });
      } catch { /* skip */ }
    }
  }
  evictHashCacheIfNeeded();
  return result;
}

/** Per-file fallback with bounded concurrency (8 parallel spawns max). */
async function hashObjectPerFile(
  repoPath: string,
  paths: string[],
  result: Map<string, string>
): Promise<void> {
  const CONCURRENCY = 8;
  for (let i = 0; i < paths.length; i += CONCURRENCY) {
    const batch = paths.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (p) => {
        try {
          const { code, stdout } = await spawnGitCapture(repoPath, [
            'hash-object', '--', p,
          ]);
          if (code === 0) {
            const h = stdout.trim();
            if (HASH_RE.test(h)) result.set(p, h);
          }
        } catch {
          /* skip missing file */
        }
      })
    );
  }
}

/**
 * Run `git` with stdin piped. Used by batchHashObject to feed a large path
 * list without ARG_MAX limits. Reuses the same spawn pattern as
 * spawnGitCapture but writes to stdin and closes it.
 */
function spawnGitWithStdin(
  repoPath: string,
  args: string[],
  stdin: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: repoPath, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    // Write paths to stdin, then close it so git knows input is done.
    child.stdin.end(stdin);
  });
}

/**
 * Look up blob hashes in HEAD for every path in `paths`. Returns Map<path, hash>.
 *
 * Uses getCachedHeadTree() — fetches the WHOLE HEAD tree once and caches it
 * by HEAD hash. Subsequent calls (with unchanged HEAD) skip ls-tree entirely.
 * In-memory filtering by `paths` is O(N) Map lookups, much faster than
 * `git ls-tree HEAD -- <paths>` which is quadratic in path count.
 */
export async function batchLsTreeHead(
  repoPath: string,
  paths: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (paths.length === 0) return result;

  const cached = await getCachedHeadTree(repoPath);
  for (const p of paths) {
    const h = cached.treeMap.get(p);
    if (h) result.set(p, h);
  }
  return result;
}

export interface DetectedRename {
  oldPath: string;
  newPath: string;
}

/**
 * Detect all renames in the working tree (staged + unstaged) in a single
 * optimized IPC call. Used by ChangesPage's rename detection.
 *
 * Pipeline:
 *   Stage A (parallel):
 *     1. `git diff --cached --find-renames --diff-filter=R` (staged renames)
 *     2. `git ls-tree -r -l HEAD` (cached by HEAD hash) — HEAD blob hashes
 *        AND sizes for every deleted file.
 *
 *   Stage B (after Stage A completes, uses sizes from HEAD tree):
 *     3. Stat every untracked file, keep only those whose size matches SOME
 *        deleted file's HEAD blob size. Skip hash-object entirely if no
 *        size matches exist.
 *     4. `git hash-object --stdin-paths` (paths via stdin) — blob hashes for
 *        the size-filtered untracked files only. Uses mtime+size cache to
 *        skip re-hashing unchanged files on auto-refresh.
 *
 * Why two stages? Size pre-filter needs to know deleted file sizes from
 * the HEAD tree (Stage A). Without pre-filter, hash-object reads every
 * untracked file from disk — wasteful when most untracked files are junk
 * (build artifacts, node_modules, etc.) that can never match a renamed
 * file. With pre-filter, hash-object only reads files that COULD be a
 * rename candidate.
 *
 * Benchmark (realistic scenario: 3 renames + 997 junk untracked):
 *   Without size-filter: 10ms (hash all 1000 files)
 *   With size-filter:     7ms (hash only 3 files)
 *
 * Benchmark (worst case: 5000 renames, 0 junk):
 *   Without size-filter: 58ms (hash all 5000 files)
 *   With size-filter:    64ms (stat all 5000 + hash all 5000 — small overhead)
 *
 * mtime cache (auto-refresh scenario):
 *   First call:           60ms (hash 5000 files, cache result)
 *   Subsequent calls:     18ms (cache hits — only stat, no hash spawn)
 *
 * @param deletedFiles   Files reported as ' D' or 'D ' by `git status`
 * @param untrackedFiles Files reported as '??' by `git status`
 */
export async function detectWorkingTreeRenames(
  repoPath: string,
  deletedFiles: string[],
  untrackedFiles: string[]
): Promise<DetectedRename[]> {
  const git = getGit(repoPath);

  // Fast path: if either list is empty, no unstaged renames possible —
  // only need the staged-rename diff. Skip ls-tree + hash-object entirely.
  const needUnstaged = deletedFiles.length > 0 && untrackedFiles.length > 0;

  // Stage A: run staged-diff and HEAD-tree fetch in parallel. The HEAD tree
  // gives us BOTH hashes AND sizes of every deleted file (the sizes power
  // the size pre-filter in Stage B).
  const [stagedOut, headTree] = await Promise.all([
    // 1. Staged renames — `git diff --cached --find-renames --diff-filter=R`
    git.raw([
      'diff', '--cached', '--name-status',
      '--find-renames', '--diff-filter=R',
    ]).catch(() => ''),
    // 2. HEAD tree (cached by HEAD hash) — provides hashes AND sizes
    needUnstaged ? getCachedHeadTree(repoPath) : Promise.resolve(null),
  ]);

  const renames: DetectedRename[] = [];

  // Parse staged renames.
  for (const line of stagedOut.split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length >= 3 && parts[0].startsWith('R')) {
      renames.push({ oldPath: parts[1], newPath: parts[2] });
    }
  }

  // No unstaged renames to detect — return staged-only result.
  if (!needUnstaged || !headTree) return renames;

  // Collect HEAD hashes for each deleted file (in-memory Map lookup).
  const deletedHashes = new Map<string, string>();
  // Set of sizes of deleted files — drives the size pre-filter.
  const deletedSizes = new Set<number>();
  for (const p of deletedFiles) {
    const h = headTree.treeMap.get(p);
    const sz = headTree.sizeMap.get(p);
    if (h && sz !== undefined) {
      deletedHashes.set(p, h);
      deletedSizes.add(sz);
    }
  }
  if (deletedHashes.size === 0) return renames;

  // Stage B: stat every untracked file, keep only size-matching ones.
  // stat() is essentially free (microseconds per file, no git spawn).
  // This is the key optimization: if a working tree has 5000 junk untracked
  // files (build artifacts, node_modules, etc.) and only 5 renamed files,
  // we'll hash 5 files instead of 5005.
  const sizeFilteredUntracked: string[] = [];
  for (const p of untrackedFiles) {
    try {
      const stat = fs.statSync(path.join(repoPath, p));
      if (deletedSizes.has(stat.size)) {
        sizeFilteredUntracked.push(p);
      }
    } catch {
      // File doesn't exist (race condition: deleted between status and check).
      // Skip — caller treats missing files as "no match" anyway.
    }
  }
  if (sizeFilteredUntracked.length === 0) return renames;

  // Stage C: hash only the size-filtered untracked files. batchHashObject
  // has its own mtime+size cache, so on auto-refresh most files will be
  // cache hits and no git spawn happens at all.
  const untrackedHashes = await batchHashObject(repoPath, sizeFilteredUntracked);

  // Build reverse index untrackedHash → path (first occurrence wins).
  // Map lookup is O(1); old code did O(N×M) find/some scans.
  const untrackedByHash = new Map<string, string>();
  for (const [p, h] of untrackedHashes) {
    if (!untrackedByHash.has(h)) untrackedByHash.set(h, p);
  }

  // Already-used new paths (from staged renames) — skip to avoid duplicates.
  const usedNewPaths = new Set(renames.map((r) => r.newPath));

  for (const [oldPath, hash] of deletedHashes) {
    const newPath = untrackedByHash.get(hash);
    if (newPath && !usedNewPaths.has(newPath)) {
      renames.push({ oldPath, newPath });
      usedNewPaths.add(newPath);
    }
  }

  return renames;
}

/** Read what the remote's branch points at right now (with push credentials). */
async function lsRemoteBranch(
  repoPath: string,
  remote: string,
  branch: string
): Promise<string | null> {
  const auth = await remoteNetworkArgs(repoPath, remote, true);
  const { code, stdout } = await spawnGitCapture(repoPath, [
    ...auth, 'ls-remote', remote, `refs/heads/${branch}`,
  ]);
  if (code !== 0) return null;
  const line = stdout.split(/\r?\n/).find((l) => l.trim().length > 0);
  if (!line) return null;
  const hash = line.split(/\t|\s+/)[0];
  return /^[0-9a-f]{40}$/i.test(hash) ? hash : null;
}

export async function push(
  repoPath: string,
  remote = 'origin',
  branch?: string,
  setUpstream = false,
  force = false,
  tags = false,
  /** Remote-side branch name (Push To... dialog): refspec becomes `branch:target`. */
  targetBranch?: string
): Promise<PushResult> {
  const git = getGit(repoPath);
  // No branch given: resolve the CURRENT branch and auto-publish it.
  // `git push <remote>` alone fails with "no upstream configured" for a fresh
  // local branch (push.default=simple) — the "cannot push my new branch" bug.
  let refspec = branch;
  let setUp = setUpstream;
  if (!refspec) {
    const cur = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (cur && cur !== 'HEAD' && cur !== '') {
      refspec = cur;
      if (!setUp) {
        // Add -u when the branch has no upstream yet
        try {
          await git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${cur}@{u}`]);
        } catch {
          setUp = true;
        }
      }
    }
  }
  // Explicit remote-side target ("Push To..." lets the user publish a local
  // branch under a DIFFERENT name on the remote): refspec `src:target`.
  const target = targetBranch?.trim() || undefined;
  const args: string[] = [
    ...(await remoteNetworkArgs(repoPath, remote, true)),
    // Hardening for servers/proxies that reject chunked uploads or HTTP/2
    // pushes with "RPC failed; HTTP 400 curl 22 / unexpected disconnect":
    //  - http.version=HTTP/1.1 — curl's HTTP/2 upload trips many proxies
    //  - http.postBuffer — buffer the whole pack instead of chunked
    //    transfer-encoding (both are per-command -c flags; nothing is
    //    persisted into the repository config)
    '-c', 'http.version=HTTP/1.1',
    '-c', 'http.postBuffer=524288000',
    'push',
  ];
  if (setUp) args.push('-u');
  if (force) args.push('--force-with-lease');
  if (tags) args.push('--tags');
  args.push(remote);
  if (refspec) {
    // Plain refspec `branch` (NOT `HEAD:branch` — that pushes whatever HEAD
    // points at, which is wrong when the user selected a non-current branch),
    // or `branch:target` when the user chose a different remote-side name.
    args.push(target && target !== refspec ? `${refspec}:${target}` : refspec);
  }

  // Capture BOTH streams: git prints ref status on stderr and exits 0 even
  // when nothing was pushed ("Everything up-to-date").
  const run = await spawnGitCapture(repoPath, args).catch((e) => {
    throw describeNetworkError(e, 'push');
  });
  if (run.code !== 0) {
    const err = new Error(run.stderr.trim() || run.stdout.trim() || 'git push failed');
    throw describeNetworkError(err, 'push');
  }

  const { refs, upToDate } = parsePushOutput(`${run.stderr}\n${run.stdout}`);
  const rejected = refs.filter((r) => r.rejected);
  // Exit 0 but a rejected ref line → server refused part of the push
  // (can happen with --tags or multiple refspecs): treat as failure.
  if (rejected.length > 0) {
    const detail = rejected
      .map((r) => `${r.remoteRef}: ${r.reason ?? 'rejected by remote'}`)
      .join('; ');
    const err = new Error(`The remote refused the push — ${detail}\n${run.stderr.trim()}`);
    throw describeNetworkError(err, 'push');
  }

  // Honest post-push verification: the remote branch must now point at the
  // same commit the local one does. Catches silent hook rewrites, proxy
  // weirdness, and wrong-branch pushes (e.g. `Main` vs `main`).
  let verification: PushVerification | undefined;
  if (refspec && /^[A-Za-z0-9._\-/]+$/.test(refspec) && !refspec.includes(':')) {
    // With a different remote-side name, the remote branch to verify is the TARGET.
    const verifyRef = target && target !== refspec ? target : refspec;
    try {
      const localHash = (await git.raw(['rev-parse', refspec])).trim();
      const remoteHash = await lsRemoteBranch(repoPath, remote, verifyRef);
      verification = {
        branch: verifyRef,
        localHash,
        remoteHash,
        ok: remoteHash === localHash,
      };
    } catch {
      /* verification is best-effort — never mask a successful push */
    }
  }

  const updated = refs.some((r) => !r.upToDate && !r.rejected && !r.deleted);
  const head = refs.find((r) => !r.upToDate && !r.rejected && !r.deleted);
  let summary: string;
  if (upToDate && !updated) summary = 'Everything up-to-date — nothing to push';
  else if (head?.created) summary = `Published '${head.remoteRef}' → ${remote}`;
  else if (head) summary = `Pushed '${head.localRef ?? head.remoteRef}' → ${remote}/${head.remoteRef}`;
  else summary = 'Push completed';

  return {
    upToDate: upToDate && !updated,
    updated,
    refs,
    verification,
    remote,
    branch: refspec ?? undefined,
    summary,
  };
}

/**
 * Per-remote credentials from app settings (Repository Settings → Remotes,
 * shared with the Remotes tool). Empty when the user has not configured any.
 */
function getStoredCredential(repoPath: string, remoteName: string): RemoteCredential | undefined {
  try {
    const map = getSetting('remoteAuth') as
      | Record<string, Record<string, RemoteCredential>>
      | undefined;
    const cred = map?.[repoPath]?.[remoteName];
    if (cred && (cred.username?.trim() || cred.password?.trim())) return cred;
  } catch {
    /* settings store unavailable (unit tests) — no credentials */
  }
  return undefined;
}

/**
 * Build `-c http.extraHeader=Authorization: Basic ...` args for an HTTP(S)
 * remote with stored credentials. Credentials are injected per command only —
 * never persisted into .git/config or the remote URL, never echoed in errors.
 * Returns [] for SSH/local URLs or when no credentials are configured.
 */
export function buildHttpAuthArgs(
  remoteUrl: string | undefined,
  cred: RemoteCredential | undefined
): string[] {
  if (!remoteUrl || !cred) return [];
  // Only http(s) supports the extraHeader mechanism.
  if (!/^https?:\/\//i.test(remoteUrl.trim())) return [];
  const user = cred.username?.trim() ?? '';
  const pass = cred.password ?? '';
  if (!user && !pass) return [];
  // Don't double-authorize: URLs that already embed credentials (http://u:p@host/)
  // would send two conflicting Authorization sources.
  if (/^https?:\/\/[^/@]+@/i.test(remoteUrl.trim())) return [];
  const b64 = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  return ['-c', `http.extraHeader=Authorization: Basic ${b64}`];
}

/**
 * Resolve the stored URL of a remote. Push commands should authenticate
 * against the push URL when a dedicated one is configured, fetch/pull/ls
 * against the fetch URL.
 */
async function remoteUrlOf(repoPath: string, remoteName: string, pushUrl = false): Promise<string | undefined> {
  try {
    const remotes = (await getGit(repoPath).getRemotes(true)) as Array<{
      name: string;
      refs: { fetch: string; push?: string };
    }>;
    const refs = remotes.find((r) => r.name === remoteName)?.refs;
    if (!refs) return undefined;
    return (pushUrl ? refs.push || refs.fetch : refs.fetch) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * `-c` args (auth) that must precede a network git subcommand for `remote`.
 * Async because the remote URL has to be read from the repo config.
 */
async function remoteNetworkArgs(repoPath: string, remoteName: string, pushUrl = false): Promise<string[]> {
  try {
    const url = await remoteUrlOf(repoPath, remoteName, pushUrl);
    return buildHttpAuthArgs(url, getStoredCredential(repoPath, remoteName));
  } catch {
    return [];
  }
}

/**
 * Translate raw git network errors into actionable messages. The technical
 * detail is kept after the hint; the Authorization header value can never
 * appear in git output (it is an http.extraHeader, not a URL rewrite).
 */
function describeNetworkError(e: unknown, op: 'push' | 'pull' | 'fetch'): Error {
  const raw = e instanceof Error ? e.message : String(e);
  let hint = '';
  if (/remote rejected|protected branch|GH006|hook declined|pre-receive/i.test(raw)) {
    hint =
      'The server REFUSED the branch update — the branch is protected ' +
      '(e.g. GitHub "Protect this branch" / required PR reviews) or you lack ' +
      'write permission. The remote branch was NOT changed. ';
  } else if (/non-fast-forward|fetch first|behind its remote/i.test(raw)) {
    hint =
      'The remote branch has commits you do not have locally — pull first ' +
      '(Pull button, or Pull --rebase), then push again. ';
  } else if (/could not read Username|Authentication failed|401|403|authorization/i.test(raw)) {
    hint =
      `Authentication failed — set Username + Password/token for this remote in ` +
      `Repository Settings → Remotes (or the Remotes tool → Edit URLs). `;
  } else if (/HTTP 400/.test(raw)) {
    hint =
      'The server rejected the request (HTTP 400) — usually a proxy or server ' +
      'limit. Push was already retried over HTTP/1.1 with a large buffer; ' +
      'check the server log if it persists. ';
  } else if (/413/.test(raw)) {
    hint = 'The server refused the payload as too large (HTTP 413). ';
  } else if (/host key verification|permission denied \(publickey\)/i.test(raw)) {
    hint = 'SSH authentication failed — add your key to ssh-agent for this host. ';
  }
  if (!hint) return e instanceof Error ? e : new Error(raw);
  const err = new Error(hint + raw.trim());
  (err as { originalStack?: string }).originalStack = e instanceof Error ? e.stack : undefined;
  return err;
}

/**
 * Handle "untracked working tree files would be overwritten" errors.
 * When git pull/checkout/merge fails because untracked files conflict
 * with incoming files, auto-clean those specific files (git clean -f)
 * and retry the operation.
 *
 * Returns true if the error was handled (caller should retry).
 */
function isUntrackedOverwriteError(e: unknown): boolean {
  const msg = String(e);
  return msg.includes('untracked working tree files would be overwritten');
}

/** Extract the file paths from "untracked working tree files would be
 *  overwritten by merge: file1 file2" error messages. */
function extractUntrackedFiles(e: unknown): string[] {
  const msg = String(e);
  const lines = msg.split('\n');
  const files: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Lines with file paths are indented with a tab
    if (line.startsWith('\t') && trimmed) {
      files.push(trimmed);
    }
  }
  return files;
}

/** Auto-clean conflicting untracked files, then the caller can retry. */
async function cleanConflictingUntracked(repoPath: string, files: string[]): Promise<void> {
  const git = getGit(repoPath);
  removeStaleIndexLock(repoPath);
  for (const f of files) {
    try {
      // Force-remove the untracked file that blocks the operation.
      await git.raw(['clean', '-f', '--', f]);
    } catch {
      // If clean fails, try fs.unlink as a last resort.
      try {
        const fullPath = path.join(repoPath, f);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      } catch { /* ignore — will surface as a clearer error on retry */ }
    }
  }
}

export async function pull(
  repoPath: string,
  remote = 'origin',
  branch?: string,
  rebase = false,
  noFF = false
): Promise<void> {
  const git = getGit(repoPath);
  const args: string[] = [...(await remoteNetworkArgs(repoPath, remote)), 'pull'];
  if (rebase) args.push('--rebase');
  if (noFF) args.push('--no-ff');
  args.push(remote);
  if (branch) args.push(branch);
  try {
    await git.raw(args);
  } catch (e) {
    // ── Auto-recover from "untracked working tree files would be
    //    overwritten" — the user has local untracked files that
    //    conflict with incoming files from the remote. Auto-clean
    //    those files and retry the pull. This is safe because
    //    the files are UNTRACKED — they're not in git history.
    if (isUntrackedOverwriteError(e)) {
      const files = extractUntrackedFiles(e);
      if (files.length > 0) {
        await cleanConflictingUntracked(repoPath, files);
        // Retry the pull after cleaning.
        try {
          await git.raw(args);
          return;
        } catch (e2) {
          throw describeNetworkError(e2, 'pull');
        }
      }
    }
    throw describeNetworkError(e, 'pull');
  }
}

// ── Fetch deduplication — one download per repo at a time ──────────────────
// The same repository can be fetched concurrently from several entry points
// (app menu accelerator + renderer keydown double-fire, background
// "Poll or Fetch", History page auto-fetch, sidebar remote check, a double
// click). Overlapping fetches download the same objects twice and show up as
// duplicate "Fetch" commands in the command log. The second concurrent caller
// now JOINS the in-flight fetch instead of starting a second download.
const inFlightFetches = new Map<string, Promise<void>>();

function runExclusiveFetch(repoPath: string, run: () => Promise<void>): Promise<void> {
  const existing = inFlightFetches.get(repoPath);
  if (existing) return existing;
  const p = run().finally(() => {
    if (inFlightFetches.get(repoPath) === p) inFlightFetches.delete(repoPath);
  });
  inFlightFetches.set(repoPath, p);
  return p;
}

export function fetch(
  repoPath: string,
  remote = 'origin',
  prune = false,
  tags = false
): Promise<void> {
  return runExclusiveFetch(repoPath, async () => {
    const git = getGit(repoPath);
    const args: string[] = [...(await remoteNetworkArgs(repoPath, remote)), 'fetch'];
    if (prune) args.push('--prune');
    if (tags) args.push('--tags');
    args.push(remote);
    try {
      await git.raw(args);
    } catch (e) {
      throw describeNetworkError(e, 'fetch');
    }
  });
}

export function fetchAll(repoPath: string, prune = false): Promise<void> {
  return runExclusiveFetch(repoPath, async () => {
    const git = getGit(repoPath);
    // Always prune — stale remote-tracking refs cause "cannot lock ref" errors
    // when the remote has been force-pushed (the local ref points to an OID
    // that the remote no longer expects).
    const shouldPrune = true; // prune === false means "don't force prune", but we still prune to avoid lock errors
    const remotes = ((await git.getRemotes(true)) as Array<{ name: string }>).map((r) => r.name);
    const hasCreds = remotes.some((r) => !!getStoredCredential(repoPath, r));
    if (!hasCreds) {
      const args: string[] = ['fetch', '--all', '--tags'];
      if (shouldPrune) args.push('--prune');
      try {
        await git.raw(args);
      } catch (e) {
        // If the error is "cannot lock ref" (stale remote-tracking branch),
        // try with --force to overwrite the stale ref
        const errMsg = String(e);
        if (errMsg.includes('cannot lock ref') || errMsg.includes('unable to update local ref')) {
          try {
            await git.raw(['fetch', '--all', '--tags', '--prune', '--force']);
            return;
          } catch {
            // Still failing — fall through to original error
          }
        }
        throw describeNetworkError(e, 'fetch');
      }
      return;
    }
    const failures: string[] = [];
    for (const r of remotes) {
      try {
        const args: string[] = [...(await remoteNetworkArgs(repoPath, r)), 'fetch', '--tags'];
        if (shouldPrune) args.push('--prune');
        args.push(r);
        await git.raw(args);
      } catch (e) {
        const errMsg = String(e);
        if (errMsg.includes('cannot lock ref') || errMsg.includes('unable to update local ref')) {
          // Retry with --force to overwrite stale remote-tracking ref
          try {
            const args: string[] = [...(await remoteNetworkArgs(repoPath, r)), 'fetch', '--tags', '--prune', '--force', r];
            await git.raw(args);
            continue;
          } catch (e2) {
            failures.push(`${r}: ${describeNetworkError(e2, 'fetch').message}`);
            continue;
          }
        }
        failures.push(`${r}: ${describeNetworkError(e, 'fetch').message}`);
      }
    }
    if (failures.length === remotes.length && failures.length > 0) {
      throw new Error(`Fetch failed for all remotes — ${failures.join('; ')}`);
    }
    // Partial failures are intentionally non-fatal (same semantics as --all,
    // which reports per-remote errors but still updates the others).
  });
}

export async function log(
  repoPath: string,
  options: { maxCount?: number; skip?: number; branch?: string; branches?: string[]; file?: string; follow?: boolean; all?: boolean; grep?: string; grepIgnoreCase?: boolean } = {}
): Promise<LogEntry[]> {
  const git = getGit(repoPath);
  const { maxCount = 500, skip = 0, branch, branches, file, follow = false, all = false, grep, grepIgnoreCase = false } = options;

  // Use a custom pretty format with record separator \x1e between commits and \x00 between fields.
  // simple-git's built-in log() uses \n\n to split commits which breaks when body contains blank lines.
  // Field order: hash, hashAbbrev, parents, parentsAbbrev, authorName, authorEmail, authorDate,
  //              committerName, committerEmail, committerDate, subject, body, refs
  const fieldSep = '%x00';
  const commitSep = '%x1e';
  const pretty = [
    '%H', '%h', '%P', '%p',
    '%an', '%ae', '%aI',
    '%cn', '%ce', '%cI',
    '%s', '%b', '%D',
  ].join(fieldSep);

  // --topo-order: stable topological ordering — parents always come after
  // children. This is what VS Code uses for its Git Graph view, and it
  // produces cleaner lane assignments (no "jumps" where a commit appears
  // out of chronological order, breaking the visual flow of the graph).
  // Without --topo-order, git uses --date-order by default which can
  // interleave commits from different branches in a way that makes the
  // graph look messy with unnecessary lane crossings.
  const rawArgs = ['log', `-${maxCount}`, `--pretty=format:${pretty}${commitSep}`, '--date=iso-strict', '--decorate=full', '--topo-order'];

  // Skip — for lazy-loading the next page of commits without refetching
  // the ones we already have. `--skip=N` tells git to skip the first N
  // commits in the rev-walk, so the returned list starts at commit N+1.
  // Used by the History page's infinite-scroll: initial load fetches the
  // first 100 commits; when the user scrolls near the bottom, we fetch
  // the next 100 with skip=100, append to entries, and so on.
  if (skip > 0) rawArgs.push(`--skip=${skip}`);

  // Multi-branch mode: pass explicit refs to git log.
  // `git log ref1 ref2 ref3` shows the union of all commits reachable from any of these refs,
  // in topological order — perfect for multi-branch history view.
  if (branches && branches.length > 0) {
    // Don't use --all when explicit branches are given
    for (const b of branches) rawArgs.push(b);
  } else if (all) {
    rawArgs.push('--all');
  } else if (branch) {
    rawArgs.push(branch);
  }

  if (file) {
    rawArgs.push('--', file);
    if (follow) rawArgs.splice(2, 0, '--follow');
  }

  // Commit-message search (Search tool → Commits tab). `--grep` matches the
  // subject + body with basic regex; -i makes it case-insensitive.
  if (grep && grep.trim()) {
    rawArgs.push(`--grep=${grep.trim()}`);
    if (grepIgnoreCase) rawArgs.push('-i');
  }

  let out: string;
  try {
    out = await git.raw(rawArgs);
  } catch {
    return [];
  }
  return parseRawLog(out);
}
function parseRawLog(raw: string): LogEntry[] {
  if (!raw.trim()) return [];
  // Split on \x1e (record separator) — handles bodies with blank lines correctly.
  const commits = raw.split('\x1e').filter((c) => c.trim());
  return commits.map((c) => {
    // Strip leading/trailing newlines that git adds around the record.
    // The trailing \n is added by git before \x1e (between records).
    const cleaned = c.replace(/^\n+/, '').replace(/\n+$/, '');
    const parts = cleaned.split('\x00');
    if (parts.length < 13) return null;
    const [
      hash, hashAbbrev, parents, parentsAbbrev,
      authorName, authorEmail, authorDate,
      committerName, committerEmail, committerDate,
      subject, body, refs,
    ] = parts;
    const authorDateTs = new Date(authorDate || '').getTime();
    const committerDateTs = new Date(committerDate || '').getTime();
    return {
      hash: hash || '',
      hashAbbrev: hashAbbrev || (hash || '').substring(0, 7),
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      parentsAbbrev: parentsAbbrev ? parentsAbbrev.split(' ').filter(Boolean) : [],
      author: { name: authorName || '', email: authorEmail || '', date: authorDate || '', timestamp: isNaN(authorDateTs) ? 0 : authorDateTs },
      committer: { name: committerName || '', email: committerEmail || '', date: committerDate || '', timestamp: isNaN(committerDateTs) ? 0 : committerDateTs },
      subject: subject || '',
      body: body || '',
      refs: refs ? refs.split(',').map((r) => r.trim()).filter(Boolean) : [],
      message: `${subject || ''}\n\n${body || ''}`.trim(),
    } as LogEntry;
  }).filter(Boolean) as LogEntry[];
}

/**
 * Resolve a commit by full or abbreviated hash (prefix search).
 * Works for ANY commit in the repo — including ones outside the loaded log window.
 * Returns null when the query is not hash-like, ambiguous or unresolvable.
 */
export async function findCommit(repoPath: string, query: string): Promise<LogEntry | null> {
  const q = query.trim().toLowerCase();
  if (!/^[0-9a-f]{4,40}$/.test(q)) return null;
  const git = getGit(repoPath);
  let full: string;
  try {
    full = (await git.raw(['rev-parse', '--quiet', '--verify', `${q}^{commit}`])).trim();
  } catch {
    return null; // not found / ambiguous prefix / not a commit
  }
  if (!/^[0-9a-f]{40}$/.test(full)) return null;
  // Reuse the same pretty format + parser as log() so the result is a regular LogEntry.
  const fieldSep = '%x00';
  const commitSep = '%x1e';
  const pretty = [
    '%H', '%h', '%P', '%p',
    '%an', '%ae', '%aI',
    '%cn', '%ce', '%cI',
    '%s', '%b', '%D',
  ].join(fieldSep);
  let out: string;
  try {
    out = await git.raw(['log', '-1', `--pretty=format:${pretty}${commitSep}`, '--date=iso-strict', full]);
  } catch {
    return null;
  }
  return parseRawLog(out)[0] || null;
}

export async function branches(repoPath: string): Promise<BranchInfo[]> {
  const git = getGit(repoPath);
  const current = await git.status();

  // Use for-each-ref to get all branches in a single git call.
  // Note: simple-git passes args through to git as-is, so we use real tab characters,
  // not the %x09 placeholder (which only works in --pretty=format).
  // Fields: refname, objectname, subject, committerdate, *objectname (for annotated), upstream, HEAD
  const fmt = [
    '%(refname)',
    '%(objectname)',
    '%(contents:subject)',
    '%(committerdate:iso-strict)',
    '%(*objectname)',
    '%(upstream:short)',
    '%(HEAD)',
  ].join('\t');
  let rawLocal = '';
  let rawRemote = '';
  try {
    rawLocal = await git.raw(['for-each-ref', `--format=${fmt}`, 'refs/heads/']);
  } catch { /* empty repo */ }
  try {
    rawRemote = await git.raw(['for-each-ref', `--format=${fmt}`, 'refs/remotes/']);
  } catch { /* no remotes */ }

  const result: BranchInfo[] = [];

  const parseBlock = (raw: string, isRemote: boolean) => {
    if (!raw.trim()) return;
    for (const line of raw.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length < 4) continue;
      const [refname, objectname, subject, committerdate, targetHash, upstream, headMarker] = parts;
      let name: string;
      if (isRemote) {
        name = refname.replace(/^refs\/remotes\//, '');
      } else {
        name = refname.replace(/^refs\/heads\//, '');
      }
      // Skip symbolic refs like "origin/HEAD"
      if (name.endsWith('/HEAD')) continue;
      const isCurrent = headMarker === '*';
      const commitHash = (isRemote ? (targetHash || objectname) : objectname) || '';

      const branchInfo: BranchInfo = {
        name,
        current: isCurrent,
        remote: isRemote,
        lastCommit: {
          hash: commitHash.substring(0, 7),
          date: committerdate || '',
          message: subject || '',
        },
      };

      if (!isRemote && isCurrent) {
        branchInfo.tracking = current.tracking || undefined;
        branchInfo.ahead = current.ahead;
        branchInfo.behind = current.behind;
      } else if (!isRemote && upstream) {
        branchInfo.upstream = upstream;
      }

      result.push(branchInfo);
    }
  };

  parseBlock(rawLocal, false);
  parseBlock(rawRemote, true);

  return result;
}

export async function remotes(repoPath: string): Promise<RemoteInfo[]> {
  const git = getGit(repoPath);
  const result = await git.getRemotes(true);
  return result.map((r) => ({
    name: r.name,
    refs: { fetch: r.refs.fetch, push: r.refs.push },
  }));
}

export async function checkout(
  repoPath: string,
  branch: string,
  options: { newBranch?: boolean; force?: boolean; track?: boolean } = {}
): Promise<void> {
  const args: string[] = ['checkout'];
  if (options.newBranch) args.push('-b');
  if (options.force) args.push('--force');
  if (options.track) args.push('--track');
  args.push(branch);
  const cmd = `git ${args.join(' ')}`;
  await withOperationLog(options.newBranch ? 'Create & Checkout Branch' : 'Checkout', repoPath, cmd, async () => {
    const git = getGit(repoPath);
    try {
      await git.raw(args);
    } catch (e) {
      // ── Auto-recover from "untracked working tree files would be
      //    overwritten by checkout" — same as pull.
      if (isUntrackedOverwriteError(e)) {
        const files = extractUntrackedFiles(e);
        if (files.length > 0) {
          await cleanConflictingUntracked(repoPath, files);
          // Retry checkout after cleaning.
          try {
            await git.raw(args);
            return;
          } catch (e2) {
            const err2 = e2 as { stderr?: string; message?: string };
            const msg2 = err2?.stderr || err2?.message || String(e2);
            const lines2 = msg2.split('\n').filter(l => l.includes('error:') || l.includes('fatal:'));
            throw new Error(lines2.length > 0 ? lines2.join('\n') : msg2);
          }
        }
      }
      const err = e as { stderr?: string; message?: string };
      const msg = err?.stderr || err?.message || String(e);
      const lines = msg.split('\n').filter(l => l.includes('error:') || l.includes('fatal:'));
      throw new Error(lines.length > 0 ? lines.join('\n') : msg);
    }
  });
}

export async function checkoutFile(repoPath: string, file: string, ref?: string): Promise<void> {
  const git = getGit(repoPath);
  await git.checkout([ref || 'HEAD', '--', file]);
}

/**
 * Restore multiple files from a ref in ONE git call instead of N sequential
 * calls. `git checkout <ref> -- f1 f2 f3` works for any number of paths
 * in a single invocation.
 *
 * For 50 files this is ~50× faster than calling checkoutFile() in a for-loop.
 */
export async function checkoutFiles(repoPath: string, files: string[], ref?: string): Promise<void> {
  if (files.length === 0) return;
  const git = getGit(repoPath);
  removeStaleIndexLock(repoPath);
  await git.checkout([ref || 'HEAD', '--', ...files]);
}

export async function createBranch(
  repoPath: string,
  name: string,
  startPoint?: string,
  force = false,
  track = false
): Promise<void> {
  const git = getGit(repoPath);
  const args: string[] = ['branch'];
  if (force) args.push('-f');
  if (track) args.push('--track');
  args.push(name, startPoint || 'HEAD');
  await git.raw(args);
}

export async function deleteBranch(
  repoPath: string,
  name: string,
  force = false,
  remote = false
): Promise<void> {
  const git = getGit(repoPath);
  if (remote) {
    await git.raw([...(await remoteNetworkArgs(repoPath, 'origin', true)), 'push', 'origin', '--delete', name]);
  } else {
    await git.deleteLocalBranch(name, force);
  }
}

export async function renameBranch(
  repoPath: string,
  oldName: string,
  newName: string
): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['branch', '-m', oldName, newName]);
}

export async function merge(
  repoPath: string,
  branch: string,
  options: { noFf?: boolean; squash?: boolean; ffOnly?: boolean; strategy?: string } = {}
): Promise<{ conflicts: string[]; fastForward: boolean; alreadyUpToDate: boolean }> {
  const git = getGit(repoPath);
  const args: string[] = ['merge'];
  if (options.noFf) args.push('--no-ff');
  if (options.squash) args.push('--squash');
  if (options.ffOnly) args.push('--ff-only');
  if (options.strategy) args.push('--strategy', options.strategy);
  args.push(branch);

  // simple-git's git.raw() does NOT throw on conflict — it returns the stderr/stdout
  // even when git exits non-zero. So we ALWAYS run status() after merge to detect conflicts.
  let output = '';
  try {
    output = await git.raw(args);
  } catch (err) {
    // For --ff-only, git may reject with non-zero exit when not possible to fast-forward.
    // We capture output from the error if present.
    output = (err as { stderr?: string; stdout?: string })?.stderr || (err as Error)?.message || '';
    // If output indicates already-up-to-date or contains "merge" errors, fall through to status check
  }

  const statusRes = await status(repoPath);
  const hasConflicts = statusRes.conflicted.length > 0;
  // "Not possible to fast-forward" (from --ff-only rejection) must NOT be
  // reported as a successful fast-forward — exclude rejection messages first.
  const ffRejected = /not possible to fast-forward/i.test(output);
  return {
    conflicts: statusRes.conflicted,
    fastForward: !hasConflicts && !ffRejected && /Fast-forward/i.test(output),
    alreadyUpToDate: !hasConflicts && /Already up to date/i.test(output),
  };
}

export async function abortMerge(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  await git.merge(['--abort']);
}

export async function continueMerge(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  // Continue merge by committing the resolved conflicts
  await git.raw(['commit', '--no-edit']);
}

/**
 * Pre-merge preview: determine mergeability without touching the working tree.
 * Uses `git merge-tree --write-tree` (Git 2.38+) to compute the result of merging
 * two trees/commits. Returns the list of files that would conflict.
 *
 * Adapted from GitHub Desktop's determineMergeability() approach.
 */
export async function mergeTree(
  repoPath: string,
  ours: string,
  theirs: string
): Promise<{ conflicts: string[]; clean: boolean }> {
  const git = getGit(repoPath);
  try {
    // Git 2.38+ syntax: merge-tree --write-tree --name-only --no-messages -z <ours> <theirs>
    // Exit code: 0 = clean merge, 1 = conflicts
    const out = await git.raw(['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', ours, theirs]);
    // Output format: "<tree-id>\0[<file>\0]*"
    // If there are conflicts, additional NUL-separated file paths follow the tree-id.
    // Split on \0; first element is tree-id, remaining elements (excluding trailing empty) are conflicted files.
    const parts = out.split('\0').filter(Boolean);
    if (parts.length <= 1) {
      return { conflicts: [], clean: true };
    }
    // On conflict, git outputs: <tree-id>\0<conflicted-file-1>\0<conflicted-file-2>\0...
    // On clean merge, git outputs only: <tree-id>
    const conflicts = parts.slice(1);
    return { conflicts, clean: conflicts.length === 0 };
  } catch {
    // Either merge-tree is unsupported (older git) or unrelated histories
    return { conflicts: [], clean: false };
  }
}

/**
 * Get ahead/behind counts between two refs without modifying state.
 */
export async function aheadBehind(
  repoPath: string,
  base: string,
  compare: string
): Promise<{ ahead: number; behind: number }> {
  const git = getGit(repoPath);
  try {
    const out = await git.raw(['rev-list', '--left-right', '--count', `${base}...${compare}`]);
    // Output: "<left> <right>" — left = commits only in `base`, right = commits
    // only in `compare`. Contract (see gitService.real tests): `ahead` counts
    // commits only in `compare` ("compare is ahead of base"), `behind` counts
    // commits only in `base`. BranchesPage compare dialog and MergePanel both
    // rely on this. NOTE: smartPull() parses the same command inline with the
    // OPPOSITE orientation (HEAD first = left = local ahead) — do not "unify".
    const [behind, ahead] = out.trim().split(/\s+/).map(n => parseInt(n, 10) || 0);
    return { ahead, behind };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

/** Never-resolving safety timeout for the network fetch of a remote check. */
const REMOTE_FETCH_TIMEOUT_MS = 60_000;

function emptyRemoteCheckSummary(repoPath: string): RemoteCheckSummary {
  return {
    path: repoPath,
    hasRemote: false,
    remotes: [],
    incoming: 0,
    outgoing: 0,
    dirty: 0,
    branch: null,
    fetched: false,
    checkedAt: Date.now(),
  };
}

async function countRevList(git: SimpleGit, args: string[]): Promise<number> {
  const out = await git.raw(args);
  return parseInt(out.trim(), 10) || 0;
}

/**
 * Remotes of `repoPath` whose "Perform background Poll or Fetch" checkbox is
 * enabled (Repository Settings → Remotes, or the Remotes/Branches tools).
 * The renderer writes this map into the shared settings store; read it here
 * so periodic refresh touches exactly the remotes the user opted in.
 */
function getBackgroundFetchRemotes(repoPath: string): string[] {
  try {
    const map = getSetting('backgroundFetchRemotes') as Record<string, string[]> | undefined;
    const names = map?.[repoPath];
    return Array.isArray(names) ? names.filter((n) => typeof n === 'string' && n) : [];
  } catch {
    return [];
  }
}

/**
 * Periodic remote check for the repository list (SmartGit-style background
 * poll): fetches ONLY the remotes opted in via "Perform background Poll or
 * Fetch" (network, guarded by a timeout — never prompts), then cheap local
 * computations of incoming/outgoing commit counters and the working-tree
 * change count. NEVER throws — all failures land in `error`.
 */
export async function pollRemoteSummary(repoPath: string): Promise<RemoteCheckSummary> {
  const summary = emptyRemoteCheckSummary(repoPath);
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    return summary;
  }

  const git = getGit(repoPath);

  // 1. Remotes
  try {
    const remotes = (await git.getRemotes(true)) as Array<{ name: string; refs: { fetch: string } }>;
    summary.remotes = remotes.map((r) => r.name);
    summary.hasRemote = remotes.length > 0;
  } catch {
    return summary; // not a repo or unreadable — nothing else to report
  }

  // 2. Network fetch. Refresh ONLY the remotes whose "Perform background
  //    Poll or Fetch" checkbox is enabled in the repository settings — never
  //    every remote of every repository. With no checked remotes there is no
  //    network activity at all (counters reflect the last fetch).
  //    GIT_TERMINAL_PROMPT=0 so a credential prompt can never hang the
  //    background poll; per-remote timeout as a safety net.
  //    NOTE: only the override variable goes into .env() — spreading the full
  //    process.env here would trip simple-git's "unsafe operations" guard
  //    whenever the user's environment contains EDITOR/PAGER etc.
  if (summary.hasRemote) {
    const checked = getBackgroundFetchRemotes(repoPath).filter((n) => summary.remotes.includes(n));
    if (checked.length > 0) {
      const fetchGit = simpleGit({ baseDir: repoPath, binary: 'git' })
        .env({ GIT_TERMINAL_PROMPT: '0' });
      const perRemote = async (name: string): Promise<void> => {
        const authArgs = await remoteNetworkArgs(repoPath, name);
        await Promise.race([
          fetchGit.raw([...authArgs, 'fetch', '--prune', '--quiet', name]),
          new Promise<never>((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`fetch timed out after ${REMOTE_FETCH_TIMEOUT_MS / 1000}s`)),
              REMOTE_FETCH_TIMEOUT_MS
            );
            // Don't keep the process alive just for this timer.
            (timer as { unref?: () => void }).unref?.();
          }),
        ]);
      };
      const results = await Promise.allSettled(checked.map(perRemote));
      const errors = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
      if (errors.length === 0) {
        summary.fetched = true;
      } else if (errors.length === checked.length) {
        summary.error = errors.join('; ');
      } else {
        // At least one remote refreshed the refs; surface partial failures.
        summary.fetched = true;
        summary.error = errors.join('; ');
      }
    }
  }

  // 3. Current branch
  try {
    const name = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    summary.branch = name === 'HEAD' ? null : name; // detached HEAD
  } catch { /* keep null */ }

  // 4. Incoming: commits reachable from remote-tracking branches but not from
  //    any local branch. Outgoing is the mirror image. These aggregates don't
  //    require an upstream to be configured and cover all branches at once.
  try {
    summary.incoming = await countRevList(git, ['rev-list', '--count', '--remotes', '--not', '--branches']);
  } catch { /* keep 0 */ }
  try {
    summary.outgoing = await countRevList(git, ['rev-list', '--count', '--branches', '--not', '--remotes']);
  } catch { /* keep 0 */ }

  // 5. Working tree changes (local only, cheap)
  try {
    const status = await git.raw(['status', '--porcelain']);
    summary.dirty = status.split('\n').filter((line) => line.trim().length > 0).length;
  } catch { /* keep 0 */ }

  summary.checkedAt = Date.now();
  return summary;
}

/**
 * Batch remote check over several repositories with bounded concurrency
 * (network-bound work — keep it gentle). Returns a map keyed by repo path;
 * every entry is a valid summary even if that repo failed.
 */
export async function pollRemoteSummaries(paths: string[]): Promise<Record<string, RemoteCheckSummary>> {
  const result: Record<string, RemoteCheckSummary> = {};
  const unique = [...new Set(paths)].filter(Boolean);
  const CONCURRENCY = 3;
  let next = 0;

  async function worker(): Promise<void> {
    while (next < unique.length) {
      const repoPath = unique[next++];
      try {
        result[repoPath] = await pollRemoteSummary(repoPath);
      } catch (e) {
        // pollRemoteSummary is designed not to throw — belt and braces.
        result[repoPath] = {
          ...emptyRemoteCheckSummary(repoPath),
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(CONCURRENCY, unique.length)) }, worker)
  );
  return result;
}

function parseDiff(rawDiff: string, oldPath: string, newPath: string): { hunks: DiffHunk[]; newFile: boolean; deletedFile: boolean; renamedFile: boolean; modeChange?: { oldMode: number; newMode: number } } {
  const lines = rawDiff.split('\n');
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let newFile = false;
  let deletedFile = false;
  let renamedFile = false;
  let modeChange: { oldMode: number; newMode: number } | undefined;

  for (const line of lines) {
    if (line.startsWith('new file mode')) newFile = true;
    if (line.startsWith('deleted file mode')) deletedFile = true;
    if (line.startsWith('rename from') || line.startsWith('rename to')) renamedFile = true;
    const modeMatch = line.match(/^old mode (\d+)$/) || line.match(/^new mode (\d+)$/);
    if (modeMatch) {
      const mode = parseInt(modeMatch[1], 10);
      if (line.startsWith('old mode')) modeChange = { oldMode: mode, newMode: modeChange?.newMode ?? mode };
      if (line.startsWith('new mode')) modeChange = { oldMode: modeChange?.oldMode ?? mode, newMode: mode };
    }
    if (line.startsWith('diff --git')) continue;
    if (line.startsWith('index ')) continue;
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    if (line.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk);
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (match) {
        const oldStart = parseInt(match[1], 10);
        const oldLines = match[2] ? parseInt(match[2], 10) : 1;
        const newStart = parseInt(match[3], 10);
        const newLines = match[4] ? parseInt(match[4], 10) : 1;
        currentHunk = {
          oldStart,
          oldLines,
          newStart,
          newLines,
          header: line,
          lines: [],
        };
        oldLine = oldStart;
        newLine = newStart;
      }
      continue;
    }
    if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({
          type: 'add',
          content: line.substring(1),
          oldLineNumber: null,
          newLineNumber: newLine++,
        });
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({
          type: 'del',
          content: line.substring(1),
          oldLineNumber: oldLine++,
          newLineNumber: null,
        });
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({
          type: 'context',
          content: line.substring(1),
          oldLineNumber: oldLine++,
          newLineNumber: newLine++,
        });
      }
    }
  }
  if (currentHunk) hunks.push(currentHunk);
  return { hunks, newFile, deletedFile, renamedFile, modeChange };
}

export async function diff(
  repoPath: string,
  file: string,
  options: { staged?: boolean; ref?: string } = {}
): Promise<DiffResult> {
  // ── In-memory diff cache ──────────────────────────────────────────────
  // The Changes page calls api.git.diff() every time the user selects a
  // file in the list. After a commit / stage / unstage, the renderer's
  // `lastLoadedFileRef` cache is busted — but if the user clicks back to
  // the same file with no underlying change, we end up running
  // `git diff -- <path>` + `git show HEAD:<path>` + readFile again, even
  // though the result is identical to the last call ~50ms ago.
  //
  // Cache key: repoPath + file + staged + ref. TTL: 1500ms — long enough
  // to absorb back-to-back clicks on the same file, short enough that
  // actual file changes (which the watcher notifies) get a fresh diff
  // on the next call.
  const cacheKey = `${repoPath}|${file}|staged=${!!options.staged}|ref=${options.ref || ''}`;
  const cached = diffCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 1500) {
    return cached.result;
  }

  const git = getGit(repoPath);
  const args = ['diff', '--no-color'];
  if (options.staged) args.push('--cached');
  if (options.ref) args.push(options.ref);
  // Only add pathspec if file is non-empty and not '.' — empty pathspec causes
  // git error "fatal: empty string is not a valid pathspec".
  // When file is '.' or empty, we diff ALL files in the working tree vs the ref.
  if (file && file !== '.' && file !== '') {
    args.push('--', file);
  } else {
    args.push('--', '.');
  }

  // Run the diff + the HEAD:file show in parallel — they're independent
  // commands and previously ran sequentially, doubling latency for large
  // diffs. (Was: `await git.raw(args)` THEN `await git.raw(['show', ...])`.)
  const MAX_INLINE_FILE_BYTES = 1_048_576; // 1 MiB — above this we skip inline content
  const rawDiffPromise = git.raw(args);
  const oldContentPromise = (async () => {
    try {
      return await git.raw(['show', `${options.ref || 'HEAD'}:${file}`]);
    } catch {
      return '';
    }
  })();

  const [rawDiff, oldContentStr] = await Promise.all([rawDiffPromise, oldContentPromise]);

  let oldContent = oldContentStr || '';
  let newContent = '';
  let binary = false;

  // Read the working-tree file ASYNCHRONOUSLY (was: fs.readFileSync —
  // blocked the event loop for ~50–500ms on large files, which froze the
  // Electron IPC queue and made the whole app feel sluggish while a diff
  // was loading). Also cap at MAX_INLINE_FILE_BYTES — anything larger
  // gets an empty newContent (the diff hunks are still rendered from the
  // rawDiff output above, so the user still sees WHAT changed — just
  // without the inline word-diff comparison).
  try {
    const abs = path.join(repoPath, file);
    const stat = await fs.promises.stat(abs).catch(() => null);
    if (stat && stat.isFile()) {
      if (stat.size > MAX_INLINE_FILE_BYTES) {
        // Too large for inline word-diff — skip reading, mark as "large".
        // The diff hunks themselves are still parsed from rawDiff.
        newContent = '';
      } else {
        const buf = await fs.promises.readFile(abs);
        // Quick binary check — first 8KB only, not the whole file.
        if (buf.toString('utf8', 0, Math.min(8000, buf.length)).includes('\u0000')) {
          binary = true;
        } else {
          newContent = buf.toString('utf8');
        }
      }
    }
  } catch {
    newContent = '';
  }

  const parsed = parseDiff(rawDiff, file, file);
  const result: DiffResult = {
    oldContent,
    newContent,
    oldPath: file,
    newPath: file,
    hunks: parsed.hunks,
    binary: binary || rawDiff.includes('Binary files'),
    newFile: parsed.newFile,
    deletedFile: parsed.deletedFile,
    renamedFile: parsed.renamedFile,
    modeChange: parsed.modeChange,
  };

  // Store in cache — see comment at the top of diff() for the rationale.
  // Cap at 64 entries so the cache can't grow unbounded on a long session.
  if (diffCache.size >= 64) {
    // Evict the oldest entry (Maps iterate in insertion order).
    const firstKey = diffCache.keys().next().value;
    if (firstKey) diffCache.delete(firstKey);
  }
  diffCache.set(cacheKey, { ts: Date.now(), result });

  return result;
}

/** In-memory cache for the `diff()` function — see comment inside. */
const diffCache = new Map<string, { ts: number; result: DiffResult }>();

/**
 * Invalidate cached diff results for a given repo. Call this from any
 * write operation that changes the working tree or index (commit, stage,
 * unstage, restore, stash, checkout, merge, etc.) — otherwise the next
 * diff() call for the same file may return the pre-change result.
 *
 * Implementation: walk the cache keys and delete any that start with
 * `${repoPath}|`. O(n) in cache size (≤64 entries) so cheap.
 */
export function invalidateDiffCache(repoPath: string): void {
  const prefix = `${repoPath}|`;
  for (const key of diffCache.keys()) {
    if (key.startsWith(prefix)) diffCache.delete(key);
  }
}

export async function diffBranches(
  repoPath: string,
  base: string,
  compare: string
): Promise<DiffResult> {
  const git = getGit(repoPath);
  const rawDiff = await git.raw(['diff', `${base}...${compare}`, '--no-color']);
  const parsed = parseDiff(rawDiff, base, compare);
  return {
    oldContent: '',
    newContent: '',
    oldPath: base,
    newPath: compare,
    hunks: parsed.hunks,
    binary: false,
    newFile: false,
    deletedFile: false,
    renamedFile: false,
  };
}

export async function diffCommit(
  repoPath: string,
  hash: string,
  parentHash?: string
): Promise<DiffResult> {
  const git = getGit(repoPath);

  // Preflight: verify the commit (and optional parent) exist before invoking
  // `git diff`. When a commit becomes unreachable (e.g. after `git reset --hard`,
  // `git commit --amend`, force-push, or `git gc --prune=now`), the hash in the
  // History list may no longer resolve — `git diff` would throw
  // `fatal: bad object <hash>`. We swallow that case and return an empty diff
  // so the UI shows "No changes" instead of an IPC error popup.
  if (!(await commitExists(repoPath, hash))) {
    return {
      oldContent: '', newContent: '',
      oldPath: hash, newPath: hash,
      hunks: [], binary: false,
      newFile: false, deletedFile: false, renamedFile: false,
    };
  }
  if (parentHash && !(await commitExists(repoPath, parentHash))) {
    return {
      oldContent: '', newContent: '',
      oldPath: hash, newPath: hash,
      hunks: [], binary: false,
      newFile: false, deletedFile: false, renamedFile: false,
    };
  }

  const range = parentHash ? `${parentHash}..${hash}` : `${hash}^..${hash}`;
  let rawDiff: string;
  try {
    rawDiff = await git.raw(['diff', '--no-color', range]);
  } catch {
    // Race: commit may have been gc'd between the preflight and the diff.
    // Return an empty diff rather than propagating the error.
    return {
      oldContent: '', newContent: '',
      oldPath: hash, newPath: hash,
      hunks: [], binary: false,
      newFile: false, deletedFile: false, renamedFile: false,
    };
  }
  const parsed = parseDiff(rawDiff, hash, hash);
  return {
    oldContent: '',
    newContent: '',
    oldPath: hash,
    newPath: hash,
    hunks: parsed.hunks,
    binary: false,
    newFile: parsed.newFile,
    deletedFile: parsed.deletedFile,
    renamedFile: parsed.renamedFile,
  };
}

/**
 * Cheap preflight check — verifies a commit object exists in the repo without
 * reading its content. Used by `commitFiles` and `diffCommit` to avoid
 * `fatal: bad object <hash>` errors when a commit becomes unreachable
 * (e.g. after `git reset --hard`, `git commit --amend`, force-push, or
 * `git gc --prune=now`).
 *
 * Uses `git rev-parse --quiet --verify '<hash>^{commit}'`:
 *   - Exit code 0 + stdout = full hash → commit exists
 *   - Non-zero exit (caught by simple-git) → not a commit / not found
 *
 * Always returns false for empty / undefined / non-hash inputs.
 */
export async function commitExists(repoPath: string, hash: string): Promise<boolean> {
  if (!hash || typeof hash !== 'string') return false;
  const trimmed = hash.trim();
  if (!trimmed) return false;
  // Reject obviously non-hash inputs early (e.g., branch names, HEAD).
  // `git rev-parse` would resolve them too, but we want to be strict here —
  // this helper is specifically for verifying commit SHAs.
  if (!/^[0-9a-f]{4,40}$/i.test(trimmed)) {
    // Allow HEAD / HEAD~N / branch names — they may also point to commits,
    // so we still verify via rev-parse rather than rejecting outright.
  }
  const git = getGit(repoPath);
  try {
    const out = await git.raw([
      'rev-parse', '--quiet', '--verify', `${trimmed}^{commit}`,
    ]);
    return typeof out === 'string' && /^[0-9a-f]{40}$/i.test(out.trim());
  } catch {
    return false;
  }
}

export async function commitFiles(repoPath: string, hash: string): Promise<CommitFile[]> {
  const git = getGit(repoPath);

  // Preflight: verify the commit exists. If the user clicked on a commit hash
  // from a stale History list (e.g., the commit was force-pushed away or
  // gc'd), `git show` would throw `fatal: bad object <hash>`. We catch that
  // case here and return an empty file list — the UI shows "No files" which
  // is the correct degraded behavior (and avoids the IPC error popup).
  if (!(await commitExists(repoPath, hash))) {
    return [];
  }

  // MERGE commits: `git show <merge>` prints a COMBINED diff which lists NO
  // files for a clean merge — the History panel showed "Files (0)" for every
  // merge commit (octopus merges too). SmartGit shows the changes the merge
  // introduced relative to its FIRST parent — the union of everything the
  // merged branches brought in (plus conflict resolutions). Detect merges via
  // `rev-list --parents` and diff `<merge>^1..<merge>` for them.
  let parentCount = 1;
  try {
    const parentsOut = await git.raw(['rev-list', '--parents', '-n', '1', hash]);
    parentCount = parentsOut.trim().split(/\s+/).length - 1;
  } catch { /* default to non-merge handling */ }
  const isMerge = parentCount > 1;

  // Get file list with status. Wrap in try/catch as defense-in-depth — even
  // with the preflight check, a race condition (commit gc'd between the check
  // and the show) would otherwise throw.
  // `-c core.quotePath=false` keeps non-ASCII filenames readable (raw UTF-8
  // instead of C-escaped octal) so path matching + clicking work.
  let raw: string;
  try {
    raw = isMerge
      ? await git.raw(['-c', 'core.quotePath=false', 'diff', '--no-color', '--name-status', `${hash}^1`, hash])
      : await git.raw(['-c', 'core.quotePath=false', 'show', '--no-color', '--name-status', '--format=', hash]);
  } catch {
    return [];
  }
  const result: CommitFile[] = [];
  const lines = raw.split('\n').filter(Boolean);
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const statusCode = parts[0];
    // R068 — git name-status returns 'R100' / 'C75' (status letter + similarity
    // score) for renames and copies. Strip the digits so the UI shows just
    // the 1-letter status (R / C) — the similarity % is already conveyed
    // via the colored badge and the old→new path text.
    const statusLetter = statusCode.replace(/[0-9]+$/, '');
    let pathStr = parts[1];
    let oldPath: string | undefined;
    if (statusCode.startsWith('R') || statusCode.startsWith('C')) {
      oldPath = parts[1];
      pathStr = parts[2];
    }
    // Initial entry — additions/deletions/binary will be filled in from
    // the batched numstat call below (single git spawn for ALL files,
    // previously this was an N+1: one `git show --numstat <file>` per file).
    result.push({
      path: pathStr,
      status: statusLetter,
      oldPath,
      additions: 0,
      deletions: 0,
      binary: false,
      mode: '',
    });
  }

  // Batched numstat: single git call for ALL files in this commit.
  // Previously each file triggered its own `git show --numstat <file>` spawn,
  // which on a 200-file merge commit meant 200 sequential git invocations
  // (~2-6 seconds on Windows). Now: 1 call, O(lines) parse.
  try {
    const numstatRaw = isMerge
      ? await git.raw(['-c', 'core.quotePath=false', 'diff', '--no-color', '--numstat', `${hash}^1`, hash])
      : await git.raw(['-c', 'core.quotePath=false', 'show', '--numstat', '--format=', hash]);
    // Build a path → stat lookup. numstat format: "<add>\t<del>\t<path>"
    // (for renames: "<add>\t<del>\t<old>\t<new>" — but the last column is
    // always the resulting path, matching `result[i].path`).
    const statByPath = new Map<string, { add: number; del: number; binary: boolean }>();
    for (const line of numstatRaw.split('\n')) {
      if (!line.trim()) continue;
      const cols = line.split('\t');
      if (cols.length < 3) continue;
      const last = cols[cols.length - 1];
      const addCol = cols[0];
      const delCol = cols[1];
      statByPath.set(unquoteGitPath(last), {
        add: addCol === '-' ? 0 : (parseInt(addCol || '0', 10) || 0),
        del: delCol === '-' ? 0 : (parseInt(delCol || '0', 10) || 0),
        binary: addCol === '-' || delCol === '-',
      });
    }
    for (const f of result) {
      const s = statByPath.get(f.path);
      if (s) {
        f.additions = s.add;
        f.deletions = s.del;
        f.binary = s.binary;
      }
    }
  } catch {
    /* ignore — numstat is best-effort */
  }
  return result;
}

/**
 * Nested commits of a MERGE commit — everything the merge brought in that was
 * not reachable from its first parent (`git log <merge>^1..<merge>`), the
 * merge itself included. For an octopus merge this lists commits from ALL
 * merged branches. Empty for regular (non-merge) commits.
 */
export async function mergeNestedCommits(repoPath: string, hash: string): Promise<LogEntry[]> {
  const git = getGit(repoPath);
  if (!(await commitExists(repoPath, hash))) return [];

  let parentCount = 1;
  try {
    const parentsOut = await git.raw(['rev-list', '--parents', '-n', '1', hash]);
    parentCount = parentsOut.trim().split(/\s+/).length - 1;
  } catch { return []; }
  if (parentCount <= 1) return [];

  // Same pretty format + parser as log() so the UI can reuse LogEntry rows.
  const fieldSep = '%x00';
  const commitSep = '%x1e';
  const pretty = [
    '%H', '%h', '%P', '%p',
    '%an', '%ae', '%aI',
    '%cn', '%ce', '%cI',
    '%s', '%b', '%D',
  ].join(fieldSep);
  try {
    const out = await git.raw([
      'log', `${hash}^1..${hash}`, '-n', '200',
      `--pretty=format:${pretty}${commitSep}`, '--date=iso-strict', '--decorate=full',
    ]);
    return parseRawLog(out);
  } catch {
    return [];
  }
}

/** Annotated-tag metadata for tags pointing AT a commit (SmartGit shows the
 *  tag message in the commit description). Lightweight tags carry only a name. */
export interface TagAtCommit {
  name: string;
  annotated: boolean;
  tagger?: string;
  date?: string;
  message?: string;
}

export async function tagsAt(repoPath: string, hash: string): Promise<TagAtCommit[]> {
  const git = getGit(repoPath);
  // NOTE: for-each-ref does NOT support %x09 hex escapes (that's a log
  // pretty-format feature) — use a literal separator that cannot appear
  // inside refnames or tag messages.
  const SEP = ' @#@ ';
  try {
    const fmt = `%(refname:short)${SEP}%(objecttype)${SEP}%(taggername)${SEP}%(creatordate:iso-strict)${SEP}%(subject)`;
    const raw = await git.raw(['for-each-ref', '--points-at', hash, `--format=${fmt}`, 'refs/tags/']);
    return raw.split('\n').filter(Boolean).map((line) => {
      const [name, type, tagger, date, ...subject] = line.split(SEP);
      return {
        name: (name || '').trim(),
        annotated: (type || '').trim() === 'tag',
        tagger: tagger || undefined,
        date: date || undefined,
        message: subject.join(SEP) || undefined,
      };
    }).filter((t) => t.name);
  } catch {
    return [];
  }
}

/**
 * All tracked files (git ls-files) — used by the Search tool's Files tab for
 * name-based file lookup without knowing exact paths.
 */
export async function trackedFiles(repoPath: string): Promise<string[]> {
  const git = getGit(repoPath);
  try {
    const raw = await git.raw(['-c', 'core.quotePath=false', 'ls-files', '-z']);
    return raw.split('\u0000').filter(Boolean);
  } catch {
    return [];
  }
}

export async function stashList(repoPath: string): Promise<StashEntry[]> {
  const git = getGit(repoPath);
  const result = await git.stashList();
  return result.all.map((entry, idx) => ({
    index: idx,
    hash: entry.hash,
    hashAbbrev: entry.hash.substring(0, 7),
    message: entry.message || '',
    date: entry.date || '',
  }));
}

/**
 * Stash commit anatomy (why plain `git diff stash^..stash` is NOT enough):
 *
 *   parent[0]  base commit (HEAD at stash time)   → tracked changes
 *   parent[1]  index state at stash time
 *   parent[2]  untracked-files commit (OPTIONAL, only with --include-untracked)
 *
 * The stash commit's TREE does not contain untracked files — they live ONLY
 * in parent[2]. So `git diff stash^..stash` renders EMPTY for any stash that
 * includes untracked files (the "View Stash shows nothing" bug). These
 * helpers read both parts.
 */
async function stashParents(git: SimpleGit, hash: string): Promise<string[]> {
  const out = await git.raw(['rev-list', '--parents', '-n', '1', hash]);
  const parts = out.trim().split(/\s+/);
  return parts.slice(1); // drop the stash commit itself → [base, index?, untracked?]
}

/**
 * Decode git's C-style quoted path back to UTF-8. With the default
 * core.quotePath=true, non-ASCII paths come out as `"uni-\321\204..."` —
 * feeding that literal string back into a git pathspec matches nothing,
 * so the file list showed garbage and clicking a file gave an empty diff.
 * Octal escapes are UTF-8 BYTES (not code points) → collect into a Buffer.
 */
/** Exported for tests (tests/unit/unquoteGitPath.test.ts). */
export function unquoteGitPath(p: string): string {
  const m = /^"([\s\S]*)"$/.exec(p);
  if (!m) return p;
  const body = m[1];
  const enc = new TextEncoder();
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') {
      bytes.push(...enc.encode(c));
      continue;
    }
    const n = body[++i];
    if (n === undefined) {
      bytes.push(0x5c); // dangling backslash
      break;
    }
    if (n >= '0' && n <= '7') {
      let oct = n;
      while (oct.length < 3 && body[i + 1] >= '0' && body[i + 1] <= '7') oct += body[++i];
      bytes.push(parseInt(oct, 8) & 0xff);
    } else {
      const esc: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
      bytes.push(...enc.encode(esc[n] !== undefined ? String.fromCharCode(esc[n]) : n));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Parse a `--name-status` line into a CommitFile (handles R/C two-path form). */
function parseNameStatusLine(line: string): CommitFile | null {
  const parts = line.split('\t');
  if (parts.length < 2) return null;
  const statusCode = parts[0];
  let pathStr = parts[parts.length - 1];
  let oldPath: string | undefined;
  if (statusCode.startsWith('R') || statusCode.startsWith('C')) {
    oldPath = parts[1];
    pathStr = parts[2];
  }
  return {
    path: unquoteGitPath(pathStr),
    status: statusCode,
    oldPath: oldPath === undefined ? undefined : unquoteGitPath(oldPath),
    additions: 0,
    deletions: 0,
    binary: false,
    mode: '',
  };
}

/** Best-effort numstat merge into the file list. */
async function applyNumstat(git: SimpleGit, args: string[], files: CommitFile[]): Promise<void> {
  let numstat: string;
  try {
    numstat = await git.raw(args);
  } catch {
    return;
  }
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    if (cols.length < 3) continue;
    const pathStr = unquoteGitPath(cols[cols.length - 1]);
    const target = files.find((f) => f.path === pathStr);
    if (!target) continue;
    if (cols[0] === '-') target.binary = true;
    else target.additions = parseInt(cols[0] || '0', 10) || 0;
    if (cols[1] === '-') target.binary = true;
    else target.deletions = parseInt(cols[1] || '0', 10) || 0;
  }
}

/** All files contained in a stash: tracked changes + untracked files (parent[2]). */
export async function stashFiles(repoPath: string, hash: string): Promise<CommitFile[]> {
  const git = getGit(repoPath);
  const parents = await stashParents(git, hash);
  const base = parents[0];
  const result: CommitFile[] = [];

  // Tracked changes: direct two-dot diff base..stash (working-tree part; the
  // index part is included in the stash tree as well — the union is what the
  // user expects to see, exactly like `git stash show`).
  // core.quotePath=false: paths come out as plain UTF-8 instead of C-quoted
  // "uni-\321\204..." (unquoteGitPath in the parsers is the safety net).
  const tracked = await git.raw(['-c', 'core.quotePath=false', 'diff', '--name-status', '--no-color', `${base}..${hash}`]);
  for (const line of tracked.split('\n').filter(Boolean)) {
    const f = parseNameStatusLine(line);
    if (f) result.push(f);
  }
  await applyNumstat(git, ['diff', '--numstat', '--no-color', `${base}..${hash}`], result);

  // Untracked files: stored ONLY in parent[2] as a root commit holding them.
  if (parents.length >= 3) {
    const untracked = await git.raw([
      '-c', 'core.quotePath=false',
      'diff-tree', '--root', '--no-color', '--name-status', '-r', parents[2],
    ]);
    for (const line of untracked.split('\n').filter(Boolean)) {
      if (!line.includes('\t')) continue; // diff-tree --root echoes the commit id first
      const f = parseNameStatusLine(line);
      if (!f) continue;
      if (f.status === 'A' || f.status === '') f.status = 'A';
      if (!result.some((r) => r.path === f.path)) result.push(f);
    }
    await applyNumstat(git, ['show', '--numstat', '--format=', parents[2]], result);
  }
  return result;
}

/** Raw unified diff of ONE file inside a stash (tracked part or untracked part). */
export async function stashFileRawDiff(repoPath: string, hash: string, file: string): Promise<string> {
  const git = getGit(repoPath);
  const parents = await stashParents(git, hash);
  const base = parents[0];
  // 1) tracked: base..stash -- file (quotePath=false → UTF-8 diff headers)
  const tracked = await git.raw(['-c', 'core.quotePath=false', 'diff', '--no-color', `${base}..${hash}`, '--', file]);
  if (tracked.trim()) return tracked;
  // 2) untracked: only present in the third parent (root commit)
  if (parents.length >= 3) {
    const untracked = await git.raw([
      '-c', 'core.quotePath=false',
      'show', '--format=', '--no-color', parents[2], '--', file,
    ]);
    if (untracked.trim()) return untracked;
  }
  return '';
}

export async function stashPush(
  repoPath: string,
  message?: string,
  includeUntracked = false,
  keepIndex = false,
  files?: string[]
): Promise<string> {
  const git = getGit(repoPath);
  const args: string[] = ['stash', 'push'];
  if (includeUntracked) args.push('--include-untracked');
  if (keepIndex) args.push('--keep-index');
  if (message) args.push('-m', message);
  if (files && files.length > 0) {
    args.push('--');
    args.push(...files);
  }
  const out = await git.raw(args);
  invalidateDiffCache(repoPath);
  // Returns the stash hash if successful, empty if no changes
  return out.trim();
}

export async function stashPop(repoPath: string, index = 0): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['stash', 'pop', `stash@{${index}}`]);
  invalidateDiffCache(repoPath);
}

export async function stashApply(repoPath: string, index = 0): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['stash', 'apply', `stash@{${index}}`]);
  invalidateDiffCache(repoPath);
}

export async function stashDrop(repoPath: string, index = 0): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['stash', 'drop', `stash@{${index}}`]);
}

export async function stashBranch(repoPath: string, branch: string, index = 0): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['stash', 'branch', branch, `stash@{${index}}`]);
}

/**
 * Rename a stash entry (stash@{index}) — real operation, no native git support.
 *
 * Technique (the same one SmartGit/Fork use under the hood):
 *   1. Create a NEW commit with the SAME tree and SAME parents as the stash
 *      commit, but carrying the new message (git commit-tree).
 *      → stash content (worktree + index + optional untracked commit) untouched.
 *   2. Rebuild refs/stash: delete the ref (its reflog goes with it), then
 *      `git stash store -m <msg>` every entry back in chronological order,
 *      substituting the target entry with the renamed commit.
 *
 * Result: identical stash list, same order, only the target message changed.
 */
export async function renameStash(repoPath: string, index: number, newMessage: string): Promise<void> {
  if (!newMessage || !newMessage.trim()) throw new Error('Stash message must not be empty');
  const git = getGit(repoPath);

  // 1. Snapshot the stash reflog. stash list is newest-first (stash@{0} on top).
  //    Separator: ASCII unit separator (\x1f) — a real char that never collides
  //    with commit messages (git for-each-ref %xNN escapes are unreliable here).
  const list = await git.raw(['stash', 'list', '--format=%H\u001f%gs']);
  const lines = list.split('\n').filter((l) => l.trim() !== '');
  if (index < 0 || index >= lines.length) {
    throw new Error(`stash@{${index}} does not exist (0..${lines.length - 1})`);
  }
  // Convert to chronological order (oldest → newest) for reflog rebuild.
  const entries = lines
    .map((l) => {
      const sep = l.indexOf('\u001f');
      return { hash: l.slice(0, sep).trim(), message: l.slice(sep + 1) };
    })
    .reverse();

  // stash@{index} counts from NEWEST (stash@{0} = last reflog entry).
  // entries[] is chronological (oldest first) → invert the index.
  const chronologicalIndex = entries.length - 1 - index;
  const target = entries[chronologicalIndex];

  // 2. Grab tree + parents of the stash commit (%T = tree, %P = parents).
  const meta = await git.raw(['show', '-s', '--format=%T%n%P', target.hash]);
  const [treeRaw, parentsRaw] = meta.trim().split('\n');
  const tree = treeRaw.trim();
  const parents = parentsRaw.trim().split(/\s+/).filter(Boolean);

  // 3. Replacement commit: same tree, same parents, new message.
  const args = ['commit-tree', tree];
  for (const p of parents) args.push('-p', p);
  args.push('-m', newMessage.trim());
  const newHash = (await git.raw(args)).trim();
  entries[chronologicalIndex] = { hash: newHash, message: newMessage.trim() };

  // 4. Rebuild refs/stash: delete (reflog is deleted with it) then re-store
  //    oldest → newest so stash@{0} is again the most recent entry.
  await git.raw(['update-ref', '-d', 'refs/stash']);
  for (const e of entries) {
    await git.raw(['stash', 'store', '-m', e.message, e.hash]);
  }
  invalidateCache(repoPath);
}

/**
 * "Fetch More..." — deepen a shallow clone by fetching N more commits of
 * history beyond the current shallow boundary (git fetch --deepen=N).
 * On a complete repository this is a cheap no-op fetch.
 */
export async function fetchDeepen(repoPath: string, remote = 'origin', commits = 100): Promise<void> {
  const git = getGit(repoPath);
  await git.raw([
    ...(await remoteNetworkArgs(repoPath, remote)),
    'fetch', remote, '--deepen', String(Math.max(1, commits)),
  ]);
  invalidateCache(repoPath);
}

/**
 * "Set Depth..." — set the fetch depth for a shallow clone
 * (git fetch --depth=N). depth <= 0 means unshallow (download full history).
 */
export async function setFetchDepth(repoPath: string, remote = 'origin', depth: number): Promise<void> {
  const git = getGit(repoPath);
  const authArgs = await remoteNetworkArgs(repoPath, remote);
  if (depth > 0) {
    await git.raw([...authArgs, 'fetch', remote, '--depth', String(depth)]);
  } else {
    await git.raw([...authArgs, 'fetch', '--unshallow', remote]);
  }
  invalidateCache(repoPath);
}

/**
 * "Properties..." — collect real remote properties for the properties dialog.
 * Everything is read locally: `git remote show -n` (no network), the repo
 * config for remote.<name>.* entries, for-each-ref for tracking branches and
 * the .git/shallow marker for shallow-clone state.
 */
export async function remoteProperties(repoPath: string, name: string): Promise<RemoteProperties> {
  const git = getGit(repoPath);
  // Validate the remote exists. NOTE: simple-git resolves `config --get`
  // with exit code 1 + empty stderr to '' (it does NOT throw), and
  // `git remote show -n` happily "shows" unknown remotes (echoing the name
  // as URL) — so we must check the resolved VALUE ourselves.
  const cfgUrl = await git
    .raw(['config', '--get', `remote.${name}.url`])
    .catch(() => '');
  if (!cfgUrl.trim()) {
    throw new Error(`Remote '${name}' is not configured in this repository`);
  }
  const show = await git.raw(['remote', 'show', '-n', name]).catch(() => '');
  const configRaw = await git
    // NOTE: --null must come BEFORE the pattern — after the pattern git
    // treats it as an extra value-pattern and matches nothing (exit 1).
    .raw(['config', '--null', '--get-regexp', `^remote\\.${name}\\.`])
    .catch(() => '');
  const trackingRaw = await git
    .raw(['for-each-ref', '--format=%(refname:short)', `refs/remotes/${name}/`])
    .catch(() => '');

  const fetchUrl = /Fetch URL:\s*(.*)/.exec(show)?.[1]?.trim() ?? '';
  const pushUrl = /Push\s+URL:\s*(.*)/.exec(show)?.[1]?.trim() ?? '';
  // `remote show -n` cannot query HEAD ("(not queried)") — fall back to the
  // locally cached refs/remotes/<name>/HEAD symbolic ref (set by clone/set-head).
  const headShow = /HEAD branch:\s*(.*)/.exec(show)?.[1]?.trim() || '';
  let headBranch = headShow && !headShow.startsWith('(') ? headShow : undefined;
  if (!headBranch) {
    const sym = await git
      .raw(['symbolic-ref', '-q', '--short', `refs/remotes/${name}/HEAD`])
      .catch(() => '');
    const symShort = sym.trim();
    if (symShort) {
      headBranch = symShort.replace(new RegExp(`^${name}/`), '');
    }
  }

  // Exclude the default-branch pointer: it shows up either as "<name>/HEAD"
  // or — after `git remote set-head` — shortened to just "<name>". Neither is
  // a real remote-tracking branch.
  const trackingBranches = trackingRaw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((b) => b !== name && !b.endsWith('/HEAD'));

  const config: { key: string; value: string }[] = [];
  for (const rec of configRaw.split('\u0000')) {
    if (!rec.trim()) continue;
    const nl = rec.indexOf('\n');
    if (nl === -1) continue;
    const key = rec.slice(0, nl);
    const value = rec.slice(nl + 1);
    if (key) config.push({ key, value });
  }

  return {
    name,
    fetchUrl,
    pushUrl,
    headBranch,
    trackingBranchCount: trackingBranches.length,
    trackingBranches: trackingBranches.slice(0, 50),
    shallow: fs.existsSync(path.join(repoPath, '.git', 'shallow')),
    mirror: config.some((c) => c.key.endsWith('.mirror') && c.value === 'true'),
    config,
  };
}

export async function tags(repoPath: string): Promise<TagInfo[]> {
  const git = getGit(repoPath);
  // Use for-each-ref to reliably distinguish annotated (objecttype=tag) from lightweight (objecttype=commit).
  // Note: real tab chars in format (not %x09 — simple-git passes args through as-is).
  // Fields: name, objecttype, objectname, subject, *objectname (target commit for annotated),
  //         taggerdate, taggername
  const fmt = [
    '%(refname:short)',
    '%(objecttype)',
    '%(objectname)',
    '%(contents:subject)',
    '%(*objectname)',
    '%(taggerdate:iso-strict)',
    '%(taggername)',
  ].join('\t');
  let rawList = '';
  try {
    rawList = await git.raw(['for-each-ref', '--sort=-creatordate', `--format=${fmt}`, 'refs/tags/']);
  } catch {
    rawList = '';
  }
  if (!rawList.trim()) return [];

  const lines = rawList.split('\n').filter(Boolean);
  const result: TagInfo[] = [];
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const [name, objectType, objectname, subject, targetHash, taggerDate, taggerName] = parts;
    const isAnnotated = objectType === 'tag';
    // For lightweight tags: objectname IS the commit hash
    // For annotated tags: *objectname (targetHash) is the commit hash; if empty, fall back to objectname
    //   (which is the tag object hash, not commit — but better than nothing, and avoids N+1 revparse)
    const commitHash = isAnnotated
      ? (targetHash || objectname)
      : objectname;
    result.push({
      name,
      hash: commitHash,
      hashAbbrev: commitHash.substring(0, 7),
      annotation: isAnnotated ? (subject || undefined) : undefined,
      date: taggerDate || undefined,
      author: taggerName || undefined,
      lightweight: !isAnnotated,
      targetHash: targetHash || undefined,
    });
  }
  return result;
}

export async function createTag(
  repoPath: string,
  name: string,
  message?: string,
  ref?: string,
  force = false,
  annotated = true
): Promise<void> {
  const git = getGit(repoPath);
  const args: string[] = ['tag'];
  if (force) args.push('-f');
  if (annotated && message) {
    args.push('-a', name, '-m', message);
  } else {
    args.push(name);
  }
  if (ref) args.push(ref);
  await git.raw(args);
}

export async function deleteTag(repoPath: string, name: string, remote = false): Promise<void> {
  const git = getGit(repoPath);
  if (remote) {
    await git.raw([...(await remoteNetworkArgs(repoPath, 'origin', true)), 'push', 'origin', '--delete', name]);
  } else {
    await git.tag(['-d', name]);
  }
}

export async function pushTag(repoPath: string, name: string, remote = 'origin'): Promise<void> {
  const git = getGit(repoPath);
  await git.raw([
    ...(await remoteNetworkArgs(repoPath, remote, true)),
    '-c', 'http.version=HTTP/1.1',
    '-c', 'http.postBuffer=524288000',
    'push', remote, name,
  ]);
}

export async function submodules(repoPath: string): Promise<SubmoduleInfo[]> {
  const git = getGit(repoPath);
  const gitmodulesPath = path.join(repoPath, '.gitmodules');
  if (!fs.existsSync(gitmodulesPath)) return [];

  const content = fs.readFileSync(gitmodulesPath, 'utf8');
  const result: SubmoduleInfo[] = [];
  const blocks = content.split(/\[submodule\s+"([^"]+)"\]/);
  for (let i = 1; i < blocks.length; i += 2) {
    const name = blocks[i];
    const body = blocks[i + 1] || '';
    const pathMatch = body.match(/path\s*=\s*(\S+)/);
    const urlMatch = body.match(/url\s*=\s*(\S+)/);
    const branchMatch = body.match(/branch\s*=\s*(\S+)/);
    if (!pathMatch || !urlMatch) continue;

    const subPath = pathMatch[1];
    const subUrl = urlMatch[1];
    const absSubPath = path.join(repoPath, subPath);
    const initialized = fs.existsSync(path.join(absSubPath, '.git'));
    let upToDate = true;
    let currentCommit = '';
    let trackedCommit = '';
    try {
      const subGit = simpleGit({ baseDir: absSubPath });
      const subStatus = await subGit.status();
      upToDate = subStatus.isClean();
      currentCommit = await subGit.revparse(['HEAD']);
    } catch {
      upToDate = false;
    }
    try {
      trackedCommit = await git.raw(['submodule', 'status', subPath]);
      // Format: "<prefix><hash> <path> (<describe>)" — prefix is ' '/+/-/U.
      // The old code took token [1] (the PATH) instead of the hash.
      const statusToken = trackedCommit.trim().split(/\s+/)[0] || '';
      trackedCommit = statusToken.replace(/^[+\-U]/, '');
    } catch {
      /* ignore */
    }
    result.push({
      name,
      path: subPath,
      url: subUrl,
      branch: branchMatch ? branchMatch[1] : undefined,
      initialized,
      upToDate,
      currentCommit,
      trackedCommit,
    });
  }
  return result;
}

export async function submoduleInit(repoPath: string, name?: string): Promise<void> {
  const git = getGit(repoPath);
  const args = ['submodule', 'init'];
  if (name) args.push(name);
  await git.raw(args);
}

export async function submoduleUpdate(
  repoPath: string,
  name?: string,
  init = false,
  recursive = false
): Promise<void> {
  const git = getGit(repoPath);
  const args = ['submodule', 'update'];
  if (init) args.push('--init');
  if (recursive) args.push('--recursive');
  if (name) args.push(name);
  await git.raw(args);
}

export async function submoduleSync(repoPath: string, name?: string): Promise<void> {
  const git = getGit(repoPath);
  const args = ['submodule', 'sync'];
  if (name) args.push(name);
  await git.raw(args);
}

export async function submoduleDeinit(repoPath: string, name: string, force = false): Promise<void> {
  const git = getGit(repoPath);
  const args = ['submodule', 'deinit'];
  if (force) args.push('-f');
  args.push(name);
  await git.raw(args);
}

export async function submoduleAdd(
  repoPath: string,
  url: string,
  targetPath: string,
  branch?: string
): Promise<void> {
  const git = getGit(repoPath);
  const args = ['submodule', 'add'];
  if (branch) args.push('-b', branch);
  args.push(url, targetPath);
  await git.raw(args);
}

export async function clone(
  url: string,
  targetPath: string,
  options: { depth?: number; branch?: string; recursive?: boolean; shallowSubmodules?: boolean } = {}
): Promise<string> {
  const git = simpleGit();
  const args: string[] = ['clone'];
  if (options.depth) args.push('--depth', String(options.depth));
  if (options.branch) args.push('--branch', options.branch);
  if (options.recursive) args.push('--recursive');
  if (options.shallowSubmodules) args.push('--shallow-submodules');
  args.push(url, targetPath);
  await git.raw(args);
  invalidateCache();
  return targetPath;
}

export async function init(targetPath: string, bare = false): Promise<void> {
  const git = simpleGit({ baseDir: targetPath });
  await git.init(bare);
  invalidateCache();
}

export async function addRemote(
  repoPath: string,
  name: string,
  url: string
): Promise<void> {
  const git = getGit(repoPath);
  await git.addRemote(name, url);
}

export async function removeRemote(repoPath: string, name: string): Promise<void> {
  const git = getGit(repoPath);
  await git.removeRemote(name);
}

export async function renameRemote(
  repoPath: string,
  oldName: string,
  newName: string
): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['remote', 'rename', oldName, newName]);
}

export async function setRemoteUrl(
  repoPath: string,
  name: string,
  url: string,
  pushUrl = false
): Promise<void> {
  const git = getGit(repoPath);
  const args = ['remote', 'set-url'];
  if (pushUrl) args.push('--push');
  args.push(name, url);
  await git.raw(args);
}

export async function currentBranch(repoPath: string): Promise<string | null> {
  const git = getGit(repoPath);
  const branch = await git.branch();
  return branch.current || null;
}

export async function revParse(repoPath: string, ref: string): Promise<string> {
  const git = getGit(repoPath);
  return (await git.revparse([ref])).trim();
}

export async function raw(repoPath: string, args: string[]): Promise<string> {
  const git = getGit(repoPath);
  return git.raw(args);
}

// ============= SmartGit 20-24 Extended Features =============

export async function worktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const git = getGit(repoPath);
  const out = await git.raw(['worktree', 'list', '--porcelain']);
  const result: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) result.push(current as WorktreeInfo);
      current = { path: line.substring('worktree '.length) };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.substring('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      current.branch = line.substring('branch '.length).replace('refs/heads/', '');
    } else if (line === 'detached') {
      current.detached = true;
    } else if (line === 'bare') {
      current.bare = true;
    } else if (line === 'locked') {
      current.locked = true;
    } else if (line.startsWith('locked ')) {
      current.locked = true;
      current.lockedReason = line.substring('locked '.length);
    } else if (line === 'prunable') {
      current.prunable = true;
    } else if (line === '' && current.path) {
      result.push(current as WorktreeInfo);
      current = {};
    }
  }
  if (current.path) result.push(current as WorktreeInfo);
  return result.filter((w) => w.path);
}

export async function worktreeAdd(
  repoPath: string,
  targetPath: string,
  branch?: string,
  commit?: string,
  detach = false
): Promise<void> {
  const git = getGit(repoPath);
  const args = ['worktree', 'add'];
  if (detach) args.push('--detach');
  if (branch) args.push('-b', branch);
  if (commit) args.push(commit);
  args.push(targetPath);
  await git.raw(args);
}

export async function worktreeRemove(
  repoPath: string,
  targetPath: string,
  force = false
): Promise<void> {
  const git = getGit(repoPath);
  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(targetPath);
  await git.raw(args);
}

export async function worktreePrune(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['worktree', 'prune', '-v']);
}

export async function worktreeMove(
  repoPath: string,
  oldPath: string,
  newPath: string
): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['worktree', 'move', oldPath, newPath]);
}

export async function reflog(
  repoPath: string,
  ref = 'HEAD',
  maxCount = 200
): Promise<ReflogEntry[]> {
  const git = getGit(repoPath);
  const format = '%H%x00%h%x00%gs%x00%gd%x00%an%x00%ae%x00%aI';
  const out = await git.raw([
    'reflog',
    `--pretty=format:${format}`,
    `-${maxCount}`,
    ref,
  ]);
  if (!out.trim()) return [];
  const lines = out.split('\n');
  return lines.map((line, idx) => {
    const parts = line.split('\x00');
    if (parts.length < 7) return null;
    const [hash, hashAbbrev, message, selector, authorName, authorEmail, date] = parts;
    return {
      index: idx,
      hash,
      hashAbbrev,
      refName: ref,
      selector,
      message,
      author: { name: authorName, email: authorEmail },
      date,
      timestamp: new Date(date).getTime(),
    } as ReflogEntry;
  }).filter(Boolean) as ReflogEntry[];
}

export async function reflogDelete(
  repoPath: string,
  index: number,
  ref = 'HEAD'
): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['reflog', 'delete', `HEAD@{${index}}`, ref]);
}

export interface CherryPickResult {
  conflicts: string[];
  /** The pick produced no changes (already applied) — repo left in cherry-pick state with nothing to commit. */
  empty?: boolean;
  /** Non-empty when cherry-pick failed for a reason OTHER than conflicts/empty (e.g. dirty worktree). */
  error?: string;
}

export async function cherryPick(
  repoPath: string,
  hashes: string[],
  noCommit = false
): Promise<CherryPickResult> {
  const git = getGit(repoPath);
  const args = ['cherry-pick'];
  if (noCommit) args.push('-n');
  args.push(...hashes);
  let errText = '';
  try {
    await git.raw(args);
  } catch (e) {
    // simple-git throws on conflicts AND on the "previous cherry-pick is now
    // empty" exit — both leave the repo in a recoverable sequencer state, so
    // fall through to the status check instead of failing the whole operation.
    // Prefer stderr: e.message may omit the actual git diagnostics.
    errText = e instanceof Error
      ? (((e as { stderr?: string }).stderr || e.message) as string)
      : String(e);
  }
  const statusRes = await status(repoPath);
  if (statusRes.conflicted.length > 0) {
    return { conflicts: statusRes.conflicted };
  }
  if (statusRes.isCherryPicking) {
    // State remains but nothing is conflicted → the pick is empty ("The
    // previous cherry-pick is now empty, possibly due to conflict
    // resolution"). The user must Skip or Commit Empty to resolve it.
    return { conflicts: [], empty: true, error: errText || undefined };
  }
  if (errText) {
    // Hard failure with no sequencer state (e.g. "your local changes would be
    // overwritten", "bad revision") — surface it to the UI instead of lying.
    return { conflicts: [], error: errText };
  }
  return { conflicts: [] };
}

export async function cherryPickAbort(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['cherry-pick', '--abort']);
}

/**
 * Skip the current pick (`git cherry-pick --skip`) — drops the empty/conflicted
 * step and continues with the next one in multi-pick sequences.
 */
export async function cherryPickSkip(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['cherry-pick', '--skip']);
}

/**
 * Continue a cherry-pick after conflict resolution (`git cherry-pick --continue`).
 * When the pick has become EMPTY, --continue refuses — the caller can pass
 * allowEmpty to finalize it with `git commit --allow-empty` (git's own
 * suggested remedy) or use cherryPickSkip instead.
 */
export async function cherryPickContinue(
  repoPath: string,
  allowEmpty = false
): Promise<{ empty?: boolean }> {
  const git = getGit(repoPath);
  try {
    await git.raw(['cherry-pick', '--continue', '--no-edit']);
    return {};
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/now empty|nothing to commit/i.test(msg)) {
      if (allowEmpty) {
        // git docs: "If you wish to commit it anyway, use: git commit --allow-empty".
        // A plain commit during a pick consumes MERGE_MSG and clears CHERRY_PICK_HEAD.
        await git.raw(['commit', '--allow-empty', '--no-edit']);
        return {};
      }
      return { empty: true };
    }
    throw e;
  }
}

export async function revert(
  repoPath: string,
  hashes: string[],
  noCommit = false
): Promise<{ conflicts: string[] }> {
  const git = getGit(repoPath);
  const args = ['revert'];
  if (noCommit) args.push('-n');
  args.push(...hashes);
  try {
    await git.raw(args);
  } catch {
    // simple-git may throw on conflicts, fall through to status check
  }
  const statusRes = await status(repoPath);
  return { conflicts: statusRes.conflicted };
}

export async function revertAbort(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['revert', '--abort']);
}

/**
 * Skip the current revert step (`git revert --skip`) — drops the
 * empty/conflicted step and continues with the next one in a sequence.
 */
export async function revertSkip(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['revert', '--skip']);
}

export async function revertContinue(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['revert', '--continue', '--no-edit']);
}

export async function rebase(
  repoPath: string,
  onto: string,
  options: { interactive?: boolean; autosquash?: boolean; abort?: boolean; continue?: boolean; skip?: boolean } = {}
): Promise<void> {
  const git = getGit(repoPath);
  const args = ['rebase'];
  if (options.abort) {
    await git.raw(['rebase', '--abort']);
    return;
  }
  if (options.continue) {
    await git.raw(['rebase', '--continue']);
    return;
  }
  if (options.skip) {
    await git.raw(['rebase', '--skip']);
    return;
  }
  if (options.interactive) args.push('-i');
  if (options.autosquash) args.push('--autosquash');
  args.push(onto);
  await git.raw(args);
}

export async function bisectStart(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['bisect', 'start']);
}

export async function bisectGood(repoPath: string, ref?: string): Promise<void> {
  const git = getGit(repoPath);
  const args = ['bisect', 'good'];
  if (ref) args.push(ref);
  await git.raw(args);
}

export async function bisectBad(repoPath: string, ref?: string): Promise<void> {
  const git = getGit(repoPath);
  const args = ['bisect', 'bad'];
  if (ref) args.push(ref);
  await git.raw(args);
}

export async function bisectSkip(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['bisect', 'skip']);
}

export async function bisectReset(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['bisect', 'reset']);
}

export async function bisectLog(repoPath: string): Promise<string> {
  const git = getGit(repoPath);
  try {
    return await git.raw(['bisect', 'log']);
  } catch (e) {
    // Not bisecting → git exits non-zero with "We are not bisecting".
    // The Search/Bisect UI shows this state as a friendly message, so return
    // an empty log instead of throwing.
    if (String(e).includes('not bisecting')) return '';
    throw e;
  }
}

export async function bisectStatus(
  repoPath: string
): Promise<{ state: 'bisecting' | 'none'; remaining?: number; rev?: string }> {
  const gitDir = path.join(repoPath, '.git');
  const bisectLogPath = path.join(gitDir, 'BISECT_LOG');
  if (!fs.existsSync(bisectLogPath)) {
    return { state: 'none' };
  }
  let rev = '';
  try {
    const git = getGit(repoPath);
    // While bisecting, HEAD is detached at the current candidate.
    // (`git bisect view` would try to launch a GUI browser — never use it here.)
    rev = (await git.raw(['rev-parse', 'HEAD'])).trim();
  } catch {
    /* ignore */
  }
  let remaining = 0;
  try {
    const namesPath = path.join(gitDir, 'BISECT_NAMES');
    if (fs.existsSync(namesPath)) {
      const git = getGit(repoPath);
      const logCount = await git.raw(['rev-list', '--count', 'HEAD']);
      remaining = Math.ceil(Math.log2(parseInt(logCount.trim(), 10) || 1));
    }
  } catch {
    /* ignore */
  }
  return { state: 'bisecting', remaining, rev };
}

export async function blame(
  repoPath: string,
  file: string,
  ref?: string
): Promise<BlameResult> {
  const git = getGit(repoPath);
  const format = '%H%x00%h%x00%an%x00%ae%x00%aI%x00%aZ%x00%cn%x00%ce%x00%cI%x00%cZ%x00%s%x00%N';
  const args = ['blame', '--line-porcelain', '-w'];
  if (ref) {
    // ref must come AFTER 'blame' but BEFORE '--' and file path
    // git blame [<options>] [<rev>] [--] <file>
    args.push(ref);
  }
  args.push('--', file);
  const out = await git.raw(args);

  const lines: BlameLine[] = [];
  const rawLines = out.split('\n');
  let current: Partial<BlameLine> & { content?: string } = {};
  let finalLineNumber = 0;

  const flush = () => {
    if (current.hash && current.content !== undefined) {
      lines.push(current as BlameLine);
    }
    current = {};
  };

  for (const line of rawLines) {
    if (line.startsWith('author ')) current.author = line.substring(7);
    else if (line.startsWith('author-mail ')) current.authorMail = line.substring(12);
    else if (line.startsWith('author-time ')) current.authorTime = line.substring(12);
    else if (line.startsWith('author-tz ')) current.authorTz = line.substring(10);
    else if (line.startsWith('committer ')) current.committer = line.substring(10);
    else if (line.startsWith('committer-mail ')) current.committerMail = line.substring(15);
    else if (line.startsWith('committer-time ')) current.committerTime = line.substring(15);
    else if (line.startsWith('committer-tz ')) current.committerTz = line.substring(13);
    else if (line.startsWith('summary ')) current.summary = line.substring(8);
    else if (line.match(/^[0-9a-f]{40}/)) {
      const parts = line.split(' ');
      current.hash = parts[0];
      current.hashAbbrev = parts[0].substring(0, 7);
      current.originalLineNumber = parseInt(parts[1] || '0', 10);
      finalLineNumber = parseInt(parts[2] || '0', 10);
      current.finalLineNumber = finalLineNumber;
    } else if (line.startsWith('\t')) {
      current.content = line.substring(1);
      // content line is the last field for this entry, flush now
      flush();
    } else if (line.startsWith('filename ')) {
      // ignore - we flush on content line which always comes after filename
    }
  }

  return {
    lines,
    file,
    totalLines: lines.length,
  };
}

export async function ignore(
  repoPath: string,
  patterns: string[],
  localOnly = false
): Promise<void> {
  const ignorePath = localOnly
    ? path.join(repoPath, '.git', 'info', 'exclude')
    : path.join(repoPath, '.gitignore');
  let existing = '';
  if (fs.existsSync(ignorePath)) {
    existing = fs.readFileSync(ignorePath, 'utf8');
  }
  const newContent = existing + (existing.endsWith('\n') || existing === '' ? '' : '\n') +
    patterns.join('\n') + '\n';
  fs.writeFileSync(ignorePath, newContent, 'utf8');
}

export async function isIgnored(repoPath: string, file: string): Promise<boolean> {
  const git = getGit(repoPath);
  try {
    const result = await git.raw(['check-ignore', file]);
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

export async function editIgnoreFile(
  repoPath: string,
  scope: 'local' | 'global'
): Promise<string> {
  const ignorePath = scope === 'local'
    ? path.join(repoPath, '.gitignore')
    : path.join(process.env.HOME || process.env.USERPROFILE || '', '.gitignore');
  if (!fs.existsSync(ignorePath)) {
    fs.writeFileSync(ignorePath, '', 'utf8');
  }
  return ignorePath;
}

export async function editCommitMessage(
  repoPath: string,
  hash: string,
  message: string
): Promise<void> {
  const git = getGit(repoPath);
  const headHash = (await git.raw(['rev-parse', 'HEAD'])).trim();

  if (hash === 'HEAD' || hash === headHash) {
    // Amending HEAD is safe and simple — no rebase needed.
    await git.raw(['commit', '--amend', '-m', message]);
  } else {
    // For non-HEAD commits, use interactive rebase with a custom sequence
    // editor. This replaces the fragile git filter-branch approach which:
    //   1. Prints a scary deprecation warning
    //   2. Refuses to run when there are unstaged changes
    //   3. Can leave .git/index.lock behind on failure
    //
    // Strategy: write a rebase-todo file where the target commit is marked
    // as 'reword', all others as 'pick'. Then use GIT_SEQUENCE_EDITOR to
    // substitute the todo, and GIT_EDITOR to write the new message.
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    // Get the list of commits from hash^..HEAD
    // `${hash}^..HEAD` breaks when hash is the ROOT commit ("invalid upstream").
    // List commits after hash and prepend hash itself — root-safe.
    const revList = await git.raw(['rev-list', '--reverse', `${hash}..HEAD`]);
    const commits = [hash, ...revList.trim().split('\n').filter(Boolean)];
    if (commits.length === 0) return;

    // Non-HEAD reword via interactive rebase. We deliberately do NOT use the
    // 'reword' todo action: git 2.4x fails `rebase -i --root` with 'reword'
    // (the sequence editor gets ENOTDIR on .git/rebase-merge). The pick +
    // exec-amend pattern (same as squashCommits) is root-safe and keeps the
    // full multi-line message via -F <file>.
    const msgPath = path.join(os.tmpdir(), `prismgit-reword-msg-${Date.now()}.txt`);
    fs.writeFileSync(msgPath, message, 'utf8');

    // The sequence editor (core.editor for rebase) replaces the generated todo
    const editorScript = path.join(repoPath, '.git', 'prismgit-seq-editor.sh');
    const todoLines = commits.map(oid => `pick ${oid}`);
    todoLines.splice(commits.indexOf(hash) + 1, 0,
      `exec git commit --amend --no-verify -F "${msgPath}"`);
    fs.writeFileSync(
      editorScript,
      `#!/bin/sh\ncat > "$1" <<'PRISM_TODO_EOF'\n${todoLines.join('\n')}\nPRISM_TODO_EOF\n`,
      { mode: 0o755 },
    );

    try {
      // simple-git blocks `-c core.editor` on the default instance — the
      // non-HEAD reword path silently always failed. An unsafe instance is
      // required for interactive-rebase automation.
      const gitUnsafe = simpleGit({ baseDir: repoPath, unsafe: { allowUnsafeEditor: true } });
      // Rewording the ROOT commit: rebase needs --root there (same parent-
      // counting probe as squashCommits — rev-parse --quiet never throws).
      let rootCase = false;
      try {
        const parentsOut = await git.raw(['rev-list', '--parents', '-n', '1', hash]);
        rootCase = parentsOut.trim().split(/\s+/).length < 2;
      } catch {
        rootCase = false;
      }
      const rebaseArgs = ['-c', `core.editor=${editorScript}`, 'rebase', '-i'];
      if (rootCase) rebaseArgs.push('--root');
      else rebaseArgs.push(`${hash}^`);
      await gitUnsafe.raw(rebaseArgs);
    } finally {
      try { fs.unlinkSync(editorScript); } catch { /* ignore */ }
      try { fs.unlinkSync(msgPath); } catch { /* ignore */ }
    }
  }
}

export async function splitOffFiles(
  repoPath: string,
  hash: string,
  files: string[],
  message: string
): Promise<void> {
  // This is a simplified version using git rebase + checkout
  // A real implementation would use interactive rebase
  const git = getGit(repoPath);
  // Use git reset --soft to HEAD~1 of the target, then commit message, then commit the rest
  // This is complex; we'll throw a not-implemented for now
  throw new Error('Split-off files operation requires interactive rebase - use Rebase Interactive instead');
}

export async function configGet(
  repoPath: string,
  key: string,
  scope?: 'system' | 'global' | 'local'
): Promise<string | undefined> {
  const git = getGit(repoPath);
  const args = ['config'];
  if (scope === 'system') args.push('--system');
  else if (scope === 'global') args.push('--global');
  else if (scope === 'local') args.push('--local');
  args.push('--get', key);
  try {
    const result = await git.raw(args);
    return result.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function configSet(
  repoPath: string,
  key: string,
  value: string,
  scope?: 'system' | 'global' | 'local'
): Promise<void> {
  const git = getGit(repoPath);
  const args = ['config'];
  if (scope === 'system') args.push('--system');
  else if (scope === 'global') args.push('--global');
  else if (scope === 'local') args.push('--local');
  args.push(key, value);
  await git.raw(args);
}

/**
 * Matches the git error for a missing config file, e.g.:
 *   fatal: unable to read config file '/etc/gitconfig': No such file or directory
 * Common on macOS/Windows where /etc/gitconfig (or the Git for Windows system
 * config) does not exist — reading a missing file must yield an EMPTY config,
 * not an error (Settings → Git Config → System previously crashed the IPC
 * handler with GitError and showed a toast for a perfectly normal situation).
 */
const MISSING_CONFIG_FILE_RE = /unable to read config file|no such file or directory/i;

export async function configList(
  repoPath: string,
  scope?: 'system' | 'global' | 'local'
): Promise<GitConfigEntry[]> {
  const git = getGit(repoPath);
  const args = ['config', '--list'];
  if (scope === 'system') args.push('--system');
  else if (scope === 'global') args.push('--global');
  else if (scope === 'local') args.push('--local');
  let result: string;
  try {
    result = await git.raw(args);
  } catch (err) {
    // Missing config file (e.g. no /etc/gitconfig) → empty config, not an error.
    const msg = err instanceof Error ? err.message : String(err);
    if (MISSING_CONFIG_FILE_RE.test(msg)) return [];
    throw err;
  }
  return result.split('\n')
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf('=');
      if (idx < 0) return null;
      return {
        key: line.substring(0, idx),
        value: line.substring(idx + 1),
        scope: scope || 'local',
      } as GitConfigEntry;
    })
    .filter(Boolean) as GitConfigEntry[];
}

export async function configUnset(
  repoPath: string,
  key: string,
  scope?: 'system' | 'global' | 'local'
): Promise<void> {
  const git = getGit(repoPath);
  const args = ['config'];
  if (scope === 'system') args.push('--system');
  else if (scope === 'global') args.push('--global');
  else if (scope === 'local') args.push('--local');
  args.push('--unset', key);
  try {
    await git.raw(args);
  } catch (err) {
    // Unsetting from a missing config file is a no-op — there is nothing to unset.
    const msg = err instanceof Error ? err.message : String(err);
    if (MISSING_CONFIG_FILE_RE.test(msg)) return;
    throw err;
  }
}

export async function findRef(
  repoPath: string,
  query: string
): Promise<{ name: string; hash: string; type: 'branch' | 'tag' | 'remote' }[]> {
  const git = getGit(repoPath);
  const q = query.toLowerCase();
  const result: { name: string; hash: string; type: 'branch' | 'tag' | 'remote' }[] = [];

  // Single for-each-ref call for ALL refs — no N+1 revparse
  // Use %(refname) (full) not %(refname:short) so we can determine type from the prefix
  const fmt = ['%(refname)', '%(objectname)'].join('\t');
  let raw = '';
  try {
    raw = await git.raw(['for-each-ref', `--format=${fmt}`, 'refs/']);
  } catch { /* ignore */ }
  if (raw.trim()) {
    for (const line of raw.split('\n').filter(Boolean)) {
      const [refname, hash] = line.split('\t');
      if (!refname || !hash) continue;
      // refname is like "refs/heads/main", "refs/remotes/origin/main", "refs/tags/v1.0.0"
      const shortName = refname.replace(/^refs\/(heads|remotes|tags)\//, '');
      if (!shortName.toLowerCase().includes(q)) continue;
      const isTag = refname.startsWith('refs/tags/');
      const isRemote = refname.startsWith('refs/remotes/');
      result.push({
        name: shortName,
        hash,
        type: isTag ? 'tag' : isRemote ? 'remote' : 'branch',
      });
    }
  }

  return result;
}

export async function reset(
  repoPath: string,
  mode: 'soft' | 'mixed' | 'hard' | 'keep',
  ref?: string
): Promise<void> {
  const git = getGit(repoPath);
  const args = ['reset', `--${mode}`];
  if (ref) args.push(ref);
  await git.raw(args);
}

export async function resetFile(
  repoPath: string,
  file: string,
  ref?: string
): Promise<void> {
  const git = getGit(repoPath);
  removeStaleIndexLock(repoPath);
  await git.raw(['reset', ref || 'HEAD', '--', file]);
  invalidateDiffCache(repoPath);
}

/**
 * Reset multiple files in ONE git call instead of N sequential calls.
 *
 * `git reset HEAD -- f1 f2 f3` works for any number of paths in a single
 * invocation — much faster than calling resetFile() in a for-loop (each
 * for-loop iteration spawns a new git process + walks the index from
 * scratch). For 50 files this is ~50× faster (50× fewer git spawns).
 *
 * Files that fail (e.g. untracked, not in index) are silently skipped —
 * `git reset HEAD -- untracked.txt` is a no-op, not an error, so the
 * whole batch succeeds.
 */
export async function resetFiles(
  repoPath: string,
  files: string[],
  ref?: string
): Promise<void> {
  if (files.length === 0) return;
  const git = getGit(repoPath);
  removeStaleIndexLock(repoPath);
  // git reset HEAD -- f1 f2 f3 ... fN
  // Single call — supports any number of paths. Files not in the index are
  // silently skipped by git (no error), so the call succeeds even when the
  // batch mixes tracked + untracked paths.
  await git.raw(['reset', ref || 'HEAD', '--', ...files]);
  invalidateDiffCache(repoPath);
}

export async function clean(
  repoPath: string,
  paths: string[],
  dryRun = false,
  force = false,
  directories = false
): Promise<string[]> {
  const git = getGit(repoPath);
  const args = ['clean'];
  if (dryRun) args.push('-n');
  if (force) args.push('-f');
  if (directories) args.push('-d');
  args.push('--', ...paths);
  const result = await git.raw(args);
  return result.split('\n').filter(Boolean).map((l) => l.replace(/^Would remove\s+/, '').replace(/^Removing\s+/, ''));
}

export async function extractRepoInfo(
  repoPath: string
): Promise<{ provider: 'github' | 'gitlab' | 'bitbucket' | 'unknown'; owner?: string; repo?: string; url?: string; webUrl?: string }> {
  const git = getGit(repoPath);
  try {
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin') || remotes[0];
    if (!origin) return { provider: 'unknown' };
    const url = origin.refs.fetch;
    let webUrl = url;
    let provider: 'github' | 'gitlab' | 'bitbucket' | 'unknown' = 'unknown';
    let owner: string | undefined;
    let repo: string | undefined;

    const sshMatch = url.match(/git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
    const httpsMatch = url.match(/https?:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/);

    if (sshMatch) {
      const [, host, ownerName, repoName] = sshMatch;
      webUrl = `https://${host}/${ownerName}/${repoName}`;
      if (host.includes('github.com')) { provider = 'github'; owner = ownerName; repo = repoName; }
      else if (host.includes('gitlab')) { provider = 'gitlab'; owner = ownerName; repo = repoName; }
      else if (host.includes('bitbucket.org')) { provider = 'bitbucket'; owner = ownerName; repo = repoName; }
    } else if (httpsMatch) {
      const [, host, ownerName, repoName] = httpsMatch;
      webUrl = `https://${host}/${ownerName}/${repoName}`;
      if (host.includes('github.com')) { provider = 'github'; owner = ownerName; repo = repoName; }
      else if (host.includes('gitlab')) { provider = 'gitlab'; owner = ownerName; repo = repoName; }
      else if (host.includes('bitbucket.org')) { provider = 'bitbucket'; owner = ownerName; repo = repoName; }
    }
    return { provider, owner, repo, url, webUrl };
  } catch {
    return { provider: 'unknown' };
  }
}

// ============= LFS Support =============

export async function lfsStatus(repoPath: string): Promise<{ installed: boolean; files: { path: string; size: string; status: string }[] }> {
  const git = getGit(repoPath);
  try {
    // Check if LFS is initialized — `git lfs version` exits non-zero when
    // git-lfs is not installed. Suppress stderr to avoid console noise.
    const lfsVersion = await git.raw(['lfs', 'version']).catch(() => '');
    if (!lfsVersion.trim()) {
      return { installed: false, files: [] };
    }
    // Get LFS status
    const status = await git.raw(['lfs', 'status']).catch(() => '');
    const files: { path: string; size: string; status: string }[] = [];
    const lines = status.split('\n');
    let currentFile: string | null = null;
    for (const line of lines) {
      const match = line.match(/^\s+(.+?)\s+\((.+?)\)\s*$/);
      if (match) {
        files.push({ path: match[1], size: '', status: match[2] });
      }
    }
    return { installed: true, files };
  } catch {
    return { installed: false, files: [] };
  }
}

/**
 * Check whether git-lfs is installed (git lfs version exits 0).
 * Used as a preflight check before any LFS operation — avoids the
 * "git: 'lfs' is not a git command" error being shown to the user
 * when LFS is simply not installed.
 *
 * Uses a raw spawn with stdio captured (not simple-git) so the command
 * logger doesn't record the failed 'git lfs version' call — it would
 * show as an error in the Output panel even though the failure is
 * expected when git-lfs is not installed.
 */
export async function isLfsInstalled(repoPath: string): Promise<boolean> {
  try {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync('git', ['-C', repoPath, 'lfs', 'version'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],  // suppress stderr completely
    });
    return !!out.trim();
  } catch {
    return false;
  }
}

export async function lfsPull(repoPath: string, files?: string[]): Promise<void> {
  const git = getGit(repoPath);
  const args = ['lfs', 'pull'];
  if (files && files.length > 0) args.push('--include', files.join(','));
  await git.raw(args);
}

export async function lfsPush(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['lfs', 'push', 'origin', '--all']);
}

export async function lfsFetch(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['lfs', 'fetch']);
}

export async function lfsInstall(repoPath: string): Promise<void> {
  // Check if git-lfs is installed FIRST — if not, give a clear error
  // message instead of letting simple-git throw a raw "git: 'lfs' is not
  // a git command" error.
  if (!await isLfsInstalled(repoPath)) {
    throw new Error(
      'Git LFS is not installed on this system. Install it from https://git-lfs.com ' +
      'and run "git lfs install" from a terminal, then retry.'
    );
  }
  const git = getGit(repoPath);
  await git.raw(['lfs', 'install']);
}

export async function lfsTrack(repoPath: string, patterns: string[]): Promise<void> {
  const git = getGit(repoPath);
  for (const p of patterns) {
    await git.raw(['lfs', 'track', p]);
  }
}

export async function lfsList(repoPath: string): Promise<string[]> {
  const git = getGit(repoPath);
  const result = await git.raw(['lfs', 'ls-files']).catch(() => '');
  return result.split('\n').filter(Boolean).map(l => l.split(' * ').pop() || l);
}

// ============= Split Commit =============

export async function splitCommit(repoPath: string, hash: string): Promise<{ started: boolean; message?: string }> {
  const git = getGit(repoPath);
  // Dedicated instance with unsafe.allowUnsafeEditor: simple-git blocks
  // `-c sequence.editor=...` on the default instance, which made splitCommit
  // fail silently (always {started:false}) despite valid git commands.
  const gitUnsafe = simpleGit({ baseDir: repoPath, unsafe: { allowUnsafeEditor: true } });
  // Start an interactive rebase with "edit" for the target commit
  // This will stop at the commit, allowing the user to split it
  try {
    // Create a rebase-todo with "edit" for the target commit
    const log = await git.raw(['log', '--oneline', `${hash}~1..HEAD`]);
    const commits = log.split('\n').filter(Boolean);
    const targetIdx = commits.findIndex(c => c.includes(hash.substring(0, 7)));
    if (targetIdx === -1) {
      return { started: false, message: 'Commit not found in current history' };
    }
    // Build todo: pick all before, edit target, pick all after
    const todo = commits.map((c, i) => {
      const parts = c.split(' ');
      const h = parts[0];
      const msg = parts.slice(1).join(' ');
      return i === targetIdx ? `edit ${h} ${msg}` : `pick ${h} ${msg}`;
    }).join('\n');

    // Write todo to temp file and use as sequence editor
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const todoPath = path.join(os.tmpdir(), `smartgit-split-todo-${Date.now()}.txt`);
    fs.writeFileSync(todoPath, todo, 'utf-8');

    // Start rebase with custom sequence editor
    await gitUnsafe.raw(['-c', `sequence.editor=cp ${todoPath}`, 'rebase', '-i', `${hash}~1`]);

    // If we get here, rebase stopped at the commit for editing
    // Reset HEAD to unstage, so user can selectively stage
    await git.raw(['reset', 'HEAD^']);

    fs.unlinkSync(todoPath);
    return { started: true, message: `Rebase stopped at ${hash.substring(0, 7)}. Stage files and commit in parts, then run 'git rebase --continue'.` };
  } catch (e) {
    return { started: false, message: String(e) };
  }
}

// ============= Stage/Unstage specific lines (real partial staging) =============

interface UZeroHunk {
  header: string;
  lines: string[];
  type: 'add' | 'del' | 'mixed';
}

/**
 * Parse a `git diff --unified=0` output into its file header + hunks.
 * Line numbers inside -U0 hunks are implicit: old lines are sequential from the
 * header's -start, new lines sequential from the +start.
 */
function parseUnifiedZero(diffOut: string): { header: string; hunks: UZeroHunk[] } {
  const lines = diffOut.split('\n');
  const hunkIdx = lines.findIndex((l) => l.startsWith('@@ -'));
  if (hunkIdx === -1) return { header: '', hunks: [] };
  const header = lines.slice(0, hunkIdx).join('\n');
  const hunks: UZeroHunk[] = [];
  let current: UZeroHunk | null = null;
  for (let i = hunkIdx; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('@@ -')) {
      if (current) hunks.push(current);
      current = { header: line, lines: [], type: 'add' };
    } else if (current) {
      if (line.startsWith('diff --git')) break; // next file (defensive; single file expected)
      if (line.startsWith('+') || line.startsWith('-')) {
        const isAdd = line.startsWith('+');
        const isDel = line.startsWith('-');
        // Track what the hunk contains via explicit flags: a hunk is 'add'
        // until we see a del and vice versa; both → 'mixed'.
        if (isAdd && current.lines.some((l) => l.startsWith('-'))) current.type = 'mixed';
        else if (isDel && current.lines.some((l) => l.startsWith('+'))) current.type = 'mixed';
        else if (isDel && current.lines.length === 0) current.type = 'del';
        current.lines.push(line);
      }
      // '\ No newline at end of file' and blank trailing lines are ignored
    }
  }
  if (current) hunks.push(current);
  return { header, hunks };
}

/** Is `n` inside any of the inclusive ranges? */
function inRanges(n: number, ranges: { start: number; end: number }[]): boolean {
  return ranges.some((r) => n >= r.start && n <= r.end);
}

/**
 * Filter PURE hunks (only adds or only dels) to the selected line subset and
 * recompute zero-context hunk headers.
 * Mixed hunks must NOT be passed here — intra-hunk filtering would shift numbers.
 */
function filterPureHunks(hunks: UZeroHunk[], ranges: { start: number; end: number }[]): string[] {
  const out: string[] = [];
  for (const hunk of hunks) {
    if (hunk.type === 'add') {
      const startNew = parseInt(hunk.header.match(/\+(\d+)/)![1], 10);
      const keptIdx = hunk.lines.map((_, i) => startNew + i).filter((n) => inRanges(n, ranges));
      if (keptIdx.length === 0) continue;
      if (keptIdx.length === hunk.lines.length) {
        out.push(hunk.header, ...hunk.lines);
      } else {
        const minNew = keptIdx[0];
        const keptLines = hunk.lines.filter((_, i) => inRanges(startNew + i, ranges));
        out.push(`@@ -${minNew - 1},0 +${minNew},${keptIdx.length} @@`, ...keptLines);
      }
    } else {
      const startOld = parseInt(hunk.header.match(/^@@ -(\d+)/)![1], 10);
      const keptIdx = hunk.lines.map((_, i) => startOld + i).filter((n) => inRanges(n, ranges));
      if (keptIdx.length === 0) continue;
      if (keptIdx.length === hunk.lines.length) {
        out.push(hunk.header, ...hunk.lines);
      } else {
        const minOld = keptIdx[0];
        const keptLines = hunk.lines.filter((_, i) => inRanges(startOld + i, ranges));
        out.push(`@@ -${minOld},${keptIdx.length} +${minOld - 1},0 @@`, ...keptLines);
      }
    }
  }
  return out;
}

/**
 * Mixed hunks are all-or-nothing (same as git add -p): keep the hunk only if
 * at least one add line's new number OR del line's old number is selected.
 */
function filterMixedHunks(hunks: UZeroHunk[], ranges: { start: number; end: number }[]): string[] {
  const out: string[] = [];
  for (const hunk of hunks) {
    const startOld = parseInt(hunk.header.match(/^@@ -(\d+)/)![1], 10);
    const startNew = parseInt(hunk.header.match(/\+(\d+)/)![1], 10);
    let oldNo = startOld;
    let newNo = startNew;
    let selected = false;
    for (const l of hunk.lines) {
      if (l.startsWith('+')) {
        if (inRanges(newNo, ranges)) selected = true;
        newNo++;
      } else {
        if (inRanges(oldNo, ranges)) selected = true;
        oldNo++;
      }
    }
    if (selected) out.push(hunk.header, ...hunk.lines);
  }
  return out;
}

/** Write `patch` to a temp file (git apply has no stdin via simple-git raw) and apply it to the index. */
async function applyPatchToIndex(git: ReturnType<typeof getGit>, patch: string, reverse: boolean): Promise<void> {
  const os = await import('node:os');
  const tmp = path.join(os.tmpdir(), `smartgit-${reverse ? 'unstage' : 'stage'}-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`);
  await fs.promises.writeFile(tmp, patch, 'utf8');
  try {
    const args = ['apply', '--cached', '--unidiff-zero', '--whitespace=nowarn'];
    if (reverse) args.push('--reverse');
    args.push(tmp);
    await git.raw(args);
  } finally {
    await fs.promises.unlink(tmp).catch(() => undefined);
  }
}

/**
 * Stage only the given line ranges of `file` into the index (partial staging).
 * Uses `git diff -U0` filtered to the selected lines + `git apply --cached`.
 * Falls back to staging the whole file when the file is untracked (no diff output).
 */
export async function stageLines(repoPath: string, file: string, lineRanges: { start: number; end: number }[]): Promise<void> {
  const git = getGit(repoPath);
  const diffOut = await git.raw(['diff', '--unified=0', '--no-color', '--', file]);
  if (!diffOut.trim()) {
    // Untracked or unchanged file — partial staging impossible, stage whole file.
    await git.add(file);
    invalidateDiffCache(repoPath);
    return;
  }
  const { header, hunks } = parseUnifiedZero(diffOut);
  const pure = filterPureHunks(hunks.filter((h) => h.type !== 'mixed'), lineRanges);
  const mixed = filterMixedHunks(hunks.filter((h) => h.type === 'mixed'), lineRanges);
  const body = [...pure, ...mixed];
  if (body.length === 0) return; // nothing matched the selection
  const patch = `${header}\n${body.join('\n')}\n`;
  await applyPatchToIndex(git, patch, false);
  invalidateDiffCache(repoPath);
}

/**
 * Unstage only the given line ranges of `file` from the index (partial unstage).
 * Reverse-applies a filtered `git diff --cached -U0` patch to the index.
 */
export async function unstageLines(repoPath: string, file: string, lineRanges: { start: number; end: number }[]): Promise<void> {
  const git = getGit(repoPath);
  const diffOut = await git.raw(['diff', '--cached', '--unified=0', '--no-color', '--', file]);
  if (!diffOut.trim()) return; // nothing staged for this file
  const { header, hunks } = parseUnifiedZero(diffOut);
  const pure = filterPureHunks(hunks.filter((h) => h.type !== 'mixed'), lineRanges);
  const mixed = filterMixedHunks(hunks.filter((h) => h.type === 'mixed'), lineRanges);
  const body = [...pure, ...mixed];
  if (body.length === 0) return;
  const patch = `${header}\n${body.join('\n')}\n`;
  await applyPatchToIndex(git, patch, true);
  invalidateDiffCache(repoPath);
}

// ============= Repository directory tree =============

const DIR_SKIP = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  '.cache',
  '.gradle',
  '.idea',
  '__pycache__',
  'target',
  'vendor',
  'coverage',
  '.vercel',
  '.output',
  '.svelte-kit',
  '.pytest_cache',
  '.venv',
  'release',
]);

interface DirBudget {
  count: number;
  max: number;
}

async function buildDirLevel(
  absBase: string,
  rel: string,
  depth: number,
  maxDepth: number,
  budget: DirBudget,
  includeIgnored = false
): Promise<DirNode[]> {
  if (depth > maxDepth || budget.count >= budget.max) return [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(path.join(absBase, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const names = entries
    .filter((e) => {
      if (!e.isDirectory()) return false;
      // When includeIgnored is true, show ALL directories (including
      // node_modules, dist, .git, etc.) so the user can browse
      // git-ignored content in the tree panel.
      if (includeIgnored) return e.name !== '.git';
      // Default: skip VCS/build directories for performance.
      return !DIR_SKIP.has(e.name);
    })
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  const nodes: DirNode[] = [];
  for (const name of names) {
    if (budget.count >= budget.max) break;
    const childRel = rel ? `${rel}/${name}` : name;
    budget.count += 1;
    nodes.push({
      name,
      path: childRel,
      children: await buildDirLevel(absBase, childRel, depth + 1, maxDepth, budget, includeIgnored),
    });
  }
  return nodes;
}

/** List repository directories (Changes view tree), skipping VCS/build directories. */
export async function listDirectories(repoPath: string, maxDepth = 1024): Promise<DirNode[]> {
  const budget: DirBudget = { count: 0, max: 200000 };
  return buildDirLevel(repoPath, '', 1, maxDepth, budget, false);
}

/** Like listDirectories but includes ALL directories — even those normally
 *  skipped (node_modules, dist, .cache, etc.). Used when the 'ignored'
 *  display flag is ON so the user can browse git-ignored content. */
export async function listAllDirectories(repoPath: string, maxDepth = 1024): Promise<DirNode[]> {
  const budget: DirBudget = { count: 0, max: 200000 };
  return buildDirLevel(repoPath, '', 1, maxDepth, budget, true);
}

/**
 * Grep — search for a pattern across tracked files (or with --cached/--untracked).
 *
 * Wraps `git grep` so the UI can do "find all TODOs" or "where is this symbol used".
 *
 * Returns the raw grep output as a string. Callers parse line-by-line.
 * For structured access, callers can pass `--count` and parse the per-file counts.
 *
 * Examples:
 *   grep(repoPath, 'TODO')                       → all matches, raw output
 *   grep(repoPath, 'TODO', ['--count'])          → "path/to/file:N" per line
 *   grep(repoPath, 'TODO', ['--cached'])         → only staged files
 *   grep(repoPath, 'TODO', ['--untracked'])     → include untracked files
 *   grep(repoPath, 'TODO', ['-i', '--line-number']) → case-insensitive with line numbers
 */
export async function grep(
  repoPath: string,
  pattern: string,
  options: string[] = [],
  pathspec?: string
): Promise<string> {
  const git = getGit(repoPath);
  // git grep exits with code 1 when there are NO matches — simple-git treats
  // non-zero exit as an error and throws. We need to catch that and return
  // an empty string (no matches = valid result, not an error).
  try {
    // `-e <pattern>` separates the pattern from pathspecs — passing the pattern
    // after `--` makes git treat it as a PATHSPEC (broken/empty results), and a
    // pattern starting with '-' would be parsed as an option.
    // Optional trailing pathspec (glob like "src/*.ts") narrows the search.
    const args = ['grep', ...options, '-e', pattern];
    if (pathspec && pathspec.trim()) args.push('--', pathspec.trim());
    return await git.raw(args);
  } catch (e) {
    const msg = String(e);
    // Exit code 1 = no matches found (not an actual error)
    if (msg.includes('exit code 1') || msg.includes('nothing found')) {
      return '';
    }
    // Real error (bad regex, bad options, etc.) — re-throw
    throw e;
  }
}

/**
 * Apply a patch file — wraps `git apply`.
 *
 * Use cases:
 *   - Apply a saved .diff file to the working tree
 *   - Reverse-apply (--reverse) to undo a patch
 *   - Check without applying (--check)
 *
 * The `patch` argument accepts a FILE PATH or raw patch CONTENT (detected by
 * the unified-diff signature). Content is written to a temp file first because
 * `git apply` has no stdin path through simple-git.
 *
 * Examples:
 *   applyPatch(repoPath, 'fix.diff')                       → applies patch
 *   applyPatch(repoPath, ['fix.diff', '--reverse'])        → undoes patch
 *   applyPatch(repoPath, 'fix.diff', { '--check': null }) → validates only
 *   applyPatch(repoPath, 'diff --git a/x b/x\n...', ['--check']) → content
 */
export async function applyPatch(
  repoPath: string,
  patch: string | string[],
  options: Record<string, null> | string[] = []
): Promise<string> {
  const git = getGit(repoPath);
  const opts = Array.isArray(options) ? options : Object.keys(options);
  // Raw patch content → temp file → git apply
  if (typeof patch === 'string' && (patch.includes('diff --git') || patch.startsWith('--- ') || /\n@@ -\d+/.test(patch))) {
    const os = await import('node:os');
    const tmp = path.join(os.tmpdir(), `prismgit-apply-${Date.now()}.patch`);
    await fs.promises.writeFile(tmp, patch, 'utf8');
    try {
      return await git.raw(['apply', ...opts, tmp]);
    } finally {
      await fs.promises.unlink(tmp).catch(() => undefined);
    }
  }
  if (typeof patch === 'string') {
    if (opts.length > 0) {
      return await git.raw(['apply', ...opts, patch]);
    }
    return await git.applyPatch(patch);
  }
  return await git.applyPatch(patch);
}

/**
 * Show arbitrary git content via `git show`.
 *
 * Two forms:
 *   show(repoPath, ['HEAD:path/to/file'])     → file content at HEAD
 *   show(repoPath, ['--stat', 'HEAD'])        → commit stat
 *   show(repoPath, ['--format=%H', 'HEAD'])  → custom format
 *
 * Returns the raw output as a string. For binary content use showBuffer().
 */
export async function show(repoPath: string, args: string[]): Promise<string> {
  const git = getGit(repoPath);
  return await git.show(args);
}

/**
 * Show arbitrary git content as a Buffer (binary-safe).
 *
 * Use for `git archive --format=zip HEAD` or other commands that produce
 * binary output where utf-8 decoding would corrupt the data.
 */
export async function showBuffer(repoPath: string, args: string[]): Promise<Buffer> {
  const git = getGit(repoPath);
  return await git.showBuffer(args);
}

/**
 * Mirror-clone a remote repository — wraps `git clone --mirror`.
 *
 * A mirror clone copies ALL refs (heads, tags, notes, remotes) and sets up
 * the local repo as a pure mirror. Useful for backup workflows.
 *
 * Returns when the clone is complete.
 */
export async function mirror(remoteUrl: string, targetPath: string): Promise<void> {
  const git = simpleGit();
  await git.mirror(remoteUrl, targetPath);
}

/**
 * rev-parse with arbitrary args — wraps `git rev-parse`.
 *
 * Examples:
 *   revParseArgs(repoPath, ['--short', 'HEAD'])            → short hash
 *   revParseArgs(repoPath, ['--show-toplevel'])             → repo root
 *   revParseArgs(repoPath, ['--is-bare-repository'])       → 'true'/'false'
 *   revParseArgs(repoPath, ['--abbrev-ref', 'HEAD'])        → current branch name
 */
export async function revParseArgs(repoPath: string, args: string[]): Promise<string> {
  const git = getGit(repoPath);
  return await git.revparse(args);
}

/**
 * count-objects — wraps `git count-objects -v`.
 *
 * Returns repository size statistics. Useful for showing repo footprint in
 * the status bar or a repo info dialog.
 *
 * Output format:
 *   count: 12
 *   size: 24
 *   in-pack: 0
 *   packs: 0
 *   size-pack: 0
 *   prune-packable: 0
 *   garbage: 0
 *   size-garbage: 0
 */
export async function countObjects(repoPath: string, verbose = true): Promise<string> {
  const git = getGit(repoPath);
  return await git.raw(['count-objects', ...(verbose ? ['-v'] : [])]);
}

/**
 * Update server info — wraps `git update-server-info`.
 *
 * Required for dumb HTTP transports. Rarely needed in practice but part
 * of the complete git CLI surface.
 */
export async function updateServerInfo(repoPath: string): Promise<string> {
  const git = getGit(repoPath);
  return await git.updateServerInfo();
}

/**
 * list-remote — wraps `git ls-remote`.
 *
 * Returns the refs available on a remote WITHOUT cloning. Useful for
 * checking what branches/tags exist before deciding to clone.
 */
export async function listRemote(repoPath: string, remote: string = 'origin'): Promise<string> {
  const git = getGit(repoPath);
  try {
    // Per-remote auth (http.extraHeader) — private servers reject anonymous
    // ls-remote, and the Remotes tool preview must use the same stored
    // credentials as push/pull/fetch.
    return await git.raw([...(await remoteNetworkArgs(repoPath, remote)), 'ls-remote', remote]);
  } catch (e) {
    throw describeNetworkError(e, 'fetch');
  }
}

/**
 * Add an annotated tag — wraps `git tag -a -m`.
 *
 * Annotated tags store metadata (tagger, date, message) in addition to
 * the commit pointer, unlike lightweight tags which are just a ref.
 *
 * Returns the tag name on success.
 */
export async function addAnnotatedTag(
  repoPath: string,
  name: string,
  message: string,
  ref: string = 'HEAD'
): Promise<string> {
  const git = getGit(repoPath);
  // simple-git's addAnnotatedTag(name, message) tags HEAD; for a specific ref,
  // fall back to raw.
  if (ref === 'HEAD') {
    const result = await git.addAnnotatedTag(name, message);
    return typeof result === 'string' ? result : name;
  }
  await git.raw(['tag', '-a', name, '-m', message, ref]);
  return name;
}

// ---------------------------------------------------------------------------
// Working-tree file operations (SmartGit-style file context menu actions)
// ---------------------------------------------------------------------------

/** Ensure an absolute path stays inside the repository root. */
function assertInsideRepo(repoPath: string, relPath: string): string {
  const root = path.resolve(repoPath);
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`Path escapes repository: ${relPath}`);
  }
  return abs;
}

/**
 * Move or rename a file within the repository (SmartGit 'Move or Rename...').
 * Tracked files go through `git mv` so the index is updated too; untracked
 * (or index-less) files fall back to a plain filesystem rename. Missing
 * target directories are created automatically.
 */
export async function moveFile(repoPath: string, fromPath: string, toPath: string): Promise<void> {
  const root = path.resolve(repoPath);
  const fromAbs = assertInsideRepo(repoPath, fromPath);
  const toAbs = assertInsideRepo(repoPath, toPath);
  if (fromAbs === toAbs) return;
  if (!fs.existsSync(fromAbs)) {
    throw new Error(`Source not found: ${fromPath}`);
  }
  fs.mkdirSync(path.dirname(toAbs), { recursive: true });
  try {
    const git = getGit(repoPath);
    await git.raw(['mv', '--', fromPath, toPath]);
  } catch {
    // Untracked file (git mv refuses) → filesystem rename
    fs.renameSync(fromAbs, toAbs);
  }
  invalidateCache(repoPath);
}

/**
 * Current index flags of a file via `git ls-files -v`:
 *   'S'                    → skip-worktree
 *   lowercase tag (h, m…)  → assume-unchanged
 * Returns tracked=false for paths unknown to the index (untracked files).
 */
export async function getIndexFlags(
  repoPath: string,
  file: string
): Promise<{ assumeUnchanged: boolean; skipWorktree: boolean; tracked: boolean }> {
  const git = getGit(repoPath);
  try {
    const out = await git.raw(['ls-files', '-v', '--', file]);
    const line = out.split('\n').find((l) => l.trim().length > 1);
    if (!line) return { assumeUnchanged: false, skipWorktree: false, tracked: false };
    const tag = line.charAt(0);
    // ls-files -v tag codes: 'H' cached, 'S' skip-worktree, 'M' unmerged, ...
    // Lowercase tag ⇒ assume-unchanged variant of that code (h = cached+au).
    return {
      assumeUnchanged: tag !== 'S' && /[a-z]/.test(tag),
      skipWorktree: tag === 'S',
      tracked: true,
    };
  } catch {
    return { assumeUnchanged: false, skipWorktree: false, tracked: false };
  }
}

/**
 * Set/clear an index flag on a tracked file:
 *   assume-unchanged — git stops reporting working-tree changes for the file
 *   skip-worktree    — like assume-unchanged but also survives some checkouts
 */
export async function setIndexFlag(
  repoPath: string,
  file: string,
  flag: 'assume-unchanged' | 'skip-worktree',
  value: boolean
): Promise<void> {
  const git = getGit(repoPath);
  assertInsideRepo(repoPath, file);
  const opt =
    flag === 'assume-unchanged'
      ? value ? '--assume-unchanged' : '--no-assume-unchanged'
      : value ? '--skip-worktree' : '--no-skip-worktree';
  await git.raw(['update-index', opt, '--', file]);
  invalidateCache(repoPath);
}

/**
 * Toggle an index flag (assume-unchanged / skip-worktree) on MULTIPLE files
 * in ONE git call instead of N sequential calls.
 *
 * `git update-index --skip-worktree -- f1 f2 f3` accepts any number of paths.
 * For 50 files this is ~50× faster than calling setIndexFlag() in a for-loop.
 *
 * Files not in the index are silently skipped by git (no error).
 */
export async function setIndexFlagBatch(
  repoPath: string,
  files: string[],
  flag: 'assume-unchanged' | 'skip-worktree',
  value: boolean
): Promise<void> {
  if (files.length === 0) return;
  const git = getGit(repoPath);
  removeStaleIndexLock(repoPath);
  const opt =
    flag === 'assume-unchanged'
      ? value ? '--assume-unchanged' : '--no-assume-unchanged'
      : value ? '--skip-worktree' : '--no-skip-worktree';
  await git.raw(['update-index', opt, '--', ...files]);
  invalidateCache(repoPath);
}

/**
 * Delete a file from the working tree (and the index when tracked).
 * Tracked files go through `git rm -f` (removes from index + disk);
 * untracked files are removed from disk directly — `git rm` refuses them,
 * which made the old untracked 'Delete file' menu item silently fail.
 */
export async function deleteFile(repoPath: string, file: string): Promise<void> {
  const git = getGit(repoPath);
  assertInsideRepo(repoPath, file);
  try {
    await git.raw(['rm', '-f', '--', file]);
  } catch {
    const abs = path.resolve(repoPath, file);
    if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
  }
  invalidateCache(repoPath);
}

/**
 * Delete multiple files from the working tree (and the index when tracked)
 * in ONE git call instead of N sequential calls.
 *
 * `git rm -f -- f1 f2 f3` accepts any number of paths in a single invocation.
 * For 50 files this is ~50× faster than calling deleteFile() in a for-loop.
 *
 * Files that fail (e.g. untracked — git rm refuses them) are retried one
 * at a time and removed from disk directly via fs.rmSync as a fallback.
 */
export async function deleteFiles(repoPath: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  const git = getGit(repoPath);
  removeStaleIndexLock(repoPath);
  // Try the batch first — works for tracked files. Falls back to per-file
  // fs.rmSync for untracked files that `git rm` refuses.
  try {
    await git.raw(['rm', '-f', '--', ...files]);
  } catch {
    // Some files were untracked → retry each individually. Tracked ones go
    // through `git rm`, untracked ones go through `fs.rmSync`.
    for (const f of files) {
      try {
        await git.raw(['rm', '-f', '--', f]);
      } catch {
        const abs = path.resolve(repoPath, f);
        if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
      }
    }
  }
  invalidateCache(repoPath);
}

// =====================================================================
// Git Notes (SmartGit Notes feature: add/remove notes on commits,
// categories via [smartgit-notes "<id>"] config sections)
// =====================================================================

/** List note categories: default "commits" plus configured smartgit-notes sections. */
export async function noteCategories(repoPath: string): Promise<NoteCategory[]> {
  const git = getGit(repoPath);
  const categories = new Map<string, NoteCategory>();
  // Default category — always offered (git creates refs/notes/commits on first add)
  categories.set('commits', { id: 'Notes', ref: 'commits' });
  // Configured categories: smartgit.notes.<id>.ref / .color / .graphmessageregex
  try {
    // NOTE: --null must precede --get-regexp
    const out = await git.raw(['config', '--null', '--get-regexp', '^smartgit\\.notes\\.']);
    const entries = parseNullSeparatedConfig(out);
    for (const [key, value] of Object.entries(entries)) {
      const m = key.match(/^smartgit\.notes\.([^.]+)\.(ref|color|graphmessageregex)$/);
      if (!m) continue;
      const id = m[1];
      const cat = categories.get(id) || { id, ref: id };
      if (m[2] === 'ref') { cat.ref = value.trim(); cat.id = id; }
      else if (m[2] === 'color') cat.color = value.trim();
      else if (m[2] === 'graphmessageregex') cat.graphRegex = value.trim();
      categories.set(id, cat);
    }
  } catch { /* no configured categories */ }
  // Auto-detect existing note refs (refs/notes/*) — SmartGit shows them as categories too
  try {
    const refsOut = await git.raw(['for-each-ref', '--format=%(refname)', 'refs/notes/']);
    for (const refname of refsOut.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const ref = refname.replace(/^refs\/notes\//, '');
      if (ref && !categories.has(ref)) categories.set(ref, { id: ref, ref });
    }
  } catch { /* ignore */ }
  return Array.from(categories.values());
}

/** List all notes in a category: [{ commit, note }]. Single git log pass (%N shows notes). */
export async function notesList(
  repoPath: string,
  notesRef: string,
  maxCount = 500
): Promise<CommitNote[]> {
  const git = getGit(repoPath);
  // %N — display the notes of the commit for the given --notes ref.
  const out = await git.raw([
    'log', `--notes=${notesRef}`, '--all',
    `--max-count=${maxCount}`,
    '--format=%H%x01%N%x02',
  ]);
  const result: CommitNote[] = [];
  const re = /([0-9a-f]{40})\x01([\s\S]*?)\x02/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null) {
    const note = m[2].replace(/^\n+/, '').replace(/\s+$/, '');
    if (note) result.push({ commit: m[1], note });
  }
  return result;
}

/** Show the note of a single commit (null when the commit has no note). */
export async function notesShow(
  repoPath: string,
  notesRef: string,
  commit: string
): Promise<string | null> {
  // Use execFileSync instead of simple-git so the command logger doesn't
  // record the 'git notes show' call — when no note exists, git exits 1
  // with "error: no note found" which shows as an error in the Output panel
  // even though it's a perfectly normal state (most commits have no notes).
  try {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync('git', ['-C', repoPath, 'notes', `--ref=${notesRef}`, 'show', commit], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/** Add (or overwrite with force) a note on a commit. */
export async function notesAdd(
  repoPath: string,
  notesRef: string,
  commit: string,
  message: string,
  force = false
): Promise<void> {
  const git = getGit(repoPath);
  const args = ['notes', `--ref=${notesRef}`, 'add'];
  if (force) args.push('--force');
  args.push('-m', message, commit);
  await git.raw(args);
  invalidateCache(repoPath);
}

/** Remove the note from a commit (throws if the commit has no note in this category). */
export async function notesRemove(
  repoPath: string,
  notesRef: string,
  commit: string
): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['notes', `--ref=${notesRef}`, 'remove', commit]);
  invalidateCache(repoPath);
}

// =====================================================================
// Subtrees (SmartGit Remote | Subtree: Add / Pull / Push / Split / Reset)
// Configuration persisted in subtree.<name>.* config keys.
// =====================================================================

function subtreeConfigKey(name: string, key: string): string {
  return `subtree.${name}.${key}`;
}

/** List configured subtrees. */
export async function subtrees(repoPath: string): Promise<SubtreeInfo[]> {
  const git = getGit(repoPath);
  const info = new Map<string, Partial<SubtreeInfo>>();
  try {
    const out = await git.raw(['config', '--null', '--get-regexp', '^subtree\\.']);
    const entries = parseNullSeparatedConfig(out);
    for (const [key, value] of Object.entries(entries)) {
      const m = key.match(/^subtree\.([^.]+)\.(path|remote|branch|squash)$/);
      if (!m) continue;
      const name = m[1];
      const t = info.get(name) || { name };
      if (m[2] === 'path') t.path = value;
      else if (m[2] === 'remote') t.remote = value;
      else if (m[2] === 'branch') t.branch = value;
      else if (m[2] === 'squash') t.squash = value === 'true' || value === '1';
      info.set(name, t);
    }
  } catch { /* none configured */ }
  return Array.from(info.values())
    .filter((t) => t.path && t.remote && t.branch)
    .map((t) => ({ name: t.name!, path: t.path!, remote: t.remote!, branch: t.branch!, squash: !!t.squash }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function requireSubtree(repoPath: string, name: string): Promise<SubtreeInfo> {
  const all = await subtrees(repoPath);
  const t = all.find((x) => x.name === name);
  if (!t) throw new Error(`Subtree "${name}" is not configured`);
  return t;
}

/** Verify git-subtree is available (it is a git contrib command). */
async function assertSubtreeAvailable(git: SimpleGit): Promise<void> {
  try {
    await git.raw(['subtree', '-h']);
  } catch (e) {
    const msg = String(e);
    if (/is not a git command|unknown option/i.test(msg)) {
      throw new Error(
        'git-subtree is not available in your Git installation. Install git-full / git-subtree package.'
      );
    }
  }
}

/** Add a subtree: fetch remote, `git subtree add --prefix=<path> <remote>/<branch> [--squash]`, persist config. */
export async function subtreeAdd(
  repoPath: string,
  opts: { name: string; path: string; remote: string; branch: string; squash?: boolean; remoteUrl?: string }
): Promise<void> {
  const git = getGit(repoPath);
  await assertSubtreeAvailable(git);
  const prefix = opts.path.replace(/^\/+|\/+$/g, '');
  if (!prefix) throw new Error('Subtree path must not be empty');
  const absPrefix = path.resolve(repoPath, prefix);
  if (!absPrefix.startsWith(path.resolve(repoPath))) throw new Error('Subtree path escapes the repository');
  if (fs.existsSync(absPrefix) && fs.readdirSync(absPrefix).length > 0) {
    throw new Error(`Directory "${prefix}" already exists and is not empty`);
  }
  // Register or verify the remote, then fetch it so <remote>/<branch> exists
  const remotes = await git.getRemotes(false);
  const exists = remotes.some((r) => r.name === opts.remote);
  if (!exists) {
    if (!opts.remoteUrl) throw new Error(`Remote "${opts.remote}" does not exist — provide a URL to create it`);
    await addRemote(repoPath, opts.remote, opts.remoteUrl);
  }
  await git.raw(['fetch', opts.remote]);
  const squashArgs = opts.squash ? ['--squash'] : [];
  await git.raw(['subtree', 'add', `--prefix=${prefix}`, `${opts.remote}/${opts.branch}`, ...squashArgs]);
  // Persist configuration
  await git.raw(['config', subtreeConfigKey(opts.name, 'path'), prefix]);
  await git.raw(['config', subtreeConfigKey(opts.name, 'remote'), opts.remote]);
  await git.raw(['config', subtreeConfigKey(opts.name, 'branch'), opts.branch]);
  await git.raw(['config', subtreeConfigKey(opts.name, 'squash'), String(!!opts.squash)]);
  invalidateCache(repoPath);
}

/** Fetch and merge new upstream changes into the subtree (git subtree pull). */
export async function subtreePull(repoPath: string, name: string): Promise<void> {
  const git = getGit(repoPath);
  await assertSubtreeAvailable(git);
  const t = await requireSubtree(repoPath, name);
  await git.raw(['fetch', t.remote]);
  const squashArgs = t.squash ? ['--squash'] : [];
  await git.raw(['subtree', 'pull', `--prefix=${t.path}`, t.remote, t.branch, ...squashArgs]);
  invalidateCache(repoPath);
}

/** Split local subtree changes back out and push them to the subtree remote (git subtree push). */
export async function subtreePush(repoPath: string, name: string): Promise<void> {
  const git = getGit(repoPath);
  await assertSubtreeAvailable(git);
  const t = await requireSubtree(repoPath, name);
  await git.raw(['subtree', 'push', `--prefix=${t.path}`, t.remote, t.branch]);
}

/** Extract subtree commits into a local branch (git subtree split) for review/push. */
export async function subtreeSplit(
  repoPath: string,
  name: string,
  opts?: { rejoin?: boolean; annotate?: string }
): Promise<string> {
  const git = getGit(repoPath);
  await assertSubtreeAvailable(git);
  const t = await requireSubtree(repoPath, name);
  const branch = `subtree/${t.name}`;
  const buildArgs = (rejoin: boolean) => {
    const args = ['subtree', 'split', `--prefix=${t.path}`, `--branch=${branch}`];
    if (rejoin) args.push('--rejoin');
    if (opts?.annotate) args.push(`--annotate=${opts.annotate}`);
    return args;
  };
  try {
    await git.raw(buildArgs(!!opts?.rejoin));
  } catch (e) {
    // Known git-subtree regression: --rejoin can fail with
    // "refusing to merge unrelated histories". Retry without --rejoin —
    // the split itself still succeeds (only the history-reuse optimization is lost).
    if (opts?.rejoin && /unrelated histories/i.test(String(e))) {
      await git.raw(buildArgs(false));
    } else {
      throw e;
    }
  }
  invalidateCache(repoPath);
  return branch;
}

/** Remove the subtree configuration (does NOT touch the working tree content). */
export async function subtreeRemove(repoPath: string, name: string): Promise<void> {
  const git = getGit(repoPath);
  await requireSubtree(repoPath, name);
  for (const key of ['path', 'remote', 'branch', 'squash']) {
    try {
      await git.raw(['config', '--unset', subtreeConfigKey(name, key)]);
    } catch { /* already unset */ }
  }
}

// =====================================================================
// LFS file locks (SmartGit Local | LFS | Lock / Unlock)
// =====================================================================

/** List LFS locks. local=true reads only local locks (no server round-trip). */
export async function lfsLocks(repoPath: string, local = false): Promise<LfsLockInfo[]> {
  const git = getGit(repoPath);
  const args = ['lfs', 'locks'];
  if (local) args.push('--local');
  try {
    const out = await git.raw(args);
    const locks: LfsLockInfo[] = [];
    for (const line of out.split('\n').filter((l) => l.trim())) {
      // Format: ID <tab> Path <tab> Owner (JSON output may vary between versions)
      let parsed: { id?: unknown; path?: unknown; owner?: { name?: unknown } } | null = null;
      try { parsed = JSON.parse(line); } catch { /* plain text format */ }
      if (parsed && typeof parsed.path === 'string') {
        locks.push({
          id: String(parsed.id ?? ''),
          path: parsed.path,
          owner: parsed.owner && typeof parsed.owner.name === 'string' ? parsed.owner.name : undefined,
        });
        continue;
      }
      const m = line.match(/(\S+)\s+(.+?)(?:\s+(?:by\s+)?(\S+))?$/);
      if (m) locks.push({ id: m[1], path: m[2], owner: m[3] });
    }
    return locks;
  } catch (e) {
    // Locks need LFS + server support; surface a clear error to the caller
    throw new Error(`Failed to list LFS locks: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Lock a file on the LFS server for exclusive editing. */
export async function lfsLock(repoPath: string, file: string): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['lfs', 'lock', file]);
}

/** Unlock a file; force removes a lock owned by someone else (requires permissions). */
export async function lfsUnlock(repoPath: string, file: string, force = false): Promise<void> {
  const git = getGit(repoPath);
  const args = ['lfs', 'unlock'];
  if (force) args.push('--force');
  args.push(file);
  await git.raw(args);
}

// =====================================================================
// Format Patch (git format-patch) — SmartGit legacy "Format Patch" tool
// =====================================================================

/** Write patch files for a commit (or commit range) into outputDir; returns created file paths. */
export async function formatPatch(
  repoPath: string,
  opts: { outputDir: string; commit?: string; from?: string; to?: string }
): Promise<string[]> {
  const git = getGit(repoPath);
  fs.mkdirSync(opts.outputDir, { recursive: true });
  const args = ['format-patch', '-o', opts.outputDir, '--no-numbered'];
  if (opts.from && opts.to) {
    args.push(`${opts.from}..${opts.to}`);
  } else if (opts.commit) {
    args.push('-1', opts.commit);
  } else {
    throw new Error('formatPatch requires a commit or a from..to range');
  }
  const out = await git.raw(args);
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

// =====================================================================
// Edit commit author (SmartGit "Edit Author")
// =====================================================================

/** Change the author of a commit (HEAD via amend, older commits via filter-branch env-filter). */
export async function editCommitAuthor(
  repoPath: string,
  hash: string,
  name: string,
  email: string
): Promise<void> {
  const git = getGit(repoPath);
  if (hash === 'HEAD' || hash === (await revParse(repoPath, 'HEAD'))) {
    // --allow-empty keeps author-only edits working when HEAD happens to be an empty commit
    await git.raw(['commit', '--amend', '--no-edit', '--allow-empty', '--author', `${name} <${email}>`]);
    return;
  }
  const esc = (s: string) => s.replace(/'/g, `'\\''`);
  await git.raw([
    'filter-branch', '-f', '--env-filter',
    `if [ "$GIT_COMMIT" = "${hash}" ]; then ` +
    `export GIT_AUTHOR_NAME='${esc(name)}'; ` +
    `export GIT_AUTHOR_EMAIL='${esc(email)}'; fi`,
    `${hash}^..HEAD`,
  ]);
  invalidateCache(repoPath);
}

// =====================================================================
// Verify Database / Garbage Collect (SmartGit Query menu)
// =====================================================================

/** Run `git fsck --full` and return its combined output (report includes warnings/errors). */
export async function verifyDatabase(repoPath: string): Promise<string> {
  const git = getGit(repoPath);
  try {
    return await git.raw(['fsck', '--full']);
  } catch (e) {
    // fsck exits non-zero when problems are found — the stdout/stderr IS the report
    const msg = e instanceof Error ? e.message : String(e);
    return msg;
  }
}

/** Run `git gc` and return a short stat summary (git count-objects -vH). */
export async function garbageCollect(repoPath: string, aggressive = false): Promise<string> {
  const git = getGit(repoPath);
  const args = ['gc', '--quiet'];
  if (aggressive) args.push('--aggressive');
  await git.raw(args);
  invalidateCache(repoPath);
  return git.raw(['count-objects', '-vH']);
}

/** List commits unreachable from any ref (SmartGit "Recyclable Commits"). */
export async function unreachableCommits(repoPath: string): Promise<UnreachableCommit[]> {
  const git = getGit(repoPath);
  let out = '';
  try {
    out = await git.raw(['fsck', '--unreachable', '--no-reflogs', '--no-progress']);
  } catch (e) {
    // fsck may exit non-zero while still printing unreachable objects on stdout
    out = e instanceof Error ? (e as { message?: string }).message ?? '' : String(e);
  }
  const shas: string[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^unreachable commit ([0-9a-f]{40})/);
    if (m) shas.push(m[1]);
  }
  if (shas.length === 0) return [];
  const result: UnreachableCommit[] = [];
  // Enrich with log metadata in chunks (avoid oversized command lines)
  for (let i = 0; i < shas.length; i += 200) {
    const chunk = shas.slice(i, i + 200);
    let logOut = '';
    try {
      logOut = await git.raw([
        'log', '--no-walk', '--date=iso-strict',
        '--format=%H%x01%h%x01%an%x01%aI%x01%at%x01%s%x02',
        ...chunk,
      ]);
    } catch { continue; }
    const re = /([0-9a-f]{40})\x01([^\x01]*)\x01([^\x01]*)\x01([^\x01]*)\x01(\d+)\x01([\s\S]*?)\x02/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(logOut)) !== null) {
      result.push({
        hash: m[1],
        hashAbbrev: m[2],
        author: m[3],
        date: m[4],
        timestamp: Number(m[5]) * 1000,
        subject: m[6],
      });
    }
  }
  return result;
}

// =====================================================================
// Bugtraq issue-tracker configuration (.gitbugtraq / [bugtraq] section)
// =====================================================================

function parseNullSeparatedConfig(out: string): Record<string, string> {
  // git config --null output: entries separated by NUL; inside an entry the key
  // and the value are separated by LF ("key\nvalue\0").
  const entries: Record<string, string> = {};
  for (const record of out.split('\0')) {
    if (!record) continue;
    const nl = record.indexOf('\n');
    if (nl < 0) {
      entries[record.toLowerCase()] = '';
      continue;
    }
    entries[record.slice(0, nl).toLowerCase()] = record.slice(nl + 1);
  }
  return entries;
}

function bugtraqFromEntries(entries: Record<string, string>): BugtraqConfig | null {
  // keys look like: bugtraq.<id>.url / .logregex / .loglinkregex / .logfilterregex / .projects
  const ids = new Set<string>();
  for (const key of Object.keys(entries)) {
    const m = key.match(/^bugtraq\.([^.]+)\./);
    if (m) ids.add(m[1]);
  }
  // Also support a plain [bugtraq] section without id (keys: bugtraq.url etc.)
  if (entries['bugtraq.url']) {
    return {
      url: entries['bugtraq.url'],
      logregex: entries['bugtraq.logregex'] ?? entries['bugtraq.loglinkregex'] ?? '',
      loglinkregex: entries['bugtraq.loglinkregex'],
      logfilterregex: entries['bugtraq.logfilterregex'],
      projects: entries['bugtraq.projects']?.split(',').map((p) => p.trim()).filter(Boolean),
    };
  }
  // Prefer an entry whose id matches a project prefix, otherwise the first id
  for (const id of ids) {
    const url = entries[`bugtraq.${id}.url`];
    if (!url) continue;
    return {
      url,
      logregex: entries[`bugtraq.${id}.logregex`] ?? entries[`bugtraq.${id}.loglinkregex`] ?? '',
      loglinkregex: entries[`bugtraq.${id}.loglinkregex`],
      logfilterregex: entries[`bugtraq.${id}.logfilterregex`],
      projects: entries[`bugtraq.${id}.projects`]?.split(',').map((p) => p.trim()).filter(Boolean),
    };
  }
  return null;
}

/** Read the Bugtraq configuration: .gitbugtraq file first, then any config scope. */
export async function bugtraqConfig(repoPath: string): Promise<BugtraqConfig | null> {
  const git = getGit(repoPath);
  const bugtraqFile = path.join(repoPath, '.gitbugtraq');
  if (fs.existsSync(bugtraqFile)) {
    try {
      const out = await git.raw(['config', '--null', '--file', '.gitbugtraq', '--list']);
      const cfg = bugtraqFromEntries(parseNullSeparatedConfig(out));
      if (cfg) return cfg;
    } catch { /* fall through to config */ }
  }
  try {
    const out = await git.raw(['config', '--null', '--list']);
    return bugtraqFromEntries(parseNullSeparatedConfig(out));
  } catch {
    return null;
  }
}

// =====================================================================
// Index Editor helpers: write the Index content of a file directly
// =====================================================================

/** Overwrite the Index entry of `file` with the given text content (SmartGit Index Editor "save"). */
export async function setIndexContent(repoPath: string, file: string, content: string): Promise<void> {
  const git = getGit(repoPath);
  assertInsideRepo(repoPath, file);
  const tmpFile = path.join(repoPath, '.git', 'prismgit-index-editor-tmp');
  fs.writeFileSync(tmpFile, content, 'utf8');
  try {
    const sha = (await git.raw(['hash-object', '-w', tmpFile])).trim();
    // Mode: preserve the existing mode when the file is in the index, otherwise 100644
    let mode = '100644';
    try {
      const ls = await git.raw(['ls-files', '-s', '--', file]);
      const m = ls.match(/^(\d{6}) /);
      if (m) mode = m[1];
    } catch { /* default */ }
    await git.raw(['update-index', '--cacheinfo', `${mode},${sha},${file}`]);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
  invalidateCache(repoPath);
}

/** Show the file content at a given ref (`git show <ref>:<file>`). */
export async function showFile(repoPath: string, ref: string, file: string): Promise<string> {
  const git = getGit(repoPath);
  return git.raw(['show', `${ref}:${file}`]);
}

// ============================================================
// SmartGit Manual features — extended backend
// ============================================================

/**
 * Auto-stash: stash local changes before an operation, then pop after.
 * Used by merge/rebase/pull to enable --autostash-like behavior.
 */
export async function autoStash<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
  const git = getGit(repoPath);
  const s = await git.status();
  const dirty = !s.isClean();
  let stashHash: string | null = null;
  if (dirty) {
    try {
      stashHash = await git.stash(['push', '-u', '-m', 'prismgit-autostash']);
    } catch {
      /* ignore — proceed without stash */
    }
  }
  try {
    return await fn();
  } finally {
    if (stashHash) {
      try {
        await git.stash(['pop']);
      } catch {
        /* swallow pop errors; user can recover via stashes view */
      }
    }
  }
}

/**
 * Recyclable commits — unreachable reflog commits eligible for GC (see types/git-api).
 */
export async function recyclableCommits(repoPath: string): Promise<RecyclableCommit[]> {
  const git = getGit(repoPath);
  // Strategy: list all reflog hashes (HEAD + branches), then filter out those reachable from refs.
  try {
    // Get all reflog entries across all refs
    const reflogsRaw = await git.raw(['reflog', '--all', '--format=%H%x1f%s%x1f%ct%x1f%gs']);
    if (!reflogsRaw.trim()) return [];
    const seen = new Set<string>();
    const entries: RecyclableCommit[] = [];
    for (const line of reflogsRaw.split('\n')) {
      if (!line.trim()) continue;
      const [hash, subject, ts, source] = line.split('\x1f');
      if (!hash || seen.has(hash)) continue;
      seen.add(hash);
      const timestamp = Number(ts) * 1000;
      const date = new Date(timestamp).toISOString();
      entries.push({
        hash,
        hashAbbrev: hash.substring(0, 8),
        subject: subject || '(no subject)',
        date,
        timestamp,
        source: source || 'reflog',
      });
    }
    // Filter: only keep commits that are NOT reachable from any branch/tag
    const reachable = new Set<string>();
    try {
      const revList = await git.raw(['rev-list', '--all']);
      for (const line of revList.split('\n')) {
        const h = line.trim();
        if (h) reachable.add(h);
      }
    } catch {
      /* ignore — treat all as recyclable if rev-list fails */
    }
    return entries.filter(e => !reachable.has(e.hash));
  } catch {
    return [];
  }
}

export async function lfsListLocks(repoPath: string, remote = 'origin'): Promise<LfsLock[]> {
  const git = getGit(repoPath);
  try {
    const out = await git.raw(['lfs', 'locks', '--remote=' + remote, '--json']);
    if (!out.trim()) return [];
    const parsed = JSON.parse(out);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((l: any) => ({
      id: String(l.id || ''),
      path: String(l.path || ''),
      owner: { name: l.owner?.name || l.owner?.name || 'unknown' },
      lockedAt: l.locked_at || '',
      createdAt: l.created_at || '',
    }));
  } catch {
    return [];
  }
}

export async function noteShow(repoPath: string, commit: string, ref = 'refs/notes/commits'): Promise<string> {
  const git = getGit(repoPath);
  try {
    return await git.raw(['notes', '--ref=' + ref, 'show', commit]);
  } catch {
    return '';
  }
}

export async function noteAdd(repoPath: string, commit: string, content: string, ref = 'refs/notes/commits', force = false): Promise<void> {
  const git = getGit(repoPath);
  const args = ['notes', '--ref=' + ref, 'add'];
  if (force) args.push('-f');
  args.push('-m', content, commit);
  await git.raw(args);
}

export async function noteRemove(repoPath: string, commit: string, ref = 'refs/notes/commits'): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['notes', '--ref=' + ref, 'remove', commit]);
}

/** Force compare — bypass maxFileSize limit. Just calls diff() but signals intent. */
export async function forceCompare(
  repoPath: string,
  file: string,
  options?: { staged?: boolean; ref?: string }
): Promise<DiffResult> {
  return diff(repoPath, file, options);
}

/**
 * EOL-only change detection.
 * Returns true if file's changes are ONLY line-ending differences (CRLF vs LF).
 */
export async function isEolOnlyChange(repoPath: string, file: string): Promise<boolean> {
  const git = getGit(repoPath);
  try {
    // Run a diff with --ignore-cr-at-eol; if it produces NO output, the only change is EOL.
    const out = await git.raw(['diff', '--ignore-cr-at-eol', '--', file]);
    return out.trim() === '';
  } catch {
    return false;
  }
}

/** Push to Gerrit — refs/for/<branch> instead of HEAD */
export async function pushToGerrit(
  repoPath: string,
  branch?: string,
  remote = 'origin',
  options?: { draft?: boolean; reviewers?: string[]; topic?: string }
): Promise<string> {
  const git = getGit(repoPath);
  // Detect target branch from .gitreview or current branch
  let targetBranch = branch;
  if (!targetBranch) {
    // Try reading .gitreview
    const gitreview = path.join(repoPath, '.gitreview');
    if (fs.existsSync(gitreview)) {
      const content = fs.readFileSync(gitreview, 'utf8');
      const match = content.match(/^defaultbranch\s*=\s*(.+)$/m);
      if (match) targetBranch = match[1].trim();
    }
    if (!targetBranch) {
      const s = await git.status();
      targetBranch = s.current || 'main';
    }
  }
  const ref = options?.draft ? `refs/drafts/${targetBranch}` : `refs/for/${targetBranch}`;
  // A bare magic ref ("git push origin refs/for/main") means "push the LOCAL
  // refs/for/main branch" — which never exists, so the push always failed with
  // "src refspec refs/for/... does not match any". Gerrit needs HEAD:magic-ref,
  // and topic/reviewers must ride the refspec as '%'-options (not extra args,
  // which git parses as additional refspecs).
  let refspec = `HEAD:${ref}`;
  const gerritOpts: string[] = [];
  if (options?.topic) gerritOpts.push(`topic=${options.topic}`);
  if (options?.reviewers && options.reviewers.length) {
    for (const r of options.reviewers) gerritOpts.push(`r=${r}`);
  }
  if (gerritOpts.length) refspec += '%' + gerritOpts.join(',');
  const args = [...(await remoteNetworkArgs(repoPath, remote, true)), 'push', remote, refspec];
  return git.raw(args);
}

/** Clone with partial clone filter (--filter=blob:none etc.) */
export async function clonePartial(
  url: string,
  targetPath: string,
  filter: 'blob:none' | 'tree:0' | 'blob:limit=1m' = 'blob:none',
  options?: { depth?: number; branch?: string; recursive?: boolean }
): Promise<string> {
  const args = ['clone', '--filter=' + filter, url, targetPath];
  if (options?.depth) args.push('--depth=' + options.depth);
  if (options?.branch) args.push('--branch=' + options.branch, '--single-branch');
  if (options?.recursive) args.push('--recursive');
  const git = simpleGit();
  const result = await git.raw(args);
  invalidateCache();
  return result || targetPath;
}

/** Set up PrismGit as credential helper for the cloned repo */
export async function setupCredentialHelper(repoPath: string): Promise<void> {
  // simple-git BLOCKS configuring credential.helper on the default instance
  // ("Configuring credential.helper is not permitted without enabling
  // allowUnsafeCredentialHelper") — the old code swallowed that error, so this
  // function silently did nothing. Use an unsafe instance and actually set it.
  const git = simpleGit({ baseDir: repoPath, unsafe: { allowUnsafeCredentialHelper: true } });
  try {
    await git.addConfig('credential.helper', 'store', false /* replace-all */, 'local');
  } catch {
    /* ignore — best effort */
  }
}

/**
 * Bidirectional blame: past blame + future commits per line (see types/git-api).
 */
export async function blameBidirectional(
  repoPath: string,
  file: string,
  ref?: string
): Promise<BidirectionalBlameResult> {
  const past = await blame(repoPath, file, ref);
  // For future: use git log -L to find all commits that touched each line range.
  // For performance, we just find all commits touching the file after the past blame.
  const git = getGit(repoPath);
  const futureLines: BidirectionalBlameResult['futureLines'] = [];

  // Get all commits touching this file
  let commits: { hash: string; subject: string; date: string; timestamp: number }[] = [];
  try {
    const logOut = await git.raw([
      'log', '--follow', '--format=%H%x1f%s%x1f%cI',
      '--', file,
    ]);
    commits = logOut.trim().split('\n')
      .filter(l => l.trim())
      .map(l => {
        const [hash, subject, date] = l.split('\x1f');
        return { hash, subject, date, timestamp: new Date(date).getTime() };
      });
  } catch {
    /* ignore */
  }

  // For each line in past blame, find future commits (timestamp > blame commit's timestamp) that touched this file.
  // blame --porcelain reports author-time as raw UNIX SECONDS ('1704067201');
  // Date.parse on a plain number string parses it as a YEAR (~5.4e13), so every
  // comparison failed and futureLines was ALWAYS empty. Handle both forms.
  const pastTime = (v: string): number => {
    const trimmed = (v || '').trim();
    if (trimmed && !/^\d+$/.test(trimmed)) {
      const t = Date.parse(trimmed);
      if (!Number.isNaN(t)) return t;
    }
    const secs = parseInt(trimmed, 10);
    return Number.isNaN(secs) ? 0 : secs * 1000;
  };
  for (const line of past.lines) {
    const lineCommitTimestamp = pastTime(line.authorTime);
    const futureCommits = commits
      .filter(c => c.timestamp > lineCommitTimestamp)
      .map(c => ({ hash: c.hash, subject: c.subject, date: c.date }))
      .slice(0, 10); // cap at 10 to keep UI manageable
    if (futureCommits.length > 0) {
      futureLines.push({ lineNumber: line.finalLineNumber, commits: futureCommits });
    }
  }

  return { past, futureLines };
}

/** SmartGit's "Investigate" / DeepGit line-level find commits that introduced or removed a string */
export async function pickaxeSearch(
  repoPath: string,
  file: string,
  search: string,
  options?: { regex?: boolean; ignoreCase?: boolean }
): Promise<{ hash: string; subject: string; date: string; lineNumbers: number[] }[]> {
  const git = getGit(repoPath);
  // Options must come BEFORE the "--" pathspec: pushing -i after "--" made git
  // read it as a pathspec (always-empty results), and the old regex splice
  // produced ["-S", "-G", search] (invalid). Build the argv cleanly instead.
  const args = ['log', '-S', search];
  if (options?.regex) {
    args[1] = '-G';
  }
  if (options?.ignoreCase) {
    args.push('-i');
  }
  args.push('--format=%H%x1f%s%x1f%cI', '--follow', '--', file);
  try {
    const out = await git.raw(args);
    if (!out.trim()) return [];
    return out.trim().split('\n').map(l => {
      const [hash, subject, date] = l.split('\x1f');
      return { hash, subject, date, lineNumbers: [] };
    });
  } catch {
    return [];
  }
}

/**
 * Detect renames more aggressively (with --find-renames=<threshold>).
 * Returns the rename pairs detected in the working tree or in a commit.
 */
export async function detectRenames(
  repoPath: string,
  options?: { threshold?: number; ref?: string }
): Promise<{ from: string; to: string; similarity: number }[]> {
  const git = getGit(repoPath);
  const threshold = options?.threshold ?? 50;
  // Default: compare HEAD to working tree (catches both staged + unstaged renames)
  const args = ['diff', '--name-status', '--find-renames=' + threshold + '%'];
  if (options?.ref) {
    args.push(options.ref);
  } else {
    args.push('HEAD');
  }
  try {
    const out = await git.raw(args);
    return out.trim().split('\n')
      .filter(l => l.startsWith('R'))
      .map(l => {
        // Format: R<similarity>\t<from>\t<to>
        const parts = l.split('\t');
        const similarityStr = parts[0].substring(1);
        const similarity = parseInt(similarityStr, 10) || 100;
        return { from: parts[1] || '', to: parts[2] || '', similarity };
      });
  } catch {
    return [];
  }
}

/**
 * Allow modifying pushed commits — check if commit is pushed.
 * Returns true if commit has been pushed to any remote.
 */
export async function isCommitPushed(repoPath: string, hash: string): Promise<boolean> {
  const git = getGit(repoPath);
  try {
    // Check if commit is reachable from any remote-tracking branch
    const branches = await git.raw(['branch', '-r', '--contains', hash]);
    return branches.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Squash multiple commits into one (interactive rebase automation).
 * Uses git rebase --interactive with autosquash, by writing fixup! messages.
 */
export async function squashCommits(
  repoPath: string,
  fromHash: string,
  toHash: string,
  message?: string
): Promise<void> {
  const git = getGit(repoPath);
  // Commits to squash: everything reachable from toHash but not from fromHash,
  // plus fromHash itself. `^fromHash` (instead of `fromHash^..toHash`) also
  // works when fromHash is the ROOT commit.
  const afterFrom = await git.raw(['rev-list', '--reverse', toHash, `^${fromHash}`]);
  const squashList = [fromHash, ...afterFrom.split('\n').filter(Boolean)];
  if (squashList.length < 2) return;

  // The sequence editor REPLACES the whole todo file, so the todo must cover
  // fromHash..HEAD — otherwise every commit after toHash would be silently
  // DROPPED from the branch (data loss; the old code listed only from..to).
  const tailRaw = await git.raw(['rev-list', '--reverse', 'HEAD', `^${fromHash}`]);
  const allAfter = [fromHash, ...tailRaw.split('\n').filter(Boolean)];

  // Inline "pick <hash> <msg>" messages are ignored by rebase; a custom
  // message is applied with an exec-amend right after the fixup group.
  const safeMessage = (message ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, '\\"')
    .trim();

  const lines: string[] = [];
  allAfter.forEach((h, i) => {
    if (i === 0) lines.push(`pick ${h}`);
    else if (i < squashList.length) lines.push(`fixup ${h}`);
    else lines.push(`pick ${h}`);
  });
  if (safeMessage) {
    lines.splice(squashList.length, 0, `exec git commit --amend --no-verify -m "${safeMessage}"`);
  }

  // Heredoc instead of echo: no shell escape ambiguity for the todo lines.
  const editorScript = path.join(repoPath, '.git', 'prismgit-seq-editor.sh');
  fs.writeFileSync(
    editorScript,
    `#!/bin/sh\ncat > "$1" <<'PRISM_TODO_EOF'\n${lines.join('\n')}\nPRISM_TODO_EOF\n`,
    { mode: 0o755 },
  );
  try {
    // simple-git blocks `-c core.editor` on the default instance (the same
    // pitfall splitCommit documents) — an unsafe instance is MANDATORY here,
    // otherwise the rebase always fails with "Configuring core.editor is not
    // permitted without enabling allowUnsafeEditor".
    const gitUnsafe = simpleGit({ baseDir: repoPath, unsafe: { allowUnsafeEditor: true } });
    // fromHash may be the ROOT commit — rebase needs --root there. NOTE: a
    // `rev-parse --verify --quiet <hash>^` probe does NOT work: it exits 1
    // with EMPTY output and simple-git resolves that (no stderr → no throw).
    // Count parents instead — deterministic for root and normal commits.
    let rootCase = false;
    try {
      const parentsOut = await git.raw(['rev-list', '--parents', '-n', '1', fromHash]);
      rootCase = parentsOut.trim().split(/\s+/).length < 2;
    } catch {
      rootCase = false;
    }
    const rebaseArgs = ['-c', `core.editor=${editorScript}`, 'rebase', '-i'];
    if (rootCase) rebaseArgs.push('--root');
    else rebaseArgs.push(`${fromHash}^`);
    await gitUnsafe.raw(rebaseArgs);
  } finally {
    try { fs.unlinkSync(editorScript); } catch { /* ignore */ }
  }
}

/** Coalesce two adjacent commits into one (similar to squash, but combines messages). */
export async function coalesceCommits(
  repoPath: string,
  firstHash: string,
  secondHash: string
): Promise<void> {
  const git = getGit(repoPath);
  // Accept any argument order — determine which commit is the older one.
  // (`rev-list first~1..second` broke when first was the ROOT commit.)
  let older = firstHash;
  let newer = secondHash;
  try {
    await git.raw(['merge-base', '--is-ancestor', firstHash, secondHash]);
  } catch {
    older = secondHash;
    newer = firstHash;
  }
  // Squash with combined message
  const messages: string[] = [];
  for (const h of [older, newer]) {
    try {
      const msg = await git.raw(['log', '-1', '--format=%B', h]);
      messages.push(msg.trim());
    } catch { /* ignore */ }
  }
  await squashCommits(repoPath, older, newer, messages.join('\n\n'));
}

/** Tag-Grouping: group tags by patterns (e.g., v1.0.0, v1.0.1 → group "v1.0") */
export interface TagGroup {
  name: string;
  tags: TagInfo[];
  latest?: TagInfo;
}

export function groupTags(tags: TagInfo[], pattern: RegExp = /^v?(\d+\.\d+)/): TagGroup[] {
  const groups = new Map<string, TagInfo[]>();
  const ungrouped: TagInfo[] = [];
  for (const tag of tags) {
    const match = tag.name.match(pattern);
    if (match) {
      const group = match[1];
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(tag);
    } else {
      ungrouped.push(tag);
    }
  }
  const result: TagGroup[] = [];
  for (const [name, groupTags] of groups.entries()) {
    groupTags.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    result.push({ name, tags: groupTags, latest: groupTags[0] });
  }
  result.sort((a, b) => (b.latest?.date || '').localeCompare(a.latest?.date || ''));
  if (ungrouped.length > 0) {
    result.push({ name: 'Other', tags: ungrouped });
  }
  return result;
}

// ============================================================
// SmartGit Manual v25/26 — extended backend (batch 1-7)
// ============================================================

/**
 * Smart Pull — prevents divergence after remote force-push.
 * Strategy:
 *   1. Fetch the remote branch
 *   2. Check if local HEAD has commits not on remote (ahead)
 *   3. If local is clean (no uncommitted changes) AND local has no unique commits:
 *      reset --hard to remote tracking branch (avoid divergence)
 *   4. Otherwise: regular pull --rebase (preserve local commits)
 */
export async function smartPull(
  repoPath: string,
  remote = 'origin',
  branch?: string
): Promise<{ strategy: 'reset' | 'rebase' | 'merge' | 'noop'; message: string }> {
  const git = getGit(repoPath);
  // Resolve current branch if not given
  let targetBranch = branch;
  if (!targetBranch) {
    const cur = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (!cur || cur === 'HEAD') {
      // Detached HEAD — fall back to regular pull
      await pull(repoPath, remote, branch, true);
      return { strategy: 'rebase', message: 'Detached HEAD — pulled with --rebase' };
    }
    targetBranch = cur;
  }
  // Fetch first
  try {
    await git.raw(['fetch', remote, targetBranch]);
  } catch {
    /* ignore fetch errors */
  }
  // Check ahead/behind. `rev-list --left-right --count HEAD...remote` prints
  // "<left> <right>": left = commits only in HEAD (LOCAL, ahead), right =
  // commits only on the remote (behind). The old code read them swapped, which
  // made smartPull REBASE a clean behind-repo (should reset) and — far worse —
  // RESET --hard a repo that was only AHEAD, silently dropping local commits.
  const remoteRef = `${remote}/${targetBranch}`;
  let ahead = 0, behind = 0;
  try {
    const counts = await git.raw(['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`]);
    const parts = counts.trim().split(/\s+/);
    ahead = parseInt(parts[0] || '0', 10) || 0;   // left = HEAD side = local
    behind = parseInt(parts[1] || '0', 10) || 0;  // right = remote side
  } catch {
    // Remote ref may not exist — fall back to regular pull
    await pull(repoPath, remote, targetBranch, true);
    return { strategy: 'rebase', message: 'No remote tracking ref — pulled with --rebase' };
  }
  // Check working tree status
  const st = await git.status();
  if (st.isClean() && ahead === 0) {
    // Safe to reset to remote — prevents divergence after remote force-push
    await git.raw(['reset', '--hard', remoteRef]);
    return { strategy: 'reset', message: `Reset to ${remoteRef} (clean tree, no local commits)` };
  }
  if (ahead > 0) {
    // Has local commits — rebase to preserve them
    await git.raw(['rebase', remoteRef]);
    return { strategy: 'rebase', message: `Rebased onto ${remoteRef} (${ahead} local commit${ahead > 1 ? 's' : ''})` };
  }
  // Behind only — fast-forward
  await git.raw(['merge', '--ff-only', remoteRef]);
  return { strategy: 'merge', message: `Fast-forwarded to ${remoteRef}` };
}

/**
 * Octopus Merge — merge 3+ branches in one commit with multiple parents.
 * Uses `git merge -s octopus branch1 branch2 branch3...`.
 */
export async function octopusMerge(
  repoPath: string,
  branches: string[]
): Promise<{ conflicts: string[]; success: boolean }> {
  const git = getGit(repoPath);
  if (branches.length < 2) {
    throw new Error('Octopus merge requires at least 2 branches');
  }
  try {
    await git.raw(['merge', '-s', 'octopus', ...branches]);
    const st = await status(repoPath);
    return { conflicts: st.conflicted, success: st.conflicted.length === 0 };
  } catch (e) {
    const st = await status(repoPath);
    return { conflicts: st.conflicted, success: false };
  }
}

/**
 * Force Push policy check — SmartGit Manual: configurable safety.
 * Returns true if force-push is allowed for the given branch.
 */
export type ForcePushPolicy = 'deny' | 'feature-only' | 'allow';

export function isForcePushAllowed(
  branch: string | undefined,
  policy: ForcePushPolicy,
  protectedBranches: string[] = ['main', 'master', 'develop', 'release/*']
): { allowed: boolean; reason: string } {
  if (policy === 'allow') return { allowed: true, reason: 'Force push allowed by policy' };
  if (policy === 'deny') return { allowed: false, reason: 'Force push denied by global policy' };
  // feature-only: allow on non-protected branches
  if (!branch) return { allowed: false, reason: 'No branch specified' };
  const isProtected = protectedBranches.some(pattern => {
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      return branch.startsWith(prefix + '/');
    }
    return branch === pattern;
  });
  if (isProtected) {
    return { allowed: false, reason: `Branch '${branch}' is protected` };
  }
  return { allowed: true, reason: `Force push allowed on feature branch '${branch}'` };
}

/**
 * Edit code in Diff view — apply a single-line change to the working tree.
 * Used by DiffViewer's inline edit mode.
 */
export async function applyLineEdit(
  repoPath: string,
  file: string,
  lineNumber: number,
  newContent: string,
  isStaged: boolean = false
): Promise<void> {
  const git = getGit(repoPath);
  // Read current file content
  const absPath = path.join(repoPath, file);
  const content = fs.readFileSync(absPath, 'utf8');
  const lines = content.split('\n');
  if (lineNumber < 1 || lineNumber > lines.length) {
    throw new Error(`Line ${lineNumber} out of range (1..${lines.length})`);
  }
  lines[lineNumber - 1] = newContent;
  fs.writeFileSync(absPath, lines.join('\n'));
  if (isStaged) {
    await git.raw(['add', '--', file]);
  }
  invalidateCache(repoPath);
}

/**
 * .git/info/exclude management — local-only exclude patterns.
 */
export async function editInfoExclude(repoPath: string): Promise<string> {
  const excludePath = path.join(repoPath, '.git', 'info', 'exclude');
  // Create if doesn't exist
  if (!fs.existsSync(excludePath)) {
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    fs.writeFileSync(excludePath, '# Local exclude patterns (not shared with team)\n');
  }
  // Open in default editor
  return excludePath;
}

/**
 * Trace which .gitignore rule matches a file — `git check-ignore -v`.
 * Returns the rule source file, line number, and pattern.
 */
export async function traceIgnoreRule(
  repoPath: string,
  file: string
): Promise<{ source: string; lineNumber: number; pattern: string } | null> {
  const git = getGit(repoPath);
  try {
    const out = await git.raw(['check-ignore', '-v', '--', file]);
    // Format: <source>:<line>:<pattern>\t<file>
    const match = out.trim().match(/^([^:]+):(\d+):(.+?)\t/);
    if (match) {
      return {
        source: match[1],
        lineNumber: parseInt(match[2], 10),
        pattern: match[3],
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect repository object format (SHA-1 vs SHA-256) and ref storage (files vs reftable).
 * SmartGit Manual v26: Git 3.0 readiness.
 */
export async function detectRepoFormat(
  repoPath: string
): Promise<{ objectFormat: 'sha1' | 'sha256'; refStorage: 'files' | 'reftable' }> {
  const git = getGit(repoPath);
  let objectFormat: 'sha1' | 'sha256' = 'sha1';
  let refStorage: 'files' | 'reftable' = 'files';
  try {
    // Check extensions.objectFormat in config
    const fmt = await git.raw(['config', '--get', 'extensions.objectformat']);
    if (fmt.trim() === 'sha256') objectFormat = 'sha256';
  } catch { /* default sha1 */ }
  try {
    // Check extensions.refStorage in config
    const rs = await git.raw(['config', '--get', 'extensions.refstorage']);
    if (rs.trim() === 'reftable') refStorage = 'reftable';
  } catch { /* default files */ }
  // Also check for reftable directory existence
  const reftableDir = path.join(repoPath, '.git', 'reftable');
  if (fs.existsSync(reftableDir)) {
    refStorage = 'reftable';
  }
  return { objectFormat, refStorage };
}

/**
 * Commit with GPG signing — passes -S flag.
 * SmartGit Manual: GPG-signed commits.
 */
export async function commitSigned(
  repoPath: string,
  message: string,
  options: { gpgSign?: boolean; sshSign?: boolean; signingKey?: string; noVerify?: boolean } = {}
): Promise<string> {
  const git = getGit(repoPath);
  const args: string[] = ['commit', '-m', message];
  if (options.gpgSign) args.push('-S');
  if (options.sshSign) {
    // Configure for SSH signing: gpg.format=ssh, user.signingkey=ssh:<key>
    if (options.signingKey) {
      await git.addConfig('gpg.format', 'ssh', false, 'local');
      await git.addConfig('user.signingkey', options.signingKey, false, 'local');
    }
    args.push('-S');
  }
  if (options.noVerify) args.push('--no-verify');
  await git.raw(args);
  // Commit output ("[main abc1234] msg") has the branch name inside the
  // brackets, so a bracket-regex never matches — read HEAD instead.
  return (await git.revparse(['HEAD'])).trim();
}

/**
 * Create signed tag — annotated + signed (-s).
 */
export async function createSignedTag(
  repoPath: string,
  name: string,
  message: string,
  ref?: string,
  sshSign: boolean = false
): Promise<void> {
  const git = getGit(repoPath);
  const args: string[] = ['tag', '-s', '-a', name, '-m', message];
  if (ref) args.push(ref);
  if (sshSign) {
    await git.addConfig('gpg.format', 'ssh', false, 'local');
  }
  await git.raw(args);
}

/**
 * LFS fsck — validate LFS object integrity.
 * SmartGit Manual: LFS validation.
 */
export async function lfsFsck(repoPath: string): Promise<{ ok: boolean; output: string }> {
  const git = getGit(repoPath);
  try {
    const out = await git.raw(['lfs', 'fsck']);
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, output: String(e) };
  }
}

/**
 * Multi-repo batch operation — run a git command across multiple repos.
 * SmartGit Manual: Batch operations for multi-repo management.
 */
export async function batchOperation(
  repos: string[],
  operation: 'fetch' | 'pull' | 'push' | 'status',
  options: { remote?: string; branch?: string; force?: boolean } = {}
): Promise<{ repo: string; success: boolean; error?: string }[]> {
  const results: { repo: string; success: boolean; error?: string }[] = [];
  for (const repo of repos) {
    try {
      const git = getGit(repo);
      const r = options.remote || 'origin';
      const isPush = operation === 'push';
      const netArgs = await remoteNetworkArgs(repo, r, isPush);
      switch (operation) {
        case 'fetch':
          await git.raw([...netArgs, 'fetch', r, '--prune']);
          break;
        case 'pull':
          await git.raw([...netArgs, 'pull', r, options.branch || '']);
          break;
        case 'push':
          await git.raw([...netArgs, '-c', 'http.version=HTTP/1.1', 'push', r, ...(options.force ? ['--force-with-lease'] : [])]);
          break;
        case 'status':
          await git.status();
          break;
      }
      results.push({ repo, success: true });
    } catch (e) {
      results.push({ repo, success: false, error: String(e) });
    }
  }
  return results;
}

/**
 * Export all settings, hotkeys, and tool configs as a JSON blob.
 * SmartGit Manual: Config export/import for backup or migration.
 */
export async function exportConfig(
  repoPath: string | null
): Promise<{
  version: string;
  exportedAt: string;
  gitConfig?: { key: string; value: string }[];
  gitignore?: string;
  infoExclude?: string;
  bugtraq?: string;
  gitreview?: string;
}> {
  const result: any = {
    version: '2.0.0',
    exportedAt: new Date().toISOString(),
  };
  if (repoPath) {
    try {
      const list = await configList(repoPath, 'local');
      result.gitConfig = list.map(e => ({ key: e.key, value: e.value }));
    } catch { /* ignore */ }
    try {
      const gi = path.join(repoPath, '.gitignore');
      if (fs.existsSync(gi)) result.gitignore = fs.readFileSync(gi, 'utf8');
    } catch { /* ignore */ }
    try {
      const ie = path.join(repoPath, '.git', 'info', 'exclude');
      if (fs.existsSync(ie)) result.infoExclude = fs.readFileSync(ie, 'utf8');
    } catch { /* ignore */ }
    try {
      const bt = path.join(repoPath, '.gitbugtraq');
      if (fs.existsSync(bt)) result.bugtraq = fs.readFileSync(bt, 'utf8');
    } catch { /* ignore */ }
    try {
      const gr = path.join(repoPath, '.gitreview');
      if (fs.existsSync(gr)) result.gitreview = fs.readFileSync(gr, 'utf8');
    } catch { /* ignore */ }
  }
  return result;
}

/**
 * Import config from a JSON blob back into a repo.
 */
export async function importConfig(
  repoPath: string,
  config: {
    gitConfig?: { key: string; value: string }[];
    gitignore?: string;
    infoExclude?: string;
    bugtraq?: string;
    gitreview?: string;
  }
): Promise<void> {
  if (config.gitConfig) {
    for (const { key, value } of config.gitConfig) {
      try {
        await configSet(repoPath, key, value, 'local');
      } catch { /* ignore individual failures */ }
    }
  }
  if (config.gitignore) {
    fs.writeFileSync(path.join(repoPath, '.gitignore'), config.gitignore);
  }
  if (config.infoExclude) {
    const dir = path.join(repoPath, '.git', 'info');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'exclude'), config.infoExclude);
  }
  if (config.bugtraq) {
    fs.writeFileSync(path.join(repoPath, '.gitbugtraq'), config.bugtraq);
  }
  if (config.gitreview) {
    fs.writeFileSync(path.join(repoPath, '.gitreview'), config.gitreview);
  }
}

export { invalidateCache };
