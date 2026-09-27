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
 * simple-git v4 `allowEnvironment` guard (semantics pinned empirically —
 * the probe in tests/unit + the failing suites after the 3→4 upgrade):
 *
 * The guard protects GIT-RELEVANT variables — every key that is
 *   a) `GIT_*`-prefixed (case-insensitive), or
 *   b) one of the editor/pager variables git itself reads
 *      (EDITOR / PAGER / VISUAL)
 * may NOT be set through the `.env()` builder unless it is ALSO listed in
 * the `allowEnvironment` simpleGit() option; otherwise every git operation
 * throws `Use of "X" is blocked by the environment guard …`.
 * NON-git variables (PATH, HOME, LANG, TERM, SSH_*, proxies, custom vars)
 * are not guarded and pass through freely.
 *
 * The app's child env is a LIVE merge of process.env + GIT_* overrides
 * (trusted main-process environment, see gitChildEnv), and tests/ops
 * legitimately introduce git keys AFTER module load (GIT_EDITOR,
 * GIT_CONFIG_GLOBAL, per-call GIT_CONFIG_KEY_n…). The allowEnvironment
 * list is snapshotted when the instance is constructed, so we:
 *   1. allowlist every ambient key + the app's override keys + the KNOWN
 *      dynamic git keys (below);
 *   2. have the live view SKIP any guarded key that is NOT allowlisted —
 *      a late-appearing unknown git var is dropped from the child instead
 *      of throwing, which is exactly what simple-git v4 does to unknown
 *      ambient git keys when no `.env()` is used at all.
 */
const EDITOR_PAGER_ENV_KEYS = ['EDITOR', 'PAGER', 'VISUAL'];
const KNOWN_DYNAMIC_GIT_ENV_KEYS: readonly string[] = [
  'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR', 'GIT_ASKPASS', 'GIT_TERMINAL_PROMPT',
  'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_COUNT', 'GIT_CONFIG_LOCK_TIMEOUT', 'GIT_CONFIG_PARAMETERS',
  'GIT_LFS_SKIP_SMUDGE', 'GIT_LFS_DISABLE',
  'GIT_SSH_COMMAND', 'GIT_SSH_VARIANT', 'GIT_ALLOW_PROTOCOL',
  'GIT_PROTOCOL_COMMAND', 'GIT_MERGE_AUTOEDIT',
  'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE',
  // Indexed GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n pairs (gitChildEnv merges
  // ambient + app indices; remoteNetworkArgs adds its own).
  ...Array.from({ length: 64 }, (_, i) => `GIT_CONFIG_KEY_${i}`),
  ...Array.from({ length: 64 }, (_, i) => `GIT_CONFIG_VALUE_${i}`),
];

/** Is this key one the simple-git v4 environment guard protects? */
const isGuardedEnvKey = (key: string): boolean =>
  /^git_/i.test(key) || EDITOR_PAGER_ENV_KEYS.includes(key.toUpperCase());

const ALLOWED_ENV_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(process.env),
  ...Object.keys(GIT_ENV_LFS_SKIP),
  ...KNOWN_DYNAMIC_GIT_ENV_KEYS,
]);

