import simpleGit, { type SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
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
} from '../types/git-api.js';

const gitCache = new Map<string, SimpleGit>();

function getGit(repoPath: string): SimpleGit {
  let git = gitCache.get(repoPath);
  if (!git) {
    git = simpleGit({
      baseDir: repoPath,
      binary: 'git',
      // Limit concurrent git processes to reduce memory spikes.
      // 2 is enough for most workflows (e.g. status + log in parallel).
      // Higher values (4+) spawn more child processes = more RAM.
      maxConcurrentProcesses: 2,
      trimmed: false,
    });
    gitCache.set(repoPath, git);
  }
  return git;
}

function invalidateCache(repoPath?: string) {
  if (repoPath) {
    gitCache.delete(repoPath);
  } else {
    gitCache.clear();
  }
}

// State detection helpers
async function detectRepoState(repoPath: string) {
  const gitDir = path.join(repoPath, '.git');
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
  const state = await detectRepoState(repoPath);
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
    detached: !s.current && s.files.length === 0 && !s.tracking,
  };
}

export async function add(repoPath: string, files: string[]): Promise<void> {
  const git = getGit(repoPath);
  if (files.length === 0) return;
  await git.add(files);
}

export async function addAll(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  await git.add('-A');
}

export async function restore(repoPath: string, files: string[], staged = false): Promise<void> {
  const git = getGit(repoPath);
  const args = ['restore'];
  if (staged) args.push('--staged');
  args.push('--', ...files);
  await git.raw(args);
}

export async function commit(
  repoPath: string,
  message: string,
  amend = false,
  signoff = false,
  noVerify = false
): Promise<string> {
  const git = getGit(repoPath);
  const args: string[] = ['-m', message];
  if (amend) args.push('--amend', '--no-edit');
  if (signoff) args.push('--signoff');
  if (noVerify) args.push('--no-verify');
  const result = await git.commit(args);
  return result.commit;
}

export async function push(
  repoPath: string,
  remote = 'origin',
  branch?: string,
  setUpstream = false,
  force = false,
  tags = false
): Promise<void> {
  const git = getGit(repoPath);
  const args: string[] = ['push'];
  if (setUpstream) args.push('-u');
  if (force) args.push('--force-with-lease');
  if (tags) args.push('--tags');
  args.push(remote);
  if (branch) args.push(`HEAD:${branch}`);
  await git.raw(args);
}

export async function pull(
  repoPath: string,
  remote = 'origin',
  branch?: string,
  rebase = false,
  noFF = false
): Promise<void> {
  const git = getGit(repoPath);
  const args: string[] = ['pull'];
  if (rebase) args.push('--rebase');
  if (noFF) args.push('--no-ff');
  args.push(remote);
  if (branch) args.push(branch);
  await git.raw(args);
}

export async function fetch(
  repoPath: string,
  remote = 'origin',
  prune = false,
  tags = false
): Promise<void> {
  const git = getGit(repoPath);
  const args: string[] = ['fetch'];
  if (prune) args.push('--prune');
  if (tags) args.push('--tags');
  args.push(remote);
  await git.raw(args);
}

export async function fetchAll(repoPath: string, prune = false): Promise<void> {
  const git = getGit(repoPath);
  const args: string[] = ['fetch', '--all'];
  if (prune) args.push('--prune');
  await git.raw(args);
}

export async function log(
  repoPath: string,
  options: { maxCount?: number; branch?: string; branches?: string[]; file?: string; follow?: boolean; all?: boolean } = {}
): Promise<LogEntry[]> {
  const git = getGit(repoPath);
  const { maxCount = 500, branch, branches, file, follow = false, all = false } = options;

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

  const rawArgs = ['log', `-${maxCount}`, `--pretty=format:${pretty}${commitSep}`, '--date=iso-strict', '--decorate=full'];

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
  const git = getGit(repoPath);
  const args: string[] = ['checkout'];
  if (options.newBranch) args.push('-b');
  if (options.force) args.push('--force');
  if (options.track) args.push('--track');
  args.push(branch);
  try {
    await git.raw(args);
  } catch (e) {
    // Extract meaningful error message from git output
    const err = e as { stderr?: string; message?: string };
    const msg = err?.stderr || err?.message || String(e);
    // Filter out simple-git noise — keep the actual git error line
    const lines = msg.split('\n').filter(l => l.includes('error:') || l.includes('fatal:'));
    throw new Error(lines.length > 0 ? lines.join('\n') : msg);
  }
}

