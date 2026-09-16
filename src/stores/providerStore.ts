/**
 * Provider store — single source of truth for which hosting provider
 * (GitHub / GitLab) the current repository is connected to.
 *
 * Problem (the user's complaint):
 *   Pull Requests and Reviews each independently called `api.git.extractRepoInfo`
 *   on mount and stored the result in local component state. When the auto-
 *   detection failed (self-hosted GitLab, GitHub Enterprise, or a non-standard
 *   URL), the user had to manually pick a provider on the PR page — but that
 *   choice was forgotten the moment they navigated to Reviews. Same problem
 *   in reverse. There was no shared "I am working with GitLab repo X" state.
 *
 * Solution:
 *   One Zustand store holds:
 *     - repoPath:        the path of the currently-scanned repo (so we can
 *                        re-detect when the user switches repos)
 *     - provider:        'github' | 'gitlab' | 'unknown'
 *     - owner, repo:     parsed from the remote URL
 *     - url, webUrl:     raw remote URL + browsable web URL
 *     - gitlabProjectId: resolved GitLab project ID (cached, because resolving
 *                        requires an API round-trip)
 *     - githubAuthed, gitlabAuthed: cached auth flags for the active provider
 *
 *   Auto-detection runs on mount and whenever the current repo changes.
 *   Manual override via `selectProvider` re-parses owner/repo from the URL
 *   and stores the override so it sticks across page navigations.
 *
 *   All pages that need provider context (PRs, Reviews, Toolbar) read from
 *   this store — no more per-page detection, no more per-page picker dialogs.
 */

import { create } from 'zustand';
import { api } from '../lib/api';

export type RepoProvider = 'github' | 'gitlab' | 'unknown';

export interface ProviderInfo {
  /** Repo path this info was scanned for (so stale data is detected). */
  repoPath: string;
  provider: RepoProvider;
  owner?: string;
  repo?: string;
  url?: string;
  webUrl?: string;
  /** True when the value of `provider` came from a manual user override
   *  (so the UI can show a "manual" badge and not auto-re-detect). */
  manualOverride?: boolean;
}

/** Minimal PR shape stored in the providerStore. We only keep what's needed
 *  to display the row in the PR list + jump into the Reviews page for the
 *  full review (description, files, comments). The Reviews page fetches the
 *  full version via api.github.getPullRequest. */
export interface SelectedPR {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  html_url: string;
  author: { login: string; avatar_url?: string };
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  created_at: string;
  updated_at: string;
  merged_at?: string | null;
}

interface ProviderState extends ProviderInfo {
  /** GitLab project ID — resolved from owner/repo via the GitLab API.
   *  Cached because the lookup is a round-trip. Reset on repo change. */
  gitlabProjectId: number | null;
  /** Auth flags — refreshed on mount + on demand. */
  githubAuthed: boolean;
  gitlabAuthed: boolean;
  /** True while `detect()` is in flight (initial load). */
  loading: boolean;

  /** The PR currently selected for code review. Shared between PullRequests
   *  (where the user clicks a row to select) and Reviews (where the review
   *  surface is rendered). Null when no PR is selected — Reviews then falls
   *  back to its legacy local-review mode (git-notes comments).
   *
   *  Set by PullRequestsPage's row onClick. Cleared by selecting null. */
  selectedPR: SelectedPR | null;

  /** Scan the given repo's remote URL and populate provider/owner/repo/url.
   *  Skips re-detection if the repo path is unchanged and a manual override
   *  is in effect. */
  detect: (repoPath: string, opts?: { force?: boolean }) => Promise<void>;
  /** Manually pick a provider (GitHub or GitLab). Re-parses owner/repo from
   *  the last-known remote URL. Marks `manualOverride=true` so subsequent
   *  `detect()` calls don't override the user's choice. */
  selectProvider: (provider: 'github' | 'gitlab') => void;
  /** Manually set owner/repo when auto-parsing from the remote URL failed.
   *  Used by the manual-entry form on the PR page. Keeps the current
   *  provider and marks `manualOverride=true`. */
  setManualOwnerRepo: (owner: string, repo: string) => void;
  /** Set the cached GitLab project ID (after resolving it via API). */
  setGitlabProjectId: (id: number | null) => void;
  /** Refresh auth state for both GitHub and GitLab. Cheap (two IPC calls). */
  refreshAuth: () => Promise<void>;
  /** Select a PR for code review (shared with Reviews page). Pass null to clear. */
  selectPR: (pr: SelectedPR | null) => void;
  /** Clear everything (e.g. when the user closes the repo). */
  reset: () => void;
}

