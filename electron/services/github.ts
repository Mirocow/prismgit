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
  name: 'smartgit-github',
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
  if (!token) throw new Error('Not authenticated with GitHub');
  return httpsJson<GithubPullRequest[]>(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=${state}&per_page=100`,
    { token }
  );
}

export async function logout(): Promise<void> {
  store.delete('github');
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
