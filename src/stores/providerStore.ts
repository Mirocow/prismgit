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

interface ProviderState extends ProviderInfo {
  /** GitLab project ID — resolved from owner/repo via the GitLab API.
   *  Cached because the lookup is a round-trip. Reset on repo change. */
  gitlabProjectId: number | null;
  /** Auth flags — refreshed on mount + on demand. */
  githubAuthed: boolean;
  gitlabAuthed: boolean;
  /** True while `detect()` is in flight (initial load). */
  loading: boolean;

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
  /** Clear everything (e.g. when the user closes the repo). */
  reset: () => void;
}

/** Parse owner/repo from SSH or HTTPS remote URL. Returns the parsed
 *  components plus the cleaned-up web URL. */
function parseRemoteUrl(url: string): { host?: string; owner?: string; repo?: string; webUrl?: string } {
  const sshMatch = url.match(/git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
  const httpsMatch = url.match(/https?:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/);
  const match = sshMatch || httpsMatch;
  if (!match) return {};
  const [, host, owner, repo] = match;
  return { host, owner, repo, webUrl: `https://${host}/${owner}/${repo}` };
}

/** Smart suggestion: based on the URL host substring, return the provider
 *  that matches. Used by the UI to pre-highlight the suggested button. */
export function suggestProviderFromUrl(url: string): 'github' | 'gitlab' | null {
  const host = (url.match(/git@([^:]+):|https?:\/\/([^/]+)/) || [])
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

  detect: async (repoPath, opts) => {
    const st = get();
    // Skip if repo unchanged AND not forced AND there's a manual override —
    // we don't want to clobber a user-chosen provider.
    if (!opts?.force && st.repoPath === repoPath && st.manualOverride) return;
    set({ loading: true });
    try {
      const info = await api.git.extractRepoInfo(repoPath);
      const next: ProviderInfo = {
        repoPath,
        provider: info.provider,
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

  refreshAuth: async () => {
    // GitHub auth
    try {
      const gh = await api.github.getAuthState();
      set({ githubAuthed: !!gh.authenticated });
    } catch { /* github not configured */ }
    // GitLab auth
    try {
      const gl = await api.gitlab.getAuthState();
      set({ gitlabAuthed: !!gl.token });
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
  }),
}));
