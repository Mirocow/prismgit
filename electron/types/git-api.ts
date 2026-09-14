/** Directory node for the repository tree in the Changes view. */
export interface DirNode {
  name: string;
  /** Path relative to the repository root. */
  path: string;
  children: DirNode[];
}

// Extended file status codes from git status --porcelain
export interface FileStatus {
  path: string;
  index: 'unmodified' | 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored' | 'conflicted' | 'typechanged';
  working_dir: 'unmodified' | 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored' | 'conflicted' | 'typechanged';
  old_path?: string;
}

export interface StatusResult {
  not_added: string[];
  conflicted: string[];
  created: string[];
  deleted: string[];
  modified: string[];
  renamed: { from: string; to: string }[];
  staged: { path: string; index: string; working_dir: string }[];
  ahead: number;
  behind: number;
  current?: string;
  tracking?: string;
  files: FileStatus[];
  isClean: boolean;
  isMerging: boolean;
  isRebasing: boolean;
  isCherryPicking: boolean;
  isReverting: boolean;
  isBisecting: boolean;
  /** Present ONLY while a cherry-pick is in progress (SmartGit: "cherry-picking-state"). */
  cherryPick?: { commit: string; subject: string; /** pick has nothing to commit — needs Skip or Commit Empty */ empty: boolean };
  /** Present ONLY while a revert is in progress (REVERT_HEAD). */
  revert?: { commit: string; subject: string };
  /** Present ONLY while a merge is in progress (MERGE_HEAD / MERGE_MSG). */
  merge?: { message: string };
  /** Present ONLY while a rebase is in progress (rebase-merge / rebase-apply). */
  rebase?: { step?: number; total?: number };
  /** Present ONLY while bisecting (HEAD detached at the current candidate). */
  bisect?: { rev: string };
  detached: boolean;
}

export interface LogEntry {
  hash: string;
  hashAbbrev: string;
  parents: string[];
  parentsAbbrev: string[];
  author: { name: string; email: string; date: string; timestamp: number };
  committer: { name: string; email: string; date: string; timestamp: number };
  subject: string;
  body: string;
  refs: string[];
  message: string;
  // Graph-related
  branches?: number[]; // lanes this commit occupies
  dots?: { branch: number; color: string }[];
  lines?: { from: number; to: number; color: string; direct: boolean }[];
}

export interface BranchInfo {
  name: string;
  current: boolean;
  remote: boolean;
  tracking?: string;
  ahead?: number;
  behind?: number;
  lastCommit?: { hash: string; date: string; message: string };
  author?: string;
  upstream?: string;
  gone?: boolean;
}

export interface RemoteInfo {
  name: string;
  refs: { fetch: string; push: string };
}

/**
 * Result of a periodic remote check for one repository in the sidebar list:
 * fetches all remotes, then counts incoming/outgoing commits and local
 * (uncommitted) changes. All counters are cheap local rev-list computations
 * performed AFTER the fetch.
 */
export interface RemoteCheckSummary {
  path: string;
  /** Repo has at least one configured remote. */
  hasRemote: boolean;
  /** Remote names found in the repo (e.g. ["origin"]). */
  remotes: string[];
  /** Commits present on remote-tracking branches but missing locally. */
  incoming: number;
  /** Commits on local branches not present on any remote. */
  outgoing: number;
  /** Number of changed (unstaged+staged+untracked) files in the working tree. */
  dirty: number;
  /** Current checked-out branch (null when detached HEAD or not a repo). */
  branch: string | null;
  /** True when a `git fetch --all` succeeded during this check. */
  fetched: boolean;
  /** Epoch ms of the check. */
  checkedAt: number;
  /** Network/other error message (counters still reflect the last successful fetch). */
  error?: string;
}

/** Real remote properties for the "Properties..." context-menu dialog. */
export interface RemoteProperties {
  name: string;
  fetchUrl: string;
  pushUrl: string;
  /** HEAD branch reported by the remote (may be undefined / "(unknown)"). */
  headBranch?: string;
  /** Number of remote-tracking branches (refs/remotes/<name>/*). */
  trackingBranchCount: number;
  /** First up-to-50 tracking branch names for display. */
  trackingBranches: string[];
  /** True when the repo is a shallow clone (.git/shallow exists). */
  shallow: boolean;
  /** remote.<name>.mirror */
  mirror: boolean;
  /** Full remote.<name>.* config section. */
  config: { key: string; value: string }[];
}


export interface StashEntry {
  index: number;
  hash: string;
  hashAbbrev: string;
  message: string;
  date: string;
  branch?: string;
  subject?: string;
}

export interface TagInfo {
  name: string;
  hash: string;
  hashAbbrev: string;
  annotation?: string;
  date?: string;
  author?: string;
  lightweight: boolean;
  target?: string;
  targetHash?: string;
}

