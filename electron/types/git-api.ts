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

export interface GitApi {
  status: (repoPath: string) => Promise<StatusResult>;
  add: (repoPath: string, files: string[]) => Promise<void>;
  addAll: (repoPath: string) => Promise<void>;
  restore: (repoPath: string, files: string[], staged?: boolean) => Promise<void>;
  commit: (repoPath: string, message: string, amend?: boolean, signoff?: boolean, noVerify?: boolean) => Promise<string>;
  push: (repoPath: string, remote?: string, branch?: string, setUpstream?: boolean, force?: boolean, tags?: boolean) => Promise<void>;
  pull: (repoPath: string, remote?: string, branch?: string, rebase?: boolean, noFF?: boolean) => Promise<void>;
  fetch: (repoPath: string, remote?: string, prune?: boolean, tags?: boolean) => Promise<void>;
  fetchAll: (repoPath: string, prune?: boolean) => Promise<void>;
  /** Deepen a shallow clone by N commits (git fetch --deepen=N). */
  fetchDeepen: (repoPath: string, remote?: string, commits?: number) => Promise<void>;
  /** Set shallow fetch depth (git fetch --depth=N); depth <= 0 → --unshallow. */
  setFetchDepth: (repoPath: string, remote?: string, depth?: number) => Promise<void>;
  /** Read real remote properties (URLs, HEAD branch, tracking branches, config). */
  remoteProperties: (repoPath: string, name: string) => Promise<RemoteProperties>;
  log: (repoPath: string, options?: { maxCount?: number; branch?: string; branches?: string[]; file?: string; follow?: boolean; all?: boolean }) => Promise<LogEntry[]>;
  /** Resolve a commit by full/abbreviated hash (prefix search) — null when not found. */
  findCommit: (repoPath: string, query: string) => Promise<LogEntry | null>;
  branches: (repoPath: string) => Promise<BranchInfo[]>;
  remotes: (repoPath: string) => Promise<RemoteInfo[]>;
  checkout: (repoPath: string, branch: string, options?: { newBranch?: boolean; force?: boolean; track?: boolean }) => Promise<void>;
  checkoutFile: (repoPath: string, file: string, ref?: string) => Promise<void>;
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
  diff: (repoPath: string, file: string, options?: { staged?: boolean; ref?: string }) => Promise<DiffResult>;
  diffBranches: (repoPath: string, base: string, compare: string) => Promise<DiffResult>;
  diffCommit: (repoPath: string, hash: string, parentHash?: string) => Promise<DiffResult>;
  commitFiles: (repoPath: string, hash: string) => Promise<CommitFile[]>;
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
  stashPop: (repoPath: string, index?: number) => Promise<void>;
  stashApply: (repoPath: string, index?: number) => Promise<void>;
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

  // New: full git CLI surface coverage (added per simple-git comprehensive test spec)
  grep: (repoPath: string, pattern: string, options?: string[]) => Promise<string>;
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

  cherryPick: (repoPath: string, hashes: string[], noCommit?: boolean) => Promise<{ conflicts: string[] }>;
  cherryPickAbort: (repoPath: string) => Promise<void>;
  cherryPickContinue: (repoPath: string) => Promise<void>;

  revert: (repoPath: string, hashes: string[], noCommit?: boolean) => Promise<{ conflicts: string[] }>;
  revertAbort: (repoPath: string) => Promise<void>;
  revertContinue: (repoPath: string) => Promise<void>;

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
  /** Delete file: `git rm -f` when tracked, fs removal for untracked. */
  deleteFile: (repoPath: string, file: string) => Promise<void>;

  // LFS support
  lfsStatus: (repoPath: string) => Promise<{ installed: boolean; files: { path: string; size: string; status: string }[] }>;
  lfsPull: (repoPath: string, files?: string[]) => Promise<void>;
  lfsPush: (repoPath: string) => Promise<void>;
  lfsFetch: (repoPath: string) => Promise<void>;
  lfsInstall: (repoPath: string) => Promise<void>;
  lfsTrack: (repoPath: string, patterns: string[]) => Promise<void>;
  lfsList: (repoPath: string) => Promise<string[]>;

  // Split commit
  splitCommit: (repoPath: string, hash: string) => Promise<{ started: boolean; message?: string }>;

  // Stage specific lines (patch-based)
  stageLines: (repoPath: string, file: string, lineRanges: { start: number; end: number }[]) => Promise<void>;
  unstageLines: (repoPath: string, file: string, lineRanges: { start: number; end: number }[]) => Promise<void>;

  // Repository directory tree (Changes view)
  listDirectories: (repoPath: string, maxDepth?: number) => Promise<DirNode[]>;
}
