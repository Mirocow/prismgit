import { useState, useEffect, useCallback } from 'react';
import { GitPullRequest, RefreshCw, Plus, Trash, Check, X, AlertCircle, Upload, Download, Loader, FileText } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type LogEntry } from '../lib/api';
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
  const toast = useToastStore();
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
    load();
  }, [load]);

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
      await pushReviews(repo.path);
      toast.success(t('pages.reviewsPushed'));
    } catch (e) {
      toast.error(t('pages.pushFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleFetch = async () => {
    setBusy('fetch');
    try {
      await fetchReviews(repo.path);
      toast.success(t('pages.reviewsFetched'));
      await load();
    } catch (e) {
      toast.error(t('pages.fetchFailed'), String(e));
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

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <GitPullRequest size={14} />
          <span className="text-sm font-medium">{t('pages.reviewsTitle')}</span>
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