export interface SubmoduleInfo {
  name: string;
  path: string;
  url: string;
  branch?: string;
  initialized: boolean;
  upToDate: boolean;
  currentCommit?: string;
  trackedCommit?: string;
}

export interface DiffResult {
  oldContent: string;
  newContent: string;
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  binary: boolean;
  newFile: boolean;
  deletedFile: boolean;
  renamedFile: boolean;
  modeChange?: { oldMode: number; newMode: number };
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'add' | 'del' | 'hunk-header';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface WorktreeInfo {
  path: string;
  head: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  lockedReason?: string;
}

export interface ReflogEntry {
  index: number;
  hash: string;
  hashAbbrev: string;
  refName: string;
  selector: string;
  message: string;
  author: { name: string; email: string };
  date: string;
  timestamp: number;
}

export interface CommitFile {
  path: string;
  status: string; // A/M/D/R/C/T
  oldPath?: string;
  additions: number;
  deletions: number;
  binary: boolean;
  mode: string;
}

export interface BlameLine {
  hash: string;
  hashAbbrev: string;
  author: string;
  authorMail: string;
  authorTime: string;
  authorTz: string;
  committer: string;
  committerMail: string;
  committerTime: string;
  committerTz: string;
  summary: string;
  originalLineNumber: number;
  finalLineNumber: number;
  content: string;
}

export interface BlameResult {
  lines: BlameLine[];
  file: string;
  totalLines: number;
}

export interface GitConfigEntry {
  key: string;
  value: string;
  scope: 'system' | 'global' | 'local' | 'worktree';
  source?: string;
}

/** Status of one ref update as reported by `git push` output. */
export interface PushRefStatus {
  /** remote branch name, e.g. `main` */
  remoteRef: string;
  /** local side of the refspec, e.g. `main` (may differ — case, or Main vs main) */
  localRef?: string;
  /** new branch was created on the remote */
  created?: boolean;
  deleted?: boolean;
  forced?: boolean;
  /** server refused this ref (protected branch, permissions, ...) */
  rejected?: boolean;
  /** reason given by the server, e.g. `protected branch hook declined` */
  reason?: string;
  oldHash?: string;
  newHash?: string;
  /** `= [up to date]` for this ref */
  upToDate?: boolean;
}

/** Post-push verification: does the remote branch now point at the local commit? */
export interface PushVerification {
  branch: string;
  localHash: string;
  /** hash the remote branch points at after the push, null when missing */
  remoteHash: string | null;
  /** localHash === remoteHash */
  ok: boolean;
}

/**
 * Honest result of a push. `git push` exits 0 in cases where the user's
 * intent was NOT fulfilled ("Everything up-to-date", pushing `Main` when the
 * remote branch is `main` — a new branch appears). The UI must not report
 * "Pushed successfully" without checking this result.
 */
export interface PushResult {
  /** git said "Everything up-to-date" — nothing was sent */
  upToDate: boolean;
  /** at least one ref was updated (or created) on the remote */
  updated: boolean;
  /** per-ref details as reported by git */
  refs: PushRefStatus[];
  /** post-push ls-remote verification of the pushed branch */
  verification?: PushVerification;
  /** remote that received (or would have received) the push */
  remote: string;
  /** branch refspec that was pushed (resolved current branch when omitted) */
  branch?: string;
  /** short human-readable summary for the operation log */
  summary: string;
}

/** Result of pull()/checkout() when auto-stash (Preferences → Commands) kicked in. */
export interface AutoStashResult {
  autoStashed: boolean;
  popFailed: boolean;
}

export interface GitApi {
  status: (repoPath: string) => Promise<StatusResult>;
  add: (repoPath: string, files: string[]) => Promise<void>;
  addAll: (repoPath: string) => Promise<void>;
  /** Stage only tracked-file modifications (git add -u) — no untracked. */
  stageAllTracked: (repoPath: string) => Promise<void>;
  restore: (repoPath: string, files: string[], staged?: boolean) => Promise<void>;
  commit: (repoPath: string, message: string, amend?: boolean, signoff?: boolean, noVerify?: boolean) => Promise<string>;
  push: (repoPath: string, remote?: string, branch?: string, setUpstream?: boolean, force?: boolean, tags?: boolean, targetBranch?: string) => Promise<PushResult>;
  pull: (repoPath: string, remote?: string, branch?: string, rebase?: boolean, noFF?: boolean) => Promise<AutoStashResult>;
  fetch: (repoPath: string, remote?: string, prune?: boolean, tags?: boolean) => Promise<void>;
  fetchAll: (repoPath: string, prune?: boolean) => Promise<void>;
  /** Deepen a shallow clone by N commits (git fetch --deepen=N). */
  fetchDeepen: (repoPath: string, remote?: string, commits?: number) => Promise<void>;
  /** Set shallow fetch depth (git fetch --depth=N); depth <= 0 → --unshallow. */
  setFetchDepth: (repoPath: string, remote?: string, depth?: number) => Promise<void>;
  /** Read real remote properties (URLs, HEAD branch, tracking branches, config). */
  remoteProperties: (repoPath: string, name: string) => Promise<RemoteProperties>;
  log: (repoPath: string, options?: { maxCount?: number; skip?: number; branch?: string; branches?: string[]; file?: string; follow?: boolean; all?: boolean; grep?: string; grepIgnoreCase?: boolean }) => Promise<LogEntry[]>;
  /** Resolve a commit by full/abbreviated hash (prefix search) — null when not found. */
  findCommit: (repoPath: string, query: string) => Promise<LogEntry | null>;
  branches: (repoPath: string) => Promise<BranchInfo[]>;
  remotes: (repoPath: string) => Promise<RemoteInfo[]>;
  checkout: (repoPath: string, branch: string, options?: { newBranch?: boolean; force?: boolean; track?: boolean }) => Promise<AutoStashResult>;
  /**
   * Would checking out `target` change .gitmodules? Compares HEAD..target
   * for the .gitmodules path. Used to warn before checkout (SmartGit:
   * "Warn when checkout changes submodule configuration"). Accepts local
   * branch names and remote-tracking refs (origin/foo). Returns false on
   * any error (missing .gitmodules, unborn HEAD) — never blocks checkout.
   */
  hasSubmoduleConfigChanges: (repoPath: string, target: string) => Promise<boolean>;
  checkoutFile: (repoPath: string, file: string, ref?: string) => Promise<void>;
  checkoutFiles: (repoPath: string, files: string[], ref?: string) => Promise<void>;
  createBranch: (repoPath: string, name: string, startPoint?: string, force?: boolean, track?: boolean) => Promise<void>;
  deleteBranch: (repoPath: string, name: string, force?: boolean, remote?: boolean) => Promise<void>;
  renameBranch: (repoPath: string, oldName: string, newName: string) => Promise<void>;
  merge: (repoPath: string, branch: string, options?: { noFf?: boolean; squash?: boolean; ffOnly?: boolean; strategy?: string }) => Promise<{ conflicts: string[]; fastForward: boolean; alreadyUpToDate: boolean }>;
  abortMerge: (repoPath: string) => Promise<void>;
  continueMerge: (repoPath: string) => Promise<void>;
  /** Pre-merge preview: returns the list of files that would conflict if we merged `theirs` into `ours`. */
  mergeTree: (repoPath: string, ours: string, theirs: string) => Promise<{ conflicts: string[]; clean: boolean }>;
  /** Returns ahead/behind counts between two refs without touching the working tree. */
  aheadBehind: (repoPath: string, base: string, compare: string) => Promise<{ ahead: number; behind: number }>;
  /**
   * Periodic remote check for the repository list: `git fetch --all` then
   * compute incoming/outgoing/dirty counters. Never throws — failures are
   * reported in the summary's `error` field.
   */
  pollRemoteSummary: (repoPath: string) => Promise<RemoteCheckSummary>;
  /** Batch version over several repos with bounded concurrency. */
  pollRemoteSummaries: (paths: string[]) => Promise<Record<string, RemoteCheckSummary>>;
  diff: (repoPath: string, file: string, options?: { staged?: boolean; ref?: string }) => Promise<DiffResult>;
  diffBranches: (repoPath: string, base: string, compare: string) => Promise<DiffResult>;
  diffCommit: (repoPath: string, hash: string, parentHash?: string) => Promise<DiffResult>;
  commitFiles: (repoPath: string, hash: string) => Promise<CommitFile[]>;
  /** Nested commits brought in by a MERGE commit (git log <merge>^1..<merge>, merge itself included). Empty for non-merges. */
  mergeNestedCommits: (repoPath: string, hash: string) => Promise<LogEntry[]>;
  /** Tags pointing AT a commit with annotated-tag metadata (tagger, date, message). */
  tagsAt: (repoPath: string, hash: string) => Promise<{ name: string; annotated: boolean; tagger?: string; date?: string; message?: string }[]>;
  /** All tracked files (git ls-files) — file-name search for the Search tool. */
  trackedFiles: (repoPath: string) => Promise<string[]>;
  /**
   * Cheap preflight: does the commit object exist in the repo?
   * Returns false silently for non-existent / unreachable commits
   * (e.g. after git reset --hard, amend, force-push, or gc --prune=now).
   * Used internally by commitFiles + diffCommit to avoid IPC errors,
   * exposed publicly so callers can verify before showing commit links.
   */
  commitExists: (repoPath: string, hash: string) => Promise<boolean>;
  stashList: (repoPath: string) => Promise<StashEntry[]>;
  stashPush: (repoPath: string, message?: string, includeUntracked?: boolean, keepIndex?: boolean, files?: string[]) => Promise<string>;
  /** keepIndex — restore the staged/unstaged split (`git stash pop --index`). */
  stashPop: (repoPath: string, index?: number, keepIndex?: boolean) => Promise<void>;
  /** keepIndex — restore the staged/unstaged split (`git stash apply --index`). */
  stashApply: (repoPath: string, index?: number, keepIndex?: boolean) => Promise<void>;
  /** All files in a stash: tracked changes + untracked files (stash parent[2]). */
  stashFiles: (repoPath: string, hash: string) => Promise<CommitFile[]>;
  /** Raw unified diff of ONE file inside a stash (tracked or untracked part). */
  stashFileRawDiff: (repoPath: string, hash: string, file: string) => Promise<string>;
  stashDrop: (repoPath: string, index?: number) => Promise<void>;
  stashBranch: (repoPath: string, branch: string, index?: number) => Promise<void>;
  /** Rename a stash entry (rebuild refs/stash with a replacement commit). */
  stashRename: (repoPath: string, index: number, message: string) => Promise<void>;
  tags: (repoPath: string) => Promise<TagInfo[]>;
  createTag: (repoPath: string, name: string, message?: string, ref?: string, force?: boolean, annotated?: boolean) => Promise<void>;
  deleteTag: (repoPath: string, name: string, remote?: boolean) => Promise<void>;
  pushTag: (repoPath: string, name: string, remote?: string) => Promise<void>;
  submodules: (repoPath: string) => Promise<SubmoduleInfo[]>;
  submoduleInit: (repoPath: string, name?: string) => Promise<void>;
  submoduleUpdate: (repoPath: string, name?: string, init?: boolean, recursive?: boolean) => Promise<void>;
  submoduleSync: (repoPath: string, name?: string) => Promise<void>;
  submoduleDeinit: (repoPath: string, name: string, force?: boolean) => Promise<void>;
  submoduleAdd: (repoPath: string, url: string, path: string, branch?: string) => Promise<void>;
  clone: (url: string, targetPath: string, options?: { depth?: number; branch?: string; recursive?: boolean; shallowSubmodules?: boolean }) => Promise<string>;
  init: (targetPath: string, bare?: boolean) => Promise<void>;
  addRemote: (repoPath: string, name: string, url: string) => Promise<void>;
  removeRemote: (repoPath: string, name: string) => Promise<void>;
  renameRemote: (repoPath: string, oldName: string, newName: string) => Promise<void>;
  setRemoteUrl: (repoPath: string, name: string, url: string, pushUrl?: boolean) => Promise<void>;
  isRepo: (targetPath: string) => Promise<boolean>;
  currentBranch: (repoPath: string) => Promise<string | null>;
  revParse: (repoPath: string, ref: string) => Promise<string>;
  revParseArgs: (repoPath: string, args: string[]) => Promise<string>;
  raw: (repoPath: string, args: string[]) => Promise<string>;
  /**
   * Detect renames in the working tree (staged + unstaged) in a single
   * optimized IPC call. Returns { oldPath, newPath }[] for every detected
   * rename. Pass the file lists from `git status` so we don't recompute them.
   * Distinct from detectRenames() (which uses --find-renames=<threshold>%).
   */
  detectWorkingTreeRenames: (repoPath: string, deletedFiles: string[], untrackedFiles: string[]) => Promise<{ oldPath: string; newPath: string }[]>;

