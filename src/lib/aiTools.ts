/**
 * LAR-3 — AI Tools registry.
 *
 * Defines the AITool interface and a set of git-read-only tools that
 * the AI Assistant chat can invoke. Each tool:
 *   - Has a name + description (so the LLM knows what it does).
 *   - Has a JSON Schema for its parameters.
 *   - Has an execute() function that takes the params and returns a
 *     string (which gets fed back to the LLM as the tool result).
 *
 * All tools are read-only (get_status, get_log, get_diff, etc.) — they
 * don't mutate the repository. Mutating tools (commit, push, etc.)
 * would require user confirmation; left for follow-up.
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

/** Get the current git status (porcelain + branch info). */
export const gitStatusTool: AITool = {
  name: 'get_status',
  description: 'Get the current git status of the repository — list of modified/staged/untracked files, current branch, ahead/behind counters.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
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
      // Use api.git.raw to get the porcelain diff (no need to parse DiffResult).
      const args = staged
        ? ['diff', '--cached', '--stat']
        : ['diff', '--stat'];
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
    return stashes.map((s, i) => `stash@{i}: ${s.message}`).join('\n');
  },
};

/** All registered AI tools. */
export const AI_TOOLS: AITool[] = [
  gitStatusTool,
  gitLogTool,
  gitDiffTool,
  gitBranchesTool,
  gitStashesTool,
];

/** Look up a tool by name. */
export function getTool(name: string): AITool | undefined {
  return AI_TOOLS.find(t => t.name === name);
}
