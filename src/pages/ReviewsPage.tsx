import { useState, useEffect, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { GitPullRequest, RefreshCw, Plus, Trash, Check, X, AlertCircle, Upload, Download, Loader, FileText, ExternalLink, ArrowLeft } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useAuthStore } from '../stores/authStore';
import { useProviderStore } from '../stores/providerStore';
import { api, type LogEntry } from '../lib/api';
import { ProviderChip } from '../components/ProviderChip';
import { PRReview } from '../components/PRReview';
import {
  loadReviews,
  addReviewComment,
  deleteReviewComment,
  setCommentResolved,
  pushReviews,
  fetchReviews,
  type ReviewComment,
  type Review,
} from '../lib/distributedReviews';
import { cn, formatDate, shortHash } from '../lib/utils';

import { useEscapeKey } from '../hooks/useEscapeKey';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
import { useI18n } from '../lib/i18n';
type Severity = 'info' | 'suggestion' | 'warning' | 'critical';

const SEVERITY_COLORS: Record<Severity, string> = {
  info: 'var(--status-info)',
  suggestion: 'var(--accent-purple)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-error)',
};

const SEVERITY_BADGES: Record<Severity, string> = {
  info: 'badge-renamed',
  suggestion: 'badge-renamed',
  warning: 'badge-modified',
  critical: 'badge-deleted',
};