  // New: full git CLI surface coverage (added per simple-git comprehensive test spec)
  grep: (repoPath: string, pattern: string, options?: string[], pathspec?: string) => Promise<string>;
  applyPatch: (repoPath: string, patch: string | string[], options?: Record<string, null> | string[]) => Promise<string>;
  show: (repoPath: string, args: string[]) => Promise<string>;
  showBuffer: (repoPath: string, args: string[]) => Promise<Buffer>;
  mirror: (remoteUrl: string, targetPath: string) => Promise<void>;
  countObjects: (repoPath: string, verbose?: boolean) => Promise<string>;
  updateServerInfo: (repoPath: string) => Promise<string>;
  listRemote: (repoPath: string, remote?: string) => Promise<string>;
  addAnnotatedTag: (repoPath: string, name: string, message: string, ref?: string) => Promise<string>;

  // SmartGit 20-24 extended features
  worktrees: (repoPath: string) => Promise<WorktreeInfo[]>;
  worktreeAdd: (repoPath: string, targetPath: string, branch?: string, commit?: string, detach?: boolean) => Promise<void>;
  worktreeRemove: (repoPath: string, targetPath: string, force?: boolean) => Promise<void>;
  worktreePrune: (repoPath: string) => Promise<void>;
  worktreeMove: (repoPath: string, oldPath: string, newPath: string) => Promise<void>;

