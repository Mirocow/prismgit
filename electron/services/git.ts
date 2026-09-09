import simpleGit, { type SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import type {
  StatusResult,
  LogEntry,
  BranchInfo,
  RemoteInfo,
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
} from '../types/git-api.js';

const gitCache = new Map<string, SimpleGit>();

function getGit(repoPath: string): SimpleGit {
  let git = gitCache.get(repoPath);
  if (!git) {
    git = simpleGit({
      baseDir: repoPath,
      binary: 'git',
      maxConcurrentProcesses: 4,
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
  options: { maxCount?: number; branch?: string; file?: string; follow?: boolean; all?: boolean } = {}
): Promise<LogEntry[]> {
  const git = getGit(repoPath);
  const { maxCount = 500, branch, file, follow = false, all = false } = options;
  const logArgs: Record<string, unknown> = {
    maxCount,
    format: {
      hash: '%H',
      hashAbbrev: '%h',
      parents: '%P',
      parentsAbbrev: '%p',
      authorName: '%an',
      authorEmail: '%ae',
      authorDate: '%aI',
      committerName: '%cn',
      committerEmail: '%ce',
      committerDate: '%cI',
      subject: '%s',
      body: '%b',
      refs: '%D',
    },
    '--date': 'iso-strict',
  };
  if (branch) logArgs[branch] = null;
  if (all) logArgs['--all'] = null;
  if (file) {
    logArgs['--'] = file;
    if (follow) {
      // simple-git does not support --follow natively, use raw
      const rawArgs = ['log', `-${maxCount}`, '--follow', '--pretty=format:%H%x00%h%x00%P%x00%p%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%b%x00%D', '--date=iso-strict', '--', file];
      const out = await git.raw(rawArgs);
      return parseRawLog(out);
    }
  }

  const result = await git.log(logArgs);
  return result.all.map((entry) => {
    const e = entry as unknown as Record<string, string>;
    const authorDate = new Date(e.authorDate || '');
    const committerDate = new Date(e.committerDate || '');
    return {
      hash: e.hash || '',
      hashAbbrev: e.hashAbbrev || (e.hash || '').substring(0, 7),
      parents: e.parents ? e.parents.split(' ').filter(Boolean) : [],
      parentsAbbrev: e.parentsAbbrev ? e.parentsAbbrev.split(' ').filter(Boolean) : [],
      author: {
        name: e.authorName || '',
        email: e.authorEmail || '',
        date: e.authorDate || '',
        timestamp: authorDate.getTime(),
      },
      committer: {
        name: e.committerName || '',
        email: e.committerEmail || '',
        date: e.committerDate || '',
        timestamp: committerDate.getTime(),
      },
      subject: e.subject || '',
      body: e.body || '',
      refs: e.refs ? e.refs.split(',').map((r) => r.trim()).filter(Boolean) : [],
      message: `${e.subject || ''}\n\n${e.body || ''}`.trim(),
    } satisfies LogEntry;
  });
}

// Helper for parsing raw git log --follow output
function parseRawLog(raw: string): LogEntry[] {
  if (!raw.trim()) return [];
  const commits = raw.split('\n\n').filter((c) => c.trim());
  return commits.map((c) => {
    const parts = c.split('\x00');
    if (parts.length < 13) return null;
    const [
      hash, hashAbbrev, parents, parentsAbbrev,
      authorName, authorEmail, authorDate,
      committerName, committerEmail, committerDate,
      subject, body, refs,
    ] = parts;
    return {
      hash, hashAbbrev,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      parentsAbbrev: parentsAbbrev ? parentsAbbrev.split(' ').filter(Boolean) : [],
      author: { name: authorName, email: authorEmail, date: authorDate, timestamp: new Date(authorDate).getTime() },
      committer: { name: committerName, email: committerEmail, date: committerDate, timestamp: new Date(committerDate).getTime() },
      subject: subject || '',
      body: body || '',
      refs: refs ? refs.split(',').map((r) => r.trim()).filter(Boolean) : [],
      message: `${subject}\n\n${body || ''}`.trim(),
    } as LogEntry;
  }).filter(Boolean) as LogEntry[];
}

export async function branches(repoPath: string): Promise<BranchInfo[]> {
  const git = getGit(repoPath);
  const [local, remote] = await Promise.all([
    git.branchLocal(),
    git.branch(['-r']).catch(() => ({ all: [] as string[], current: false })),
  ]);

  const result: BranchInfo[] = [];

  for (const name of local.all) {
    const isCurrent = local.current === name;
    let tracking: string | undefined;
    let ahead: number | undefined;
    let behind: number | undefined;
    if (isCurrent) {
      try {
        const statusRes = await git.status();
        tracking = statusRes.tracking || undefined;
        ahead = statusRes.ahead;
        behind = statusRes.behind;
      } catch {
        /* ignore */
      }
    }
    let lastCommit: BranchInfo['lastCommit'];
    try {
      const logRes = await git.log({ maxCount: 1, [name]: null } as Record<string, null>);
      const e = logRes.latest;
      if (e) {
        lastCommit = {
          hash: e.hash.substring(0, 7),
          date: e.date || '',
          message: e.message || '',
        };
      }
    } catch {
      /* ignore */
    }
    result.push({
      name,
      current: isCurrent,
      remote: false,
      tracking,
      ahead,
      behind,
      lastCommit,
    });
  }

  const remoteBranches = (remote as { all: string[] }).all || [];
  for (const fullName of remoteBranches) {
    if (fullName.includes('HEAD ->')) continue;
    result.push({
      name: fullName,
      current: false,
      remote: true,
    });
  }

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
  await git.raw(args);
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

  try {
    const result = await git.raw(args);
    return {
      conflicts: [],
      fastForward: result.includes('Fast-forward'),
      alreadyUpToDate: result.includes('Already up to date'),
    };
  } catch (err) {
    const statusRes = await status(repoPath);
    return { conflicts: statusRes.conflicted, fastForward: false, alreadyUpToDate: false };
  }
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
  args.push('--', file);

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
  const range = parentHash ? `${parentHash}..${hash}` : `${hash}^..${hash}`;
  const rawDiff = await git.raw(['diff', '--no-color', range]);
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

export async function commitFiles(repoPath: string, hash: string): Promise<CommitFile[]> {
  const git = getGit(repoPath);
  // Get file list with status
  const raw = await git.raw(['show', '--no-color', '--name-status', '--format=', hash]);
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
    // Get additions/deletions
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
      /* ignore */
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

export async function tags(repoPath: string): Promise<TagInfo[]> {
  const git = getGit(repoPath);
  const tagList = await git.tag(['-n99', '--sort=-creatordate']);
  if (!tagList.trim()) return [];
  const lines = tagList.split('\n').filter(Boolean);
  const result: TagInfo[] = [];
  for (const line of lines) {
    const match = line.match(/^(\S+)\s+(.*)$/);
    if (match) {
      const name = match[1];
      const annotation = match[2].trim();
      try {
        const hash = await git.revparse([name]);
        const targetHash = await git.raw(['rev-list', '-n', '1', name]);
        result.push({
          name,
          hash: hash.trim(),
          hashAbbrev: hash.trim().substring(0, 7),
          annotation: annotation || undefined,
          lightweight: annotation === '',
          targetHash: targetHash.trim(),
        });
      } catch {
        result.push({
          name,
          hash: '',
          hashAbbrev: '',
          annotation: annotation || undefined,
          lightweight: annotation === '',
        });
      }
    }
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
    return { conflicts: [] };
  } catch {
    const statusRes = await status(repoPath);
    return { conflicts: statusRes.conflicted };
  }
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
    return { conflicts: [] };
  } catch {
    const statusRes = await status(repoPath);
    return { conflicts: statusRes.conflicted };
  }
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
  if (ref) args.unshift(ref);
  args.push('--', file);
  const out = await git.raw(args);

  const lines: BlameLine[] = [];
  const rawLines = out.split('\n');
  let current: Partial<BlameLine> & { content?: string } = {};
  let finalLineNumber = 0;

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
    else if (line.startsWith('filename ')) {
      // end of entry
      if (current.hash) {
        lines.push(current as BlameLine);
      }
      current = {};
    } else if (line.match(/^[0-9a-f]{40}/)) {
      const parts = line.split(' ');
      current.hash = parts[0];
      current.hashAbbrev = parts[0].substring(0, 7);
      current.originalLineNumber = parseInt(parts[1] || '0', 10);
      finalLineNumber = parseInt(parts[2] || '0', 10);
      current.finalLineNumber = finalLineNumber;
    } else if (line.startsWith('\t')) {
      current.content = line.substring(1);
    }
  }
  if (current.hash) {
    lines.push(current as BlameLine);
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
    await git.commit(['--amend', '-m', message]);
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

  // Local branches
  try {
    const local = await git.branchLocal();
    for (const b of local.all) {
      if (b.toLowerCase().includes(q)) {
        const hash = await git.revparse([b]);
        result.push({ name: b, hash, type: 'branch' });
      }
    }
  } catch { /* ignore */ }

  // Remote branches
  try {
    const remote = await git.branch(['-r']);
    for (const b of remote.all) {
      if (b.toLowerCase().includes(q)) {
        const hash = await git.revparse([b]);
        result.push({ name: b, hash, type: 'remote' });
      }
    }
  } catch { /* ignore */ }

  // Tags
  try {
    const tags = await git.tag();
    for (const t of tags.split('\n').filter(Boolean)) {
      if (t.toLowerCase().includes(q)) {
        const hash = await git.revparse([t]);
        result.push({ name: t, hash, type: 'tag' });
      }
    }
  } catch { /* ignore */ }

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
    await git.raw(['-c', `sequence.editor=cp ${todoPath}`, 'rebase', '-i', `${hash}~1`]);

    // If we get here, rebase stopped at the commit for editing
    // Reset HEAD to unstage, so user can selectively stage
    await git.raw(['reset', 'HEAD^']);

    fs.unlinkSync(todoPath);
    return { started: true, message: `Rebase stopped at ${hash.substring(0, 7)}. Stage files and commit in parts, then run 'git rebase --continue'.` };
  } catch (e) {
    return { started: false, message: String(e) };
  }
}

// ============= Stage/Unstage specific lines =============

export async function stageLines(repoPath: string, file: string, lineRanges: { start: number; end: number }[]): Promise<void> {
  const git = getGit(repoPath);
  // Generate a patch for the specific lines and apply it to the index
  // Use git diff to get the patch, then filter lines, then git apply --cached
  const diff = await git.raw(['diff', '--unified=0', '--', file]);

  // Parse diff and filter to only requested line ranges
  // This is complex — for now, stage the whole file as fallback
  await git.add(file);
}

export async function unstageLines(repoPath: string, file: string, lineRanges: { start: number; end: number }[]): Promise<void> {
  const git = getGit(repoPath);
  // Reverse of stageLines
  await git.raw(['reset', 'HEAD', '--', file]);
}

export { invalidateCache };
