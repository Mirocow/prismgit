// SmartGit-like Git-Flow implementation
// Supports: Feature, Release, Hotfix, Fix, Support branches
// Based on AVH Edition of git-flow
//
// Fix branches are a non-canonical but commonly-requested addition: a
// "fix/" prefix is used by many teams for small urgent bugfixes that don't
// warrant the full hotfix (master → tag → develop merge) ceremony. They
// behave like features (develop → develop) but get their own prefix.
//
// Support branches are a real AVH git-flow concept: long-lived branches
// off master for maintaining old release lines (e.g. support/1.x).

import { api } from './api';
import type { BranchInfo } from './api';

/**
 * Conflict-reaction audit (v3.6): error thrown by every git-flow finish
 * merge when it lands on conflicts. `conflicts` carries the file list so
 * the dialog can show the state-based reaction (Changes tool + banner)
 * with the branch/delete/push steps NEVER reached — before this, the
 * merge result was ignored and the flow continued to force-delete the
 * feature branch and push while the repo sat in a conflicted merge.
 */
export class GitFlowConflictError extends Error {
  conflicts: string[];
  constructor(branch: string, conflicts: string[]) {
    super(`git-flow finish stopped: merge of ${branch} resulted in ${conflicts.length} conflict(s)`);
    this.name = 'GitFlowConflictError';
    this.conflicts = conflicts;
  }
}

/** Merge step of every finish flow — refuses to continue on conflicts. */
async function mergeOrFail(
  repoPath: string,
  branchName: string,
  opts: { noFf?: boolean; squash?: boolean } = {},
): Promise<void> {
  const result = await api.git.merge(repoPath, branchName, opts);
  if (result.conflicts?.length) {
    // The merge leaves the repo mid-merge (MERGE_HEAD + unmerged paths) —
    // the perfect state for the standard resolve flow. Stop HERE: no tag,
    // no second merge, no branch delete, no push.
    throw new GitFlowConflictError(branchName, result.conflicts);
  }
}

/**
 * The set of Git-Flow branch kinds. 'feature'/'release'/'hotfix' are the
 * canonical AVH git-flow set; 'fix' and 'support' are added for teams that
 * use those prefixes. Each kind has its own start/finish semantics below.
 */
export type FlowType = 'feature' | 'release' | 'hotfix' | 'fix' | 'support';

export interface GitFlowConfig {
  masterBranch: string;
  developBranch: string;
  featurePrefix: string;
  releasePrefix: string;
  hotfixPrefix: string;
  supportPrefix: string;
  /** Bugfix branch prefix (non-canonical but commonly used; behaviour mirrors feature). */
  fixPrefix: string;
  versionTagPrefix: string;
  originRemote: string;
}

export const DEFAULT_GIT_FLOW_CONFIG: GitFlowConfig = {
  masterBranch: 'main',
  developBranch: 'develop',
  featurePrefix: 'feature/',
  releasePrefix: 'release/',
  hotfixPrefix: 'hotfix/',
  supportPrefix: 'support/',
  fixPrefix: 'fix/',
  versionTagPrefix: 'v',
  originRemote: 'origin',
};

/**
 * Map a FlowType to its prefix in the given config. Used by the dialog to
 * compute the full branch name (e.g. `feature/my-thing`) and by the page to
 * resolve a clicked branch row's kind.
 */
export function flowPrefix(cfg: GitFlowConfig, flow: FlowType): string {
  switch (flow) {
    case 'feature': return cfg.featurePrefix;
    case 'release': return cfg.releasePrefix;
    case 'hotfix': return cfg.hotfixPrefix;
    case 'support': return cfg.supportPrefix;
    case 'fix': return cfg.fixPrefix;
  }
}

/**
 * Inverse of flowPrefix — given a branch name and the config, return the
 * FlowType whose prefix matches. Returns null for non-flow branches.
 */
export function detectFlowKind(cfg: GitFlowConfig, branchName: string): FlowType | null {
  const flows: FlowType[] = ['feature', 'release', 'hotfix', 'support', 'fix'];
  for (const f of flows) {
    const p = flowPrefix(cfg, f);
    if (p && branchName.startsWith(p)) return f;
  }
  return null;
}

/**
 * Result of detectGitFlowConfig — also reports whether gitflow was
 * initialized (config present in git config) and whether the develop
 * branch currently exists locally. Used by the GitFlow page to decide
 * whether to show the "Initialize Git-Flow" banner.
 */
export interface GitFlowStatus extends GitFlowConfig {
  initialized: boolean;
  developExists: boolean;
  masterExists: boolean;
}