  reflog: (repoPath: string, ref?: string, maxCount?: number) => Promise<ReflogEntry[]>;
  reflogDelete: (repoPath: string, index: number, ref?: string) => Promise<void>;

  cherryPick: (repoPath: string, hashes: string[], noCommit?: boolean) => Promise<{ conflicts: string[]; empty?: boolean; error?: string }>;
  cherryPickAbort: (repoPath: string) => Promise<void>;
  /** Continue after conflict resolution; returns {empty:true} when the pick has nothing to commit (use allowEmpty to commit it anyway). */
  cherryPickContinue: (repoPath: string, allowEmpty?: boolean) => Promise<{ empty?: boolean }>;
  /** Skip the current pick (git cherry-pick --skip) — drops an empty step. */
  cherryPickSkip: (repoPath: string) => Promise<void>;

  revert: (repoPath: string, hashes: string[], noCommit?: boolean) => Promise<{ conflicts: string[] }>;
  revertAbort: (repoPath: string) => Promise<void>;
  revertContinue: (repoPath: string) => Promise<void>;
  revertSkip: (repoPath: string) => Promise<void>;

  rebase: (repoPath: string, onto: string, options?: { interactive?: boolean; autosquash?: boolean; abort?: boolean; continue?: boolean; skip?: boolean }) => Promise<void>;

