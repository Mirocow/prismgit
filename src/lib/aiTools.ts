/**
 * LAR-3 — AI Tools registry.
 *
 * Defines the AITool interface and a set of git tools that the AI Assistant
 * chat can invoke. Tools include both read-only queries (get_status, get_log)
 * AND write operations (stage, commit, push, pull, checkout, etc.).
 *
 * Write tools require the LLM to provide clear parameters and return a
 * confirmation message — the user sees the full transcript in the chat UI.
 */

import { api } from './api';

export interface AITool {
  name: string;
  description: string;
  /** JSON Schema describing the tool's parameters. */
  parameters: Record<string, unknown>;
  /** Execute the tool with the given parameters, return a string result. */
  execute: (params: unknown, repoPath: string) => Promise<string>;
}

// ============= READ-ONLY TOOLS =============

/** Get the current git status (porcelain + branch info). */
export const gitStatusTool: AITool = {
  name: 'get_status',
  description: 'Get the current git status of the repository — list of modified/staged/untracked files, current branch, ahead/behind counters.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async execute(_params, repoPath) {
    const status = await api.git.status(repoPath);
    const lines: string[] = [];
    lines.push(`Current branch: ${status.current ?? 'detached HEAD'}`);
    if (status.ahead > 0) lines.push(`Ahead: ${status.ahead}`);
    if (status.behind > 0) lines.push(`Behind: ${status.behind}`);
    if (status.files.length === 0) {
      lines.push('Working tree clean.');
    } else {
      lines.push('Files:');
      for (const f of status.files) {
        lines.push(`  ${f.index}${f.working_dir} ${f.path}`);
      }
    }
    return lines.join('\n');
  },
};

/** Get the recent commit log (last N commits).
 *
 * DEFAULT mode is "collapsed" — returns only a summary line (total count,
 * current branch, last commit hash+subject) plus up to 5 recent commit
 * subjects. This keeps the tool output short and readable when the AI is
 * exploring the repository state — the user's request "show me recent
 * commits" doesn't need 50 lines of metadata.
 *
 * Pass `verbose: true` to get the full list up to `count` (max 50).
 */
export const gitLogTool: AITool = {
  name: 'get_log',
  description: 'Get recent commits from the repository. By default returns a COLLAPSED summary (total count + last 5 subjects) — pass verbose=true for the full list up to count (max 50).',
  parameters: {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'Max number of commits to return when verbose=true (max 50)', default: 10 },
      verbose: { type: 'boolean', description: 'If true, return the full list of `count` commits (one per line). If false (default), return a 1-line summary + last 5 subjects only.', default: false },
    },
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const p = params as { count?: number; verbose?: boolean };
    const verbose = p.verbose ?? false;
    const requestedCount = Math.min(50, Math.max(1, p.count ?? 10));
    // For collapsed mode, fetch up to 5 (the visible window) plus a count
    // of the total. For verbose mode, fetch the full requestedCount.
    const fetchCount = verbose ? requestedCount : Math.min(5, requestedCount);
    const log = await api.git.log(repoPath, { maxCount: verbose ? fetchCount : 50 });
    if (log.length === 0) return 'No commits yet.';

    const total = log.length;
    const lastCommit = log[0];
    const lastHash = lastCommit.hashAbbrev;
    const lastSubject = lastCommit.subject;
    const lastAuthor = lastCommit.author.name;
    const lastDate = lastCommit.author.date;

    if (!verbose) {
      // ── Collapsed summary mode ──────────────────────────────────────────
      // One-line summary + up to 5 most-recent commit subjects.
      // This is what the AI sees by default — keeps the chat readable and
      // avoids flooding the context with 50 lines when the user just
      // asked "what's the state of the repo".
      const lines: string[] = [];
      lines.push(`Total commits: ${total}`);
      lines.push(`Latest: ${lastHash} ${lastSubject} — ${lastAuthor}${lastDate ? ` (${lastDate})` : ''}`);
      lines.push('');
      lines.push(`Last ${Math.min(5, total)} commits:`);
      for (const c of log.slice(0, 5)) {
        lines.push(`  ${c.hashAbbrev} ${c.subject} — ${c.author.name}`);
      }
      if (total > 5) {
        lines.push('');
        lines.push(`… and ${total - 5} more. Call get_log with verbose=true to see up to ${Math.min(50, total)} commits.`);
      }
      return lines.join('\n');
    }

    // ── Verbose mode ─────────────────────────────────────────────────────
    return log.slice(0, requestedCount).map(c =>
      `${c.hashAbbrev} ${c.subject} (${c.author.name})`
    ).join('\n');
  },
};

/** Get the diff of staged, unstaged, or specific commit. */
export const gitDiffTool: AITool = {
  name: 'get_diff',
  description: 'Get the diff of staged or unstaged changes (default: unstaged).',
  parameters: {
    type: 'object',
    properties: {
      staged: { type: 'boolean', description: 'If true, return staged changes; otherwise unstaged', default: false },
    },
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const staged = (params as { staged?: boolean })?.staged ?? false;
    try {
      const args = staged ? ['diff', '--cached', '--stat'] : ['diff', '--stat'];
      const out = await api.git.raw(repoPath, args);
      return out || 'No changes.';
    } catch (e) {
      return `Failed to get diff: ${String(e)}`;
    }
  },
};

