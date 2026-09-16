/**
 * Shared git environment constants — used by BOTH git.ts and storage.ts.
 *
 * This file exists to BREAK the circular dependency:
 *   git.ts imports getSetting() from storage.ts
 *   storage.ts was importing GIT_UNSAFE_OPTIONS from git.ts (dynamic import)
 *   → circular dependency → GIT_UNSAFE_OPTIONS was undefined at runtime
 *   → refreshRepoStats created a bare simpleGit() without LFS env overrides
 *   → git-lfs smudge filters ran on every git call → repos took 10-30s to open
 *
 * By moving the constants here, both files import from git-env.ts (no cycle).
 */

/**
 * Global environment overrides applied to EVERY simple-git instance.
 *
 * 1. GIT_LFS_SKIP_SMUDGE=1 — skip LFS smudge/clean filter-process entirely.
 * 2. GIT_CONFIG_COUNT=7 — override:
 *    - core.hooksPath (disable hooks — they call git-lfs which crashes)
 *    - filter.lfs.process/smudge/clean (disable ALL LFS filter entry points)
 *    - feature.manyFiles=true (optimizes index for repos with many files)
 *    - core.fsmonitor=true (FileSystem Monitor — git tracks changed files
 *      without scanning the whole tree; massive speedup on large repos)
 *    - fetch.writeCommitGraph=true (writes commit-graph after fetch —
 *      speeds up history/blame/log graph traversal by 40-60%)
 *
 * These are the SAME settings the user manually configured with:
 *   git config --global feature.manyFiles true
 *   git config --global core.fsmonitor true
 *   git config --global fetch.writeCommitGraph true
 *
 * By setting them via GIT_CONFIG env (highest priority in git's config
 * hierarchy), they apply to ALL repos without modifying the user's
 * --global config. The user's git CLI is unaffected.
 */
/**
 * Build the GIT_CONFIG env override dynamically based on the user's
 * Settings → Git → Performance checkboxes. Called from getGit() and
 * any place that creates a simpleGit instance.
 *
 * If settings say feature.manyFiles=false, we DON'T include it in the
 * env override → git falls back to its default (disabled).
 * If settings say feature.manyFiles=true (or unset → default true),
 * we include it → git enables the optimization.
 */
export function buildGitEnv(settings?: {
  gitManyFiles?: boolean;
  gitFsmonitor?: boolean;
  gitWriteCommitGraph?: boolean;
}): Record<string, string> {
  const manyFiles = settings?.gitManyFiles ?? true;
  const fsmonitor = settings?.gitFsmonitor ?? true;
  const writeCommitGraph = settings?.gitWriteCommitGraph ?? true;

  // Count how many config overrides we need.
  // Always: 4 LFS entries (hooksPath + 3 filter.lfs)
  // Conditional: up to 3 performance entries
  const perfEntries: [string, string][] = [];
  if (manyFiles) perfEntries.push(['feature.manyFiles', 'true']);
  if (fsmonitor) perfEntries.push(['core.fsmonitor', 'true']);
  if (writeCommitGraph) perfEntries.push(['fetch.writeCommitGraph', 'true']);

  const count = 4 + perfEntries.length;

  const env: Record<string, string> = {
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_CONFIG_COUNT: String(count),
    // LFS bypass (always 4 entries)
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'filter.lfs.process',
    GIT_CONFIG_VALUE_1: '',
    GIT_CONFIG_KEY_2: 'filter.lfs.smudge',
    GIT_CONFIG_VALUE_2: '',
    GIT_CONFIG_KEY_3: 'filter.lfs.clean',
    GIT_CONFIG_VALUE_3: '',
  };

  // Performance optimizations (conditional)
  perfEntries.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${4 + i}`] = key;
    env[`GIT_CONFIG_VALUE_${4 + i}`] = value;
  });

  return env;
}

/**
 * Default env (all optimizations ON) — used before settings are loaded.
 */
export const GIT_ENV_LFS_SKIP: Record<string, string> = buildGitEnv();

/**
 * The simple-git options to use with every simpleGit() call.
 * Combines the env override with the unsafe flags that allow GIT_CONFIG_COUNT
 * and core.hooksPath override (both blocked by simple-git's safety plugin).
 *
 * allowUnsafeFilter is needed because we override filter.lfs.smudge/clean/process
 * via GIT_CONFIG — simple-git blocks filter config writes without this flag.
 * Without it, git fetch/pull/checkout fail with:
 *   "Configuring filter.smudge is not permitted without enabling allowUnsafeFilter"
 */
export const GIT_UNSAFE_OPTIONS = {
  env: GIT_ENV_LFS_SKIP,
  unsafe: {
    allowUnsafeConfigEnvCount: true as const,
    allowUnsafeHooksPath: true as const,
    allowUnsafeFilter: true as const,
  },
};

/**
 * GIT_UNSAFE_OPTIONS + permission to set GIT_SSH_COMMAND through .env() —
 * required for every SSH-transport network command (simple-git blocks
 * GIT_SSH_COMMAND without allowUnsafeSshCommand).
 */
export const GIT_SSH_UNSAFE_OPTIONS = {
  ...GIT_UNSAFE_OPTIONS,
  unsafe: {
    allowUnsafeConfigEnvCount: true as const,
    allowUnsafeHooksPath: true as const,
    allowUnsafeFilter: true as const,
    allowUnsafeSshCommand: true as const,
  },
};