export function ReviewsPage() {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastActions();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [commits, setCommits] = useState<LogEntry[]>([]);
  // Selected commit — the GLOBAL selection (shared with History, Tags, Notes…).
  // Clicking a reviewed commit here highlights it in History too.
  const selectedCommit = useSelectionStore((s) => s.selectedCommitHash);
  const selectCommit = useSelectionStore((s) => s.selectCommit);
  const [showAdd, setShowAdd] = useState(false);
  useEscapeKey(showAdd, () => setShowAdd(false));
  const [newComment, setNewComment] = useState<Partial<ReviewComment>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // ─── Single source of truth: shared with PullRequestsPage via providerStore
  // The user's explicit request: 'Зачем делали тогда инструмент Reviews — в
  // нем и должен происходить кодревью, он и должен быть синхронизирован с
  // пулреквест'. So when a PR is selected from PullRequests (or anywhere
  // else that calls selectPR), Reviews shows the PR review surface instead
  // of the local-review mode.
  const providerInfo = useProviderStore(useShallow((s) => ({
    provider: s.provider,
    owner: s.owner,
    repo: s.repo,
    gitlabAuthed: s.gitlabAuthed,
  })));
  const gitlabProjectId = useProviderStore((s) => s.gitlabProjectId);
  const selectedPR = useProviderStore((s) => s.selectedPR);
  const selectPR = useProviderStore((s) => s.selectPR);
  const detectProvider = useProviderStore((s) => s.detect);
  const [prNumberInput, setPrNumberInput] = useState('');

  useEffect(() => {
    detectProvider(repo.path);
  }, [repo.path, detectProvider]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reviewList, commitList] = await Promise.all([
        loadReviews(repo.path),
        api.git.log(repo.path, { maxCount: 100 }),
      ]);
      setReviews(reviewList);
      setCommits(commitList);
    } catch (e) {
      toast.error(t('pages.reviewsLoadFailed'), String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => {
    // Only load local reviews when we're NOT in PR review mode — PR review
    // fetches its own data via the GitHub/GitLab API.
    if (!selectedPR) load();
  }, [load, selectedPR]);

  const handleAdd = async () => {
    if (!newComment.commitHash || !newComment.filePath || !newComment.body) {
      toast.warning(t('pages.reviewFieldsRequired'));
      return;
    }
    setBusy('add');
    try {
      await addReviewComment(repo.path, {
        commitHash: newComment.commitHash,
        filePath: newComment.filePath,
        lineNumber: newComment.lineNumber || 0,
        author: 'You',
        body: newComment.body,
        severity: (newComment.severity as Severity) || 'info',
        resolved: false,
      });
      toast.success(t('pages.commentAdded'));
      setShowAdd(false);
      setNewComment({});
      await load();
    } catch (e) {
      toast.error(t('pages.commentAddFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (commitHash: string, commentId: string) => {
    if (!(await confirmDialog({
      title: t('pages.commentDeleteTitle'),
      message: t('pages.commentDeleteMessage'),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return;
    try {
      await deleteReviewComment(repo.path, commitHash, commentId);
      toast.success(t('pages.commentDeleted'));
      await load();
    } catch (e) {
      toast.error(t('pages.deleteFailed'), String(e));
    }
  };

  const handleToggleResolved = async (commitHash: string, commentId: string, resolved: boolean) => {
    try {
      await setCommentResolved(repo.path, commitHash, commentId, !resolved);
      await load();
    } catch (e) {
      toast.error(t('pages.updateFailed'), String(e));
    }
  };

  const handlePush = async () => {
    setBusy('push');
    try {
      const result = await pushReviews(repo.path);
      if (result === 'nothing-to-push') {
        toast.info(
          t('pages.reviewsNothingToPush', { defaultValue: 'No reviews to push' }),
          t('pages.reviewsNothingToPushHint', { defaultValue: 'Add a review comment first, then push to share it with your team.' })
        );
      } else {
        toast.success(t('pages.reviewsPushed'));
      }
    } catch (e) {
      toast.error(t('pages.pushFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleFetch = async () => {
    setBusy('fetch');
    try {
      const result = await fetchReviews(repo.path);
      if (result === 'no-remote-reviews') {
        toast.info(
          t('pages.reviewsNoRemoteReviews', { defaultValue: 'No reviews on remote yet' }),
          t('pages.reviewsNoRemoteReviewsHint', { defaultValue: 'The remote repository has no review notes. Push your local reviews first to share them.' })
        );
      } else {
        toast.success(t('pages.reviewsFetched'));
        await load();
      }
    } catch (e) {
      toast.error(t('pages.fetchFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleLoadFromPR = async () => {
    if (!providerInfo.owner || !providerInfo.repo) {
      toast.warning(t('pages.reviewsNoProvider', { defaultValue: 'Repository is not hosted on GitHub/GitLab' }));
      return;
    }
    const prNumStr = prNumberInput.trim() || await promptDialog({
      title: t('pages.reviewsLoadFromPRTitle', { defaultValue: 'Load review comments from Pull Request' }),
      message: t('pages.reviewsLoadFromPRMessage', { defaultValue: 'Enter the PR/MR number:' }),
      input: { placeholder: '#123' },
      confirmLabel: t('common.load', { defaultValue: 'Load' }),
    });
    if (prNumStr == null || !prNumStr.trim()) return;
    const prNum = parseInt(prNumStr.replace(/^#/, '').trim(), 10);
    if (!Number.isFinite(prNum) || prNum <= 0) {
      toast.error(t('pages.reviewsInvalidPRNumber', { defaultValue: 'Invalid PR number' }));
      return;
    }
    setBusy('pr-load');
    try {
      let imported = 0;
      if (providerInfo.provider === 'github') {
        const { authenticated } = useAuthStore.getState();
        if (!authenticated) {
          toast.warning(t('pages.reviewsGithubNotAuthed', { defaultValue: 'Connect to GitHub first (Settings → Integrations)' }));
          return;
        }
        const comments = await api.github.listPRComments(providerInfo.owner, providerInfo.repo, prNum);
        for (const c of comments) {
          if (!c.commit_id || !c.path) continue;
          await addReviewComment(repo.path, {
            commitHash: c.commit_id,
            filePath: c.path,
            lineNumber: c.line ?? 0,
            author: c.user?.login || 'github',
            body: c.body,
            severity: 'info',
            resolved: false,
          });
          imported++;
        }
      } else if (providerInfo.provider === 'gitlab') {
        toast.info(t('pages.reviewsGitlabNotesUnsupported', { defaultValue: 'GitLab MR note import is not yet available — use the GitLab web UI to view MR comments' }));
        return;
      } else {
        toast.warning(t('pages.reviewsNoProvider', { defaultValue: 'Repository is not hosted on GitHub/GitLab' }));
        return;
      }
      toast.success(t('pages.reviewsImported', { defaultValue: 'Imported {count} review comments from PR #{pr}', count: imported, pr: prNum }));
      await load();
    } catch (e) {
      toast.error(t('pages.reviewsImportFailed', { defaultValue: 'Failed to import PR comments' }), String(e));
    } finally {
      setBusy(null);
    }
  };

  const totalComments = reviews.reduce((acc, r) => acc + r.comments.length, 0);
  const unresolvedCount = reviews.reduce(
    (acc, r) => acc + r.comments.filter(c => !c.resolved).length,
    0
  );

  const filteredReviews = selectedCommit
    ? reviews.filter(r => r.commitHash.startsWith(selectedCommit))
    : reviews;

  // ═══════════════════════════════════════════════════════════════════════
  // PR REVIEW MODE — when a PR is selected (via PullRequests page click),
  // the Reviews page becomes the code review surface for that PR.
  // The local-review mode (git-notes comments) is shown when no PR is
  // selected.
  // ═══════════════════════════════════════════════════════════════════════
  if (selectedPR && providerInfo.owner && providerInfo.repo &&
      (providerInfo.provider === 'github' || providerInfo.provider === 'gitlab')) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* PR review header — shows the selected PR + a "back to local reviews" button */}
        <div className="flex items-center justify-between px-3 py-1 border-b border-border-default bg-bg-secondary">
          <div className="flex items-center gap-2">
            <GitPullRequest size={14} />
            <span className="text-sm font-medium">{t('pages.reviewsTitle')}</span>
            <ProviderChip />
            <span className="text-2xs text-text-tertiary">
              · PR review · #{selectedPR.number}
            </span>
          </div>
          <button
            className="btn btn-secondary text-xs flex items-center gap-1"
            onClick={() => selectPR(null)}
            title={t('pages.reviewsBackToLocal', { defaultValue: 'Back to local review comments' })}
          >
            <ArrowLeft size={12} />
            {t('pages.reviewsExitPR', { defaultValue: 'Exit PR review' })}
          </button>
        </div>
        <PRReview
          pr={selectedPR}
          owner={providerInfo.owner}
          repo={providerInfo.repo}
          provider={providerInfo.provider as 'github' | 'gitlab'}
          gitlabProjectId={gitlabProjectId}
          onActionComplete={() => {/* PR list will refresh on next PullRequests visit */}}
          onClose={() => selectPR(null)}
        />
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LOCAL REVIEW MODE — git-notes based review (no PR selected).
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <GitPullRequest size={14} />
          <span className="text-sm font-medium">{t('pages.reviewsTitle')}</span>
          <ProviderChip />
          <span className="text-2xs text-text-tertiary">
            {t('pages.reviewsCounts', { comments: totalComments, unresolved: unresolvedCount })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title={t('common.refresh')} onClick={load}>
            <RefreshCw size={13} />
          </button>
          <button
            className="btn btn-secondary text-xs"
            onClick={handleFetch}
            disabled={!!busy}
            title={t('pages.reviewsFetchTitle')}
          >
            {busy === 'fetch' ? <Loader size={12} className="spin" /> : <Download size={12} />}
            {t('remotes.fetch')}
          </button>
          <button
            className="btn btn-secondary text-xs"
            onClick={handlePush}
            disabled={!!busy}
            title={t('pages.reviewsPushTitle')}
          >
            {busy === 'push' ? <Loader size={12} className="spin" /> : <Upload size={12} />}
            {t('remotes.push')}
          </button>
          {/* Load PR comments from GitHub/GitLab — pulls inline review comments
              from the hosting provider so the user can see code review
              feedback without leaving the app. Disabled when the repo isn't
              on GitHub/GitLab or the user isn't authenticated. */}
          {providerInfo.provider === 'github' || providerInfo.provider === 'gitlab' ? (
            <button
              className="btn btn-secondary text-xs"
              onClick={handleLoadFromPR}
              disabled={!!busy}
              title={t('pages.reviewsLoadFromPRTitle', { defaultValue: 'Load review comments from a Pull Request/Merge Request' })}
            >
              {busy === 'pr-load' ? <Loader size={12} className="spin" /> : <ExternalLink size={12} />}
              {t('pages.reviewsLoadFromPR', { defaultValue: 'From PR' })}
            </button>
          ) : null}
          <button
            className="btn btn-primary text-xs"
            onClick={() => {
              setShowAdd(true);
              setNewComment({ severity: 'info' });
            }}
          >
            <Plus size={12} />
            {t('pages.addComment')}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Commit list with review count */}
        <div className="w-72 border-r border-border-default overflow-y-auto flex-shrink-0">
          <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-b border-border-default">
            {t('pages.reviewedCommits', { count: reviews.length })}
          </div>
          {loading ? (
            <div className="p-4 text-center text-text-tertiary text-sm">{t('common.loading')}</div>
          ) : reviews.length === 0 ? (
            <div className="p-4 text-center text-text-tertiary text-xs">
              {t('pages.noReviewsYet')}
            </div>
          ) : (
            reviews.map(review => {
              const commit = commits.find(c => c.hash === review.commitHash);
              const unresolved = review.comments.filter(c => !c.resolved).length;
              return (
                <div
                  key={review.commitHash}
                  className={cn(
                    'px-3 py-2 cursor-pointer border-b border-border-subtle hover:bg-bg-hover',
                    selectedCommit && review.commitHash.startsWith(selectedCommit) && 'bg-bg-selected'
                  )}
                  onClick={() => selectCommit(review.commitHash)}
                >
                  <div className="flex items-center gap-2">
                    <code className="text-2xs mono text-text-tertiary">{shortHash(review.commitHash)}</code>
                    {unresolved > 0 && <span className="badge badge-deleted">{unresolved}</span>}
                  </div>
                  <div className="text-xs text-text-secondary truncate mt-0.5">
                    {commit?.subject || t('pages.commitNotInHistory')}
                  </div>
                  <div className="text-2xs text-text-tertiary mt-0.5">
                    {t('pages.commentsCount', { count: review.comments.length })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Comments for selected commit */}
        <div className="flex-1 overflow-y-auto">
          {selectedCommit ? (
            filteredReviews.length > 0 ? (
              filteredReviews[0].comments.map(comment => (
                <div
                  key={comment.id}
                  className={cn(
                    'px-4 py-3 border-b border-border-subtle',
                    comment.resolved && 'opacity-60'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                      style={{ backgroundColor: SEVERITY_COLORS[comment.severity] }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn('badge', SEVERITY_BADGES[comment.severity])}>
                          {comment.severity}
                        </span>
                        <span className="text-xs text-text-secondary">{comment.author}</span>
                        <span className="text-2xs text-text-tertiary">· {formatDate(comment.date)}</span>
                        {comment.resolved && <span className="badge badge-added">{t('pages.resolvedBadge')}</span>}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-text-tertiary mt-1">
                        <FileText size={11} />
                        <code className="mono truncate">{comment.filePath}</code>
                        {comment.lineNumber > 0 && <span>:L{comment.lineNumber}</span>}
                      </div>
                      <div className="text-sm text-text-primary mt-2 whitespace-pre-wrap">
                        {comment.body}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        className="icon-btn !w-6 !h-6"
                        title={comment.resolved ? t('pages.markUnresolved') : t('pages.markResolved')}
                        onClick={() => handleToggleResolved(filteredReviews[0].commitHash, comment.id, comment.resolved)}
                      >
                        <Check size={12} />
                      </button>
                      <button
                        className="icon-btn !w-6 !h-6 hover:!text-status-deleted"
                        title={t('common.delete')}
                        onClick={() => handleDelete(filteredReviews[0].commitHash, comment.id)}
                      >
                        <Trash size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-text-tertiary text-sm">
                {t('pages.noCommentsForCommit')}
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-tertiary">
              <GitPullRequest size={32} className="mb-2 opacity-50" />
              <div className="text-sm">{t('pages.selectCommitForReviews')}</div>
              <div className="text-xs mt-1">{t('pages.addCommentHint')}</div>
              {/* Hint pointing the user at Pull Requests when a provider is set */}
              {providerInfo.provider === 'github' || providerInfo.provider === 'gitlab' ? (
                <button
                  className="btn btn-secondary text-xs mt-4"
                  onClick={() => { window.location.hash = '#/pulls'; }}
                >
                  {t('pages.reviewsGoToPRs', { defaultValue: 'Open Pull Requests to review a PR' })}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Add comment dialog */}
      {showAdd && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in"
          onClick={() => setShowAdd(false)}
        >
          <div className="panel w-[480px] flex flex-col shadow-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
              <h3 className="text-base font-medium flex items-center gap-2">
                <Plus size={16} />
                {t('pages.addReviewCommentTitle')}
              </h3>
              <button className="icon-btn" onClick={() => setShowAdd(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">{t('pages.commitLabel')}</label>
                <select
                  className="w-full text-sm mono"
                  value={newComment.commitHash || ''}
                  onChange={e => setNewComment({ ...newComment, commitHash: e.target.value })}
                >
                  <option value="">{t('pages.selectCommitPlaceholder')}</option>
                  {commits.slice(0, 50).map(c => (
                    <option key={c.hash} value={c.hash}>
                      {shortHash(c.hash)} — {c.subject.substring(0, 50)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-tertiary block mb-1">{t('pages.filePathLabel')}</label>
                  <input
                    type="text"
                    className="w-full text-sm mono"
                    placeholder="src/file.ts"
                    value={newComment.filePath || ''}
                    onChange={e => setNewComment({ ...newComment, filePath: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-text-tertiary block mb-1">{t('pages.lineOptionalLabel')}</label>
                  <input
                    type="number"
                    className="w-full text-sm"
                    placeholder="0"
                    value={newComment.lineNumber || ''}
                    onChange={e => setNewComment({ ...newComment, lineNumber: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">{t('pages.severityLabel')}</label>
                <div className="flex gap-1">
                  {(['info', 'suggestion', 'warning', 'critical'] as Severity[]).map(s => (
                    <button
                      key={s}
                      className={cn(
                        'flex-1 py-1 text-xs rounded capitalize',
                        (newComment.severity || 'info') === s
                          ? 'bg-accent text-text-inverse'
                          : 'bg-bg-tertiary text-text-secondary'
                      )}
                      style={{ color: (newComment.severity || 'info') === s ? undefined : SEVERITY_COLORS[s] }}
                      onClick={() => setNewComment({ ...newComment, severity: s })}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">{t('pages.commentLabel')}</label>
                <textarea
                  className="w-full text-sm h-24 resize-none"
                  placeholder={t('pages.commentPlaceholder')}
                  value={newComment.body || ''}
                  onChange={e => setNewComment({ ...newComment, body: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-default">
              <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                onClick={handleAdd}
                disabled={busy === 'add' || !newComment.commitHash || !newComment.filePath || !newComment.body}
              >
                {busy === 'add' ? <Loader size={13} className="spin" /> : <Plus size={13} />}
                {t('common.add')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
