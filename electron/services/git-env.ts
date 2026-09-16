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
 * 2. GIT_CONFIG_COUNT=4 — override core.hooksPath (disable hooks) +
 *    filter.lfs.process/smudge/clean (disable all three LFS filter entry
 *    points so git NEVER spawns a git-lfs subprocess).
 */
export const GIT_ENV_LFS_SKIP: Record<string, string> = {
  GIT_LFS_SKIP_SMUDGE: '1',
  GIT_CONFIG_COUNT: '4',
  GIT_CONFIG_KEY_0: 'core.hooksPath',
  GIT_CONFIG_VALUE_0: '',
  GIT_CONFIG_KEY_1: 'filter.lfs.process',
  GIT_CONFIG_VALUE_1: '',
  GIT_CONFIG_KEY_2: 'filter.lfs.smudge',
  GIT_CONFIG_VALUE_2: '',
  GIT_CONFIG_KEY_3: 'filter.lfs.clean',
  GIT_CONFIG_VALUE_3: '',
};

/**
 * The simple-git options to use with every simpleGit() call.
 * Combines the env override with the unsafe flags that allow GIT_CONFIG_COUNT
 * and core.hooksPath override (both blocked by simple-git's safety plugin).
 */
export const GIT_UNSAFE_OPTIONS = {
  env: GIT_ENV_LFS_SKIP,
  unsafe: {
    allowUnsafeConfigEnvCount: true as const,
    allowUnsafeHooksPath: true as const,
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
    allowUnsafeSshCommand: true as const,
  },
};