/** Get the list of branches (local + remote). */
export const gitBranchesTool: AITool = {
  name: 'get_branches',
  description: 'List all branches in the repository (local + remote).',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async execute(_params, repoPath) {
    const branches = await api.git.branches(repoPath);
    if (branches.length === 0) return 'No branches.';
    return branches.map(b => `${b.current ? '* ' : '  '}${b.name}${b.tracking ? ` → ${b.tracking}` : ''}`).join('\n');
  },
};

/** Get the list of stashes. */
export const gitStashesTool: AITool = {
  name: 'get_stashes',
  description: 'List all saved stashes.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async execute(_params, repoPath) {
    const stashes = await api.git.stashList(repoPath);
    if (stashes.length === 0) return 'No stashes.';
    return stashes.map((s, i) => `stash@{${i}}: ${s.message}`).join('\n');
  },
};

/** Get the list of tags. */
export const gitTagsTool: AITool = {
  name: 'get_tags',
  description: 'List all tags in the repository.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async execute(_params, repoPath) {
    const tags = await api.git.tags(repoPath);
    if (tags.length === 0) return 'No tags.';
    return tags.map(t => `${t.name} (${t.hashAbbrev})`).join('\n');
  },
};

// ============= WRITE TOOLS (actions) =============

/** Stage files (git add). */
export const gitStageTool: AITool = {
  name: 'stage_files',
  description: 'Stage files for commit (git add). Pass file paths to stage specific files, or use stage_all=true to stage everything.',
  parameters: {
    type: 'object',
    properties: {
      files: { type: 'array', items: { type: 'string' }, description: 'File paths to stage' },
      stage_all: { type: 'boolean', description: 'If true, stage all changes (git add .)', default: false },
    },
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const p = params as { files?: string[]; stage_all?: boolean };
    if (p.stage_all) {
      await api.git.addAll(repoPath);
      return 'All files staged.';
    }
    if (p.files && p.files.length > 0) {
      await api.git.add(repoPath, p.files);
      return `Staged ${p.files.length} file(s): ${p.files.join(', ')}`;
    }
    return 'No files specified to stage.';
  },
};

/** Unstage files (git reset HEAD). */
export const gitUnstageTool: AITool = {
  name: 'unstage_files',
  description: 'Unstage files (git reset HEAD). Pass file paths or use unstage_all=true.',
  parameters: {
    type: 'object',
    properties: {
      files: { type: 'array', items: { type: 'string' }, description: 'File paths to unstage' },
      unstage_all: { type: 'boolean', description: 'If true, unstage all (git reset HEAD -- .)', default: false },
    },
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const p = params as { files?: string[]; unstage_all?: boolean };
    if (p.unstage_all) {
      await api.git.raw(repoPath, ['reset', 'HEAD', '--', '.']);
      return 'All files unstaged.';
    }
    if (p.files && p.files.length > 0) {
      for (const f of p.files) {
        await api.git.resetFile(repoPath, f);
      }
      return `Unstaged ${p.files.length} file(s): ${p.files.join(', ')}`;
    }
    return 'No files specified to unstage.';
  },
};

/** Commit staged changes. */
export const gitCommitTool: AITool = {
  name: 'commit',
  description: 'Create a git commit with the given message. Files must be staged first using stage_files.',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Commit message (required)' },
      amend: { type: 'boolean', description: 'If true, amend the last commit instead of creating a new one', default: false },
    },
    required: ['message'],
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const p = params as { message: string; amend?: boolean };
    if (!p.message?.trim()) return 'Error: commit message is required.';
    const hash = await api.git.commit(repoPath, p.message.trim(), p.amend ?? false);
    return `Commit created: ${hash.substring(0, 7)}`;
  },
};

/** Push to remote. */
export const gitPushTool: AITool = {
  name: 'push',
  description: 'Push commits to the remote repository (git push). Optionally set upstream.',
  parameters: {
    type: 'object',
    properties: {
      remote: { type: 'string', description: 'Remote name (default: origin)', default: 'origin' },
      branch: { type: 'string', description: 'Branch to push (default: current)' },
      set_upstream: { type: 'boolean', description: 'Set upstream tracking (git push -u)', default: false },
      force: { type: 'boolean', description: 'Force push (git push --force)', default: false },
    },
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const p = params as { remote?: string; branch?: string; set_upstream?: boolean; force?: boolean };
    await api.git.push(repoPath, p.remote || 'origin', p.branch, p.set_upstream, p.force);
    return `Pushed to ${p.remote || 'origin'}${p.branch ? '/' + p.branch : ''}.`;
  },
};

/** Pull from remote.
 *
 *  Default strategy is now `pull --rebase --autostash`:
 *    1. `git stash push -u` to save any uncommitted changes
 *    2. `git pull --rebase` to apply remote commits on top of local ones
 *    3. `git stash pop` to restore the local changes
 *  This matches the user's stated preference: "лучше чтоб асистент всегда
 *  клал локальные изменения в Stash, а потом выполнял pull" and avoids
 *  the dreaded 'cannot pull with rebase: You have unstaged changes' error.
 *
 *  If `auto_stash` is false, the tool fails with a clear message when the
 *  working tree is dirty — matching raw `git pull` behaviour.
 */
