import { useState, useEffect, useCallback } from 'react';
import { GitPullRequest, Plus, RefreshCw, ExternalLink, Loader, X, CloudDownload, ArrowDown } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type GithubPullRequest } from '../lib/api';
import { resolveDefaultRemote } from '../lib/remotes';
import { cn, formatDate } from '../lib/utils';

import { useEscapeKey } from '../hooks/useEscapeKey';
export function PullRequestsPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const { authenticated, user } = useAuthStore();
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const [prs, setPRs] = useState<GithubPullRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<'fetch' | 'pull' | null>(null);
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open');
  const [showCreate, setShowCreate] = useState(false);
  useEscapeKey(showCreate, () => setShowCreate(false));
  const [repoInfo, setRepoInfo] = useState<{ owner?: string; repo?: string; provider?: string }>({});

  // Create PR form
  const [prTitle, setPrTitle] = useState('');
  const [prHead, setPrHead] = useState('');
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
        toast.error('Failed to load pull requests', msg);
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

  const handleCreate = async () => {
    if (!repoInfo.owner || !repoInfo.repo) return;
    if (!prTitle.trim() || !prHead.trim() || !prBase.trim()) {
      toast.warning('Title, head, and base are required');
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
      toast.success('Pull request created');
      setShowCreate(false);
      setPrTitle('');
      setPrHead('');
      setPrBody('');
      await loadPRs();
    } catch (e) {
      toast.error('Failed to create PR', String(e));
    } finally {
      setCreating(false);
    }
  };

  const isGitHubRepo = repoInfo.provider === 'github' && repoInfo.owner && repoInfo.repo;

  // Request fresh data from the remote server — plain git operations, they work
  // regardless of GitHub auth (this is what the tool was missing entirely).
  const handleFetchAll = async () => {
    setSyncing('fetch');
    try {
      await api.git.fetchAll(repo.path, true);
      await refreshStatus(repo.path);
      toast.success('Fetched from all remotes (with prune)');
    } catch (e) {
      toast.error('Fetch failed', String(e));
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
      toast.success(`Pulled from ${remote}`);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('CONFLICT') || msg.includes('conflict')) {
        toast.warning('Pull resulted in conflicts', 'Resolve them in the Changes tool');
        refreshStatus(repo.path);
      } else {
        toast.error('Pull failed', msg);
      }
    } finally {
      setSyncing(null);
    }
  };

  // Shared header buttons — Fetch/Pull belong to the PR tool too: reviewing
  // PRs starts with getting the latest remote state into the local repo.
  const syncButtons = (
    <>
      <button className="btn btn-secondary text-xs" onClick={handleFetchAll} disabled={syncing !== null} title="Fetch from ALL remotes with prune">
        {syncing === 'fetch' ? <Loader size={12} className="animate-spin" /> : <CloudDownload size={12} />}
        Fetch
      </button>
      <button className="btn btn-secondary text-xs" onClick={handlePull} disabled={syncing !== null} title="Pull the current branch from its remote">
        {syncing === 'pull' ? <Loader size={12} className="animate-spin" /> : <ArrowDown size={12} />}
        Pull
      </button>
    </>
  );

  if (!authenticated) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
          <div className="flex items-center gap-2">
            <GitPullRequest size={14} />
            <span className="text-sm font-medium">Pull Requests</span>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary">
          <GitPullRequest size={32} className="mb-2 opacity-50" />
          <div className="text-sm">GitHub not connected</div>
          <div className="text-xs mt-1">Connect your GitHub account in Settings to manage pull requests</div>
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
            <span className="text-sm font-medium">Pull Requests</span>
          </div>
          {syncButtons}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary">
          <GitPullRequest size={32} className="mb-2 opacity-50" />
          <div className="text-sm">Not a GitHub repository</div>
          <div className="text-xs mt-1">Pull requests are only available for GitHub repositories</div>
          <div className="text-xs mt-1">Fetch / Pull still work — they are plain git operations</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <GitPullRequest size={14} />
          <span className="text-sm font-medium">Pull Requests</span>
          <span className="text-2xs text-text-tertiary">{repoInfo.owner}/{repoInfo.repo}</span>
        </div>
        <div className="flex items-center gap-2">
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
          <button className="icon-btn" title="Refresh" onClick={loadPRs}>
            <RefreshCw size={13} />
          </button>
          <button className="btn btn-primary text-xs" onClick={() => setShowCreate(true)}>
            <Plus size={12} />
            New PR
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm flex items-center justify-center gap-2">
            <Loader size={14} className="spin" />
            Loading pull requests...
          </div>
        ) : prs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <GitPullRequest size={32} className="mb-2 opacity-50" />
            <div className="text-sm">No {state} pull requests</div>
          </div>
        ) : (
          prs.map(pr => (
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
                    title={`Show log of head branch '${pr.head.ref}'`}
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
                    title={`Show log of base branch '${pr.base.ref}'`}
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
                Create Pull Request
              </h3>
              <button className="icon-btn" onClick={() => setShowCreate(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Title</label>
                <input
                  type="text"
                  className="w-full text-sm"
                  placeholder="PR title"
                  value={prTitle}
                  onChange={e => setPrTitle(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-tertiary block mb-1">Head (source branch)</label>
                  <input
                    type="text"
                    className="w-full text-sm mono"
                    placeholder="feature/my-branch"
                    value={prHead}
                    onChange={e => setPrHead(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-text-tertiary block mb-1">Base (target branch)</label>
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
                <label className="text-xs text-text-tertiary block mb-1">Description (optional)</label>
                <textarea
                  className="w-full text-sm h-24 resize-none"
                  placeholder="Describe your changes..."
                  value={prBody}
                  onChange={e => setPrBody(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-default">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={creating || !prTitle.trim() || !prHead.trim()}
              >
                {creating ? <Loader size={13} className="spin" /> : <Plus size={13} />}
                Create PR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
