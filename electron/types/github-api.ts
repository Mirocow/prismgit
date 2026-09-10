export interface GithubUser {
  id: number;
  login: string;
  name: string;
  avatar_url: string;
  html_url: string;
  email?: string;
  bio?: string;
  public_repos?: number;
  followers?: number;
  following?: number;
}

export interface GithubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string; avatar_url: string };
  html_url: string;
  clone_url: string;
  ssh_url: string;
  description: string;
  fork: boolean;
  private: boolean;
  default_branch: string;
  stargazers_count: number;
  updated_at: string;
}

export interface GithubPullRequest {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  html_url: string;
  user: { login: string; avatar_url: string };
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  created_at: string;
  updated_at: string;
  body?: string;
}

export interface GithubApi {
  authWithPAT: (token: string) => Promise<GithubUser>;
  authWithOAuth: () => Promise<GithubUser>;
  getCurrentUser: () => Promise<GithubUser>;
  getRepositories: (page?: number) => Promise<GithubRepository[]>;
  getOrgRepositories: (org: string, page?: number) => Promise<GithubRepository[]>;
  createPullRequest: (owner: string, repo: string, data: {
    title: string;
    head: string;
    base: string;
    body?: string;
  }) => Promise<GithubPullRequest>;
  listPullRequests: (owner: string, repo: string, state?: 'open' | 'closed' | 'all') => Promise<GithubPullRequest[]>;
  getCheckRuns: (owner: string, repo: string, shas: string[]) => Promise<Record<string, CommitCheckStatus>>;
  logout: () => Promise<void>;
  getAuthState: () => Promise<{ authenticated: boolean; user?: GithubUser }>;
}

/** CI check-run summary for one commit (SmartGit "My History" CI badges). */
export interface CommitCheckStatus {
  sha: string;
  conclusion?: string;
  status: string;
  totalChecks: number;
}
