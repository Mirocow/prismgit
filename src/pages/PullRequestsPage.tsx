import { useState, useEffect, useCallback, useMemo } from 'react';
import { GitPullRequest, Plus, RefreshCw, ExternalLink, Loader, X, CloudDownload, ArrowDown, Search, Github, GitBranch } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useAuthStore } from '../stores/authStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type GithubPullRequest, type GitLabMergeRequest } from '../lib/api';
import { resolveDefaultRemote } from '../lib/remotes';
import { cn, formatDate } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { Avatar } from '../components/Avatar';

import { useEscapeKey } from '../hooks/useEscapeKey';
import { confirmDialog } from '../components/ConfirmDialog';

/**
 * Normalized MR/PR shape — GitHub PRs and GitLab MRs are mapped into this
 * common shape so the UI doesn't need to branch on provider for every row.
 */
interface UnifiedPR {
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

function githubToUnified(pr: GithubPullRequest): UnifiedPR {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    html_url: pr.html_url,
    author: { login: pr.user.login, avatar_url: pr.user.avatar_url },
    head: { ref: pr.head.ref, sha: pr.head.sha },
    base: { ref: pr.base.ref, sha: pr.base.sha },
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    merged_at: pr.merged_at,
  };
}

function gitlabToUnified(mr: GitLabMergeRequest): UnifiedPR {
  return {
    number: mr.iid,
    title: mr.title,
    state: mr.state === 'opened' ? 'open' : mr.state,
    html_url: mr.web_url,
    author: { login: mr.author.username, avatar_url: mr.author.avatar_url },
    head: { ref: mr.source_branch, sha: '' },
    base: { ref: mr.target_branch, sha: '' },
    created_at: mr.created_at,
    updated_at: mr.updated_at,
    merged_at: mr.merged_at,
  };
}

