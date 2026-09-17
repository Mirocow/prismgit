import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { SimpleStore } from './simpleStore.js';
import { setSecret, getSecret, deleteSecret } from './secrets.js';
import { NS_GITHUB } from './credentialKeys.js';
import type { GithubUser, GithubRepository, GithubPullRequest, GithubPRFile, GithubPRComment, GithubPRCommit } from '../types/github-api.js';
import { startApiCall, finishApiCall, sanitizeApiPath } from './commandLog.js';

interface AuthState {
  token?: string;
  user?: GithubUser;
}

const store = new SimpleStore({
  name: 'prismgit-github',
  defaults: {},
});

function getAuthState(): AuthState {
  const raw = (store.get('github') || {}) as AuthState;
  // The PAT never rests in the JSON file — it lives in the encrypted vault.
  const token = getSecret(NS_GITHUB, 'pat');
  return { ...raw, token };
}

function setAuthState(state: AuthState): void {
  // Token → vault (or delete when empty); profile stays in the JSON file.
  if (state.token) setSecret(NS_GITHUB, 'pat', state.token);
  else deleteSecret(NS_GITHUB, 'pat');
  store.set('github', { user: state.user });
}

/**
 * One-time migration: older builds stored the GitHub PAT as plaintext in
 * prismgit-github.json. Move it into the encrypted vault and strip the file.
 * Idempotent; called from main.ts after app ready.
 */
export function migrateLegacyGithubToken(): void {
  const raw = (store.get('github') || {}) as AuthState;
  if (typeof raw.token === 'string' && raw.token) {
    setSecret(NS_GITHUB, 'pat', raw.token);
    store.set('github', { user: raw.user });
  }
}

async function httpsJson<T>(url: string, options: https.RequestOptions & { token?: string; body?: string } = {}): Promise<T> {
  // Log the GitHub API call to the Output panel. The path is everything
  // after the host (so '/repos/owner/repo/pulls/5?state=open' stays short
  // and readable). Sanitize to redact any tokens that might be in the URL.
  const u = new URL(url);
  const path = sanitizeApiPath(u.pathname + u.search);
  const method = (options.method || 'GET').toUpperCase();
  const handle = startApiCall({ provider: 'github', method, path });
  return new Promise<T>((resolve, reject) => {
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
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            try {
              finishApiCall(handle, { status, body: data });
              resolve(data ? JSON.parse(data) : null);
            } catch (e) {
              finishApiCall(handle, { status, error: `Failed to parse JSON: ${e}` });
              reject(new Error(`Failed to parse JSON: ${e}`));
            }
          } else {
            finishApiCall(handle, { status, error: `GitHub API ${status}` });
            reject(new Error(`GitHub API ${status}: ${data}`));
          }
        });
      }
    );
    req.on('error', (e) => {
      finishApiCall(handle, { status: 0, error: String(e) });
      reject(e);
    });
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

/**
 * Fetch a single PR with full metadata: body/description, comments count,
 * additions/deletions/changed_files, mergeable status, draft flag, labels.
 *
 * The listPullRequests endpoint returns a slim version without these stats
 * (they're expensive for GitHub to compute). When the user opens a PR in
 * the detail view, we call this to get the full picture.
 */
export async function getPullRequest(
  owner: string,
  repo: string,
  prNumber: number
): Promise<GithubPullRequest> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  return httpsJson<GithubPullRequest>(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
    { token }
  );
}

/**
 * Fetch the list of files changed in a PR — filename, status (added/modified/
 * removed/renamed), additions/deletions, and the unified diff patch.
 *
 * Used by the PR detail view to show what files the PR touches. The patch
 * field is optional because GitHub omits it for files >300 lines of diff
 * (it returns a 406 if we ask, so we just don't show the inline diff for
 * those — the user can click through to GitHub for the full diff).
 */
export async function listPRFiles(
  owner: string,
  repo: string,
  prNumber: number
): Promise<GithubPRFile[]> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  return httpsJson<GithubPRFile[]>(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`,
    { token }
  );
}

/**
 * Fetch the issue-style discussion comments on a PR — top-level thread,
 * NOT line-by-line review comments (those come from listPRComments).
 *
 * GitHub treats every PR as an issue, so this hits the issues comments
 * endpoint. Combined with listPRComments (review-side comments), the UI
 * can render the full discussion thread.
 */
export async function listPRIssueComments(
  owner: string,
  repo: string,
  prNumber: number
): Promise<GithubPRComment[]> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  return httpsJson<GithubPRComment[]>(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`,
    { token }
  );
}

/**
 * Fetch the commits that make up a PR — message, author, date, SHA.
 *
 * Useful for the PR review surface so the user can see WHAT was done in
 * the PR, not just the file-level diff. Each commit links back to GitHub
 * for the full commit details.
 */
export async function listPRCommits(
  owner: string,
  repo: string,
  prNumber: number
): Promise<GithubPRCommit[]> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  return httpsJson<GithubPRCommit[]>(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/commits?per_page=250`,
    { token }
  );
}

/**
 * Fetch files changed in a specific commit (not the whole PR).
 *
 * Uses GitHub's commit API:
 *   GET /repos/:owner/:repo/commits/:sha
 *
 * This returns a commit object with a `files` array containing filename,
 * status, additions, deletions, and patch for each file changed in that
 * specific commit. This is more reliable than the compare API because:
 *   - Works for the first commit in a repo (no parent needed)
 *   - Works for merge commits (shows files from all parents)
 *   - Doesn't require `~1` refspec notation (which the compare API may
 *     not support)
 *
 * The response shape differs slightly from listPRFiles — the `files`
 * array has `sha` as null and `blob_url`/`raw_url` may be missing. We
 * normalize to GithubPRFile shape so the renderer doesn't need to branch.
 */
export async function getCommitFiles(
  owner: string,
  repo: string,
  commitSha: string
): Promise<GithubPRFile[]> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  // Use the commits API which returns files directly.
  // GitHub limits this to 300 files per commit — if there are more,
  // we'd need the compare API as a fallback. In practice 300 is plenty.
  const result = await httpsJson<{
    files?: Array<{
      sha?: string;
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      changes: number;
      patch?: string;
      blob_url?: string;
      raw_url?: string;
      contents_url?: string;
      previous_filename?: string;
    }>;
  }>(
    `https://api.github.com/repos/${owner}/${repo}/commits/${commitSha}`,
    { token }
  );
  // Normalize to GithubPRFile shape — fill in missing fields with defaults.
  return (result.files ?? []).map((f) => ({
    sha: f.sha ?? '',
    filename: f.filename,
    status: (f.status as GithubPRFile['status']) ?? 'modified',
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
    patch: f.patch,
    blob_url: f.blob_url ?? '',
    raw_url: f.raw_url ?? '',
    contents_url: f.contents_url ?? '',
    previous_filename: f.previous_filename,
  }));
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
  user: { login: string; avatar_url?: string };
  created_at: string;
  commit_id?: string;
}>> {
  const { token } = getAuthState();
  if (!token) throw new Error('Not authenticated with GitHub');
  return httpsJson(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100`, { token });
}
