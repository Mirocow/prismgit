/**
 * PR review surface — the in-app code review experience for a selected PR.
 *
 * The user's explicit request: 'Зачем делали тогда инструмент Reviews —
 * в нем и должен происходить кодревью, он и должен быть синхронизирован
 * с пулреквест'. So this component is what Reviews page shows when a PR is
 * selected from Pull Requests (or anywhere else that calls selectPR).
 *
 * Layout:
 *   ┌─────────────────────────────────────────────┬──────────────────────┐
 *   │ Header: #123 Title [open] [⇪ merge] [⊘ close] │  Files changed (3)   │
 *   │ author · opened 2d ago · updated 1h ago       │  ─────────────────── │
 *   │ ─────────────────────────────────────────── │  ✓ src/foo.ts (+5/-2)│
 *   │ Description (markdown rendered)               │  ✓ README.md (+10)   │
 *   │ ...                                           │  ⚠ src/bar.ts (+50)  │
 *   │ ─────────────────────────────────────────── │                      │
 *   │ Comments (3)                                 │  Selected file diff: │
 *   │ user1 · 2h ago                                │  (patch rendered)    │
 *   │ comment text                                  │                      │
 *   │ user2 · 1h ago                                 │                      │
 *   │ ...                                           │                      │
 *   │ ─────────────────────────────────────────── │                      │
 *   │ [Add comment...] [Post]                       │                      │
 *   └─────────────────────────────────────────────┴──────────────────────┘
 *
 * Data sources (GitHub API):
 *   - getPullRequest: full PR with body, stats, mergeable, labels
 *   - listPRFiles: changed files with patches
 *   - listPRIssueComments: top-level discussion thread
 *
 * For GitLab MRs, only the basic info from the list is shown — GitLab
 * doesn't have these detail endpoints wired yet.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  GitPullRequest, X, ExternalLink, Loader, Check, FileText, MessageSquare,
  GitCommit, Plus, Minus, ArrowRight, RefreshCw,
} from './icons';
import { useI18n } from '../lib/i18n';
import { useToastActions } from '../stores/toastStore';
import { api, type GithubPullRequest, type GithubPRFile, type GithubPRComment } from '../lib/api';
import { Avatar } from './Avatar';
import MarkdownRenderer from './MarkdownRenderer';
import { cn, formatDate } from '../lib/utils';
import { confirmDialog } from './ConfirmDialog';
import type { SelectedPR } from '../stores/providerStore';

interface PRReviewProps {
  /** The selected PR from providerStore — has the basic fields. */
  pr: SelectedPR;
  owner: string;
  repo: string;
  provider: 'github' | 'gitlab';
  /** GitLab project ID — only set for GitLab MRs. */
  gitlabProjectId?: number | null;
  onActionComplete: () => void;  // refresh PR list after merge/close/etc
  onClose: () => void;            // clear the PR selection
}

