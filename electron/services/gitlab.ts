/**
 * GitLab API integration — mirrors github.ts structure.
 * SmartGit Manual: Hosting Provider integration for GitLab (self-hosted + cloud).
 *
 * Supports: PAT auth, list projects, list MRs, create MR, MR comments,
 * approve MR, merge MR, pipeline status (GitLab CI).
 */
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { SimpleStore } from './simpleStore.js';
import type {
  GitLabMergeRequestDetail,
  GitLabMRFile,
  GitLabMRNote,
  GitLabMRCommit,
} from '../types/gitlab-api.js';
import { startApiCall, finishApiCall, sanitizeApiPath } from './commandLog.js';

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
  author: { id: number; username: string; name: string };
  merge_status: 'can_be_merged' | 'cannot_be_merged' | 'unchecked';
}

export interface GitLabPipeline {
  id: number;
  sha: string;
  ref: string;
  status: 'running' | 'pending' | 'success' | 'failed' | 'canceled' | 'skipped';
  web_url: string;
}

interface GitLabAuthState {
  token?: string;
  baseUrl?: string; // default https://gitlab.com
  user?: GitLabUser;
}

const store = new SimpleStore({
  name: 'prismgit-gitlab',
  defaults: {},
});

function getAuthState(): GitLabAuthState {
  return (store.get('gitlab') || {}) as GitLabAuthState;
}

function setAuthState(state: GitLabAuthState): void {
  store.set('gitlab', state);
}

function getBaseUrl(): string {
  return getAuthState().baseUrl || 'https://gitlab.com';
}

