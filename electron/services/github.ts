import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { SimpleStore } from './simpleStore.js';
import type { GithubUser, GithubRepository, GithubPullRequest } from '../types/github-api.js';

interface AuthState {
  token?: string;
  user?: GithubUser;
}

const store = new SimpleStore({
  name: 'prismgit-github',
  defaults: {},
});

function getAuthState(): AuthState {
  return (store.get('github') || {}) as AuthState;
}

function setAuthState(state: AuthState): void {
  store.set('github', state);
}

async function httpsJson<T>(url: string, options: https.RequestOptions & { token?: string; body?: string } = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const headers: Record<string, string> = {
      'User-Agent': 'SmartGit-Electron/1.0',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers as Record<string, string> || {}),
    };
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }
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
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(data ? JSON.parse(data) : null);
            } catch (e) {
              reject(new Error(`Failed to parse JSON: ${e}`));
            }
          } else {
            reject(new Error(`GitHub API ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

export async function authWithPAT(token: string): Promise<GithubUser> {
  const user = await httpsJson<GithubUser>('https://api.github.com/user', { token });
  setAuthState({ token, user });
  return user;
}

export async function authWithOAuth(): Promise<GithubUser> {
  // Simplified OAuth device flow
  // In production: register a GitHub OAuth App and use real client_id
  throw new Error(
    'OAuth flow requires registering a GitHub OAuth App. Please use a Personal Access Token (PAT) for now. Generate one at https://github.com/settings/tokens'
  );
}

export async function getCurrentUser(): Promise<GithubUser> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  return httpsJson<GithubUser>('https://api.github.com/user', { token });
}

export async function getRepositories(page = 1): Promise<GithubRepository[]> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  return httpsJson<GithubRepository[]>(
    `https://api.github.com/user/repos?page=${page}&per_page=100&sort=updated&affiliation=owner,collaborator`,
    { token }
  );
}

export async function getOrgRepositories(org: string, page = 1): Promise<GithubRepository[]> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  return httpsJson<GithubRepository[]>(
    `https://api.github.com/orgs/${org}/repos?page=${page}&per_page=100&sort=updated`,
    { token }
  );
}

export async function createPullRequest(
  owner: string,
  repo: string,
  data: { title: string; head: string; base: string; body?: string }
): Promise<GithubPullRequest> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  return httpsJson<GithubPullRequest>(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  );
}

export async function listPullRequests(
  owner: string,
  repo: string,
  state: 'open' | 'closed' | 'all' = 'open'
): Promise<GithubPullRequest[]> {
  const { token } = getAuthState();
  // Return empty array instead of throwing when not authenticated.
  // The renderer checks `authenticated` before calling, but there's a race:
  // the auth state may change between the check and the IPC call. Returning
  // [] is the correct degraded behavior — the UI shows "No PRs" which is
  // better than an IPC error popup that spams the console.
  if (!token) return [];
  return httpsJson<GithubPullRequest[]>(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=${state}&per_page=100`,
    { token }
  );
}

export async function logout(): Promise<void> {
  store.delete('github');
}

/** CI status of a commit (GitHub Actions etc. — SmartGit Standard Window "My History" badges). */
export interface CommitCheckStatus {
  sha: string;
  /** overall conclusion, e.g. success | failure | neutral | skipped | undefined while running */
  conclusion?: string;
  status: string;
  totalChecks: number;
}

/**
 * Fetch check-run summaries for a batch of commits (max ~25 per call to stay
 * within the API rate limits and keep latency acceptable).
 */
export async function getCheckRuns(
  owner: string,
  repo: string,
  shas: string[]
): Promise<Record<string, CommitCheckStatus>> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  const batch = shas.slice(0, 25);
  const results: Record<string, CommitCheckStatus> = {};
  for (const sha of batch) {
    try {
      const json = await httpsJson<{
        total_count?: number;
        check_runs?: { status: string; conclusion?: string }[];
      }>(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`, {
        token,
      });
      const runs = json.check_runs ?? [];
      // Aggregate: any failure => failure; else any running => running; else success/neutral
      let conclusion: string | undefined;
      if (runs.some((r) => r.conclusion === 'failure' || r.conclusion === 'timed_out' || r.conclusion === 'action_required')) {
        conclusion = 'failure';
      } else if (runs.some((r) => r.status !== 'completed')) {
        conclusion = 'running';
      } else if (runs.length > 0) {
        conclusion = 'success';
      }
      results[sha] = {
        sha,
        status: runs.length > 0 ? 'completed' : 'none',
        conclusion,
        totalChecks: json.total_count ?? runs.length,
      };
    } catch (e) {
      if (/404/.test(String(e))) {
        // No checks for this commit (or private API mismatch) — mark as none
        results[sha] = { sha, status: 'none', totalChecks: 0 };
      } else {
        throw e;
      }
    }
  }
  return results;
}