export function PRReview({
  pr, owner, repo, provider, gitlabProjectId, onActionComplete, onClose,
}: PRReviewProps) {
  const { t } = useI18n();
  const toast = useToastActions();
  const [fullPR, setFullPR] = useState<GithubPullRequest | null>(null);
  const [files, setFiles] = useState<GithubPRFile[]>([]);
  const [comments, setComments] = useState<GithubPRComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<GithubPRFile | null>(null);
  const [commentText, setCommentText] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (provider === 'github') {
        const [prDetail, prFiles, prComments] = await Promise.all([
          api.github.getPullRequest(owner, repo, pr.number),
          api.github.listPRFiles(owner, repo, pr.number),
          api.github.listPRIssueComments(owner, repo, pr.number),
        ]);
        setFullPR(prDetail);
        setFiles(prFiles);
        setComments(prComments);
        setSelectedFile((cur) => cur ?? prFiles[0] ?? null);
      } else {
        // GitLab: detail endpoint not wired — show what we have from the list.
        setFullPR(null);
        setFiles([]);
        setComments([]);
      }
    } catch (e) {
      toast.error(t('pages.prLoadFailed'), String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr.number, owner, repo, provider]);

  useEffect(() => {
    void load();
  }, [load]);

  // The displayed PR — prefer the full version (has body + stats),
  // fall back to the list version while loading.
  // GithubPullRequest has `user`, SelectedPR has `author` — normalize here.
  type DisplayPR = SelectedPR & {
    additions?: number; deletions?: number; changed_files?: number;
    commits?: number; comments?: number; review_comments?: number;
    mergeable?: boolean | null; draft?: boolean;
    body?: string;
  };
  const fullOrList = (fullPR ?? pr) as DisplayPR;
  const displayPR: DisplayPR = {
    ...fullOrList,
    author: (fullPR?.user ?? pr.author) as { login: string; avatar_url?: string },
  };

  const handleApprove = async () => {
    setActionInProgress('approve');
    try {
      if (provider === 'github') {
        await api.github.submitPRReview(owner, repo, pr.number, 'APPROVE', '');
      } else if (provider === 'gitlab' && gitlabProjectId != null) {
        await api.gitlab.approveMergeRequest(gitlabProjectId, pr.number);
      }
      toast.success(t('pages.prApproved', { n: pr.number }));
      onActionComplete();
      void load();
    } catch (e) {
      toast.error(t('pages.prApproveFailed'), String(e));
    } finally {
      setActionInProgress(null);
    }
  };

  const handleMerge = async () => {
    if (!(await confirmDialog({
      title: t('pages.prMergeConfirmTitle', { n: pr.number }),
      message: t('pages.prMergeConfirmMessage'),
      confirmLabel: t('pages.prMerge'),
    }))) return;
    setActionInProgress('merge');
    try {
      if (provider === 'github') {
        await api.github.mergePR(owner, repo, pr.number, { merge_method: 'merge' });
      } else if (provider === 'gitlab' && gitlabProjectId != null) {
        await api.gitlab.mergeMergeRequest(gitlabProjectId, pr.number, { should_remove_source_branch: true });
      }
      toast.success(t('pages.prMerged', { n: pr.number }));
      onActionComplete();
      onClose();
    } catch (e) {
      toast.error(t('pages.prMergeFailed'), String(e));
    } finally {
      setActionInProgress(null);
    }
  };

  const handleClose = async () => {
    setActionInProgress('close');
    try {
      if (provider === 'github') {
        await api.github.closePR(owner, repo, pr.number);
        toast.success(t('pages.prClosed', { n: pr.number }));
        onActionComplete();
        onClose();
      } else {
        toast.info(t('pages.prCloseGitLabUnsupported', { defaultValue: 'GitLab MR close is not yet supported — use the GitLab web UI' }));
      }
    } catch (e) {
      toast.error(t('pages.prCloseFailed'), String(e));
    } finally {
      setActionInProgress(null);
    }
  };

  const handlePostComment = async () => {
    if (!commentText.trim()) return;
    setPostingComment(true);
    try {
      if (provider === 'github') {
        await api.github.addPRComment(owner, repo, pr.number, commentText);
        toast.success(t('pages.commentAdded'));
        setCommentText('');
        void load();
      } else if (provider === 'gitlab' && gitlabProjectId != null) {
        await api.gitlab.addMRComment(gitlabProjectId, pr.number, commentText);
        toast.success(t('pages.commentAdded'));
        setCommentText('');
      }
    } catch (e) {
      toast.error(t('pages.commentAddFailed'), String(e));
    } finally {
      setPostingComment(false);
    }
  };

  const stats = fullPR ? {
    additions: fullPR.additions ?? 0,
    deletions: fullPR.deletions ?? 0,
    changedFiles: fullPR.changed_files ?? files.length,
    commits: fullPR.commits ?? 0,
    comments: fullPR.comments ?? 0,
    reviewComments: fullPR.review_comments ?? 0,
  } : null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header — title, number, state badge, action buttons */}
      <div className="flex items-start gap-3 px-4 py-2 border-b border-border-default bg-bg-secondary">
        <GitPullRequest
          size={18}
          className={cn(
            'mt-0.5 flex-shrink-0',
            displayPR.merged_at
              ? 'text-status-modified'
              : displayPR.state === 'open' ? 'text-status-added' : 'text-status-deleted'
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-medium text-text-primary">{displayPR.title}</h2>
            <span className="text-2xs text-text-tertiary">#{displayPR.number}</span>
            <span
              className={cn(
                'text-2xs px-1.5 py-0.5 rounded uppercase font-medium',
                displayPR.merged_at
                  ? 'bg-status-modified/15 text-status-modified'
                  : displayPR.state === 'open'
                    ? 'bg-status-added/15 text-status-added'
                    : 'bg-status-deleted/15 text-status-deleted'
              )}
            >
              {displayPR.merged_at ? 'merged' : displayPR.state}
            </span>
            {displayPR.draft && (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary">DRAFT</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
            <Avatar name={displayPR.author.login} email={undefined} size={12} avatarUrl={displayPR.author.avatar_url} />
            <span className="text-text-secondary">{displayPR.author.login}</span>
            <span>·</span>
            <span>{formatDate(displayPR.created_at)}</span>
            <span>·</span>
            <button
              className="text-status-renamed hover:underline font-mono"
              title={displayPR.head.ref}
            >
              {displayPR.head.ref}
            </button>
            <ArrowRight size={10} />
            <button
              className="text-status-added hover:underline font-mono"
              title={displayPR.base.ref}
            >
              {displayPR.base.ref}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            className="icon-btn"
            title={t('common.openExternal', { defaultValue: 'Open in browser' })}
            onClick={() => api.app.openExternal(displayPR.html_url)}
          >
            <ExternalLink size={13} />
          </button>
          <button
            className="icon-btn"
            title={t('common.refresh')}
            onClick={() => void load()}
          >
            <RefreshCw size={13} />
          </button>
          <button className="icon-btn" onClick={onClose} title={t('common.close')}>
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Action bar — Approve / Merge / Close (only for open PRs) */}
      {displayPR.state === 'open' && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border-subtle bg-bg-tertiary">
          <button
            className="btn btn-secondary text-xs flex items-center gap-1"
            onClick={handleApprove}
            disabled={actionInProgress !== null}
          >
            {actionInProgress === 'approve' ? <Loader size={11} className="animate-spin" /> : <Check size={11} />}
            {t('pages.prApprove')}
          </button>
          <button
            className="btn btn-primary text-xs flex items-center gap-1"
            onClick={handleMerge}
            disabled={actionInProgress !== null || displayPR.draft === true}
            title={displayPR.draft ? t('pages.prMergeDraftBlocked', { defaultValue: 'Draft PRs cannot be merged' }) : t('pages.prMergeTooltip')}
          >
            {actionInProgress === 'merge' ? <Loader size={11} className="animate-spin" /> : <GitPullRequest size={11} />}
            {t('pages.prMerge')}
          </button>
          <button
            className="btn btn-secondary text-xs flex items-center gap-1"
            onClick={handleClose}
            disabled={actionInProgress !== null}
          >
            {actionInProgress === 'close' ? <Loader size={11} className="animate-spin" /> : <X size={11} />}
            {t('pages.prClose')}
          </button>
          {stats && (
            <div className="ml-auto flex items-center gap-3 text-2xs text-text-tertiary">
              <span className="flex items-center gap-1">
                <FileText size={10} />
                {stats.changedFiles} {t('pages.prFiles', { defaultValue: 'files' })}
              </span>
              <span className="flex items-center gap-1 text-status-added">
                <Plus size={10} />{stats.additions}
              </span>
              <span className="flex items-center gap-1 text-status-deleted">
                <Minus size={10} />{stats.deletions}
              </span>
              <span className="flex items-center gap-1">
                <GitCommit size={10} />
                {stats.commits}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Body — description + comments on the left, files on the right */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: description + comments */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-border-subtle">
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-text-tertiary text-sm flex items-center justify-center gap-2">
                <Loader size={14} className="animate-spin" />
                {t('common.loading')}
              </div>
            ) : (
              <>
                {/* Description */}
                {displayPR.body ? (
                  <div className="px-4 py-3 border-b border-border-subtle">
                    <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold mb-2">
                      {t('pages.prDescription', { defaultValue: 'Description' })}
                    </div>
                    <MarkdownRenderer text={displayPR.body} />
                  </div>
                ) : (
                  <div className="px-4 py-3 border-b border-border-subtle text-text-tertiary text-xs italic">
                    {t('pages.prNoDescription', { defaultValue: 'No description provided.' })}
                  </div>
                )}

                {/* Comments */}
                <div className="px-4 py-3">
                  <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold mb-2 flex items-center gap-1">
                    <MessageSquare size={11} />
                    {t('pages.prComments', { defaultValue: 'Comments' })} ({comments.length})
                  </div>
                  {comments.length === 0 ? (
                    <div className="text-text-tertiary text-xs italic mb-3">
                      {t('pages.prNoComments', { defaultValue: 'No comments yet.' })}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {comments.map((c) => (
                        <div key={c.id} className="flex gap-2 p-2 bg-bg-tertiary rounded">
                          <Avatar name={c.user.login} email={undefined} size={18} avatarUrl={c.user.avatar_url} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-medium text-text-primary">{c.user.login}</span>
                              <span className="text-text-tertiary text-2xs">{formatDate(c.created_at)}</span>
                              {c.author_association && c.author_association !== 'NONE' && (
                                <span className="text-3xs px-1 rounded bg-bg-secondary text-text-tertiary">{c.author_association}</span>
                              )}
                            </div>
                            <div className="text-xs text-text-secondary mt-0.5">
                              <MarkdownRenderer text={c.body} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Comment box */}
          {provider === 'github' && !loading && (
            <div className="border-t border-border-subtle px-4 py-2 bg-bg-secondary">
              <textarea
                className="w-full text-sm bg-bg-tertiary border border-border-default rounded p-2 resize-none"
                rows={2}
                placeholder={t('pages.prCommentPlaceholder', { defaultValue: 'Leave a comment...' })}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    void handlePostComment();
                  }
                }}
              />
              <div className="flex items-center justify-between mt-1">
                <span className="text-2xs text-text-tertiary">
                  {t('pages.prCommentHint', { defaultValue: 'Cmd/Ctrl+Enter to post' })}
                </span>
                <button
                  className="btn btn-primary text-xs flex items-center gap-1"
                  onClick={handlePostComment}
                  disabled={!commentText.trim() || postingComment}
                >
                  {postingComment ? <Loader size={11} className="animate-spin" /> : <MessageSquare size={11} />}
                  {t('pages.prPostComment', { defaultValue: 'Comment' })}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: changed files + selected file's diff */}
        {files.length > 0 && (
          <div className="w-1/2 flex flex-col overflow-hidden">
            <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold px-3 py-1.5 border-b border-border-subtle bg-bg-tertiary">
              {t('pages.prChangedFiles', { defaultValue: 'Changed files' })} ({files.length})
            </div>
            <div className="flex-1 overflow-y-auto">
              {files.map((f) => (
                <button
                  key={f.sha + f.filename}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hover transition-colors border-b border-border-subtle flex items-center gap-2',
                    selectedFile?.filename === f.filename && 'bg-accent-muted text-accent'
                  )}
                  onClick={() => setSelectedFile(f)}
                >
                  <span
                    className={cn(
                      'text-2xs px-1 rounded uppercase font-medium flex-shrink-0',
                      f.status === 'added' && 'bg-status-added/15 text-status-added',
                      f.status === 'removed' && 'bg-status-deleted/15 text-status-deleted',
                      f.status === 'modified' && 'bg-status-modified/15 text-status-modified',
                      f.status === 'renamed' && 'bg-status-renamed/15 text-status-renamed',
                    )}
                  >
                    {f.status.slice(0, 3)}
                  </span>
                  <span className="font-mono truncate flex-1" title={f.filename}>{f.filename}</span>
                  <span className="text-status-added text-2xs flex-shrink-0">+{f.additions}</span>
                  <span className="text-status-deleted text-2xs flex-shrink-0">-{f.deletions}</span>
                </button>
              ))}
            </div>
            {selectedFile?.patch && (
              <div className="border-t border-border-default flex-shrink-0 max-h-[45%] overflow-y-auto bg-bg-secondary">
                <div className="px-3 py-1 text-2xs font-mono text-text-tertiary border-b border-border-subtle sticky top-0 bg-bg-secondary">
                  {selectedFile.filename}
                </div>
                <pre className="text-2xs font-mono p-2 overflow-x-auto leading-tight">
                  {selectedFile.patch.split('\n').map((line: string, i: number) => (
                    <div
                      key={i}
                      className={cn(
                        'px-1',
                        line.startsWith('+') && !line.startsWith('+++') && 'bg-status-added/15 text-status-added',
                        line.startsWith('-') && !line.startsWith('---') && 'bg-status-deleted/15 text-status-deleted',
                        line.startsWith('@@') && 'text-accent'
                      )}
                    >
                      {line || ' '}
                    </div>
                  ))}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