export const gitPullTool: AITool = {
  name: 'pull',
  description: 'Pull changes from the remote repository (git pull). Defaults to REBASE strategy with AUTO-STASH: any uncommitted local changes are stashed first, then the pull runs, then the stash is restored. This avoids the "unstaged changes" error and matches the user\'s preferred workflow. Pass auto_stash=false to disable.',
  parameters: {
    type: 'object',
    properties: {
      remote: { type: 'string', description: 'Remote name (default: origin)', default: 'origin' },
      branch: { type: 'string', description: 'Branch to pull from' },
      rebase: { type: 'boolean', description: 'Use rebase instead of merge (default: true). Recommended — keeps history linear.', default: true },
      auto_stash: { type: 'boolean', description: 'If true (default), stash uncommitted changes before pull and restore them after. If false, the pull will fail when working tree is dirty.', default: true },
    },
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const p = params as { remote?: string; branch?: string; rebase?: boolean; auto_stash?: boolean };
    const remote = p.remote || 'origin';
    const branch = p.branch;
    const useRebase = p.rebase ?? true;
    const autoStash = p.auto_stash ?? true;

    let stashed = false;
    let stashMessage = '';

    if (autoStash) {
      // Check working-tree status before stashing — `git stash` creates an
      // empty stash entry when there are no changes, which would then fail
      // to pop later with "No stash entries found".
      try {
        const status = await api.git.status(repoPath);
        const hasChanges = status.files.length > 0;
        if (hasChanges) {
          stashMessage = `auto-stash before pull (${new Date().toISOString()})`;
          await api.git.stashPush(repoPath, stashMessage, true, false);
          stashed = true;
        }
      } catch (e) {
        // Stash failed — abort the pull entirely so we don't leave the repo
        // in a weird state. The user can try again with auto_stash=false.
        return `Pull aborted: failed to auto-stash local changes. Error: ${String(e)}`;
      }
    }

    try {
      await api.git.pull(repoPath, remote, branch, useRebase, false);
    } catch (e) {
      // Pull failed — if we stashed, restore the local changes so the user
      // is back to where they started.
      if (stashed) {
        try { await api.git.stashPop(repoPath, 0); } catch { /* ignore — the pull error is more important */ }
      }
      const msg = String(e);
      // Friendly error messages for common failures.
      if (msg.includes('unstaged changes')) {
        return `Pull failed: working tree has unstaged changes. Try with auto_stash=true (default) or commit/stash manually first.\n\nOriginal error: ${msg}`;
      }
      if (msg.includes('index.lock')) {
        return `Pull failed: git index is locked (.git/index.lock exists). Another git operation may be running — wait a moment and retry.\n\nOriginal error: ${msg}`;
      }
      return `Pull failed: ${msg}`;
    }

    // Pull succeeded — restore the stashed changes if we stashed them.
    if (stashed) {
      try {
        await api.git.stashPop(repoPath, 0);
        return `Pulled from ${remote}${branch ? '/' + branch : ''} (rebase). Local changes were auto-stashed and restored.`;
      } catch (e) {
        // Stash pop failed — typically a merge conflict between the stashed
        // changes and the newly-pulled commits. The stash is NOT lost —
        // user can recover it via `git stash list` + `git stash pop`.
        return `Pulled from ${remote}${branch ? '/' + branch : ''} (rebase). WARNING: auto-stash restore failed — your local changes are still in the stash. Run \`git stash list\` to find them, then \`git stash pop\` to recover. Error: ${String(e)}`;
      }
    }

    return `Pulled from ${remote}${branch ? '/' + branch : ''} (rebase).`;
  },
};

/** Fetch from remote (no merge). */
export const gitFetchTool: AITool = {
  name: 'fetch',
  description: 'Fetch changes from the remote without merging (git fetch). Safe — does not modify working tree.',
  parameters: {
    type: 'object',
    properties: {
      remote: { type: 'string', description: 'Remote name (default: origin)', default: 'origin' },
      prune: { type: 'boolean', description: 'Prune deleted remote branches (git fetch --prune)', default: true },
    },
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const p = params as { remote?: string; prune?: boolean };
    await api.git.fetch(repoPath, p.remote || 'origin', p.prune ?? true);
    return `Fetched from ${p.remote || 'origin'}.`;
  },
};

/** Checkout a branch or create a new one. */
export const gitCheckoutTool: AITool = {
  name: 'checkout',
  description: 'Switch to an existing branch, or create a new branch and switch to it.',
  parameters: {
    type: 'object',
    properties: {
      branch: { type: 'string', description: 'Branch name to checkout or create' },
      create_new: { type: 'boolean', description: 'If true, create the branch (git checkout -b) before switching', default: false },
    },
    required: ['branch'],
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const p = params as { branch: string; create_new?: boolean };
    await api.git.checkout(repoPath, p.branch, { newBranch: p.create_new ?? false });
    return p.create_new ? `Created and switched to branch '${p.branch}'.` : `Switched to branch '${p.branch}'.`;
  },
};