/**
 * PERF (v3.1): read ALL gitflow.* config keys in ONE subprocess.
 *
 * `git config --get-regexp ^gitflow\.` prints every matching `key value`
 * pair (exit 1 + empty output when nothing is configured). The previous
 * implementation fired one `git config --get <key>` subprocess per key —
 * NINE sequential spawns for detectGitFlowConfig, and detectGitFlowStatus
 * called it (plus a duplicate key read) on top of that — ~11-13 serialized
 * spawn+exec round-trips on EVERY Git-Flow page load and Git-Flow dialog
 * open, 300-700ms of pure latency on a warm repo, far worse on network
 * home-dir setups. Now: 1 subprocess, parsed into a map.
 *
 * Parsing: split each line at the FIRST space — gitflow values (branch
 * names, prefixes) may themselves contain spaces, so a naive
 * `line.split(' ')` would corrupt them.
 *
 * Scope: deliberately UNSCOPED (system+global+local), matching the old
 * configGet(repoPath, key) semantics exactly. The env-injected overrides
 * from git-env.ts only cover filter.lfs / core.hooksPath, which cannot
 * collide with the ^gitflow\. prefix.
 */
export async function readGitFlowConfigMap(repoPath: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    const out = await api.git.raw(repoPath, ['config', '--get-regexp', '^gitflow\\.']);
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const sp = trimmed.indexOf(' ');
      if (sp <= 0) continue;
      map[trimmed.slice(0, sp)] = trimmed.slice(sp + 1);
    }
  } catch {
    // git exits 1 when no gitflow.* key matches — that is the "not
    // initialized" case, not an error.
  }
  return map;
}

/** Pure map → GitFlowConfig with per-key defaults (no subprocess). */
export function gitFlowConfigFromMap(map: Record<string, string>): GitFlowConfig {
  return {
    masterBranch: map['gitflow.branch.master'] || DEFAULT_GIT_FLOW_CONFIG.masterBranch,
    developBranch: map['gitflow.branch.develop'] || DEFAULT_GIT_FLOW_CONFIG.developBranch,
    featurePrefix: map['gitflow.prefix.feature'] || DEFAULT_GIT_FLOW_CONFIG.featurePrefix,
    releasePrefix: map['gitflow.prefix.release'] || DEFAULT_GIT_FLOW_CONFIG.releasePrefix,
    hotfixPrefix: map['gitflow.prefix.hotfix'] || DEFAULT_GIT_FLOW_CONFIG.hotfixPrefix,
    supportPrefix: map['gitflow.prefix.support'] || DEFAULT_GIT_FLOW_CONFIG.supportPrefix,
    // fix/ is not part of the canonical AVH git-flow, so the config key
    // may be missing — fall back to the default 'fix/' prefix.
    fixPrefix: map['gitflow.prefix.fix'] || DEFAULT_GIT_FLOW_CONFIG.fixPrefix,
    versionTagPrefix: map['gitflow.prefix.versiontag'] || DEFAULT_GIT_FLOW_CONFIG.versionTagPrefix,
    originRemote: map['gitflow.origin.remote'] || DEFAULT_GIT_FLOW_CONFIG.originRemote,
  };
}

/**
 * Detect the Git-Flow configuration. ONE subprocess (see
 * readGitFlowConfigMap) instead of nine sequential configGet spawns.
 */
export async function detectGitFlowConfig(repoPath: string): Promise<GitFlowConfig> {
  return gitFlowConfigFromMap(await readGitFlowConfigMap(repoPath));
}

/**
 * Pure derivation of the Git-Flow STATUS from (config map, branch list) —
 * no subprocesses, so callers that already hold a branches() result can
 * reuse it instead of refetching.
 */
export function gitFlowStatusFrom(
  map: Record<string, string>,
  allBranches: BranchInfo[],
): GitFlowStatus {
  const config = gitFlowConfigFromMap(map);
  return {
    ...config,
    // "Initialized" = any gitflow.* branch/prefix key present. The old
    // code read gitflow.branch.master twice (duplicate-key bug — both
    // reads returned the same value) and used it alone; key-presence on
    // the whole map is the same signal, minus the wasted subprocess.
    initialized:
      'gitflow.branch.master' in map ||
      'gitflow.branch.develop' in map ||
      'gitflow.prefix.feature' in map,
    masterExists: allBranches.some((b) => b.name === config.masterBranch && !b.remote),
    developExists: allBranches.some((b) => b.name === config.developBranch && !b.remote),
  };
}