/** May the live executor env expose this key without tripping the guard? */
const guardSafeEnvKey = (key: string): boolean =>
  !isGuardedEnvKey(key) || ALLOWED_ENV_KEYS.has(key);

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
  // simple-git v4 allowEnvironment — every git-relevant key the live env
  // forwards (ambient + app overrides + known dynamic keys; see
  // ALLOWED_ENV_KEYS above). Without this, the first git operation throws
  // `Use of "GIT_LFS_SKIP_SMUDGE"/"EDITOR"/… is blocked by the environment
  // guard` — the 3→4 upgrade regression.
  allowEnvironment: [...ALLOWED_ENV_KEYS] as string[],
  env: GIT_ENV_LFS_SKIP,
  unsafe: {
    allowUnsafeConfigEnvCount: true as const,
    allowUnsafeHooksPath: true as const,
    allowUnsafeFilter: true as const,
    // The GIT_CONFIG env override sets `core.fsmonitor=true` and
    // `feature.manyFiles=true`. simple-git blocks config writes for these
    // without the corresponding allowUnsafe* flag, even though we're
    // setting them via env (not via `git config`). Without these flags,
    // git fetch/pull/clone fail with:
    //   "Configuring core.fsmonitor is not permitted without enabling allowUnsafeFsMonitor"
    allowUnsafeFsMonitor: true as const,
    allowUnsafeProtocolOverride: true as const,
    // ─── env plumbing ───
    // The child env is a LIVE merge of process.env + overrides (see
    // gitChildEnv). simple-git's env-vulnerability check blocks these
    // categories whenever the corresponding var is PRESENT in the env —
    // including values inherited from the user's own login environment
    // (EDITOR, PAGER, …) and values tests legitimately set (GIT_EDITOR).
    // The main-process environment is trusted (it is the user's machine),
    // so every env category is allowed; the ARGUMENT checks — the part
    // that actually guards against untrusted repo/branch names reaching
    // argv — keep their original per-instance flags.
    allowUnsafeConfigPaths: true as const,
    allowUnsafeEditor: true as const,
    allowUnsafePager: true as const,
    allowUnsafeAskPass: true as const,
    allowUnsafeSshCommand: true as const,
    allowUnsafeDiffExternal: true as const,
    allowUnsafeGitProxy: true as const,
    allowUnsafeTemplateDir: true as const,
  },
};

/**
 * GIT_UNSAFE_OPTIONS + the SSH-specific additions kept for documentation
 * value (the base now allows ssh/askpass too — network commands still layer
 * their own GIT_SSH_COMMAND / SSH_ASKPASS through the per-call extras).
 */
export const GIT_SSH_UNSAFE_OPTIONS = {
  ...GIT_UNSAFE_OPTIONS,
  unsafe: {
    ...GIT_UNSAFE_OPTIONS.unsafe,
    allowUnsafeSshCommand: true as const,
    allowUnsafeAskPass: true as const,
  },
};

// ─── Environment plumbing ───────────────────────────────────────────────────
//
// ⚠️ simple-git 3.x silently IGNORES an `env` property passed in the options
// object: the option exists in the typings, but no code path copies it onto
// the executor (`Git2` stores only baseDir/maxConcurrentProcesses/trimmed).
// The ONLY supported way to give a child git process a custom environment is
// the `.env()` builder, which REPLACES the inherited environment. Consequence
// of the old `env: GIT_ENV_LFS_SKIP` options usage: the overrides never
// reached any spawned git — GIT_LFS_SKIP_SMUDGE / GIT_CONFIG_COUNT were
// silently inactive, and git children simply inherited process.env.
//
// The helpers below snapshot process.env, layer the LFS/perf overrides (plus
// per-call extras like SSH transport env) on top, and apply the result through
// the builder — so the overrides ACTUALLY take effect while PATH/HOME/locale
// keep flowing to the child (ssh, credential helpers, git-lfs lookup).

/** Minimal structural type of simple-git's env builder. */
type GitWithEnvBuilder = { env(name: string, value: string): unknown };

/**
 * Build the FULL environment a child git process should see — identical to
 * the previous implicit inherit-from-parent semantics (PATH, HOME, locale,
 * EDITOR, test overrides such as GIT_CONFIG_GLOBAL/GIT_EDITOR …), plus the
 * LFS/perf GIT_CONFIG overrides, plus per-call extras. `extra` wins over
 * everything else.
 *
 * GIT_CONFIG_KEY_n/VALUE_n entries are MERGED, not replaced: entries the
 * ambient environment (or a test) already defines keep their indices and
 * win over the app's entries for the same key; the app's entries are
 * appended after them. This preserves setups like
 * `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.file.allow …` (used to
 * permit local-path submodule clones on git ≥ 2.38.1) instead of silently
 * dropping them.
 */