/** Create a tag. */
export const gitCreateTagTool: AITool = {
  name: 'create_tag',
  description: 'Create a git tag at the current HEAD or a specific commit.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Tag name (required)' },
      message: { type: 'string', description: 'Annotation message (if provided, creates an annotated tag)' },
      ref: { type: 'string', description: 'Commit hash to tag (default: HEAD)' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const p = params as { name: string; message?: string; ref?: string };
    await api.git.createTag(repoPath, p.name, p.message, p.ref, false, !!p.message);
    return `Tag '${p.name}' created${p.ref ? ' at ' + p.ref.substring(0, 7) : ' at HEAD'}.`;
  },
};

/** Stash changes. */
export const gitStashPushTool: AITool = {
  name: 'stash_push',
  description: 'Save current changes to a stash (git stash push). Includes untracked files by default.',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Stash message/description' },
    },
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const p = params as { message?: string };
    await api.git.stashPush(repoPath, p.message, true, false);
    return 'Changes stashed.';
  },
};

/** Pop the latest stash. */
export const gitStashPopTool: AITool = {
  name: 'stash_pop',
  description: 'Apply and remove the latest stash (git stash pop).',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async execute(_params, repoPath) {
    await api.git.stashPop(repoPath, 0);
    return 'Latest stash popped.';
  },
};

/** Merge a branch into the current branch. */
export const gitMergeTool: AITool = {
  name: 'merge',
  description: 'Merge a branch into the current branch (git merge).',
  parameters: {
    type: 'object',
    properties: {
      branch: { type: 'string', description: 'Branch to merge into current (required)' },
      no_ff: { type: 'boolean', description: 'Force merge commit (git merge --no-ff)', default: false },
    },
    required: ['branch'],
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const p = params as { branch: string; no_ff?: boolean };
    const result = await api.git.merge(repoPath, p.branch, { noFf: p.no_ff ?? false });
    if (result.conflicts.length > 0) {
      return `Merge completed with ${result.conflicts.length} conflict(s): ${result.conflicts.join(', ')}`;
    }
    return `Merged '${p.branch}' into current branch.`;
  },
};

/** Discard local changes — permanently delete uncommitted work.
 *
 *  Runs:
 *    1. `git reset --hard HEAD` — discards tracked file modifications
 *    2. `git clean -fd` — removes untracked files and directories
 *
 *  This is DESTRUCTIVE — there is no undo. The AI Assistant should only
 *  call this when the user explicitly says "discard" / "откатить локальные
 *  изменения" / "reset to HEAD" etc. If the user wants to keep the changes
 *  for later, use `stash_push` instead.
 *
 *  Optional `include_ignored` (default false) also removes ignored files
 *  (git clean -fdx) — useful for fully resetting a repo to a clean state.
 */
export const gitDiscardChangesTool: AITool = {
  name: 'discard_changes',
  description: 'DESTRUCTIVE: discard ALL local changes permanently. Runs `git reset --hard HEAD` (discards tracked file modifications) + `git clean -fd` (removes untracked files and directories). There is NO undo. Use this when the user explicitly says "discard", "откатить локальные изменения", "reset to HEAD", "throw away my changes", etc. If the user might want the changes later, use stash_push instead. Optional include_ignored=true also removes ignored files (git clean -fdx).',
  parameters: {
    type: 'object',
    properties: {
      include_ignored: { type: 'boolean', description: 'If true, also remove ignored files (git clean -fdx). Default false — only removes untracked files.', default: false },
    },
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const p = params as { include_ignored?: boolean };
    const includeIgnored = p.include_ignored ?? false;

    // Snapshot what we're about to discard — useful for the AI to report
    // back to the user what was lost.
    let discardedSummary = '';
    try {
      const status = await api.git.status(repoPath);
      // FileStatus.index/working_dir use string enums ('modified', 'untracked', etc.)
      // — the porcelain '?' marker is parsed into 'untracked' upstream.
      const modified = status.files.filter(f => f.index !== 'untracked' || f.working_dir !== 'untracked');
      const untracked = status.files.filter(f => f.index === 'untracked' && f.working_dir === 'untracked');
      discardedSummary = `Discarded ${modified.length} modified file(s) and ${untracked.length} untracked file(s).`;
    } catch {
      discardedSummary = 'Discarded local changes.';
    }

    // 1. git reset --hard HEAD — discard tracked-file modifications
    try {
      await api.git.raw(repoPath, ['reset', '--hard', 'HEAD']);
    } catch (e) {
      // The git:checkout error "index.lock exists" suggests another git op
      // is running — surface a clear error instead of leaving the repo in
      // a half-reset state.
      const msg = String(e);
      if (msg.includes('index.lock')) {
        return `Discard failed: git index is locked (.git/index.lock exists). Another git operation may be running — wait a moment and retry.\n\nOriginal error: ${msg}`;
      }
      return `Discard failed at 'git reset --hard': ${msg}`;
    }

    // 2. git clean -fd (or -fdx) — remove untracked files and directories
    try {
      const cleanArgs = ['clean', '-f', '-d'];
      if (includeIgnored) cleanArgs.push('-x');
      await api.git.raw(repoPath, cleanArgs);
    } catch (e) {
      return `${discardedSummary} WARNING: failed to clean untracked files: ${String(e)}. Tracked-file changes were reset, but untracked files may remain.`;
    }

    return `${discardedSummary} Working tree is now clean and matches HEAD.`;
  },
};