/**
 * Detect Git-Flow config AND check whether the master / develop branches
 * exist locally. Used by the GitFlow page to render the "Initialize" banner
 * when the project has no git-flow setup yet.
 *
 * PERF (v3.1): the config map and the branch list are INDEPENDENT reads —
 * they run in parallel now (was: 2 duplicate + 9 sequential config spawns,
 * then branches). 3 subprocesses total (1 config + 2 for-each-ref, the
 * latter TTL-cached and shared with the Branches page).
 */
export async function detectGitFlowStatus(repoPath: string): Promise<GitFlowStatus> {
  const [map, allBranches] = await Promise.all([
    readGitFlowConfigMap(repoPath),
    api.git.branches(repoPath).catch(() => [] as BranchInfo[]),
  ]);
  return gitFlowStatusFrom(map, allBranches);
}

/**
 * Initialize Git-Flow in a repository that doesn't have it yet.
 * Writes the gitflow.* config keys (local scope) and creates the develop
 * branch off the current HEAD (or off the master branch if it exists).
 *
 * Mirrors what `git flow init -d` does in the AVH git-flow tool, but
 * without requiring the git-flow CLI to be installed.
 *
 * Idempotent: if develop already exists, it's not re-created. Config keys
 * are always (re-)written so the user can change branch names via the
 * settings dialog and re-init to apply.
 */
export async function initGitFlow(
  repoPath: string,
  cfg: Partial<GitFlowConfig> = {}
): Promise<GitFlowStatus> {
  const config: GitFlowConfig = { ...DEFAULT_GIT_FLOW_CONFIG, ...cfg };
  // Persist gitflow.* config keys to local git config.
  await Promise.all([
    api.git.configSet(repoPath, 'gitflow.branch.master', config.masterBranch, 'local'),
    api.git.configSet(repoPath, 'gitflow.branch.develop', config.developBranch, 'local'),
    api.git.configSet(repoPath, 'gitflow.prefix.feature', config.featurePrefix, 'local'),
    api.git.configSet(repoPath, 'gitflow.prefix.release', config.releasePrefix, 'local'),
    api.git.configSet(repoPath, 'gitflow.prefix.hotfix', config.hotfixPrefix, 'local'),
    api.git.configSet(repoPath, 'gitflow.prefix.support', config.supportPrefix, 'local'),
    api.git.configSet(repoPath, 'gitflow.prefix.fix', config.fixPrefix, 'local'),
    api.git.configSet(repoPath, 'gitflow.prefix.versiontag', config.versionTagPrefix, 'local'),
    api.git.configSet(repoPath, 'gitflow.origin.remote', config.originRemote, 'local'),
  ]);

  // Detect what already exists so we can create develop from the right
  // starting point. If neither master nor develop exists, we cannot init
  // — the caller must first commit something to the unborn HEAD.
  const status = await detectGitFlowStatus(repoPath);
  if (!status.masterExists && !status.developExists) {
    // Repo with no commits — can't create branches. Config is still written,
    // so once the user makes their first commit they can re-init.
    return status;
  }
  if (!status.developExists) {
    // Create develop off master (or current HEAD if master isn't there).
    const startPoint = status.masterExists ? config.masterBranch : 'HEAD';
    try {
      await api.git.createBranch(repoPath, config.developBranch, startPoint, false, false);
    } catch {
      /* may already exist race-conditionally — ignore */
    }
  }
  return detectGitFlowStatus(repoPath);
}

// Feature operations
export async function startFeature(repoPath: string, name: string, base?: string, cfg?: GitFlowConfig): Promise<void> {
  const config = cfg || await detectGitFlowConfig(repoPath);
  const branchName = `${config.featurePrefix}${name}`;
  const startPoint = base || config.developBranch;
  await api.git.createBranch(repoPath, branchName, startPoint, false, false);
  await api.git.checkout(repoPath, branchName);
}

export async function checkoutFlowBranch(repoPath: string, flow: FlowType, name: string, cfg?: GitFlowConfig): Promise<void> {
  const config = cfg || await detectGitFlowConfig(repoPath);
  const prefix = flowPrefix(config, flow);
  const branchName = `${prefix}${name}`;
  await api.git.checkout(repoPath, branchName);
}