export async function checkoutFile(repoPath: string, file: string, ref?: string): Promise<void> {
  const git = getGit(repoPath);
  await git.checkout([ref || 'HEAD', '--', file]);
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
    await git.raw(['push', 'origin', '--delete', name]);
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
    // Output: "<behind>\t<ahead>"  (left = base, right = compare)
    const [behind, ahead] = out.trim().split(/\s+/).map(n => parseInt(n, 10) || 0);
    return { ahead, behind };
  } catch {
    return { ahead: 0, behind: 0 };
  }
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

  const rawDiff = await git.raw(args);
  const oldPath = file;
  const newPath = file;

  let oldContent = '';
  let newContent = '';
  let binary = false;

  try {
    const stat = await git.raw(['show', `${options.ref || 'HEAD'}:${file}`]);
    oldContent = stat || '';
  } catch {
    oldContent = '';
  }
  try {
    const abs = path.join(repoPath, file);
    if (fs.existsSync(abs)) {
      const buf = fs.readFileSync(abs);
      if (buf.toString('utf8', 0, Math.min(8000, buf.length)).includes('\u0000')) {
        binary = true;
      } else {
        newContent = buf.toString('utf8');
      }
    }
  } catch {
    newContent = '';
  }

  const parsed = parseDiff(rawDiff, oldPath, newPath);
  return {
    oldContent,
    newContent,
    oldPath,
    newPath,
    hunks: parsed.hunks,
    binary: binary || rawDiff.includes('Binary files'),
    newFile: parsed.newFile,
    deletedFile: parsed.deletedFile,
    renamedFile: parsed.renamedFile,
    modeChange: parsed.modeChange,
  };
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

  // Get file list with status. Wrap in try/catch as defense-in-depth — even
  // with the preflight check, a race condition (commit gc'd between the check
  // and the show) would otherwise throw.
  let raw: string;
  try {
    raw = await git.raw(['show', '--no-color', '--name-status', '--format=', hash]);
  } catch {
    return [];
  }
  const result: CommitFile[] = [];
  const lines = raw.split('\n').filter(Boolean);
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const statusCode = parts[0];
    let pathStr = parts[1];
    let oldPath: string | undefined;
    if (statusCode.startsWith('R') || statusCode.startsWith('C')) {
      oldPath = parts[1];
      pathStr = parts[2];
    }
    // Get additions/deletions — this inner call already has its own try/catch
    // (the numstat is best-effort; if it fails we still want the file entry).
    let additions = 0;
    let deletions = 0;
    let binary = false;
    try {
      const numstat = await git.raw(['show', '--numstat', '--format=', hash, '--', pathStr]);
      const numLine = numstat.split('\n').find((l) => l.includes(pathStr));
      if (numLine) {
        const parts2 = numLine.split('\t');
        if (parts2[0] === '-') binary = true;
        else additions = parseInt(parts2[0] || '0', 10) || 0;
        if (parts2[1] === '-') binary = true;
        else deletions = parseInt(parts2[1] || '0', 10) || 0;
      }
    } catch {
      /* ignore — numstat is best-effort */
    }
    result.push({
      path: pathStr,
      status: statusCode,
      oldPath,
      additions,
      deletions,
      binary,
      mode: '',
    });
  }
  return result;
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
  // Returns the stash hash if successful, empty if no changes
  return out.trim();
}

export async function stashPop(repoPath: string, index = 0): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['stash', 'pop', `stash@{${index}}`]);
}

export async function stashApply(repoPath: string, index = 0): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['stash', 'apply', `stash@{${index}}`]);
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
  await git.raw(['fetch', remote, '--deepen', String(Math.max(1, commits))]);
  invalidateCache(repoPath);
}

/**
 * "Set Depth..." — set the fetch depth for a shallow clone
 * (git fetch --depth=N). depth <= 0 means unshallow (download full history).
 */
export async function setFetchDepth(repoPath: string, remote = 'origin', depth: number): Promise<void> {
  const git = getGit(repoPath);
  if (depth > 0) {
    await git.raw(['fetch', remote, '--depth', String(depth)]);
  } else {
    await git.raw(['fetch', '--unshallow', remote]);
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
    await git.raw(['push', 'origin', '--delete', name]);
  } else {
    await git.tag(['-d', name]);
  }
}

export async function pushTag(repoPath: string, name: string, remote = 'origin'): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['push', remote, name]);
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
      trackedCommit = trackedCommit.trim().split(' ')[1] || '';
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

export async function cherryPick(
  repoPath: string,
  hashes: string[],
  noCommit = false
): Promise<{ conflicts: string[] }> {
  const git = getGit(repoPath);
  const args = ['cherry-pick'];
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

export async function cherryPickAbort(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['cherry-pick', '--abort']);
}

