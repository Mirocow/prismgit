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
  log: (repoPath: string, options?: { maxCount?: number; branch?: string; file?: string; follow?: boolean; all?: boolean }) => Promise<LogEntry[]>;
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
  diff: (repoPath: string, file: string, options?: { staged?: boolean; ref?: string }) => Promise<DiffResult>;
  diffBranches: (repoPath: string, base: string, compare: string) => Promise<DiffResult>;
  diffCommit: (repoPath: string, hash: string, parentHash?: string) => Promise<DiffResult>;
  commitFiles: (repoPath: string, hash: string) => Promise<CommitFile[]>;
  stashList: (repoPath: string) => Promise<StashEntry[]>;
  stashPush: (repoPath: string, message?: string, includeUntracked?: boolean, keepIndex?: boolean, files?: string[]) => Promise<string>;
  stashPop: (repoPath: string, index?: number) => Promise<void>;
  stashApply: (repoPath: string, index?: number) => Promise<void>;
  stashDrop: (repoPath: string, index?: number) => Promise<void>;
  stashBranch: (repoPath: string, branch: string, index?: number) => Promise<void>;
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
  raw: (repoPath: string, args: string[]) => Promise<string>;

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
}