  bisectStart: (repoPath: string) => Promise<void>;
  bisectGood: (repoPath: string, ref?: string) => Promise<void>;
  bisectBad: (repoPath: string, ref?: string) => Promise<void>;
  bisectSkip: (repoPath: string) => Promise<void>;
  bisectReset: (repoPath: string) => Promise<void>;
  bisectLog: (repoPath: string) => Promise<string>;
  bisectStatus: (repoPath: string) => Promise<{ state: 'bisecting' | 'none'; remaining?: number; rev?: string }>;

  blame: (repoPath: string, file: string, ref?: string) => Promise<BlameResult>;

  ignore: (repoPath: string, patterns: string[], localOnly?: boolean) => Promise<void>;
  isIgnored: (repoPath: string, file: string) => Promise<boolean>;
  editIgnoreFile: (repoPath: string, scope: 'local' | 'global') => Promise<string>;

  editCommitMessage: (repoPath: string, hash: string, message: string) => Promise<void>;

  splitOffFiles: (repoPath: string, hash: string, files: string[], message: string) => Promise<void>;

  configGet: (repoPath: string, key: string, scope?: 'system' | 'global' | 'local') => Promise<string | undefined>;
  configSet: (repoPath: string, key: string, value: string, scope?: 'system' | 'global' | 'local') => Promise<void>;
  configList: (repoPath: string, scope?: 'system' | 'global' | 'local') => Promise<GitConfigEntry[]>;
  configUnset: (repoPath: string, key: string, scope?: 'system' | 'global' | 'local') => Promise<void>;

  findRef: (repoPath: string, query: string) => Promise<{ name: string; hash: string; type: 'branch' | 'tag' | 'remote' }[]>;

  reset: (repoPath: string, mode: 'soft' | 'mixed' | 'hard' | 'keep', ref?: string) => Promise<void>;
  resetFile: (repoPath: string, file: string, ref?: string) => Promise<void>;
  resetFiles: (repoPath: string, files: string[], ref?: string) => Promise<void>;

  clean: (repoPath: string, paths: string[], dryRun?: boolean, force?: boolean, directories?: boolean) => Promise<string[]>;

  // GitHub-related utility
  extractRepoInfo: (repoPath: string) => Promise<{ provider: 'github' | 'gitlab' | 'bitbucket' | 'unknown'; owner?: string; repo?: string; url?: string; webUrl?: string }>;

  // File system integration
  revealInFileManager: (fullPath: string) => Promise<boolean>;
  openFile: (fullPath: string) => Promise<boolean>;

  // Working-tree file operations (file context menu)
  /** Move/rename a file: `git mv` for tracked, fs rename for untracked. */
  moveFile: (repoPath: string, fromPath: string, toPath: string) => Promise<void>;
  /** Index flags of a file (assume-unchanged / skip-worktree / tracked). */
  getIndexFlags: (repoPath: string, file: string) => Promise<{ assumeUnchanged: boolean; skipWorktree: boolean; tracked: boolean }>;
  /** Set/clear assume-unchanged or skip-worktree on a tracked file. */
  setIndexFlag: (repoPath: string, file: string, flag: 'assume-unchanged' | 'skip-worktree', value: boolean) => Promise<void>;
  /** Set/clear assume-unchanged or skip-worktree on MULTIPLE files in one git call (much faster than N sequential calls). */
  setIndexFlagBatch: (repoPath: string, files: string[], flag: 'assume-unchanged' | 'skip-worktree', value: boolean) => Promise<void>;
  /** Delete file: `git rm -f` when tracked, fs removal for untracked. */
  deleteFile: (repoPath: string, file: string) => Promise<void>;
  /** Delete MULTIPLE files in one git call (much faster than N sequential calls). */
  deleteFiles: (repoPath: string, files: string[]) => Promise<void>;

