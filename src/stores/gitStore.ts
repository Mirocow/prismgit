import { create } from 'zustand';
import { api, type StatusResult } from '../lib/api';

interface GitState {
  status: StatusResult | null;
  loading: boolean;
  error: string | null;
  lastRefresh: number;

  refreshStatus: (repoPath: string) => Promise<void>;
  stageFiles: (repoPath: string, files: string[]) => Promise<void>;
  stageAll: (repoPath: string) => Promise<void>;
  commit: (repoPath: string, message: string, amend?: boolean) => Promise<string>;
  push: (repoPath: string, remote?: string, branch?: string, setUpstream?: boolean) => Promise<void>;
  pull: (repoPath: string, remote?: string, branch?: string) => Promise<void>;
  fetch: (repoPath: string, remote?: string, prune?: boolean) => Promise<void>;
}

export const useGitStore = create<GitState>((set, get) => ({
  status: null,
  loading: false,
  error: null,
  lastRefresh: 0,

  refreshStatus: async (repoPath: string) => {
    set({ loading: true, error: null });
    try {
      const status = await api.git.status(repoPath);
      set({ status, loading: false, lastRefresh: Date.now() });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  stageFiles: async (repoPath, files) => {
    await api.git.add(repoPath, files);
    await get().refreshStatus(repoPath);
  },

  stageAll: async (repoPath) => {
    await api.git.addAll(repoPath);
    await get().refreshStatus(repoPath);
  },

  commit: async (repoPath, message, amend) => {
    const hash = await api.git.commit(repoPath, message, amend);
    await get().refreshStatus(repoPath);
    return hash;
  },

  push: async (repoPath, remote, branch, setUpstream) => {
    await api.git.push(repoPath, remote, branch, setUpstream);
    await get().refreshStatus(repoPath);
  },

  pull: async (repoPath, remote, branch) => {
    await api.git.pull(repoPath, remote, branch);
    await get().refreshStatus(repoPath);
  },

  fetch: async (repoPath, remote, prune) => {
    await api.git.fetch(repoPath, remote, prune);
    await get().refreshStatus(repoPath);
  },
}));