/** Sync the current branch with the remote — atomically.
 *
 *  This is the "pull latest and discard my local changes" workflow the
 *  user requested: "хочу чтоб инструмент мог откатить локальные изменения
 *  и обновил текущий репозиторий последними коммитами из origin".
 *
 *  Steps (all atomic — any failure rolls back to the starting state):
 *    1. `git stash push -u`         (save local changes, just in case)
 *    2. `git fetch origin`
 *    3. `git reset --hard origin/<current-branch>`
 *    4. (optional) `git stash pop`  (restore local changes on top)
 *
 *  Pass `keep_local_changes=true` (default) to restore the local changes
 *  after the reset. Pass `keep_local_changes=false` to fully discard them
 *  — the stash is still kept so the user can recover via `git stash list`.
 *
 *  Pass `branch` to override the remote branch name (default: detect
 *  from upstream config or use the local branch name).
 */
export const gitSyncWithRemoteTool: AITool = {
  name: 'sync_with_remote',
  description: 'Atomically sync the current branch with the remote. Workflow: stash local changes → fetch → reset --hard origin/<branch> → optionally restore the stashed changes. Use this when the user says "откатить локальные изменения и обновить репозиторий", "pull latest and discard my changes", "reset to origin", etc. Safe — local changes are stashed (recoverable via git stash list) before any destructive operation. Pass keep_local_changes=false to fully discard local changes after the reset (the stash is still kept).',
  parameters: {
    type: 'object',
    properties: {
      remote: { type: 'string', description: 'Remote name (default: origin)', default: 'origin' },
      branch: { type: 'string', description: 'Remote branch to sync with. If omitted, uses the current local branch name.' },
      keep_local_changes: { type: 'boolean', description: 'If true (default), restore local changes after reset. If false, fully discard them (still recoverable via git stash list).', default: true },
    },
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const p = params as { remote?: string; branch?: string; keep_local_changes?: boolean };
    const remote = p.remote || 'origin';
    const keepLocalChanges = p.keep_local_changes ?? true;

    // 1. Determine the current branch (so we know what to reset to).
    let localBranch = '';
    try {
      const status = await api.git.status(repoPath);
      localBranch = status.current ?? '';
      if (!localBranch) {
        return 'Sync failed: HEAD is detached (no current branch). Checkout a branch first, or pass the `branch` parameter explicitly.';
      }
    } catch (e) {
      return `Sync failed: could not read current branch. Error: ${String(e)}`;
    }
    const remoteBranch = p.branch || localBranch;
    const remoteRef = `${remote}/${remoteBranch}`;

    // Snapshot what we're about to do — for the AI to report back.
    let hadLocalChanges = false;
    let snapshotSummary = '';
    try {
      const status = await api.git.status(repoPath);
      hadLocalChanges = status.files.length > 0;
      snapshotSummary = `Branch: ${localBranch}, target: ${remoteRef}, local changes: ${hadLocalChanges ? `${status.files.length} file(s)` : 'none'}.`;
    } catch {
      snapshotSummary = `Branch: ${localBranch}, target: ${remoteRef}.`;
    }

    // 2. Stash local changes (only if there are any) — so they're recoverable
    //    even if the user passed keep_local_changes=false.
    let stashed = false;
    if (hadLocalChanges) {
      try {
        const stashMsg = `auto-stash before sync_with_remote (${new Date().toISOString()})`;
        await api.git.stashPush(repoPath, stashMsg, true, false);
        stashed = true;
      } catch (e) {
        return `Sync aborted: failed to stash local changes. No destructive operation was performed. Error: ${String(e)}`;
      }
    }

    // 3. Fetch the remote — make sure origin/<branch> is up to date.
    try {
      await api.git.fetch(repoPath, remote, true);
    } catch (e) {
      // Fetch failed — restore the stash if we made one.
      if (stashed) {
        try { await api.git.stashPop(repoPath, 0); } catch { /* ignore — fetch error is more important */ }
      }
      return `Sync failed: could not fetch from ${remote}. Local changes restored (if any). Error: ${String(e)}`;
    }

    // 4. Reset --hard origin/<branch>. This is the destructive step.
    try {
      await api.git.raw(repoPath, ['reset', '--hard', remoteRef]);
    } catch (e) {
      const msg = String(e);
      if (stashed) {
        try { await api.git.stashPop(repoPath, 0); } catch { /* ignore — reset error is more important */ }
      }
      if (msg.includes('index.lock')) {
        return `Sync failed: git index is locked (.git/index.lock exists). Wait a moment and retry. Local changes restored.\n\nOriginal error: ${msg}`;
      }
      if (msg.includes('unknown revision') || msg.includes('not found')) {
        return `Sync failed: remote ref '${remoteRef}' not found. Check that the branch exists on the remote — try \`git fetch ${remote} --prune\` first.\n\nOriginal error: ${msg}`;
      }
      return `Sync failed at 'git reset --hard ${remoteRef}': ${msg}${stashed ? ' Local changes restored.' : ''}`;
    }

    // 5. Optionally restore the stashed local changes on top of the new HEAD.
    if (stashed && keepLocalChanges) {
      try {
        await api.git.stashPop(repoPath, 0);
        return `${snapshotSummary} Synced to ${remoteRef} and restored local changes on top.`;
      } catch (e) {
        // Stash pop failed — typically a merge conflict between the stashed
        // changes and the new commits. The stash is NOT lost.
        return `${snapshotSummary} Synced to ${remoteRef}. WARNING: auto-stash restore failed — your local changes are still in the stash. Run \`git stash list\` + \`git stash pop\` to recover. Error: ${String(e)}`;
      }
    }

    if (stashed && !keepLocalChanges) {
      return `${snapshotSummary} Synced to ${remoteRef}. Local changes were stashed (recoverable via git stash list) and NOT restored.`;
    }

    return `${snapshotSummary} Synced to ${remoteRef}. Working tree is clean.`;
  },
};