  // LFS support
  lfsStatus: (repoPath: string) => Promise<{ installed: boolean; files: { path: string; size: string; status: string }[] }>;
  /** Check if git-lfs is installed (preflight before any LFS command). */
  isLfsInstalled: (repoPath: string) => Promise<boolean>;
  lfsPull: (repoPath: string, files?: string[]) => Promise<void>;
  lfsPush: (repoPath: string) => Promise<void>;
  lfsFetch: (repoPath: string) => Promise<void>;
  lfsInstall: (repoPath: string) => Promise<void>;
  /** Detect if .gitattributes has LFS filter rules (filter=lfs / diff=lfs / merge=lfs). */
  detectLfsConfigured: (repoPath: string) => Promise<boolean>;
  /** Remove LFS filter lines from .gitattributes. Returns number of lines removed. */
  removeLfsFilter: (repoPath: string) => Promise<number>;
  lfsTrack: (repoPath: string, patterns: string[]) => Promise<void>;
  lfsList: (repoPath: string) => Promise<string[]>;

  // Split commit
  splitCommit: (repoPath: string, hash: string) => Promise<{ started: boolean; message?: string }>;

  // Stage specific lines (patch-based)
  stageLines: (repoPath: string, file: string, lineRanges: { start: number; end: number }[]) => Promise<void>;
  unstageLines: (repoPath: string, file: string, lineRanges: { start: number; end: number }[]) => Promise<void>;

  // Repository directory tree (Changes view)
  listDirectories: (repoPath: string, maxDepth?: number) => Promise<DirNode[]>;
  /** Like listDirectories but includes ALL directories — even those normally
   *  skipped (node_modules, dist, .cache). Used when 'ignored' flag is ON. */
  listAllDirectories: (repoPath: string, maxDepth?: number) => Promise<DirNode[]>;

  // ===== Git Notes (SmartGit Notes feature) =====
  noteCategories: (repoPath: string) => Promise<NoteCategory[]>;
  notesList: (repoPath: string, notesRef: string, maxCount?: number) => Promise<CommitNote[]>;
  notesShow: (repoPath: string, notesRef: string, commit: string) => Promise<string | null>;
  notesAdd: (repoPath: string, notesRef: string, commit: string, message: string, force?: boolean) => Promise<void>;
  notesRemove: (repoPath: string, notesRef: string, commit: string) => Promise<void>;

  // ===== Subtrees (SmartGit Remote | Subtree) =====
  subtrees: (repoPath: string) => Promise<SubtreeInfo[]>;
  subtreeAdd: (repoPath: string, opts: { name: string; path: string; remote: string; branch: string; squash?: boolean; remoteUrl?: string }) => Promise<void>;
  subtreePull: (repoPath: string, name: string) => Promise<void>;
  subtreePush: (repoPath: string, name: string) => Promise<void>;
  subtreeSplit: (repoPath: string, name: string, opts?: { rejoin?: boolean; annotate?: string }) => Promise<string>;
  subtreeRemove: (repoPath: string, name: string) => Promise<void>;

  // ===== LFS file locks (SmartGit Local | LFS | Lock/Unlock) =====
  lfsLocks: (repoPath: string, local?: boolean) => Promise<LfsLockInfo[]>;
  lfsLock: (repoPath: string, file: string) => Promise<void>;
  lfsUnlock: (repoPath: string, file: string, force?: boolean) => Promise<void>;

  // ===== Format Patch (git format-patch) =====
  formatPatch: (repoPath: string, opts: { outputDir: string; commit?: string; from?: string; to?: string }) => Promise<string[]>;

  // ===== Edit commit author (SmartGit "Edit Author") =====
  editCommitAuthor: (repoPath: string, hash: string, name: string, email: string) => Promise<void>;

  // ===== Verify Database / Garbage Collect (Query menu) =====
  verifyDatabase: (repoPath: string) => Promise<string>;
  garbageCollect: (repoPath: string, aggressive?: boolean) => Promise<string>;
  unreachableCommits: (repoPath: string) => Promise<UnreachableCommit[]>;

  // ===== Bugtraq issue-tracker links =====
  bugtraqConfig: (repoPath: string) => Promise<BugtraqConfig | null>;

