import type { StatusResult } from './api';

/**
 * Central model of the git "sequencer" / in-progress repository states —
 * the SmartGit Working-tree states (Log manual): cherry-picking, reverting,
 * merging, rebasing and bisecting. Every tool in the app (Changes banner,
 * Toolbar pull-blocking, Branches badge, History guards) reacts through this
 * single helper so the wording and rules stay consistent.
 *
 * Rules while ANY of these states is active (SmartGit semantics):
 *  - Pull is NOT allowed (Fetch / Fetch All remain available — they never
 *    touch the working tree or HEAD).
 *  - Checkout / Merge / Reset / Rebase / Cherry-pick / Revert are NOT allowed
 *    — they would discard the unfinished operation.
 *  - Only the state-resolving actions from the Changes banner are allowed
 *    (Continue / Skip / Abort, Commit Empty for an empty pick, Abort Merge,
 *    Good/Bad/Reset while bisecting).
 *  - Commit is blocked EXCEPT for the merging state — a plain commit is THE
 *    way to complete a conflicted merge (SmartGit behaves the same).
 */

export type RepoStateKey =
  | 'cherry-picking'
  | 'reverting'
  | 'merging'
  | 'rebasing'
  | 'bisecting';

export interface RepoStateInfo {
  key: RepoStateKey;
  /** SmartGit wording, e.g. "The working tree is in cherry-picking-state." */
  bannerText: string;
  /** Short badge label for the Branches page, e.g. "cherry-picking". */
  badge: string;
  /** Short present-participle for titles, e.g. "Cherry-pick". */
  title: string;
  /** Short noun phrase for Pull-blocking messages: "a cherry-pick is in progress". */
  pullReason: string;
  /** Toast shown when a blocked operation is attempted. */
  blockedTitle: string;
  blockedHint: string;
}

const STATES: Record<RepoStateKey, RepoStateInfo> = {
  'cherry-picking': {
    key: 'cherry-picking',
    bannerText: 'The working tree is in cherry-picking-state.',
    badge: 'cherry-picking',
    title: 'Cherry-pick',
    pullReason: 'a cherry-pick is in progress',
    blockedTitle: 'Cherry-pick in progress',
    blockedHint:
      'Finish it first on the Changes page (Continue or Abort) — this operation would lead to loss of the picked commit',
  },
  'reverting': {
    key: 'reverting',
    bannerText: 'The working tree is in reverting-state.',
    badge: 'reverting',
    title: 'Revert',
    pullReason: 'a revert is in progress',
    blockedTitle: 'Revert in progress',
    blockedHint:
      'Finish it first on the Changes page (Continue or Abort) — this operation would lead to loss of the revert',
  },
  'merging': {
    key: 'merging',
    bannerText: 'The working tree is in merging-state.',
    badge: 'merging',
    title: 'Merge',
    pullReason: 'a merge is in progress',
    blockedTitle: 'Merge in progress',
    blockedHint:
      'Finish it first on the Changes page (commit the merge or Abort Merge) — this operation would discard the merge',
  },
  'rebasing': {
    key: 'rebasing',
    bannerText: 'The working tree is in rebasing-state.',
    badge: 'rebasing',
    title: 'Rebase',
    pullReason: 'a rebase is in progress',
    blockedTitle: 'Rebase in progress',
    blockedHint:
      'Finish it first on the Changes page (Continue, Skip or Abort) — this operation would discard the rebase',
  },
  'bisecting': {
    key: 'bisecting',
    bannerText: 'The working tree is in bisecting-state.',
    badge: 'bisecting',
    title: 'Bisect',
    pullReason: 'a bisect is in progress',
    blockedTitle: 'Bisect in progress',
    blockedHint:
      'Finish it first on the Changes page (Good / Bad / Reset) — HEAD is detached at the bisect candidate and this operation would discard the search',
  },
};

/** Priority when several state files exist (rare but possible). */
const PRIORITY: RepoStateKey[] = [
  'cherry-picking',
  'reverting',
  'merging',
  'rebasing',
  'bisecting',
];

/**
 * The state the repository is currently in, or null when the working tree is
 * idle. Reads the boolean flags computed by the git service (status()).
 */
export function getRepoInProgressState(
  status?: StatusResult | null
): RepoStateInfo | null {
  if (!status) return null;
  for (const key of PRIORITY) {
    switch (key) {
      case 'cherry-picking':
        if (status.isCherryPicking) return STATES[key];
        break;
      case 'reverting':
        if (status.isReverting) return STATES[key];
        break;
      case 'merging':
        if (status.isMerging) return STATES[key];
        break;
      case 'rebasing':
        if (status.isRebasing) return STATES[key];
        break;
      case 'bisecting':
        if (status.isBisecting) return STATES[key];
        break;
    }
  }
  return null;
}

/**
 * True when a sequencer state (or bisect) is active. While true:
 * Pull / Checkout / Merge / Reset / Rebase / Cherry-pick / Revert are blocked.
 */
export function isRepoBusy(status?: StatusResult | null): boolean {
  return getRepoInProgressState(status) !== null;
}

/**
 * True when plain Commit is blocked. During a MERGE a plain commit is the
 * legitimate way to complete the merge — it stays available there (SmartGit
 * does the same). For every other state the banner's Continue resolves it.
 */
export function isCommitBlocked(status?: StatusResult | null): boolean {
  const state = getRepoInProgressState(status);
  return state !== null && state.key !== 'merging';
}

/** Blocked-operation guard helper — builds a consistent toast payload. */
export function blockedOperationToast(status?: StatusResult | null): {
  title: string;
  hint: string;
} | null {
  const state = getRepoInProgressState(status);
  if (!state) return null;
  return { title: state.blockedTitle, hint: state.blockedHint };
}