/** Abort an in-progress merge or rebase.
 *
 *  When a `git merge` or `git rebase` fails with conflicts, the repo is
 *  left in a half-finished state (MERGE_HEAD / REBASE_HEAD set, index has
 *  conflict markers). This tool aborts the in-progress operation and
 *  returns the repo to the state it was in before the merge/rebase started.
 *
 *  Safe to call even when no merge/rebase is in progress — git will report
 *  "no merge to abort" / "no rebase in progress" which we surface cleanly.
 */
export const gitAbortOpTool: AITool = {
  name: 'abort_operation',
  description: 'Abort an in-progress git merge or rebase. Use this when a previous merge/rebase failed with conflicts and the user wants to cancel it (git merge --abort / git rebase --abort). Returns the repo to the state it was in before the operation started. Safe to call when no merge/rebase is in progress.',
  parameters: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['auto', 'merge', 'rebase'], description: 'Which operation to abort. "auto" (default) tries both — merge first, then rebase — and reports whichever was active.', default: 'auto' },
    },
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const p = params as { operation?: 'auto' | 'merge' | 'rebase' };
    const op = p.operation ?? 'auto';
    const lines: string[] = [];

    // Check for in-progress merge (MERGE_HEAD exists in .git).
    let inMerge = false;
    try {
      const out = await api.git.raw(repoPath, ['rev-parse', '--verify', 'MERGE_HEAD']);
      inMerge = !!out?.trim();
    } catch { /* MERGE_HEAD doesn't exist → no merge in progress */ }

    // Check for in-progress rebase (rebase-merge or rebase-apply dir exists).
    let inRebase = false;
    try {
      const out = await api.git.raw(repoPath, ['rev-parse', '--git-path', 'rebase-merge']);
      inRebase = !!out?.trim();
    } catch { /* ignore */ }
    if (!inRebase) {
      try {
        const out = await api.git.raw(repoPath, ['rev-parse', '--git-path', 'rebase-apply']);
        inRebase = !!out?.trim();
      } catch { /* ignore */ }
    }

    if (op === 'merge' || (op === 'auto' && inMerge)) {
      if (!inMerge) {
        lines.push('No merge in progress — nothing to abort.');
      } else {
        try {
          await api.git.abortMerge(repoPath);
          lines.push('Merge aborted.');
        } catch (e) {
          lines.push(`Failed to abort merge: ${String(e)}`);
        }
      }
    }

    if (op === 'rebase' || (op === 'auto' && inRebase)) {
      if (!inRebase) {
        lines.push('No rebase in progress — nothing to abort.');
      } else {
        try {
          await api.git.raw(repoPath, ['rebase', '--abort']);
          lines.push('Rebase aborted.');
        } catch (e) {
          lines.push(`Failed to abort rebase: ${String(e)}`);
        }
      }
    }

    if (op === 'auto' && !inMerge && !inRebase) {
      lines.push('No merge or rebase in progress — nothing to abort.');
    }

    return lines.join(' ');
  },
};

// ============================================================================
// Repository-management tools — DO NOT require an open repository.
// These let the AI Assistant work BEFORE the user has opened any repo: it can
// list known repositories (those the app has opened before), search them by
// name/path, clone a new one from a URL, initialize a fresh repo in a folder,
// and OPEN any of them in the app UI (which makes them the current repo).
//
// `repoPath` is ignored by these tools — they operate on the app-level
// repository list maintained by the settings store.
// ============================================================================

/** List all repositories that the app has opened before.
 *
 *  Returns a compact list (name + path + last-opened timestamp). Used by the
 *  AI Assistant when the user asks "what repos do I have?" or wants to switch
 *  context without navigating the sidebar.
 */