  // ===== Index Editor helpers =====
  setIndexContent: (repoPath: string, file: string, content: string) => Promise<void>;
  showFile: (repoPath: string, ref: string, file: string) => Promise<string>;

  // ============================================================
  // SmartGit Manual extended features (Power User batch)
  // ============================================================

  /** Recyclable commits — unreachable reflog commits eligible for GC. */
  recyclableCommits: (repoPath: string) => Promise<RecyclableCommit[]>;

  /** LFS Lock support (server-side list). */
  lfsListLocks: (repoPath: string, remote?: string) => Promise<LfsLock[]>;

  /** Git Notes — add/show/remove notes on commits (Power User batch). */
  noteShow: (repoPath: string, commit: string, ref?: string) => Promise<string>;
  noteAdd: (repoPath: string, commit: string, content: string, ref?: string, force?: boolean) => Promise<void>;
  noteRemove: (repoPath: string, commit: string, ref?: string) => Promise<void>;

  /** Force compare (bypass maxFileSize limit). */
  forceCompare: (repoPath: string, file: string, options?: { staged?: boolean; ref?: string }) => Promise<DiffResult>;

  /** EOL-only change detection. */
  isEolOnlyChange: (repoPath: string, file: string) => Promise<boolean>;

  /** Push to Gerrit — refs/for/<branch>. */
  pushToGerrit: (repoPath: string, branch?: string, remote?: string, options?: { draft?: boolean; reviewers?: string[]; topic?: string }) => Promise<string>;

  /** Partial clone (--filter=blob:none). */
  clonePartial: (url: string, targetPath: string, filter?: 'blob:none' | 'tree:0' | 'blob:limit=1m', options?: { depth?: number; branch?: string; recursive?: boolean }) => Promise<string>;

  /** Setup PrismGit as credential helper. */
  setupCredentialHelper: (repoPath: string) => Promise<void>;

  /** Bidirectional blame (past + future). */
  blameBidirectional: (repoPath: string, file: string, ref?: string) => Promise<BidirectionalBlameResult>;

  /** Pickaxe search — find commits that introduced or removed a string. */
  pickaxeSearch: (repoPath: string, file: string, search: string, options?: { regex?: boolean; ignoreCase?: boolean }) => Promise<{ hash: string; subject: string; date: string; lineNumbers: number[] }[]>;

  /** Detect renames with --find-renames=<threshold>%. */
  detectRenames: (repoPath: string, options?: { threshold?: number; ref?: string }) => Promise<{ from: string; to: string; similarity: number }[]>;

  /** Check if commit has been pushed to any remote. */
  isCommitPushed: (repoPath: string, hash: string) => Promise<boolean>;

  /** Squash multiple commits into one. */
  squashCommits: (repoPath: string, fromHash: string, toHash: string, message?: string) => Promise<void>;
  /** Coalesce two adjacent commits (combine messages). */
  coalesceCommits: (repoPath: string, firstHash: string, secondHash: string) => Promise<void>;

