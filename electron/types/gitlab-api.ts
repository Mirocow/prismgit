/**
 * GitLab API type for the preload bridge.
 *
 * Mirrors electron/services/gitlab.ts + electron/ipc/gitlab.ts — the IPC
 * handler names match the method names so the preload can auto-generate
 * the bindings.
 */
export interface GitLabUser {
  id: number;
  username: string;
  name: string;
  email?: string;
  avatar_url?: string;
  web_url?: string;
}

export interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  description?: string;
  web_url: string;
  default_branch: string;
  visibility: 'public' | 'private' | 'internal';
  http_url_to_repo?: string;
  ssh_url_to_repo?: string;
  avatar_url?: string;
  last_activity_at?: string;
  star_count?: number;
}

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  title: string;
  description: string;
  state: 'opened' | 'closed' | 'merged';
  source_branch: string;
  target_branch: string;
  web_url: string;
  author: { id: number; username: string; name: string; avatar_url?: string };
  merge_status: 'can_be_merged' | 'cannot_be_merged' | 'unchecked';
  created_at: string;
  updated_at: string;
  merged_at?: string | null;
  user_notes_count?: number;
  upvotes?: number;
  downvotes?: number;
}

export interface GitLabPipeline {
  id: number;
  sha: string;
  ref: string;
  status: 'running' | 'pending' | 'success' | 'failed' | 'canceled' | 'skipped';
  web_url: string;
}

export interface GitLabApi {
  // === Auth ===
  authWithPAT: (token: string, baseUrl?: string) => Promise<GitLabUser>;
  logout: () => Promise<void>;
  getAuthState: () => Promise<{ token?: string; user?: GitLabUser; baseUrl?: string }>;
  // === Projects (clone source list) ===
  listProjects: (page?: number, perPage?: number) => Promise<GitLabProject[]>;
  /** Look up a single project by its URL-encoded path_with_namespace
   *  (e.g. "group/subgroup/repo" → "%2Fgroup%2Fsubgroup%2Frepo"). Avoids
   *  paginating through listProjects when we already know the path. */
  getProjectByPath: (pathWithNamespace: string) => Promise<GitLabProject>;
  // === Merge requests (GitLab equivalent of pull requests) ===
  listMergeRequests: (projectId: number, state?: 'opened' | 'closed' | 'merged' | 'all') => Promise<GitLabMergeRequest[]>;
  createMergeRequest: (projectId: number, data: {
    title: string;
    source_branch: string;
    target_branch: string;
    description?: string;
  }) => Promise<GitLabMergeRequest>;
  // === MR actions (approve, merge, comment) ===
  approveMergeRequest: (projectId: number, mrIid: number) => Promise<void>;
  mergeMergeRequest: (projectId: number, mrIid: number, options?: {
    squash?: boolean;
    should_remove_source_branch?: boolean;
  }) => Promise<GitLabMergeRequest>;
  addMRComment: (projectId: number, mrIid: number, body: string) => Promise<void>;
  // === Pipelines (GitLab CI) ===
  listPipelines: (projectId: number, sha?: string) => Promise<GitLabPipeline[]>;
}