export const listReposTool: AITool = {
  name: 'list_repos',
  description: 'List all repositories that the app has previously opened. Each entry has name, path, last-opened time, and pinned/favorite status. Use this when the user asks "what repos do I have" or wants to switch context — does NOT require a repo to be open.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async execute() {
    const repos = await api.settings.getRepos();
    if (repos.length === 0) {
      return 'No repositories in the app list yet. Use clone_repo or init_repo to add one, or open one via the sidebar "Open Repository" button.';
    }
    // Sort by lastOpened desc — most recent first.
    const sorted = [...repos].sort((a, b) => b.lastOpened - a.lastOpened);
    const lines: string[] = [`Total: ${sorted.length} repositories`];
    lines.push('');
    for (const r of sorted) {
      const ago = formatAgo(Date.now() - r.lastOpened);
      const pin = r.pinned ? ' [pinned]' : '';
      lines.push(`• ${r.name}${pin} — ${r.path} (last opened ${ago})`);
    }
    return lines.join('\n');
  },
};

/** Search repositories by name or path substring (case-insensitive). */
export const searchReposTool: AITool = {
  name: 'search_repos',
  description: 'Search the app\'s known-repositories list by name or path substring (case-insensitive). Returns matching repos with their full paths so the AI can pass them to open_repo. Useful when the user says "open the prismgit repo" without typing the full path.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query — matches repo name OR path (case-insensitive substring)' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async execute(params) {
    const q = (params as { query: string }).query.trim().toLowerCase();
    if (!q) return 'Empty query — nothing to search.';
    const repos = await api.settings.getRepos();
    const matches = repos.filter(r =>
      r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)
    );
    if (matches.length === 0) {
      return `No repositories matching "${q}". Use list_repos to see all known repos.`;
    }
    const lines: string[] = [`Found ${matches.length} repositor${matches.length === 1 ? 'y' : 'ies'} matching "${q}":`];
    for (const r of matches) {
      lines.push(`• ${r.name} — ${r.path}`);
    }
    return lines.join('\n');
  },
};

/** Clone a remote repository into a local folder and add it to the app list.
 *
 *  Uses the configured default clone directory (Settings → Default Clone Dir)
 *  if `target_path` is not provided. If `open_after` is true (default), the
 *  cloned repo is also opened as the current repository in the app UI.
 */
export const cloneRepoTool: AITool = {
  name: 'clone_repo',
  description: 'Clone a remote Git repository (git clone) into a local folder, add it to the app\'s known-repos list, and optionally open it as the current repository. Does NOT require a repo to be open — works from the Welcome screen too.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Remote URL to clone (HTTPS or SSH). Required.' },
      target_path: { type: 'string', description: 'Local folder to clone into. If omitted, uses the app\'s default clone directory + the repo name extracted from the URL.' },
      depth: { type: 'number', description: 'Shallow clone depth (e.g. 1 for --depth=1). 0 = full clone (default).', default: 0 },
      branch: { type: 'string', description: 'Branch to clone (default: all branches). Use this to clone only a single branch for speed.' },
      open_after: { type: 'boolean', description: 'If true (default), open the cloned repo as the current repository in the app UI.', default: true },
    },
    required: ['url'],
    additionalProperties: false,
  },
  async execute(params) {
    const p = params as { url: string; target_path?: string; depth?: number; branch?: string; open_after?: boolean };
    if (!p.url?.trim()) return 'Error: url is required.';
    const url = p.url.trim();

    // Resolve target path — default clone dir + repo name from URL.
    let targetPath = p.target_path?.trim();
    if (!targetPath) {
      const defaultCloneDir = await api.settings.get<string>('defaultCloneDir');
      if (!defaultCloneDir) {
        return 'Error: no target_path given and no default clone directory configured. Set one in Settings → Default Clone Directory, or pass target_path explicitly.';
      }
      const repoName = extractRepoNameFromUrl(url);
      targetPath = `${defaultCloneDir.replace(/[/\\]+$/, '')}/${repoName}`;
    }

    try {
      await api.git.clone(url, targetPath, {
        depth: p.depth && p.depth > 0 ? p.depth : undefined,
        branch: p.branch || undefined,
      });
    } catch (e) {
      return `Clone failed: ${String(e)}`;
    }

    // Add to app's known-repos list.
    const name = targetPath.split(/[/\\]/).pop() || targetPath;
    try {
      await api.settings.addRepo({ path: targetPath, name });
    } catch { /* already exists — fine */ }

    // Optionally open it.
    if (p.open_after ?? true) {
      try {
        // Lazy import to avoid circular dependency at module load time
        // (repositoryStore imports many things; aiTools is imported widely).
        const { useRepositoryStore } = await import('../stores/repositoryStore');
        await useRepositoryStore.getState().openRepository(targetPath);
        return `Cloned '${url}' → ${targetPath} and opened as current repository.`;
      } catch (e) {
        return `Cloned '${url}' → ${targetPath}. Failed to auto-open: ${String(e)} (use open_repo to retry).`;
      }
    }
    return `Cloned '${url}' → ${targetPath}. Added to the repo list.`;
  },
};

/** Initialize a new Git repository in a local folder.
 *
 *  Creates `target_path` if it doesn't exist, runs `git init`, adds the
 *  folder to the app's known-repos list, and optionally opens it.
 */