  // === SmartGit Manual v25/26 — extended backend (batch 1-7) ===
  /** Smart Pull — prevents divergence after remote force-push. */
  smartPull: (repoPath: string, remote?: string, branch?: string) => Promise<SmartPullResult>;
  /** Octopus Merge — merge 3+ branches in one commit. */
  octopusMerge: (repoPath: string, branches: string[]) => Promise<{ conflicts: string[]; success: boolean }>;
  /** Check if force-push is allowed by policy. */
  isForcePushAllowed: (branch: string | undefined, policy: ForcePushPolicy, protectedBranches?: string[]) => Promise<{ allowed: boolean; reason: string }>;
  /** Edit code in Diff view — apply a single-line change. */
  applyLineEdit: (repoPath: string, file: string, lineNumber: number, newContent: string, isStaged?: boolean) => Promise<void>;
  /** Edit .git/info/exclude (local-only ignore patterns). */
  editInfoExclude: (repoPath: string) => Promise<string>;
  /** Trace which .gitignore rule matches a file. */
  traceIgnoreRule: (repoPath: string, file: string) => Promise<IgnoreRuleTrace | null>;
  /** Detect repository object format (SHA-1 vs SHA-256) and ref storage. */
  detectRepoFormat: (repoPath: string) => Promise<RepoFormatInfo>;
  /** Commit with GPG/SSH signing (-S flag). */
  commitSigned: (repoPath: string, message: string, options?: { gpgSign?: boolean; sshSign?: boolean; signingKey?: string; noVerify?: boolean }) => Promise<string>;
  /** Create signed tag (annotated + signed). */
  createSignedTag: (repoPath: string, name: string, message: string, ref?: string, sshSign?: boolean) => Promise<void>;
  /** LFS fsck — validate LFS object integrity. */
  lfsFsck: (repoPath: string) => Promise<LfsFsckResult>;
  /** Multi-repo batch operation. */
  batchOperation: (repos: string[], operation: 'fetch' | 'pull' | 'push' | 'status', options?: { remote?: string; branch?: string; force?: boolean }) => Promise<BatchOpResult[]>;
  /** Export repo config as JSON for backup/migration. */
  exportConfig: (repoPath: string | null) => Promise<ExportableConfig>;
  /** Import config from JSON blob into a repo. */
  importConfig: (repoPath: string, config: ExportableConfig) => Promise<void>;
  /**
   * Release the cached SimpleGit instance (and its child process pool) for
   * the given repo. Pass undefined to clear the entire cache. Called by the
   * renderer when a repo is closed to avoid leaking SimpleGit instances
   * across the session.
   */
  invalidateCache: (repoPath?: string) => Promise<void>;
}

/** Recyclable commit (unreachable reflog commit). */
export interface RecyclableCommit {
  hash: string;
  hashAbbrev: string;
  subject: string;
  date: string;
  timestamp: number;
  source: string;
}

/** LFS lock entry as reported by the LFS server (git lfs locks). */
export interface LfsLock {
  id: string;
  path: string;
  owner: { name: string };
  lockedAt: string;
  createdAt: string;
}

/** Bidirectional blame result. */
export interface BidirectionalBlameResult {
  past: BlameResult;
  futureLines: { lineNumber: number; commits: { hash: string; subject: string; date: string }[] }[];
}


// ===== Extended SmartGit feature types =====

/** One category of git notes (smartgit-notes config section or the default "commits"). */
export interface NoteCategory {
  /** Category id (display name), e.g. "QA". */
  id: string;
  /** Ref below refs/notes/, e.g. "commits" or "qa". */
  ref: string;
  /** Optional RRGGBB color for graph display. */
  color?: string;
  /** Optional regex replacing the note icon in the graph. */
  graphRegex?: string;
}

/** A note attached to a commit. */
export interface CommitNote {
  commit: string;
  note: string;
}

/** A configured subtree (persisted in subtree.<name>.* config keys). */
export interface SubtreeInfo {
  name: string;
  /** Relative path inside the main repository. */
  path: string;
  remote: string;
  branch: string;
  squash: boolean;
}

/** An LFS file lock as returned by `git lfs locks --local` (PrismGit lfsLocks). */
export interface LfsLockInfo {
  id: string;
  path: string;
  owner?: string;
}

/** A commit no longer reachable from any ref (SmartGit "Recyclable Commits"). */
export interface UnreachableCommit {
  hash: string;
  hashAbbrev: string;
  subject: string;
  author: string;
  date: string;
  timestamp: number;
}

/** Bugtraq issue-tracker configuration (.gitbugtraq / [bugtraq] config section). */
export interface BugtraqConfig {
  /** URL template with %BUGID% placeholder. */
  url: string;
  /** Regex with exactly one capture group matching the issue id. */
  logregex: string;
  loglinkregex?: string;
  logfilterregex?: string;
  /** Project prefixes substituted into %PROJECT%. */
  projects?: string[];
}

// ============================================================
// SmartGit Manual v25/26 — extended types (batch 1-7)
// ============================================================

/** Force-push safety policy (SmartGit Manual: Force Push policies). */
export type ForcePushPolicy = 'deny' | 'feature-only' | 'allow';

/** Repository object format (Git 3.0 readiness — SHA-1 vs SHA-256). */
export type ObjectFormat = 'sha1' | 'sha256';

/** Reference storage backend (Git 3.0 readiness — files vs reftable). */
export type RefStorage = 'files' | 'reftable';

/** Result of a smart pull (prevents divergence after remote force-push). */
export interface SmartPullResult {
  strategy: 'reset' | 'rebase' | 'merge' | 'noop';
  message: string;
}

/** Repository format detection result. */
export interface RepoFormatInfo {
  objectFormat: ObjectFormat;
  refStorage: RefStorage;
}

/** Batch operation result for one repo. */
export interface BatchOpResult {
  repo: string;
  success: boolean;
  error?: string;
}

/** Trace result for `git check-ignore -v`. */
export interface IgnoreRuleTrace {
  source: string;
  lineNumber: number;
  pattern: string;
}

/** Exportable config blob for backup/migration. */
export interface ExportableConfig {
  version: string;
  exportedAt: string;
  gitConfig?: { key: string; value: string }[];
  gitignore?: string;
  infoExclude?: string;
  bugtraq?: string;
  gitreview?: string;
}

/** LFS fsck validation result. */
export interface LfsFsckResult {
  ok: boolean;
  output: string;
}