export function gitChildEnv(extra: Record<string, string> = {}): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v !== 'string') continue;
    merged[k] = v;
  }

  const ambientCount = Math.max(0, parseInt(process.env.GIT_CONFIG_COUNT ?? '0', 10) || 0);
  if (ambientCount > 0) {
    const ambientKeys = new Set<string>();
    for (let i = 0; i < ambientCount; i++) {
      const k = process.env[`GIT_CONFIG_KEY_${i}`];
      if (k !== undefined) ambientKeys.add(k.toLowerCase());
    }
    const appCount = parseInt(GIT_ENV_LFS_SKIP.GIT_CONFIG_COUNT, 10) || 0;
    const appEntries: [string, string][] = [];
    for (let i = 0; i < appCount; i++) {
      const k = GIT_ENV_LFS_SKIP[`GIT_CONFIG_KEY_${i}`];
      const v = GIT_ENV_LFS_SKIP[`GIT_CONFIG_VALUE_${i}`];
      if (k !== undefined && v !== undefined && !ambientKeys.has(k.toLowerCase())) {
        appEntries.push([k, v]);
      }
    }
    merged.GIT_CONFIG_COUNT = String(ambientCount + appEntries.length);
    appEntries.forEach(([k, v], i) => {
      merged[`GIT_CONFIG_KEY_${ambientCount + i}`] = k;
      merged[`GIT_CONFIG_VALUE_${ambientCount + i}`] = v;
    });
    // The non-GIT_CONFIG override (smudge skip) still applies.
    merged.GIT_LFS_SKIP_SMUDGE = GIT_ENV_LFS_SKIP.GIT_LFS_SKIP_SMUDGE;
  } else {
    Object.assign(merged, GIT_ENV_LFS_SKIP);
  }

  Object.assign(merged, extra);
  return merged;
}

/**
 * A LIVE view over `gitChildEnv(extra)` for the executor env.
 *
 * simple-git snapshots nothing for us — executor.env is a plain object — but
 * instances are CACHED (git.ts gitCache), so a static object would freeze the
 * environment at first use. Tests (and power users) legitimately change
 * process.env mid-run (e.g. GIT_CONFIG_SYSTEM) and expect git children to
 * see the CURRENT value, exactly like the previous inherit-from-parent
 * behavior. The Proxy recomputes the merge on every property read — cheap
 * (a 50-entry object copy) and semantically identical to a fresh snapshot
 * taken at spawn time.
 */
function liveGitEnv(extra: Record<string, string> = {}): Record<string, string> {
  // simple-git v4 guard filter — the executor env may only expose keys the
  // guard accepts: non-git keys freely, guarded (git_* / EDITOR / PAGER /
  // VISUAL) keys only when allowlisted (see ALLOWED_ENV_KEYS). A guarded key
  // that is NOT allowlisted is skipped instead of forwarded, so no spawn
  // can ever throw "Use of X is blocked by the environment guard".
  const target: Record<string, string> = {};
  return new Proxy(target, {
    ownKeys() {
      return Reflect.ownKeys(gitChildEnv(extra)).filter(
        (k) => typeof k !== 'string' || guardSafeEnvKey(k),
      );
    },
    get(_t, key) {
      if (typeof key !== 'string') return undefined;
      if (!guardSafeEnvKey(key)) return undefined;
      return gitChildEnv(extra)[key];
    },
    getOwnPropertyDescriptor(_t, key) {
      if (typeof key !== 'string') return undefined;
      if (!guardSafeEnvKey(key)) return undefined;
      const merged = gitChildEnv(extra);
      if (!(key in merged)) return undefined;
      return { value: merged[key], writable: true, enumerable: true, configurable: true };
    },
    has(_t, key) {
      if (typeof key !== 'string') return false;
      if (!guardSafeEnvKey(key)) return false;
      return key in gitChildEnv(extra);
    },
  });
}

/**
 * Apply `gitChildEnv(extra)` to a simple-git instance through the SUPPORTED
 * `.env()` builder so the overrides actually reach the spawned git.
 * Returns the same instance for chaining. Call once, right after creation.
 *
 * (Passing an object with no `value` makes the builder assign executor.env
 * directly — `Git.prototype.env(name)` — applying the whole environment in
 * a single call instead of one builder call per variable. The object is a
 * live view, so spawned children always see the CURRENT process.env.)
 */
export function withMergedGitEnv<T extends GitWithEnvBuilder>(git: T, extra: Record<string, string> = {}): T {
  (git as unknown as { env(envObject: Record<string, string>): unknown }).env(liveGitEnv(extra));
  return git;
}
