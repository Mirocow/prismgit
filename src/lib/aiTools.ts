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

/** Get the recent commit log (last N commits). */
export const gitLogTool: AITool = {
  name: 'get_log',
  description: 'Get recent commits from the repository (default: last 10).',
  parameters: {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'Number of commits to return (max 50)', default: 10 },
    },
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const count = Math.min(50, Math.max(1, (params as { count?: number })?.count ?? 10));
    const log = await api.git.log(repoPath, { maxCount: count });
    if (log.length === 0) return 'No commits yet.';
    return log.map(c => `${c.hashAbbrev} ${c.subject} (${c.author.name})`).join('\n');
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

/** Pull from remote. */
export const gitPullTool: AITool = {
  name: 'pull',
  description: 'Pull changes from the remote repository (git pull). Uses merge strategy by default.',
  parameters: {
    type: 'object',
    properties: {
      remote: { type: 'string', description: 'Remote name (default: origin)', default: 'origin' },
      branch: { type: 'string', description: 'Branch to pull from' },
      rebase: { type: 'boolean', description: 'Use rebase instead of merge', default: false },
    },
    additionalProperties: false,
  },
  async execute(params, repoPath) {
    const p = params as { remote?: string; branch?: string; rebase?: boolean };
    await api.git.pull(repoPath, p.remote || 'origin', p.branch, p.rebase ?? false, false);
    return `Pulled from ${p.remote || 'origin'}${p.branch ? '/' + p.branch : ''}.`;
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
];

/** Look up a tool by name. */
export function getTool(name: string): AITool | undefined {
  return AI_TOOLS.find(t => t.name === name);
}