export const initRepoTool: AITool = {
  name: 'init_repo',
  description: 'Initialize a new Git repository in a local folder (git init). Creates the folder if it doesn\'t exist, registers it in the app\'s known-repos list, and optionally opens it as the current repository. Use this when the user says "create a new repo here" or "initialize a project".',
  parameters: {
    type: 'object',
    properties: {
      target_path: { type: 'string', description: 'Local folder path to initialize as a git repo. Will be created if it doesn\'t exist. Required.' },
      open_after: { type: 'boolean', description: 'If true (default), open the new repo as the current repository in the app UI.', default: true },
    },
    required: ['target_path'],
    additionalProperties: false,
  },
  async execute(params) {
    const p = params as { target_path: string; open_after?: boolean };
    const targetPath = p.target_path.trim();
    if (!targetPath) return 'Error: target_path is required.';

    try {
      await api.git.init(targetPath, false);
    } catch (e) {
      return `Init failed: ${String(e)}`;
    }

    const name = targetPath.split(/[/\\]/).pop() || targetPath;
    try {
      await api.settings.addRepo({ path: targetPath, name });
    } catch { /* already exists — fine */ }

    if (p.open_after ?? true) {
      try {
        const { useRepositoryStore } = await import('../stores/repositoryStore');
        await useRepositoryStore.getState().openRepository(targetPath);
        return `Initialized new git repo at ${targetPath} and opened as current repository.`;
      } catch (e) {
        return `Initialized new git repo at ${targetPath}. Failed to auto-open: ${String(e)} (use open_repo to retry).`;
      }
    }
    return `Initialized new git repo at ${targetPath}. Added to the repo list.`;
  },
};

/** Open an existing repository in the app UI.
 *
 *  Takes an absolute path (or just a repo name — uses search_repos logic to
 *  resolve it) and switches the app's current repository to it.
 */
export const openRepoTool: AITool = {
  name: 'open_repo',
  description: 'Open an existing repository in the app UI, making it the current repository. Accepts either an absolute path (use list_repos / search_repos to find one) or a repo name (will be resolved via the app\'s known-repos list). Use this when the user says "open the X repo" or wants to switch context.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the repository, OR a repo name from the known-repos list (will be resolved case-insensitively).' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  async execute(params) {
    const p = params as { path: string };
    const query = p.path.trim();
    if (!query) return 'Error: path is required.';

    // First try as an absolute path. If it doesn't match any known repo,
    // try resolving it as a name via the app's repo list.
    let resolvedPath = query;
    const isAbsolute = /^[\\/]/.test(query) || /^[a-zA-Z]:[\\/]/.test(query);
    if (!isAbsolute) {
      const repos = await api.settings.getRepos();
      const match = repos.find(r =>
        r.name.toLowerCase() === query.toLowerCase() ||
        r.name.toLowerCase().includes(query.toLowerCase())
      );
      if (!match) {
        return `No known repository matches "${query}". Use list_repos to see all known repos, or pass an absolute path.`;
      }
      resolvedPath = match.path;
    }

    try {
      const { useRepositoryStore } = await import('../stores/repositoryStore');
      await useRepositoryStore.getState().openRepository(resolvedPath);
      return `Opened repository: ${resolvedPath}`;
    } catch (e) {
      return `Failed to open ${resolvedPath}: ${String(e)}`;
    }
  },
};

/** All registered AI tools. */
export const AI_TOOLS: AITool[] = [
  // Read-only
  gitStatusTool,
  gitLogTool,
  gitDiffTool,
  gitBranchesTool,
  gitStashesTool,
  gitTagsTool,
  // Write operations
  gitStageTool,
  gitUnstageTool,
  gitCommitTool,
  gitPushTool,
  gitPullTool,
  gitFetchTool,
  gitCheckoutTool,
  gitCreateTagTool,
  gitStashPushTool,
  gitStashPopTool,
  gitMergeTool,
  // Discard / sync / abort — destructive or atomic multi-step operations
  gitDiscardChangesTool,
  gitSyncWithRemoteTool,
  gitAbortOpTool,
  // Repository management (work WITHOUT an open repo)
  listReposTool,
  searchReposTool,
  cloneRepoTool,
  initRepoTool,
  openRepoTool,
];

/** Look up a tool by name. */
export function getTool(name: string): AITool | undefined {
  return AI_TOOLS.find(t => t.name === name);
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Format milliseconds as a human-readable "X minutes ago" string. */
function formatAgo(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  return `${Math.floor(mon / 12)}y ago`;
}

/** Extract a repo name from a Git URL (HTTPS or SSH). */
function extractRepoNameFromUrl(url: string): string {
  // Strip trailing .git and slashes
  const cleaned = url.replace(/[\\/]+$/, '').replace(/\.git$/i, '');
  // SSH: git@host:owner/repo  →  last segment after / or :
  // HTTPS: https://host/owner/repo  →  last segment after /
  const match = cleaned.match(/[/:]([^/:]+)$/);
  return match?.[1] ?? 'cloned-repo';
}