export function PullRequestsPage() {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const { authenticated, user } = useAuthStore();
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastActions();
  const [prs, setPRs] = useState<UnifiedPR[]>([]);
  // GitLab project ID — resolved from the repo's remote URL on mount.
  // Required because GitLab MRs are addressed by project ID (numeric),
  // not by owner/repo like GitHub.
  const [gitlabProjectId, setGitlabProjectId] = useState<number | null>(null);
  const [gitlabAuthed, setGitlabAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<'fetch' | 'pull' | null>(null);
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open');
  // PR search filter — match title, PR number, head/base branch, or author.
  // Memory-only; not persisted (matches the pattern in Tags/Stashes/etc).
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  useEscapeKey(showCreate, () => setShowCreate(false));
  const [repoInfo, setRepoInfo] = useState<{ owner?: string; repo?: string; provider?: string; webUrl?: string; url?: string }>({});

  // Create PR form — head/base prefill from the app-wide branch selection
  // (Branches/History/Toolbar): the PR grows out of the branch you picked.
  const globalSelBranch = useSelectionStore((s) => s.selectedBranch);
  const [prTitle, setPrTitle] = useState('');
  const [prHead, setPrHead] = useState(globalSelBranch ?? '');
  const [prBase, setPrBase] = useState('');
  const [prBody, setPrBody] = useState('');
  const [creating, setCreating] = useState(false);

  const isGitLabRepo = repoInfo.provider === 'gitlab';
  // For GitLab, we need EITHER GitHub auth OR GitLab auth — but only GitLab
  // auth is meaningful for a GitLab repo. For GitHub repos, GitHub auth.
  const isAuthed = isGitLabRepo ? gitlabAuthed : authenticated;

  const loadRepoInfo = useCallback(async () => {
    try {
      const info = await api.git.extractRepoInfo(repo.path);
      setRepoInfo(info);
      if (info.provider === 'github' && info.owner && info.repo) {
        setPrBase(info.repo ? await api.git.raw(repo.path, ['symbolic-ref', '--short', 'HEAD']).catch(() => 'main') : 'main');
      } else if (info.provider === 'gitlab') {
        // GitLab MRs are addressed by project ID — resolve it from the
        // remote URL via the GitLab API. We use listProjects to find the
        // matching project by path_with_namespace (owner/repo).
        setPrBase(await api.git.raw(repo.path, ['symbolic-ref', '--short', 'HEAD']).catch(() => 'main'));
        // Check GitLab auth state.
        try {
          const glState = await api.gitlab.getAuthState();
          setGitlabAuthed(!!glState.token);
        } catch { /* GitLab not configured */ }
      }
    } catch {
      /* ignore */
    }
  }, [repo.path]);

  const loadPRs = useCallback(async () => {
    // Guard: don't even try if not authenticated or not a known-provider repo.
    if (!isAuthed) return;
    if (!repoInfo.owner || !repoInfo.repo) return;
    if (repoInfo.provider !== 'github' && repoInfo.provider !== 'gitlab') return;
    setLoading(true);
    try {
      if (repoInfo.provider === 'github') {
        const result = await api.github.listPullRequests(repoInfo.owner!, repoInfo.repo!, state);
        setPRs(result.map(githubToUnified));
      } else if (repoInfo.provider === 'gitlab') {
        // Resolve the GitLab project ID from the owner/repo path.
        // We do this by listing the user's projects and finding the one
        // whose path_with_namespace matches owner/repo.
        if (gitlabProjectId == null) {
          const projects = await api.gitlab.listProjects(1, 100);
          const fullPath = `${repoInfo.owner}/${repoInfo.repo}`;
          const found = projects.find((p) => p.path_with_namespace === fullPath);
          if (!found) {
            toast.error(t('pages.prLoadFailed'), `GitLab project "${fullPath}" not found in your accessible projects`);
            setPRs([]);
            return;
          }
          setGitlabProjectId(found.id);
        }
        const glState = state === 'open' ? 'opened' : state === 'closed' ? 'closed' : 'all';
        const result = await api.gitlab.listMergeRequests(gitlabProjectId ?? 0, glState as 'opened' | 'closed' | 'merged' | 'all');
        setPRs(result.map(gitlabToUnified));
      }
    } catch (e) {
      const msg = String(e);
      if (!msg.includes('Not authenticated')) {
        toast.error(t('pages.prLoadFailed'), msg);
      }
    } finally {
      setLoading(false);
    }
  }, [isAuthed, repoInfo, state, toast, gitlabProjectId]);

  useEffect(() => {
    loadRepoInfo();
  }, [loadRepoInfo]);

  useEffect(() => {
    if (repoInfo.owner && repoInfo.repo) {
      loadPRs();
    }
  }, [repoInfo, state, loadPRs]);

  // LAR-2 — PR action handlers. Branch on provider so the same UI works
  // for GitHub PRs and GitLab MRs.
  const handleApprove = async (prNumber: number) => {
    if (!repoInfo.owner || !repoInfo.repo) return;
    try {
      if (repoInfo.provider === 'github') {
        await api.github.submitPRReview(repoInfo.owner, repoInfo.repo, prNumber, 'APPROVE', '');
      } else if (repoInfo.provider === 'gitlab' && gitlabProjectId != null) {
        await api.gitlab.approveMergeRequest(gitlabProjectId, prNumber);
      }
      toast.success(t('pages.prApproved', { n: prNumber }));
      await loadPRs();
    } catch (e) { toast.error(t('pages.prApproveFailed'), String(e)); }
  };
  const handleRequestChanges = async (prNumber: number) => {
    if (!repoInfo.owner || !repoInfo.repo) return;
    const body = await promptForComment();
    if (body == null) return;
    try {
      if (repoInfo.provider === 'github') {
        await api.github.submitPRReview(repoInfo.owner, repoInfo.repo, prNumber, 'REQUEST_CHANGES', body);
      } else if (repoInfo.provider === 'gitlab' && gitlabProjectId != null) {
        // GitLab has no "request changes" review event — add a comment instead.
        await api.gitlab.addMRComment(gitlabProjectId, prNumber, `:warning: Changes requested: ${body}`);
      }
      toast.success(t('pages.prRequestedChanges', { n: prNumber }));
      await loadPRs();
    } catch (e) { toast.error(t('pages.prRequestChangesFailed'), String(e)); }
  };
  const handleMerge = async (prNumber: number) => {
    if (!repoInfo.owner || !repoInfo.repo) return;
    if (!(await confirmDialog({
      title: t('pages.prMergeConfirmTitle', { n: prNumber }),
      message: t('pages.prMergeConfirmMessage'),
      confirmLabel: t('pages.prMerge'),
    }))) return;
    try {
      if (repoInfo.provider === 'github') {
        await api.github.mergePR(repoInfo.owner, repoInfo.repo, prNumber, { merge_method: 'merge' });
      } else if (repoInfo.provider === 'gitlab' && gitlabProjectId != null) {
        await api.gitlab.mergeMergeRequest(gitlabProjectId, prNumber, { should_remove_source_branch: true });
      }
      toast.success(t('pages.prMerged', { n: prNumber }));
      await loadPRs();
      await refreshStatus(repo.path);
    } catch (e) { toast.error(t('pages.prMergeFailed'), String(e)); }
  };
  const handleClose = async (prNumber: number) => {
    if (!repoInfo.owner || !repoInfo.repo) return;
    try {
      if (repoInfo.provider === 'github') {
        await api.github.closePR(repoInfo.owner, repoInfo.repo, prNumber);
      } else if (repoInfo.provider === 'gitlab' && gitlabProjectId != null) {
        // GitLab doesn't have a direct "close MR" — we'd need a PUT to
        // /projects/:id/merge_requests/:iid with state_event=close. The
        // current gitlab.ts service doesn't expose this, so we show a hint.
        toast.info(t('pages.prCloseGitLabUnsupported', { defaultValue: 'GitLab MR close is not yet supported — use the GitLab web UI' }));
        return;
      }
      toast.success(t('pages.prClosed', { n: prNumber }));
      await loadPRs();
    } catch (e) { toast.error(t('pages.prCloseFailed'), String(e)); }
  };
  const handleReopen = async (prNumber: number) => {
    if (!repoInfo.owner || !repoInfo.repo) return;
    try {
      await api.github.reopenPR(repoInfo.owner, repoInfo.repo, prNumber);
      toast.success(t('pages.prReopened', { n: prNumber }));
      await loadPRs();
    } catch (e) { toast.error(t('pages.prReopenFailed'), String(e)); }
  };
  // Helper: prompt for review comment via native prompt dialog.
  const promptForComment = async (): Promise<string | null> => {
    return await new Promise<string | null>((resolve) => {
      const result = window.prompt(t('pages.prCommentPrompt'));
      resolve(result);
    });
  };

  const handleCreate = async () => {
    if (!repoInfo.owner || !repoInfo.repo) return;
    if (!prTitle.trim() || !prHead.trim() || !prBase.trim()) {
      toast.warning(t('pages.prFieldsRequired'));
      return;
    }
    setCreating(true);
    try {
      await api.github.createPullRequest(repoInfo.owner, repoInfo.repo, {
        title: prTitle,
        head: prHead,
        base: prBase,
        body: prBody || undefined,
      });
      toast.success(t('pages.prCreated'));
      setShowCreate(false);
      setPrTitle('');
      setPrHead('');
      setPrBody('');
      await loadPRs();
    } catch (e) {
      toast.error(t('pages.prCreateFailed'), String(e));
    } finally {
      setCreating(false);
    }
  };

  // Show the PR list for both GitHub and GitLab repos. The provider check
  // is split out so the "not a supported repo" empty state can suggest
  // authenticating with the right provider.
  const isSupportedRepo = (repoInfo.provider === 'github' || repoInfo.provider === 'gitlab') && repoInfo.owner && repoInfo.repo;
  const isGitHubRepo = isSupportedRepo;

  // Filtered PRs — title, PR number, head/base branch, or author match the
  // search query. The search is case-insensitive and accepts `#123` syntax
  // for direct PR-number lookup.
  const filteredPRs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return prs;
    // `#123` → match exact PR number
    const directNumMatch = q.match(/^#(\d+)$/);
    if (directNumMatch) {
      const n = parseInt(directNumMatch[1], 10);
      return prs.filter(pr => pr.number === n);
    }
    const numQ = /^\d+$/.test(q) ? parseInt(q, 10) : null;
    return prs.filter(pr =>
      pr.title.toLowerCase().includes(q) ||
      pr.author.login.toLowerCase().includes(q) ||
      pr.head.ref.toLowerCase().includes(q) ||
      pr.base.ref.toLowerCase().includes(q) ||
      (numQ != null && pr.number === numQ)
    );
  }, [prs, search]);

  // Request fresh data from the remote server — plain git operations, they work
  // regardless of GitHub auth (this is what the tool was missing entirely).
  const handleFetchAll = async () => {
    setSyncing('fetch');
    try {
      await api.git.fetchAll(repo.path, true);
      await refreshStatus(repo.path);
      toast.success(t('pages.fetchedAllRemotes'));
    } catch (e) {
      toast.error(t('pages.fetchFailed'), String(e));
    } finally {
      setSyncing(null);
    }
  };

  const handlePull = async () => {
    setSyncing('pull');
    try {
      const remote = (await resolveDefaultRemote(repo.path)) || 'origin';
      await api.git.pull(repo.path, remote, undefined, false, false);
      await refreshStatus(repo.path);
      toast.success(t('pages.pulledFrom', { remote }));
    } catch (e) {
      const msg = String(e);
      if (msg.includes('CONFLICT') || msg.includes('conflict')) {
        toast.warning(t('pages.pullConflicts'), t('pages.pullConflictsHint'));
        refreshStatus(repo.path);
      } else {
        toast.error(t('pages.pullFailed'), msg);
      }
    } finally {
      setSyncing(null);
    }
  };

  // Shared header buttons — Fetch/Pull belong to the PR tool too: reviewing
  // PRs starts with getting the latest remote state into the local repo.
  const syncButtons = (
    <>
      <button className="btn btn-secondary text-xs" onClick={handleFetchAll} disabled={syncing !== null} title={t('pages.fetchAllTitle')}>
        {syncing === 'fetch' ? <Loader size={12} className="animate-spin" /> : <CloudDownload size={12} />}
        {t('remotes.fetch')}
      </button>
      <button className="btn btn-secondary text-xs" onClick={handlePull} disabled={syncing !== null} title={t('pages.pushButtonTitle')}>
        {syncing === 'pull' ? <Loader size={12} className="animate-spin" /> : <ArrowDown size={12} />}
        {t('remotes.pull')}
      </button>
    </>
  );

  // Auth gate — show different prompts for GitHub vs GitLab repos.
  if (!isAuthed) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
          <div className="flex items-center gap-2">
            <GitPullRequest size={14} />
            <span className="text-sm font-medium">{t('nav.pulls')}</span>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary">
          <GitPullRequest size={32} className="mb-2 opacity-50" />
          <div className="text-sm">
            {isGitLabRepo
              ? t('pages.glNotConnected', { defaultValue: 'Not connected to GitLab' })
              : t('pages.ghNotConnected')}
          </div>
          <div className="text-xs mt-1">
            {isGitLabRepo
              ? t('pages.glNotConnectedHint', { defaultValue: 'Open the Clone dialog → GitLab tab, or Settings → Integrations, to authenticate with a GitLab personal access token.' })
              : t('pages.ghNotConnectedHint')}
          </div>
        </div>
      </div>
    );
  }

  if (!isSupportedRepo) {
    // Provider not detected (self-hosted GitLab, GitHub Enterprise, Gitea, etc.)
    // Let the user manually select which provider to use.
    // A dropdown covers ALL providers — not just GitHub/GitLab.
    const providers = [
      { id: 'github', label: 'GitHub', desc: 'github.com or GitHub Enterprise' },
      { id: 'gitlab', label: 'GitLab', desc: 'gitlab.com or self-hosted GitLab' },
      { id: 'bitbucket', label: 'Bitbucket', desc: 'bitbucket.org or self-hosted' },
      { id: 'gitea', label: 'Gitea', desc: 'self-hosted Gitea instance' },
      { id: 'gogs', label: 'Gogs', desc: 'self-hosted Gogs instance' },
    ];

    const selectProvider = (providerId: string) => {
      const url = repoInfo.url || '';
      // Parse owner/repo from SSH or HTTPS URL.
      const sshMatch = url.match(/git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
      const httpsMatch = url.match(/https?:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/);
      const match = sshMatch || httpsMatch;
      if (match) {
        const [, host, ownerName, repoName] = match;
        setRepoInfo({
          ...repoInfo,
          provider: providerId,
          owner: ownerName,
          repo: repoName,
          webUrl: `https://${host}/${ownerName}/${repoName}`,
        });
      } else {
        setRepoInfo({ ...repoInfo, provider: providerId, owner: '', repo: '' });
      }
    };

    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
          <div className="flex items-center gap-2">
            <GitPullRequest size={14} />
            <span className="text-sm font-medium">{t('nav.pulls')}</span>
          </div>
          {syncButtons}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-4 p-4">
          <GitPullRequest size={32} className="opacity-50" />
          <div className="text-sm">{t('pages.prProviderNotDetected', { defaultValue: 'Repository provider not detected' })}</div>
          <div className="text-xs text-center max-w-md">
            {t('pages.prProviderNotDetectedHint', { defaultValue: 'Select your hosting provider to enable Pull Requests and Code Review.' })}
          </div>
          {repoInfo.url && (
            <div className="text-2xs text-text-tertiary font-mono bg-bg-tertiary px-2 py-1 rounded max-w-full truncate">
              {repoInfo.url}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg">
            {providers.map((p) => (
              <button
                key={p.id}
                className="btn btn-secondary text-xs flex flex-col items-center gap-0.5 py-2 px-3 min-w-[100px]"
                onClick={() => selectProvider(p.id)}
                title={p.desc}
              >
                <span className="font-medium">{p.label}</span>
                <span className="text-2xs text-text-tertiary">{p.desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // If owner/repo couldn't be auto-parsed, show manual input.
  if (!repoInfo.owner || !repoInfo.repo) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
          <div className="flex items-center gap-2">
            <GitPullRequest size={14} />
            <span className="text-sm font-medium">{t('nav.pulls')}</span>
            <span className="text-2xs text-text-tertiary">
              {repoInfo.provider === 'gitlab' ? 'GitLab' : 'GitHub'}
            </span>
          </div>
          {syncButtons}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-4">
          <GitPullRequest size={32} className="opacity-50" />
          <div className="text-sm">{t('pages.prManualEntry', { defaultValue: 'Enter repository path' })}</div>
          <div className="text-xs text-center max-w-md">
            {t('pages.prManualEntryHint', { defaultValue: 'Could not auto-detect owner/repo from the remote URL. Enter them manually (e.g. myorg/myrepo).' })}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              className="text-sm font-mono w-64 px-2 py-1 bg-bg-tertiary border border-border-default rounded"
              placeholder="owner/repo"
              defaultValue={`${repoInfo.owner || ''}/${repoInfo.repo || ''}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = (e.target as HTMLInputElement).value.trim();
                  const [o, r] = val.split('/');
                  if (o && r) setRepoInfo({ ...repoInfo, owner: o, repo: r });
                }
              }}
            />
            <button
              className="btn btn-primary text-xs"
              onClick={(e) => {
                const input = (e.target as HTMLElement).previousElementSibling as HTMLInputElement;
                const val = input.value.trim();
                const [o, r] = val.split('/');
                if (o && r) setRepoInfo({ ...repoInfo, owner: o, repo: r });
              }}
            >
              {t('common.ok', { defaultValue: 'OK' })}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <GitPullRequest size={14} />
          <span className="text-sm font-medium">{t('nav.pulls')}</span>
          <span className="text-2xs text-text-tertiary">{repoInfo.owner}/{repoInfo.repo}</span>
          {/* Live count — visible count / total. When the search is active,
              shows "5 / 12" so the user knows there are hidden matches. */}
          {search && prs.length > 0 && (
            <span className="text-2xs text-text-tertiary ml-1">
              {filteredPRs.length} / {prs.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* PR search — title, #number, head/base branch, or author */}
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
            <input
              type="text"
              className="text-xs w-44 pl-7 pr-2 py-0.5 bg-bg-tertiary border border-border-default rounded"
              placeholder={t('pages.prSearchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              title={t('pages.prSearchTooltip')}
            />
            {search && (
              <button
                className="absolute right-1 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
                onClick={() => setSearch('')}
                title={t('common.clear')}
              >
                <X size={10} />
              </button>
            )}
          </div>
          {syncButtons}
          <div className="flex bg-bg-tertiary rounded">
            {(['open', 'closed', 'all'] as const).map(s => (
              <button
                key={s}
                className={cn(
                  'px-2 py-0.5 text-2xs capitalize',
                  state === s ? 'bg-accent text-text-inverse' : 'text-text-secondary'
                )}
                onClick={() => setState(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <button className="icon-btn" title={t('common.refresh')} onClick={loadPRs}>
            <RefreshCw size={13} />
          </button>
          <button
            className="btn btn-primary text-xs"
            title={t('pages.prNewTitle')}
            onClick={() => {
              // Re-read at open time so the latest cross-tool selection applies
              const sel = useSelectionStore.getState().selectedBranch;
              if (sel) setPrHead(sel);
              setShowCreate(true);
            }}
          >
            <Plus size={12} />
            {t('pages.prNewButton')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm flex items-center justify-center gap-2">
            <Loader size={14} className="spin" />
            {t('pages.prLoading')}
          </div>
        ) : prs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <GitPullRequest size={32} className="mb-2 opacity-50" />
            <div className="text-sm">{t('pages.prNone', { state })}</div>
          </div>
        ) : filteredPRs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <Search size={32} className="mb-2 opacity-50" />
            <div className="text-sm">{t('pages.prNoMatches')}</div>
            <button className="text-xs text-accent mt-2 hover:underline" onClick={() => setSearch('')}>
              {t('common.clear')}
            </button>
          </div>
        ) : (
          filteredPRs.map(pr => (
            <div
              key={pr.number}
              className="group flex items-start gap-3 px-3 py-3 border-b border-border-subtle hover:bg-bg-hover cursor-pointer"
              onClick={() => api.app.openExternal(pr.html_url)}
            >
              <GitPullRequest
                size={16}
                className={cn(
                  'mt-0.5 flex-shrink-0',
                  pr.state === 'open' ? 'text-status-added' : 'text-status-deleted'
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary truncate">{pr.title}</span>
                  <span className="text-2xs text-text-tertiary flex-shrink-0">#{pr.number}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
                  <Avatar name={pr.author.login} email={undefined} size={14} avatarUrl={pr.author.avatar_url} />
                  <span>{pr.author.login}</span>
                  <span>·</span>
                  <button
                    className="text-status-renamed hover:underline"
                    title={t('pages.prHeadLog', { ref: pr.head.ref })}
                    onClick={(e) => {
                      e.stopPropagation();
                      useSelectionStore.getState().selectBranch(pr.head.ref);
                      window.location.hash = '#/history';
                    }}
                  >
                    {pr.head.ref}
                  </button>
                  <span>→</span>
                  <button
                    className="text-status-added hover:underline"
                    title={t('pages.prBaseLog', { ref: pr.base.ref })}
                    onClick={(e) => {
                      e.stopPropagation();
                      useSelectionStore.getState().selectBranch(pr.base.ref);
                      window.location.hash = '#/history';
                    }}
                  >
                    {pr.base.ref}
                  </button>
                  <span>·</span>
                  <span>{formatDate(pr.updated_at)}</span>
                </div>
              </div>
              <ExternalLink size={12} className="text-text-tertiary opacity-0 group-hover:opacity-100" />
              {/* LAR-2 — wire up GitHub PR actions to the existing backend
                  methods (electron/services/github.ts: submitPRReview /
                  mergePR / closePR / reopenPR). Buttons are shown only
                  for OPEN PRs in a GitHub repo where the user is
                  authenticated. */}
              {pr.state === 'open' && isSupportedRepo && isAuthed && (
                <div className="flex items-center gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="text-2xs px-2 py-0.5 rounded bg-status-added/15 text-status-added hover:bg-status-added/25 border border-status-added/30"
                    onClick={() => handleApprove(pr.number)}
                    title={t('pages.prApproveTooltip')}
                  >
                    ✓
                  </button>
                  <button
                    className="text-2xs px-2 py-0.5 rounded bg-status-deleted/15 text-status-deleted hover:bg-status-deleted/25 border border-status-deleted/30"
                    onClick={() => handleRequestChanges(pr.number)}
                    title={t('pages.prRequestChangesTooltip')}
                  >
                    ✕
                  </button>
                  <button
                    className="text-2xs px-2 py-0.5 rounded bg-status-modified/15 text-status-modified hover:bg-status-modified/25 border border-status-modified/30"
                    onClick={() => handleMerge(pr.number)}
                    title={t('pages.prMergeTooltip')}
                  >
                    ⇪
                  </button>
                  <button
                    className="text-2xs px-2 py-0.5 rounded bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-border-default"
                    onClick={() => handleClose(pr.number)}
                    title={t('pages.prCloseTooltip')}
                  >
                    ⊘
                  </button>
                </div>
              )}
              {pr.state === 'closed' && isSupportedRepo && isAuthed && !pr.merged_at && (
                <button
                  className="text-2xs px-2 py-0.5 rounded bg-status-added/15 text-status-added hover:bg-status-added/25 border border-status-added/30 ml-2"
                  onClick={(e) => { e.stopPropagation(); handleReopen(pr.number); }}
                  title={t('pages.prReopenTooltip')}
                >
                  ↻
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Create PR dialog */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in" onClick={() => setShowCreate(false)}>
          <div className="panel w-[480px] flex flex-col shadow-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
              <h3 className="text-base font-medium flex items-center gap-2">
                <GitPullRequest size={16} />
                {t('pages.prCreateTitle')}
              </h3>
              <button className="icon-btn" onClick={() => setShowCreate(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">{t('pages.prTitleLabel')}</label>
                <input
                  type="text"
                  className="w-full text-sm"
                  placeholder={t('pages.prTitlePlaceholder')}
                  value={prTitle}
                  onChange={e => setPrTitle(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-tertiary block mb-1">{t('pages.prHeadLabel')}</label>
                  <input
                    type="text"
                    className="w-full text-sm mono"
                    placeholder="feature/my-branch"
                    value={prHead}
                    onChange={e => setPrHead(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-text-tertiary block mb-1">{t('pages.prBaseLabel')}</label>
                  <input
                    type="text"
                    className="w-full text-sm mono"
                    placeholder="main"
                    value={prBase}
                    onChange={e => setPrBase(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">{t('pages.prDescriptionLabel')}</label>
                <textarea
                  className="w-full text-sm h-24 resize-none"
                  placeholder={t('pages.prDescriptionPlaceholder')}
                  value={prBody}
                  onChange={e => setPrBody(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-default">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={creating || !prTitle.trim() || !prHead.trim()}
              >
                {creating ? <Loader size={13} className="spin" /> : <Plus size={13} />}
                {t('pages.prCreateButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
