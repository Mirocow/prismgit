import { useState, useEffect, useCallback, useMemo } from 'react';
import { GitPullRequest, Plus, RefreshCw, ExternalLink, Loader, X, CloudDownload, ArrowDown, Search } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useAuthStore } from '../stores/authStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type GithubPullRequest } from '../lib/api';
import { resolveDefaultRemote } from '../lib/remotes';
import { cn, formatDate } from '../lib/utils';
import { useI18n } from '../lib/i18n';

import { useEscapeKey } from '../hooks/useEscapeKey';
import { confirmDialog } from '../components/ConfirmDialog';
export function PullRequestsPage() {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const { authenticated, user } = useAuthStore();
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastActions();
  const [prs, setPRs] = useState<GithubPullRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<'fetch' | 'pull' | null>(null);
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open');
  // PR search filter — match title, PR number, head/base branch, or author.
  // Memory-only; not persisted (matches the pattern in Tags/Stashes/etc).
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  useEscapeKey(showCreate, () => setShowCreate(false));
  const [repoInfo, setRepoInfo] = useState<{ owner?: string; repo?: string; provider?: string }>({});

  // Create PR form — head/base prefill from the app-wide branch selection
  // (Branches/History/Toolbar): the PR grows out of the branch you picked.
  const globalSelBranch = useSelectionStore((s) => s.selectedBranch);
  const [prTitle, setPrTitle] = useState('');
  const [prHead, setPrHead] = useState(globalSelBranch ?? '');
  const [prBase, setPrBase] = useState('');
  const [prBody, setPrBody] = useState('');
  const [creating, setCreating] = useState(false);

  const loadRepoInfo = useCallback(async () => {
    try {
      const info = await api.git.extractRepoInfo(repo.path);
      setRepoInfo(info);
      if (info.provider === 'github' && info.owner && info.repo) {
        setPrBase(info.repo ? await api.git.raw(repo.path, ['symbolic-ref', '--short', 'HEAD']).catch(() => 'main') : 'main');
      }
    } catch {
      /* ignore */
    }
  }, [repo.path]);

  const loadPRs = useCallback(async () => {
    // Guard: don't even try if not authenticated or not a GitHub repo.
    // The useEffect below fires whenever repoInfo or state changes, and
    // without this guard it would spam IPC errors every time the user
    // opens the Pull Requests tab without GitHub auth configured.
    if (!authenticated) return;
    if (!repoInfo.owner || !repoInfo.repo || repoInfo.provider !== 'github') return;
    setLoading(true);
    try {
      const result = await api.github.listPullRequests(repoInfo.owner, repoInfo.repo, state);
      setPRs(result);
    } catch (e) {
      // Don't spam the toast on every retry — only show if it's a real error
      // (not just "not authenticated" which is handled by the auth check above)
      const msg = String(e);
      if (!msg.includes('Not authenticated')) {
        toast.error(t('pages.prLoadFailed'), msg);
      }
    } finally {
      setLoading(false);
    }
  }, [authenticated, repoInfo, state, toast]);

  useEffect(() => {
    loadRepoInfo();
  }, [loadRepoInfo]);

  useEffect(() => {
    if (repoInfo.owner && repoInfo.repo) {
      loadPRs();
    }
  }, [repoInfo, state, loadPRs]);

  // LAR-2 — PR action handlers. Wire up to api.github.* methods which
  // already exist in electron/services/github.ts.
  // Note: api.github.* take (owner, repo, prNumber, ...) — not repoPath.
  const handleApprove = async (prNumber: number) => {
    if (!repoInfo.owner || !repoInfo.repo) return;
    try {
      await api.github.submitPRReview(repoInfo.owner, repoInfo.repo, prNumber, 'APPROVE', '');
      toast.success(t('pages.prApproved', { n: prNumber }));
      await loadPRs();
    } catch (e) { toast.error(t('pages.prApproveFailed'), String(e)); }
  };
  const handleRequestChanges = async (prNumber: number) => {
    if (!repoInfo.owner || !repoInfo.repo) return;
    const body = await promptForComment();
    if (body == null) return;
    try {
      await api.github.submitPRReview(repoInfo.owner, repoInfo.repo, prNumber, 'REQUEST_CHANGES', body);
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
      await api.github.mergePR(repoInfo.owner, repoInfo.repo, prNumber, { merge_method: 'merge' });
      toast.success(t('pages.prMerged', { n: prNumber }));
      await loadPRs();
      await refreshStatus(repo.path);
    } catch (e) { toast.error(t('pages.prMergeFailed'), String(e)); }
  };
  const handleClose = async (prNumber: number) => {
    if (!repoInfo.owner || !repoInfo.repo) return;
    try {
      await api.github.closePR(repoInfo.owner, repoInfo.repo, prNumber);
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

  const isGitHubRepo = repoInfo.provider === 'github' && repoInfo.owner && repoInfo.repo;

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
      pr.user.login.toLowerCase().includes(q) ||
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

  if (!authenticated) {
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
          <div className="text-sm">{t('pages.ghNotConnected')}</div>
          <div className="text-xs mt-1">{t('pages.ghNotConnectedHint')}</div>
        </div>
      </div>
    );
  }

  if (!isGitHubRepo) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
          <div className="flex items-center gap-2">
            <GitPullRequest size={14} />
            <span className="text-sm font-medium">{t('nav.pulls')}</span>
          </div>
          {syncButtons}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary">
          <GitPullRequest size={32} className="mb-2 opacity-50" />
          <div className="text-sm">{t('pages.notGithubRepo')}</div>
          <div className="text-xs mt-1">{t('pages.notGithubHint')}</div>
          <div className="text-xs mt-1">{t('pages.notGithubHint2')}</div>
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
                  <img src={pr.user.avatar_url} alt="" className="w-4 h-4 rounded-full" />
                  <span>{pr.user.login}</span>
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
              {pr.state === 'open' && repoInfo.provider === 'github' && authenticated && (
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
              {pr.state === 'closed' && repoInfo.provider === 'github' && authenticated && !pr.merged_at && (
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
