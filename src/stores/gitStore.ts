import { create } from 'zustand';
import { api, type StatusResult, type PushResult } from '../lib/api';
import { t as i18nT } from '../lib/i18n';
import { resolveDefaultRemote } from '../lib/remotes';
import { useOperationLogStore } from './operationLogStore';
import { useRepositoryStore } from './repositoryStore';
import { useToastStore } from './toastStore';
import { useSettingsStore } from './settingsStore';

// In-flight promises for refreshStatus — keyed by repoPath so a status
// refresh on repo B is NOT short-circuited by an in-flight refresh on
// repo A. Before this was a Map, switching A → B while status(A) was
// running made refreshStatus(B) return the promise of A and skip the
// `git status` call for B entirely, leaving the UI on a stale snapshot.
const refreshInFlight = new Map<string, Promise<void>>();

interface GitState {
  status: StatusResult | null;
  loading: boolean;
  error: string | null;
  lastRefresh: number;

  refreshStatus: (repoPath: string) => Promise<void>;
  /**
   * Clear the cached `status` (e.g. when switching repositories).
   * Called from App.tsx on `currentRepo?.path` change BEFORE
   * refreshStatus() so the UI doesn't briefly show the previous
   * repo's HEAD branch name while the new status resolves.
   *
   * Without this, switching from repo A (HEAD=main) to repo B
   * (HEAD=develop) would show "develop"'s working tree with the
   * label "main" for the duration of `git status` on B (1-5s on
   * large/LFS repos). The user reported this as "после переключения
   * репозитория теряется информация о текущей HEAD ветке".
   */
  clearStatus: () => void;
  stageFiles: (repoPath: string, files: string[]) => Promise<void>;
  stageAll: (repoPath: string) => Promise<void>;
  commit: (repoPath: string, message: string, amend?: boolean) => Promise<string>;
  push: (repoPath: string, remote?: string, branch?: string, setUpstream?: boolean, force?: boolean, targetBranch?: string, forceMode?: 'lease' | 'force') => Promise<PushResult>;
  pull: (repoPath: string, remote?: string, branch?: string) => Promise<void>;
  fetch: (repoPath: string, remote?: string, prune?: boolean) => Promise<void>;
}

/**
 * Unified post-pull conflict surfacing (user-reported: "И ничего не произошло").
 *
 * A pull that hits conflicts exits 1 — but detecting that from the ERROR
 * MESSAGE is brittle (git streams the CONFLICT lines to stdout; the thrown
 * error shape varies by git version / simple-git internals). The REPO STATE
 * is the source of truth: if MERGE_HEAD exists / `git status` reports
 * conflicted files, the pull produced a merge-in-progress state that the
 * user must see — regardless of which tool ran the pull.
 *
 * This helper re-reads the status and, when a conflicted merge is in
 * progress, navigates to the Changes page (the Conflicts section +
 * RepoStateBanner live there — SmartGit likewise switches to its conflict
 * view when a pull conflicts) and fires a warning toast. Returns whether
 * the repo is in a conflicted state.
 *
 * Used by: gitStore.pull, the Toolbar Pull dialog, the one-click Git
 * Toolbar pull, the app-menu smartPull handler — so EVERY pull entry point
 * reacts identically.
 */
export async function surfaceConflictedState(repoPath: string): Promise<boolean> {
  try {
    await useGitStore.getState().refreshStatus(repoPath);
  } catch {
    /* status itself failed — nothing more to surface */
  }
  const st = useGitStore.getState().status;
  const conflicted = !!(st && (st.isMerging || (st.conflicted?.length ?? 0) > 0));
  if (conflicted) {
    // Bring the user to where the conflicts are actually shown.
    // (hash routing — same navigation pattern as HistoryPage / ChangesPage.)
    window.location.hash = '#/changes';
    useToastStore.getState().warning(
      i18nT('toast.git.pullConflicts'),
      i18nT('pages.pullConflictsHint', { defaultValue: 'Resolve them in the Changes tool' }),
    );
  }
  return conflicted;
}

