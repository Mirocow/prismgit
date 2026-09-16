import { create } from 'zustand';
import { api, type StatusResult, type PushResult } from '../lib/api';
import { t as i18nT } from '../lib/i18n';
import { resolveDefaultRemote } from '../lib/remotes';
import { useOperationLogStore } from './operationLogStore';
import { useRepositoryStore } from './repositoryStore';
import { useToastStore } from './toastStore';

// In-flight promise for refreshStatus — prevents concurrent status() calls
// on the same repo from spawning multiple `git status` subprocesses.
let refreshInFlight: Promise<void> | null = null;

interface GitState {
  status: StatusResult | null;
  loading: boolean;
  error: string | null;
  lastRefresh: number;

  refreshStatus: (repoPath: string) => Promise<void>;
  stageFiles: (repoPath: string, files: string[]) => Promise<void>;
  stageAll: (repoPath: string) => Promise<void>;
  commit: (repoPath: string, message: string, amend?: boolean) => Promise<string>;
  push: (repoPath: string, remote?: string, branch?: string, setUpstream?: boolean, force?: boolean, targetBranch?: string) => Promise<PushResult>;
  pull: (repoPath: string, remote?: string, branch?: string) => Promise<void>;
  fetch: (repoPath: string, remote?: string, prune?: boolean) => Promise<void>;
}

export const useGitStore = create<GitState>((set, get) => ({
  status: null,
  loading: false,
  error: null,
  lastRefresh: 0,

  refreshStatus: async (repoPath: string) => {
    // RACE FIX: if a status refresh is already in flight for this repo,
    // don't start a second one — return the existing promise. This was
    // the #1 cause of UI freezes: the file watcher (5s), commit/push
    // handlers, and the repo-open useEffect could all call refreshStatus
    // simultaneously, spawning 3-4 concurrent `git status` processes on
    // the same repo. simple-git queues them (maxConcurrentProcesses=4),
    // but each `git status` on a large/LFS repo takes 1-5s → 4 × 5s = 20s
    // of queued git processes → UI frozen.
    if (refreshInFlight) {
      return refreshInFlight;
    }

    set({ loading: true, error: null });
    const promise = (async () => {
      try {
        const status = await api.git.status(repoPath);
        set({ status, loading: false, lastRefresh: Date.now() });
      } catch (e) {
        set({ error: String(e), loading: false });
      } finally {
        refreshInFlight = null;
      }
    })();
    refreshInFlight = promise;
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

  push: async (repoPath, remote, branch, setUpstream, force, targetBranch) => {
    const log = useOperationLogStore.getState();
    // Never hardcode 'origin' — resolve it (origin → first remote). Fails with
    // a clear message when the repo has no remotes at all.
    const resolved = remote ?? (await resolveDefaultRemote(repoPath));
    if (!resolved) {
      throw new Error('No remotes configured — add one on the Remotes page');
    }
    const refspec = targetBranch && targetBranch !== branch ? `${branch}:${targetBranch}` : (branch || '');
    const cmd = `git push ${resolved} ${refspec} ${setUpstream ? '-u' : ''}${force ? ' --force-with-lease' : ''}`.trim();
    const opId = log.startOp('Push', repoPath, cmd);
    try {
      const result = await api.git.push(repoPath, resolved, branch, setUpstream, force, false, targetBranch);
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
    const cmd = `git pull ${remote || 'origin'} ${branch || ''}`.trim();
    const opId = log.startOp('Pull (Merge)', repoPath, cmd);
    try {
      const res = await api.git.pull(repoPath, remote, branch);
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