export function getStoredAuthState(): { authenticated: boolean; user?: GithubUser } {
  const s = getAuthState();
  return {
    authenticated: !!s.token,
    user: s.user,
  };
}

export function getStoredToken(): string | undefined {
  return getAuthState().token;
}

// ============================================================
// SmartGit Manual: PR management — comment, approve, merge, close
// ============================================================

/**
 * Add a line comment to a PR — POST /repos/{owner}/{repo}/pulls/{n}/comments.
 * SmartGit Manual: PR line-code commenting.
 */
export async function addPRLineComment(
  owner: string,
  repo: string,
  prNumber: number,
  data: {
    body: string;
    path: string;
    line: number;
    side?: 'LEFT' | 'RIGHT';
    commit_id?: string;
    in_reply_to?: number;
  }
): Promise<void> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  await httpsJson(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments`, {
    method: 'POST',
    token,
    body: JSON.stringify({
      body: data.body,
      path: data.path,
      line: data.line,
      side: data.side || 'RIGHT',
      commit_id: data.commit_id,
    }),
  });
}

/**
 * Add a PR-level comment (not tied to a line) — POST /repos/{owner}/{repo}/issues/{n}/comments.
 */
export async function addPRComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  await httpsJson(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    token,
    body: JSON.stringify({ body }),
  });
}

/**
 * Submit a PR review (APPROVE, REQUEST_CHANGES, or COMMENT).
 * SmartGit Manual: PR approve/reject.
 */
export async function submitPRReview(
  owner: string,
  repo: string,
  prNumber: number,
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
  body?: string
): Promise<void> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  await httpsJson(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
    method: 'POST',
    token,
    body: JSON.stringify({ event, body }),
  });
}

/**
 * Merge a PR — PUT /repos/{owner}/{repo}/pulls/{n}/merge.
 * SmartGit Manual: Merge PR from log.
 */
export async function mergePR(
  owner: string,
  repo: string,
  prNumber: number,
  options: {
    commit_title?: string;
    merge_method?: 'merge' | 'squash' | 'rebase';
    sha?: string;
  } = {}
): Promise<void> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  await httpsJson(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
    method: 'PUT',
    token,
    body: JSON.stringify({
      commit_title: options.commit_title,
      merge_method: options.merge_method || 'merge',
      sha: options.sha,
    }),
  });
}

/**
 * Close a PR (without merging) — PATCH /repos/{owner}/{repo}/pulls/{n}.
 */
export async function closePR(
  owner: string,
  repo: string,
  prNumber: number
): Promise<void> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  await httpsJson(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify({ state: 'closed' }),
  });
}

/**
 * Reopen a closed PR.
 */
export async function reopenPR(
  owner: string,
  repo: string,
  prNumber: number
): Promise<void> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  await httpsJson(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify({ state: 'open' }),
  });
}

/**
 * List PR comments — for displaying existing review comments.
 */
export async function listPRComments(
  owner: string,
  repo: string,
  prNumber: number
): Promise<Array<{
  id: number;
  body: string;
  path?: string;
  line?: number;
  user: { login: string };
  created_at: string;
}>> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  return httpsJson(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100`, { token });
}