// =====================================================================
// Bugfix branches ("fix/") — behave like features (develop → develop),
// but use their own prefix so they're visually distinct in the branch list.
// =====================================================================
export async function startFix(repoPath: string, name: string, base?: string, cfg?: GitFlowConfig): Promise<void> {
  const config = cfg || await detectGitFlowConfig(repoPath);
  const branchName = `${config.fixPrefix}${name}`;
  const startPoint = base || config.developBranch;
  await api.git.createBranch(repoPath, branchName, startPoint, false, false);
  await api.git.checkout(repoPath, branchName);
}

export async function finishFix(repoPath: string, name: string, options: {
  rebase?: boolean;
  squash?: boolean;
  noFF?: boolean;
  deleteBranch?: boolean;
  pushToRemote?: boolean;
  cfg?: GitFlowConfig;
} = {}): Promise<void> {
  // Same semantics as finishFeature but with the fix/ prefix.
  const cfg = options.cfg || await detectGitFlowConfig(repoPath);
  const branchName = `${cfg.fixPrefix}${name}`;
  const { rebase, squash, noFF = true, deleteBranch = true, pushToRemote = false } = options;

  if (rebase) {
    await api.git.checkout(repoPath, branchName);
    await api.git.rebase(repoPath, cfg.developBranch);
  }
  await api.git.checkout(repoPath, cfg.developBranch);
  await mergeOrFail(repoPath, branchName, { noFf: noFF, squash });
  if (deleteBranch) {
    try { await api.git.deleteBranch(repoPath, branchName, false); }
    catch { await api.git.deleteBranch(repoPath, branchName, true); }
  }
  if (pushToRemote) {
    await api.git.push(repoPath, cfg.originRemote, cfg.developBranch);
  }
}

// =====================================================================
// Support branches ("support/") — long-lived maintenance branches off
// master, for keeping old release lines alive. Support branches are NOT
// finished/merged back — they live forever (or until the line is EOL'd).
// =====================================================================
export async function startSupport(repoPath: string, name: string, base?: string, cfg?: GitFlowConfig): Promise<void> {
  const config = cfg || await detectGitFlowConfig(repoPath);
  const branchName = `${config.supportPrefix}${name}`;
  // Support branches start from master (or an old tag) — NOT develop.
  const startPoint = base || config.masterBranch;
  await api.git.createBranch(repoPath, branchName, startPoint, false, false);
  await api.git.checkout(repoPath, branchName);
}

export async function finishFeature(repoPath: string, name: string, options: {
  rebase?: boolean;
  squash?: boolean;
  noFF?: boolean;
  deleteBranch?: boolean;
  pushToRemote?: boolean;
  cfg?: GitFlowConfig;
} = {}): Promise<void> {
  const cfg = options.cfg || await detectGitFlowConfig(repoPath);
  const branchName = `${cfg.featurePrefix}${name}`;
  const { rebase, squash, noFF = true, deleteBranch = true, pushToRemote = false } = options;

  // Switch to the feature branch first so rebase (if requested) rebases
  // the feature branch onto develop, not the other way around. The previous
  // implementation called rebase while still on develop, which silently did
  // nothing useful (rebase onto develop from develop = no-op).
  if (rebase) {
    await api.git.checkout(repoPath, branchName);
    await api.git.rebase(repoPath, cfg.developBranch);
  }

  // Merge into develop
  await api.git.checkout(repoPath, cfg.developBranch);
  await mergeOrFail(repoPath, branchName, { noFf: noFF, squash });

  if (deleteBranch) {
    // -d (safe) first; fall back to -D if git refuses (e.g. not fully merged
    // when squash was used, which is a legitimate git-flow workflow).
    try {
      await api.git.deleteBranch(repoPath, branchName, false);
    } catch {
      await api.git.deleteBranch(repoPath, branchName, true);
    }
  }

  if (pushToRemote) {
    await api.git.push(repoPath, cfg.originRemote, cfg.developBranch);
  }
}

// Release operations
export async function startRelease(repoPath: string, version: string, base?: string, cfg?: GitFlowConfig): Promise<void> {
  const config = cfg || await detectGitFlowConfig(repoPath);
  const branchName = `${config.releasePrefix}${version}`;
  const startPoint = base || config.developBranch;
  await api.git.createBranch(repoPath, branchName, startPoint, false, false);
  await api.git.checkout(repoPath, branchName);
}