export async function cherryPickContinue(repoPath: string): Promise<void> {
  const git = getGit(repoPath);
  await git.raw(['cherry-pick', '--continue', '--no-edit']);
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
  return git.raw(['bisect', 'log']);
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
    rev = (await git.raw(['bisect', 'view'])).trim().split('\n')[0];
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
  // Use git filter-branch to rewrite commit message
  // Simpler approach: use git commit --amend for HEAD only
  if (hash === 'HEAD' || hash === (await revParse(repoPath, 'HEAD'))) {
    const git = getGit(repoPath);
    // NOTE: git.commit(array) is interpreted by simple-git as MULTIPLE -m
    // flags, which silently breaks the amend. Use raw args instead.
    await git.raw(['commit', '--amend', '-m', message]);
  } else {
    // For non-HEAD commits, use filter-branch
    const git = getGit(repoPath);
    const escaped = message.replace(/'/g, "'\\''");
    await git.raw([
      'filter-branch', '-f', '--msg-filter',
      `if [ "$GIT_COMMIT" = "${hash}" ]; then echo '${escaped}'; else cat; fi`,
      `${hash}^..HEAD`,
    ]);
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

export async function configList(
  repoPath: string,
  scope?: 'system' | 'global' | 'local'
): Promise<GitConfigEntry[]> {
  const git = getGit(repoPath);
  const args = ['config', '--list'];
  if (scope === 'system') args.push('--system');
  else if (scope === 'global') args.push('--global');
  else if (scope === 'local') args.push('--local');
  const result = await git.raw(args);
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
  await git.raw(args);
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
  await git.raw(['reset', ref || 'HEAD', '--', file]);
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
    // Check if LFS is initialized
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
    return;
  }
  const { header, hunks } = parseUnifiedZero(diffOut);
  const pure = filterPureHunks(hunks.filter((h) => h.type !== 'mixed'), lineRanges);
  const mixed = filterMixedHunks(hunks.filter((h) => h.type === 'mixed'), lineRanges);
  const body = [...pure, ...mixed];
  if (body.length === 0) return; // nothing matched the selection
  const patch = `${header}\n${body.join('\n')}\n`;
  await applyPatchToIndex(git, patch, false);
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
  budget: DirBudget
): Promise<DirNode[]> {
  if (depth > maxDepth || budget.count >= budget.max) return [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(path.join(absBase, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const names = entries
    .filter((e) => e.isDirectory() && !DIR_SKIP.has(e.name))
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
      children: await buildDirLevel(absBase, childRel, depth + 1, maxDepth, budget),
    });
  }
  return nodes;
}

/** List repository directories (Changes view tree), skipping VCS/build directories. */
export async function listDirectories(repoPath: string, maxDepth = 1024): Promise<DirNode[]> {
  // No practical depth or node limit — 1024 depth, 200000 node budget.
  // These are just safety guards against pathological filesystems (e.g. symlink loops).
  const budget: DirBudget = { count: 0, max: 200000 };
  return buildDirLevel(repoPath, '', 1, maxDepth, budget);
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
  options: string[] = []
): Promise<string> {
  const git = getGit(repoPath);
  // git grep exits with code 1 when there are NO matches — simple-git treats
  // non-zero exit as an error and throws. We need to catch that and return
  // an empty string (no matches = valid result, not an error).
  try {
    return await git.raw(['grep', ...options, '--', pattern]);
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
  return await git.listRemote([remote]);
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
  const git = getGit(repoPath);
  try {
    return await git.raw(['notes', `--ref=${notesRef}`, 'show', commit]);
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
  const args = ['push', remote, ref];
  if (options?.topic) args.push(`topic=${options.topic}`);
  if (options?.reviewers && options.reviewers.length) {
    for (const r of options.reviewers) args.push(`r=${r}`);
  }
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
  const git = getGit(repoPath);
  try {
    await git.raw(['config', '--local', 'credential.helper', '']);
    // We don't actually have a real credential helper here, so leave it as a config note.
    // The intent is: future PrismGit installs a credential helper that this enables.
    await git.addConfig('credential.helper', 'store', false /* local */);
  } catch {
    /* ignore */
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

  // For each line in past blame, find future commits (timestamp > blame commit's timestamp) that touched this file
  for (const line of past.lines) {
    const lineCommitTimestamp = Date.parse(line.authorTime);
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
  const args = ['log', '-S', search, '--format=%H%x1f%s%x1f%cI', '--follow', '--', file];
  if (options?.regex) {
    args.splice(2, 1, '-G', search);
  }
  if (options?.ignoreCase) {
    args.push('-i');
  }
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
  // Get list of commits from fromHash..toHash (oldest first)
  const list = await git.raw(['rev-list', '--reverse', `${fromHash}^..${toHash}`]);
  const hashes = list.trim().split('\n').filter(Boolean);
  if (hashes.length < 2) return;
  // Create a sequence editor that turns all but the first into fixup
  const editorScript = path.join(repoPath, '.git', 'prismgit-seq-editor.sh');
  const lines: string[] = [];
  hashes.forEach((h, i) => {
    if (i === 0) {
      lines.push(`pick ${h} ${message || 'squashed'}`);
    } else {
      lines.push(`fixup ${h}`);
    }
  });
  fs.writeFileSync(editorScript, `#!/bin/sh\necho '${lines.join('\\n')}' > "$1"\n`, { mode: 0o755 });
  try {
    await git.raw(['-c', 'core.editor=' + editorScript, 'rebase', '-i', `${fromHash}^`]);
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
  // Find which is older
  const git = getGit(repoPath);
  const order = await git.raw(['rev-list', '--reverse', '--format=%H', `${firstHash}~1..${secondHash}`]);
  const hashes = order.trim().split('\n').filter(l => l.startsWith('commit ')).map(l => l.substring(7));
  if (hashes.length < 2) return;
  const older = hashes[0];
  const newer = hashes[hashes.length - 1];
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
export { invalidateCache };