/** Parse owner/repo from SSH or HTTPS remote URL. Returns the parsed
 *  components plus the cleaned-up web URL.
 *
 *  Strips embedded credentials (https://user:token@host/...) before parsing —
 *  otherwise the regex captures 'user:token@host' as the host, leading to
 *  garbage owner/repo (the user's actual repo had this form and produced 404s).
 *  Multi-segment GitLab paths (e.g. 'web/git/gitclient' under group 'web',
 *  subgroup 'git') are handled by treating everything between host and
 *  '.git' as the full path — owner = first segment, repo = rest joined by '/'.
 */
function parseRemoteUrl(url: string): { host?: string; owner?: string; repo?: string; webUrl?: string } {
  // Strip embedded credentials: https://user:token@host/... → https://host/...
  const cleanUrl = url.replace(/^(https?:\/\/)[^@]+@/, '$1');
  // SSH form: git@host:path/to/repo(.git)
  const sshMatch = cleanUrl.match(/git@([^:]+):(.+?)(?:\.git)?$/);
  // HTTP(S) form: http(s)://host/path/to/repo(.git)
  // Capture everything after host as one group so 'web/git/gitclient' works.
  const httpsMatch = cleanUrl.match(/https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  const match = sshMatch || httpsMatch;
  if (!match) return {};
  const [, host, fullPath] = match;
  // For GitLab's nested paths (group/subgroup/repo), we keep the FULL path
  // as both owner and repo segments. GitLab's MR API uses the URL-encoded
  // path-with-namespace — the renderer encodes it before calling.
  // Here we just split off the last segment as 'repo' and treat the rest
  // as 'owner' (a group/subgroup path).
  const segments = fullPath.split('/');
  if (segments.length < 2) return { host, webUrl: `https://${host}/${fullPath}` };
  const repo = segments[segments.length - 1];
  const owner = segments.slice(0, -1).join('/');
  return { host, owner, repo, webUrl: `https://${host}/${owner}/${repo}` };
}

/** Smart suggestion: based on the URL host substring, return the provider
 *  that matches. Used by the UI to pre-highlight the suggested button.
 *
 *  Strips embedded credentials first — without this, a URL like
 *  http://mirocow:glpat-xxx@178.140.10.58:8082/... would have its host
 *  captured as 'mirocow:glpat-xxx@178.140.10.58:8082', which doesn't
 *  contain 'gitlab' or 'github' — so we'd never suggest a provider.
 */
export function suggestProviderFromUrl(url: string): 'github' | 'gitlab' | null {
  const cleanUrl = url.replace(/^(https?:\/\/)[^@]+@/, '$1');
  const host = (cleanUrl.match(/git@([^:]+):|https?:\/\/([^/]+)/) || [])
    .filter(Boolean)
    .slice(1)
    .join('')
    .toLowerCase();
  if (host.includes('gitlab')) return 'gitlab';
  if (host.includes('github')) return 'github';
  return null;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  repoPath: '',
  provider: 'unknown',
  manualOverride: false,
  gitlabProjectId: null,
  githubAuthed: false,
  gitlabAuthed: false,
  loading: false,
  selectedPR: null,

  detect: async (repoPath, opts) => {
    const st = get();
    // Skip if repo unchanged AND not forced AND there's a manual override —
    // we don't want to clobber a user-chosen provider.
    if (!opts?.force && st.repoPath === repoPath && st.manualOverride) return;
    set({ loading: true });
    try {
      const info = await api.git.extractRepoInfo(repoPath);
      // ─── Self-hosted GitLab heuristic ─────────────────────────────────
      // The user's setup was a self-hosted GitLab at 178.140.10.58:8082.
      // The host substring doesn't contain 'gitlab', so extractRepoInfo
      // returned provider='unknown'. We auto-detect by comparing the URL
      // host with the configured GitLab baseUrl — if they match AND the
      // user has a GitLab token, we treat it as a GitLab repo.
      //
      // This avoids the manual chip step for self-hosted GitLab users —
      // they just need to set up GitLab in Settings → Integrations once.
      let provider = info.provider;
      if (provider === 'unknown' && info.url) {
        try {
          const glState = await api.gitlab.getAuthState();
          if (glState.baseUrl && glState.token) {
            // Strip credentials from both URLs so the host comparison is fair.
            const urlHost = info.url.replace(/^https?:\/\/[^@]+@/, '').match(/^https?:\/\/([^/]+)/)?.[1]?.toLowerCase();
            const baseUrlHost = glState.baseUrl.replace(/^https?:\/\/[^@]+@/, '').match(/^https?:\/\/([^/]+)/)?.[1]?.toLowerCase();
            if (urlHost && baseUrlHost && (urlHost === baseUrlHost || urlHost.endsWith(baseUrlHost) || baseUrlHost.endsWith(urlHost))) {
              provider = 'gitlab';
            }
          }
        } catch { /* gitlab not configured */ }
      }
      const next: ProviderInfo = {
        repoPath,
        provider,
        owner: info.owner,
        repo: info.repo,
        url: info.url,
        webUrl: info.webUrl,
        manualOverride: false,
      };
      // Reset cached GitLab project ID on every new detection —
      // it's tied to the specific repo, not the user session.
      set({ ...next, gitlabProjectId: null, loading: false });
      // Kick off auth checks in parallel — non-blocking.
      void get().refreshAuth();
    } catch {
      set({ repoPath, provider: 'unknown', loading: false });
    }
  },

  selectProvider: (provider) => {
    const st = get();
    const url = st.url || '';
    const parsed = parseRemoteUrl(url);
    set({
      provider,
      owner: parsed.owner || st.owner,
      repo: parsed.repo || st.repo,
      webUrl: parsed.webUrl || st.webUrl,
      manualOverride: true,
      // Reset GitLab project ID — needs re-resolution against the new provider.
      gitlabProjectId: provider === 'gitlab' ? null : st.gitlabProjectId,
    });
  },

  setManualOwnerRepo: (owner, repo) => {
    const st = get();
    set({
      owner,
      repo,
      manualOverride: true,
      // Reset cached GitLab project ID — owner/repo changed.
      gitlabProjectId: st.provider === 'gitlab' ? null : st.gitlabProjectId,
    });
  },

  setGitlabProjectId: (id) => set({ gitlabProjectId: id }),

  selectPR: (pr) => set({ selectedPR: pr }),

  refreshAuth: async () => {
    // GitHub auth
    try {
      const gh = await api.github.getAuthState();
      set({ githubAuthed: !!gh.authenticated });
    } catch { /* github not configured */ }
    // GitLab auth
    try {
      const gl = await api.gitlab.getAuthState();
      // gl.token is now a vaulted placeholder string ('***vaulted***') when
      // authenticated — we check either `authenticated` (preferred) or
      // `token` truthiness (backward-compat) to detect auth state.
      set({ gitlabAuthed: !!gl.authenticated || !!gl.token });
    } catch { /* gitlab not configured */ }
  },

  reset: () => set({
    repoPath: '',
    provider: 'unknown',
    owner: undefined,
    repo: undefined,
    url: undefined,
    webUrl: undefined,
    manualOverride: false,
    gitlabProjectId: null,
    githubAuthed: false,
    gitlabAuthed: false,
    loading: false,
    selectedPR: null,
  }),
}));