export async function finishRelease(repoPath: string, version: string, options: {
  tagMessage?: string;
  noFF?: boolean;
  deleteBranch?: boolean;
  pushToRemote?: boolean;
  cfg?: GitFlowConfig;
} = {}): Promise<void> {
  const cfg = options.cfg || await detectGitFlowConfig(repoPath);
  const branchName = `${cfg.releasePrefix}${version}`;
  const tagName = `${cfg.versionTagPrefix}${version}`;
  const { tagMessage, noFF = true, deleteBranch = true, pushToRemote = false } = options;

  // Merge into master
  await api.git.checkout(repoPath, cfg.masterBranch);
  await mergeOrFail(repoPath, branchName, { noFf: noFF });

  // Tag the release
  await api.git.createTag(repoPath, tagName, tagMessage || `Release ${version}`, undefined, false, true);

  // Merge back into develop
  await api.git.checkout(repoPath, cfg.developBranch);
  await mergeOrFail(repoPath, branchName, { noFf: noFF });

  if (deleteBranch) {
    try {
      await api.git.deleteBranch(repoPath, branchName, false);
    } catch {
      await api.git.deleteBranch(repoPath, branchName, true);
    }
  }

  if (pushToRemote) {
    await api.git.push(repoPath, cfg.originRemote, cfg.masterBranch);
    await api.git.push(repoPath, cfg.originRemote, cfg.developBranch);
    await api.git.pushTag(repoPath, tagName, cfg.originRemote);
  }
}

// Hotfix operations
export async function startHotfix(repoPath: string, version: string, base?: string, cfg?: GitFlowConfig): Promise<void> {
  const config = cfg || await detectGitFlowConfig(repoPath);
  const branchName = `${config.hotfixPrefix}${version}`;
  const startPoint = base || config.masterBranch;
  await api.git.createBranch(repoPath, branchName, startPoint, false, false);
  await api.git.checkout(repoPath, branchName);
}

export async function finishHotfix(repoPath: string, version: string, options: {
  tagMessage?: string;
  noFF?: boolean;
  deleteBranch?: boolean;
  pushToRemote?: boolean;
  cfg?: GitFlowConfig;
} = {}): Promise<void> {
  const cfg = options.cfg || await detectGitFlowConfig(repoPath);
  const branchName = `${cfg.hotfixPrefix}${version}`;
  const tagName = `${cfg.versionTagPrefix}${version}`;
  const { tagMessage, noFF = true, deleteBranch = true, pushToRemote = false } = options;

  // Merge into master
  await api.git.checkout(repoPath, cfg.masterBranch);
  await mergeOrFail(repoPath, branchName, { noFf: noFF });

  // Tag the hotfix
  await api.git.createTag(repoPath, tagName, tagMessage || `Hotfix ${version}`, undefined, false, true);

  // Merge back into develop
  await api.git.checkout(repoPath, cfg.developBranch);
  await mergeOrFail(repoPath, branchName, { noFf: noFF });

  if (deleteBranch) {
    try {
      await api.git.deleteBranch(repoPath, branchName, false);
    } catch {
      await api.git.deleteBranch(repoPath, branchName, true);
    }
  }

  if (pushToRemote) {
    await api.git.push(repoPath, cfg.originRemote, cfg.masterBranch);
    await api.git.push(repoPath, cfg.originRemote, cfg.developBranch);
    await api.git.pushTag(repoPath, tagName, cfg.originRemote);
  }
}

// List current feature/release/hotfix/fix/support branches
// PERF (v3.1): `allBranches` can be injected by callers that already hold a
// branches() result (Git-Flow page load) — saves a duplicate branches()
// call; without it the for-each-ref reads are TTL-cached anyway.
export async function listFlowBranches(repoPath: string, cfg?: GitFlowConfig, allBranches?: BranchInfo[]) {
  const config = cfg || await detectGitFlowConfig(repoPath);
  const all = allBranches ?? await api.git.branches(repoPath);
  return flowListsFrom(config, all);
}

/**
 * Pure flow-list derivation — same filtering as listFlowBranches but from an
 * already-fetched branch list (no subprocesses). Exported for the page and
 * tests.
 */
export function flowListsFrom(config: GitFlowConfig, all: BranchInfo[]) {
  return {
    features: all.filter((b) => config.featurePrefix && b.name.startsWith(config.featurePrefix) && !b.remote),
    releases: all.filter((b) => config.releasePrefix && b.name.startsWith(config.releasePrefix) && !b.remote),
    hotfixes: all.filter((b) => config.hotfixPrefix && b.name.startsWith(config.hotfixPrefix) && !b.remote),
    fixes: all.filter((b) => config.fixPrefix && b.name.startsWith(config.fixPrefix) && !b.remote),
    supports: all.filter((b) => config.supportPrefix && b.name.startsWith(config.supportPrefix) && !b.remote),
    config,
  };
}
