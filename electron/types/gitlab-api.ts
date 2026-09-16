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

/** A file changed in a GitLab MR — returned by listMRChanges.
 *  Mirrors the GitHub GithubPRFile shape so the renderer can use the
 *  same component (PRReview) for both providers. */
export interface GitLabMRFile {
  old_path: string;
  new_path: string;
  a_mode: string;
  b_mode: string;
  diff: string;        // unified diff patch
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  /** Normalized for the renderer: 'added' | 'deleted' | 'renamed' | 'modified' */
  status: 'added' | 'removed' | 'modified' | 'renamed';
  /** Computed: filename to display (new_path for added/modified, old_path for deleted) */
  filename: string;
  /** Computed: +/- counts parsed from the diff header lines */
  additions: number;
  deletions: number;
  /** Computed: blob URL on the GitLab instance (best-effort) */
  blob_url: string;
}

/** A discussion comment on a GitLab MR — returned by listMRNotes.
 *  Mirrors the GitHub GithubPRComment shape. */
export interface GitLabMRNote {
  id: number;
  body: string;
  author: { id: number; username: string; name: string; avatar_url?: string };
  created_at: string;
  updated_at: string;
  system: boolean;
  /** Normalized for the renderer: matches GithubPRComment.user.login */
  user: { login: string; avatar_url?: string };
}

/** A commit in a GitLab MR — returned by listMRCommits.
 *  Mirrors the GitHub GithubPRCommit shape. */
export interface GitLabMRCommit {
  id: string;
  short_id: string;
  title: string;
  message: string;
  author_name: string;
  author_email: string;
  created_at: string;
  web_url: string;
  /** Normalized for the renderer */
  sha: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
  };
  author?: { login: string; avatar_url?: string };
  committer?: { login: string; avatar_url?: string };
}

/** Full MR detail — returned by getMergeRequest. Extends the list shape
 *  with extra fields used by the review UI. */
export interface GitLabMergeRequestDetail extends GitLabMergeRequest {
  /** Description (markdown) — same as `description` but explicit. */
  body?: string;
  /** Whether the MR has conflicts (cannot be merged cleanly). */
  has_conflicts?: boolean;
  /** Whether the source branch can be merged into the target. */
  mergeable?: boolean;
  /** Draft / WIP state — set from work_in_progress by getMergeRequest. */
  draft?: boolean;
  /** Draft / WIP state (raw GitLab field name). */
  work_in_progress?: boolean;
  /** Total additions across all changed files. */
  additions?: number;
  /** Total deletions across all changed files. */
  deletions?: number;
  /** Total number of changed files. */
  changed_files?: number;
  /** Number of commits in the MR. */
  commits?: number;
  /** Number of comments (notes). */
  comments?: number;
  /** Labels. */
  labels?: string[];
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
  /** Fetch a single MR with full detail (description, merge_status, changes
   *  count, etc.). The listMergeRequests endpoint returns a slim version. */
  getMergeRequest: (projectId: number, mrIid: number) => Promise<GitLabMergeRequestDetail>;
  /** Fetch the changed files in a GitLab MR with their diff patches. */
  listMRChanges: (projectId: number, mrIid: number) => Promise<GitLabMRFile[]>;
  /** Fetch discussion notes (top-level MR thread). System notes are filtered
   *  out by the renderer — they include auto-generated status changes. */
  listMRNotes: (projectId: number, mrIid: number) => Promise<GitLabMRNote[]>;
  /** Fetch the commits that make up the MR. */
  listMRCommits: (projectId: number, mrIid: number) => Promise<GitLabMRCommit[]>;
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