export const useGitStore = create<GitState>((set, get) => ({
  status: null,
  loading: false,
  error: null,
  lastRefresh: 0,

  clearStatus: () => set({ status: null, loading: false, error: null, lastRefresh: 0 }),

  refreshStatus: async (repoPath: string) => {
    // RACE FIX: if a status refresh is already in flight for this repo,
    // don't start a second one — return the existing promise. This was
    // the #1 cause of UI freezes: the file watcher (5s), commit/push
    // handlers, and the repo-open useEffect could all call refreshStatus
    // simultaneously, spawning 3-4 concurrent `git status` processes on
    // the same repo. simple-git queues them (maxConcurrentProcesses=4),
    // but each `git status` on a large/LFS repo takes 1-5s → 4 × 5s = 20s
    // of queued git processes → UI frozen.
    //
    // Keyed by repoPath: switching A → B while status(A) is running no
    // longer makes status(B) piggyback on status(A)'s promise (which
    // would skip B's status call entirely and leave its UI stale).
    const existing = refreshInFlight.get(repoPath);
    if (existing) return existing;

    set({ loading: true, error: null });
    const promise = (async () => {
      try {
        const status = await api.git.status(repoPath);
        // Only commit the status if we're STILL on the same repo. If the
        // user has switched to repo B in the meantime, dropping the result
        // is correct — refreshStatus(B) is running its own status() call.
        if (useRepositoryStore.getState().currentRepo?.path === repoPath) {
          set({ status, loading: false, lastRefresh: Date.now() });
        }
      } catch (e) {
        if (useRepositoryStore.getState().currentRepo?.path === repoPath) {
          set({ error: String(e), loading: false });
        }
      } finally {
        refreshInFlight.delete(repoPath);
      }
    })();
    refreshInFlight.set(repoPath, promise);
    return promise;
  },

  stageFiles: async (repoPath, files) => {
    await api.git.add(repoPath, files);
    await get().refreshStatus(repoPath);
  },

  stageAll: async (repoPath) => {
    const log = useOperationLogStore.getState();
    const opId = log.startOp('Stage All', repoPath, `git add .`);
    try {
      await api.git.addAll(repoPath);
      await get().refreshStatus(repoPath);
      log.finishOp(opId, 'All files staged');
    } catch (e) {
      log.failOp(opId, String(e));
      throw e;
    }
  },

  commit: async (repoPath, message, amend) => {
    const log = useOperationLogStore.getState();
    const cmd = amend ? 'git commit --amend' : 'git commit';
    const opId = log.startOp(amend ? 'Commit (Amend)' : 'Commit', repoPath, `${cmd} -m "..."`);
    try {
      const hash = await api.git.commit(repoPath, message, amend);
      await get().refreshStatus(repoPath);
      log.finishOp(opId, `Commit ${hash.substring(0, 7)}`);
      return hash;
    } catch (e) {
      log.failOp(opId, String(e));
      throw e;
    }
  },

  push: async (repoPath, remote, branch, setUpstream, force, targetBranch, forceMode) => {
    const log = useOperationLogStore.getState();
    // Never hardcode 'origin' — resolve it (origin → first remote). Fails with
    // a clear message when the repo has no remotes at all.
    const resolved = remote ?? (await resolveDefaultRemote(repoPath));
    if (!resolved) {
      throw new Error('No remotes configured — add one on the Remotes page');
    }
    const refspec = targetBranch && targetBranch !== branch ? `${branch}:${targetBranch}` : (branch || '');
    // Effective force flag: explicit param > forcePushMode setting > --force.
    const effMode = forceMode ?? useSettingsStore.getState().settings?.forcePushMode ?? 'force';
    const cmd = `git push ${resolved} ${refspec} ${setUpstream ? '-u' : ''}${force ? ` ${effMode === 'lease' ? '--force-with-lease' : '--force'}` : ''}`.trim();
    const opId = log.startOp('Push', repoPath, cmd);
    try {
      const result = await api.git.push(repoPath, resolved, branch, setUpstream, force, false, targetBranch, forceMode);
      await get().refreshStatus(repoPath);
      // Refresh repository metadata (lastCommit, branchCount, etc.) in the sidebar
      api.settings.refreshRepoStats(repoPath).then(() => {
        useRepositoryStore.getState().loadMetadata();
        useRepositoryStore.getState().checkRemotes?.([repoPath]);
      }).catch(() => {});
      log.finishOp(opId, result?.summary ?? 'Pushed successfully');
      return result;
    } catch (e) {
      log.failOp(opId, String(e));
      throw e;
    }
  },

  pull: async (repoPath, remote, branch) => {
    const log = useOperationLogStore.getState();
    // Read the user's Pull strategy setting — Settings → Git →
    // "When pulling: Merge / Rebase". Default is 'merge' when unset.
    // This is forwarded as the `rebase` flag to api.git.pull, which in
    // turn passes `--rebase` or `--no-rebase` to `git pull` so git
    // never refuses with "Need to specify how to reconcile divergent
    // branches" on repos without `pull.rebase` configured.
    const pullStrategy = useSettingsStore.getState().settings.pullStrategy ?? 'merge';
    const shouldRebase = pullStrategy === 'rebase';
    const cmd = `git pull ${remote || 'origin'} ${branch || ''} ${shouldRebase ? '--rebase' : '--no-rebase'}`.trim();
    const opId = log.startOp(shouldRebase ? 'Pull (Rebase)' : 'Pull (Merge)', repoPath, cmd);
    try {
      const res = await api.git.pull(repoPath, remote, branch, shouldRebase);
      await get().refreshStatus(repoPath);
      // Refresh repository metadata in the sidebar
      api.settings.refreshRepoStats(repoPath).then(() => {
        useRepositoryStore.getState().loadMetadata();
        useRepositoryStore.getState().checkRemotes?.([repoPath]);
      }).catch(() => {});
      log.finishOp(opId, 'Pulled successfully');
      // 0.2 — surface the auto-stash cycle (autoStashOnCommonCommands setting)
      if (res?.autoStashed) {
        const toastApi = useToastStore.getState();
        if (res.popFailed) {
          toastApi.warning(i18nT('changes.autoStashPopFailed'), i18nT('changes.autoStashHintShort'));
        } else {
          toastApi.success(i18nT('changes.autoStashRestored'));
        }
      }
    } catch (e) {
      log.failOp(opId, String(e));
      // A conflicted pull leaves the repo mid-merge — detect it from the
      // REPO STATE (not the error text) and take the user to the Conflicts
      // UI. Without this, pull exit 1 was only a transient error toast and
      // the user saw "ничего не произошло" (user-reported).
      await surfaceConflictedState(repoPath);
      throw e;
    }
  },

  fetch: async (repoPath, remote, prune) => {
    const log = useOperationLogStore.getState();
    const cmd = `git fetch ${remote || 'origin'} ${prune ? '--prune' : ''}`.trim();
    const opId = log.startOp('Fetch', repoPath, cmd);
    try {
      await api.git.fetch(repoPath, remote, prune);
      await get().refreshStatus(repoPath);
      // Refresh repository metadata in the sidebar
      api.settings.refreshRepoStats(repoPath).then(() => {
        useRepositoryStore.getState().loadMetadata();
        useRepositoryStore.getState().checkRemotes?.([repoPath]);
      }).catch(() => {});
      log.finishOp(opId, 'Fetched successfully');
    } catch (e) {
      log.failOp(opId, String(e));
      throw e;
    }
  },
}));