async function apiJson<T>(
  endpoint: string,
  options: { method?: string; body?: string; token?: string } = {}
): Promise<T> {
  const baseUrl = getBaseUrl();
  const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}/api/v4${endpoint}`;
  const u = new URL(url);
  // Log the GitLab API call to the Output panel — same pattern as github.ts.
  // The path includes '/api/v4' so the user can see it's a GitLab API call.
  const path = sanitizeApiPath(u.pathname + u.search);
  const method = (options.method || 'GET').toUpperCase();
  const handle = startApiCall({ provider: 'gitlab', method, path });
  const isHttps = u.protocol === 'https:';
  const lib = isHttps ? https : http;
  const headers: Record<string, string> = {
    'User-Agent': 'PrismGit-Electron/2.0',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const token = options.token || getAuthState().token;
  if (token) {
    headers['PRIVATE-TOKEN'] = token;
  }
  return new Promise<T>((resolve, reject) => {
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            try {
              finishApiCall(handle, { status, body: data });
              resolve(data ? JSON.parse(data) : null);
            } catch (e) {
              finishApiCall(handle, { status, error: `JSON parse error: ${e}` });
              reject(new Error(`JSON parse error: ${e}`));
            }
          } else {
            finishApiCall(handle, { status, error: `GitLab API ${status}` });
            reject(new Error(`GitLab API ${status}: ${data}`));
          }
        });
      }
    );
    req.on('error', (e) => {
      finishApiCall(handle, { status: 0, error: String(e) });
      reject(e);
    });
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

export async function authWithPAT(
  token: string,
  baseUrl?: string
): Promise<GitLabUser> {
  // Save base URL if provided
  if (baseUrl) {
    setAuthState({ ...getAuthState(), baseUrl });
  }
  const user = await apiJson<GitLabUser>('/user', { token });
  setAuthState({ token, baseUrl: baseUrl || getBaseUrl(), user });
  return user;
}

export function logout(): void {
  setAuthState({});
}

export function getAuthStatePublic(): { token?: string; user?: GitLabUser; baseUrl?: string } {
  return getAuthState();
}

export async function listProjects(
  page = 1,
  perPage = 50
): Promise<GitLabProject[]> {
  return apiJson<GitLabProject[]>(`/projects?membership=true&page=${page}&per_page=${perPage}&order_by=last_activity_at`);
}

/**
 * Look up a single project by its path_with_namespace (e.g. "group/sub/repo").
 *
 * This is the GitLab-recommended way to resolve a project from a clone URL:
 *   GET /projects/:id  where :id is the URL-encoded path_with_namespace.
 *
 * For "group/subgroup/repo" the encoded form is "%2Fgroup%2Fsubgroup%2Frepo".
 * encodeURIComponent doesn't encode forward slashes, so we replace them
 * manually with %2F.
 *
 * This replaces the previous 'page through listProjects and match
 * path_with_namespace' approach — that could need 5+ pages for users with
 * many groups, and on a self-hosted GitLab at a private IP, the lookup was
 * flaky and produced '404 Project Not Found' on listMergeRequests.
 */
export async function getProjectByPath(
  pathWithNamespace: string
): Promise<GitLabProject> {
  const encoded = encodeURIComponent(pathWithNamespace).replace(/%2F/gi, '%2F').replace(/\//g, '%2F');
  return apiJson<GitLabProject>(`/projects/${encoded}`);
}

export async function listMergeRequests(
  projectId: number,
  state: 'opened' | 'closed' | 'merged' | 'all' = 'opened'
): Promise<GitLabMergeRequest[]> {
  return apiJson<GitLabMergeRequest[]>(`/projects/${projectId}/merge_requests?state=${state}`);
}

/**
 * Fetch a single MR with full detail (description, merge_status, changes
 * count). The listMergeRequests endpoint returns a slim version.
 *
 * Used by the PR review surface (Reviews page) when the user opens a MR.
 */
export async function getMergeRequest(
  projectId: number,
  mrIid: number
): Promise<GitLabMergeRequestDetail> {
  const mr = await apiJson<GitLabMergeRequestDetail>(
    `/projects/${projectId}/merge_requests/${mrIid}?include_diverged_commits_count=true`
  );
  // Normalize: the MR list uses `description`, the review UI uses `body`.
  // Populate `body` so the PRReview component can read either field.
  mr.body = mr.description ?? mr.body ?? '';
  mr.mergeable = mr.merge_status === 'can_be_merged';
  mr.draft = mr.work_in_progress;
  return mr;
}

/**
 * Fetch the changed files in a GitLab MR with their unified diff patches.
 * Maps GitLab's response shape to the GitHub-style GithubPRFile shape so
 * the renderer can use the same PRReview component for both providers.
 *
 * GitLab endpoint: GET /projects/:id/merge_requests/:iid/changes
 * Returns: { changes: [{ old_path, new_path, diff, new_file, renamed_file, deleted_file }] }
 */
export async function listMRChanges(
  projectId: number,
  mrIid: number
): Promise<GitLabMRFile[]> {
  const resp = await apiJson<{ changes: Array<Record<string, unknown>> }>(
    `/projects/${projectId}/merge_requests/${mrIid}/changes`
  );
  const baseUrl = getBaseUrl();
  const projectPath = String(projectId); // numeric ID; renderer uses owner/repo for URLs anyway
  return (resp.changes || []).map((c) => {
    const newFile = !!c.new_file;
    const renamedFile = !!c.renamed_file;
    const deletedFile = !!c.deleted_file;
    const oldPath = String(c.old_path || '');
    const newPath = String(c.new_path || '');
    const diff = String(c.diff || '');
    // Parse +/- counts from the diff hunk lines.
    let additions = 0;
    let deletions = 0;
    for (const line of diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }
    const status: GitLabMRFile['status'] = newFile
      ? 'added'
      : deletedFile
        ? 'removed'
        : renamedFile
          ? 'renamed'
          : 'modified';
    return {
      old_path: oldPath,
      new_path: newPath,
      a_mode: String(c.a_mode || ''),
      b_mode: String(c.b_mode || ''),
      diff,
      new_file: newFile,
      renamed_file: renamedFile,
      deleted_file: deletedFile,
      status,
      filename: deletedFile ? oldPath : newPath,
      additions,
      deletions,
      blob_url: `${baseUrl}/${projectPath}/-/blob/${newPath}`,
    } satisfies GitLabMRFile;
  });
}

/**
 * Fetch discussion notes (top-level MR thread). GitLab's notes API returns
 * both user notes AND system notes (e.g. "John assigned this MR to Jane").
 * We keep all of them here — the renderer can filter `system: true` notes
 * if it wants to show only human-written comments.
 *
 * Mirrors the GitHub listPRIssueComments endpoint.
 */
export async function listMRNotes(
  projectId: number,
  mrIid: number
): Promise<GitLabMRNote[]> {
  const notes = await apiJson<Array<Omit<GitLabMRNote, 'user'>>>(
    `/projects/${projectId}/merge_requests/${mrIid}/notes?per_page=100&sort=asc&order_by=created_at`
  );
  // Normalize: GitLab uses `author.username`, the renderer expects `user.login`.
  return notes.map((n) => ({
    ...n,
    user: {
      login: n.author.username,
      avatar_url: n.author.avatar_url,
    },
  }));
}

/**
 * Fetch the commits that make up the MR.
 * Maps GitLab's response shape to the GitHub-style GithubPRCommit shape.
 *
 * GitLab endpoint: GET /projects/:id/merge_requests/:iid/commits
 */
export async function listMRCommits(
  projectId: number,
  mrIid: number
): Promise<GitLabMRCommit[]> {
  const commits = await apiJson<Array<Omit<GitLabMRCommit, 'sha' | 'commit' | 'author' | 'committer'>>>(
    `/projects/${projectId}/merge_requests/${mrIid}/commits?per_page=100`
  );
  // Normalize to match the GithubPRCommit shape so the renderer can use
  // the same PRReview component.
  return commits.map((c) => ({
    ...c,
    sha: c.id,
    commit: {
      message: c.message || c.title,
      author: {
        name: c.author_name,
        email: c.author_email,
        date: c.created_at,
      },
    },
    // GitLab's MR commits endpoint doesn't return a linked GitHub-style
    // `author` object — leave undefined so the renderer falls back to
    // showing the commit's author_name.
  }));
}

export async function createMergeRequest(
  projectId: number,
  data: {
    title: string;
    source_branch: string;
    target_branch: string;
    description?: string;
  }
): Promise<GitLabMergeRequest> {
  return apiJson<GitLabMergeRequest>(`/projects/${projectId}/merge_requests`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function approveMergeRequest(
  projectId: number,
  mrIid: number
): Promise<void> {
  await apiJson(`/projects/${projectId}/merge_requests/${mrIid}/approve`, {
    method: 'POST',
  });
}

export async function mergeMergeRequest(
  projectId: number,
  mrIid: number,
  options: { squash?: boolean; should_remove_source_branch?: boolean } = {}
): Promise<GitLabMergeRequest> {
  return apiJson<GitLabMergeRequest>(`/projects/${projectId}/merge_requests/${mrIid}/merge`, {
    method: 'PUT',
    body: JSON.stringify(options),
  });
}

export async function addMRComment(
  projectId: number,
  mrIid: number,
  body: string
): Promise<void> {
  await apiJson(`/projects/${projectId}/merge_requests/${mrIid}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

/**
 * List pipelines for a project — GitLab CI integration.
 * Returns recent pipeline runs (one per commit usually).
 */
export async function listPipelines(
  projectId: number,
  sha?: string
): Promise<GitLabPipeline[]> {
  const query = sha ? `?sha=${encodeURIComponent(sha)}` : '';
  return apiJson<GitLabPipeline[]>(`/projects/${projectId}/pipelines${query}`);
}

/**
 * Get pipeline status for a specific commit SHA.
 * Returns the most recent pipeline status for that SHA.
 */
export async function getCommitPipelineStatus(
  projectId: number,
  sha: string
): Promise<GitLabPipeline | null> {
  const pipelines = await listPipelines(projectId, sha);
  return pipelines.length > 0 ? pipelines[0] : null;
}
