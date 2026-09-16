/**
 * PR review surface — the in-app code review experience for a selected PR.
 *
 * The user's explicit request: 'А где описание к мр а где комиты а где разница
 * где полноценный интерфейс'. So this component is what Reviews page shows
 * when a PR is selected. It has FOUR tabs:
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │ Header: #123 Title [open] [⇪ merge] [⊘ close]  stats + Open external │
 *   │ author · opened 2d ago · head → base                                 │
 *   │ ─────────────────────────────────────────────────────────────────── │
 *   │ [Overview] [Commits] [Files (3)] [Discussion (2)]                    │
 *   │ ─────────────────────────────────────────────────────────────────── │
 *   │ TAB CONTENT                                                          │
 *   │                                                                      │
 *   │   Overview   = description (markdown) + stats + meta                  │
 *   │   Commits    = list of commits in the PR (sha, msg, author, date)    │
 *   │   Files      = changed files with status + +/- counts + diff patch   │
 *   │   Discussion = issue-style comments + comment input                 │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * Error handling for 404s:
 *   - GitHub/GitLab return 404 when owner/repo is wrong (user manually
 *     picked a provider via the chip dropdown, but the URL parse didn't
 *     produce the right owner/repo, OR the token doesn't have access).
 *   - We show a clear error panel: 'Repository not found on GitHub/GitLab'
 *     + the API endpoint that 404'd, so the user can debug.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  GitPullRequest, GitCommit, X, ExternalLink, Loader, Check, FileText,
  MessageSquare, Plus, Minus, ArrowRight, RefreshCw, AlertCircle,
} from './icons';
import { useI18n } from '../lib/i18n';
import { useToastActions } from '../stores/toastStore';
import {
  api, type GithubPullRequest, type GithubPRFile, type GithubPRComment,
  type GithubPRCommit, type GitLabMergeRequestDetail, type GitLabMRFile,
  type GitLabMRNote, type GitLabMRCommit,
} from '../lib/api';
import { Avatar } from './Avatar';
import MarkdownRenderer from './MarkdownRenderer';
import { cn, formatDate, shortHash } from '../lib/utils';
import { confirmDialog } from './ConfirmDialog';
import type { SelectedPR } from '../stores/providerStore';

type Tab = 'overview' | 'commits' | 'files' | 'discussion';

interface PRReviewProps {
  pr: SelectedPR;
  owner: string;
  repo: string;
  provider: 'github' | 'gitlab';
  gitlabProjectId?: number | null;
  onActionComplete: () => void;
  onClose: () => void;
}

export function PRReview({
  pr, owner, repo, provider, gitlabProjectId, onActionComplete, onClose,
}: PRReviewProps) {
  const { t } = useI18n();
  const toast = useToastActions();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [fullPR, setFullPR] = useState<GithubPullRequest | null>(null);
  const [files, setFiles] = useState<GithubPRFile[]>([]);
  const [comments, setComments] = useState<GithubPRComment[]>([]);
  const [commits, setCommits] = useState<GithubPRCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<GithubPRFile | null>(null);
  const [commentText, setCommentText] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (provider === 'github') {
        // Validate owner/repo before hitting the API — a manual provider
        // override via the chip can leave owner/repo empty, in which case
        // GitHub returns 404 (the user's error log was full of these).
        if (!owner || !repo) {
          setLoadError(
            t('pages.prReviewNoOwnerRepo', {
              defaultValue: 'Repository owner/name not detected from the remote URL. Open the provider chip in the header to re-detect or switch providers.'
            })
          );
          setLoading(false);
          return;
        }
        const [prDetail, prFiles, prComments, prCommits] = await Promise.all([
          api.github.getPullRequest(owner, repo, pr.number),
          api.github.listPRFiles(owner, repo, pr.number),
          api.github.listPRIssueComments(owner, repo, pr.number),
          api.github.listPRCommits(owner, repo, pr.number),
        ]);
        setFullPR(prDetail);
        setFiles(prFiles);
        setComments(prComments);
        setCommits(prCommits);
        setSelectedFile((cur) => cur ?? prFiles[0] ?? null);
      } else if (provider === 'gitlab') {
        // GitLab MR review — uses the project ID resolved by PullRequestsPage
        // and stored in the providerStore. Without it we can't call the
        // GitLab API (it requires the numeric project ID, not owner/repo).
        if (gitlabProjectId == null) {
          setLoadError(
            t('pages.prReviewNoProjectId', {
              defaultValue: 'GitLab project ID not resolved. Go back to Pull Requests and re-select the MR — the project ID is resolved on first load.'
            })
          );
          setLoading(false);
          return;
        }
        // Fetch MR detail + changes + notes + commits in parallel.
        // GitLab's API returns shapes that differ from GitHub's, so we
        // normalize each response to match the GitHub types the rest of
        // this component expects (GithubPullRequest / GithubPRFile /
        // GithubPRComment / GithubPRCommit). This lets us share the same
        // JSX between the two providers.
        const [mrDetail, mrFiles, mrNotes, mrCommits] = await Promise.all([
          api.gitlab.getMergeRequest(gitlabProjectId, pr.number),
          api.gitlab.listMRChanges(gitlabProjectId, pr.number),
          api.gitlab.listMRNotes(gitlabProjectId, pr.number),
          api.gitlab.listMRCommits(gitlabProjectId, pr.number),
        ]);
        // Map MR detail → GithubPullRequest shape.
        const normalizedPR: GithubPullRequest = {
          id: mrDetail.id,
          number: mrDetail.iid,
          title: mrDetail.title,
          state: mrDetail.state === 'opened' ? 'open' : (mrDetail.state === 'closed' ? 'closed' : 'closed'),
          html_url: mrDetail.web_url,
          user: {
            login: mrDetail.author.username,
            avatar_url: mrDetail.author.avatar_url ?? '',
          },
          head: { ref: mrDetail.source_branch, sha: '' },
          base: { ref: mrDetail.target_branch, sha: '' },
          created_at: mrDetail.created_at,
          updated_at: mrDetail.updated_at,
          body: mrDetail.body ?? mrDetail.description ?? '',
          merged_at: mrDetail.merged_at ?? null,
          draft: mrDetail.work_in_progress,
          mergeable: mrDetail.mergeable ?? null,
          additions: mrDetail.additions,
          deletions: mrDetail.deletions,
          changed_files: mrDetail.changed_files ?? mrFiles.length,
          commits: mrCommits.length,
          comments: mrNotes.filter((n) => !n.system).length,
          review_comments: 0,
        };
        setFullPR(normalizedPR);
        // Map MR files → GithubPRFile shape. GitLab returns `diff` (with
        // @@ hunk headers), GitHub returns `patch` — same format.
        const normalizedFiles: GithubPRFile[] = mrFiles.map((f: GitLabMRFile) => ({
          sha: '',
          filename: f.filename,
          status: f.status === 'removed' ? 'removed' : f.status === 'renamed' ? 'renamed' : f.status === 'added' ? 'added' : 'modified',
          additions: f.additions,
          deletions: f.deletions,
          changes: f.additions + f.deletions,
          patch: f.diff,
          blob_url: f.blob_url,
          raw_url: f.blob_url,
          contents_url: f.blob_url,
          previous_filename: f.renamed_file ? f.old_path : undefined,
        }));
        setFiles(normalizedFiles);
        // Map MR notes → GithubPRComment shape. Filter out system notes
        // (auto-generated status changes — the user doesn't want to see
        // "John changed the target branch" as a comment).
        const normalizedComments: GithubPRComment[] = mrNotes
          .filter((n: GitLabMRNote) => !n.system)
          .map((n: GitLabMRNote) => ({
            id: n.id,
            body: n.body,
            user: { login: n.user.login, avatar_url: n.user.avatar_url },
            created_at: n.created_at,
            updated_at: n.updated_at,
            html_url: undefined,
            author_association: 'NONE',
          }));
        setComments(normalizedComments);
        // Map MR commits → GithubPRCommit shape.
        const normalizedCommits: GithubPRCommit[] = mrCommits.map((c: GitLabMRCommit) => ({
          sha: c.sha,
          commit: {
            message: c.commit.message,
            author: c.commit.author,
          },
          html_url: c.web_url,
        }));
        setCommits(normalizedCommits);
        setSelectedFile((cur) => cur ?? normalizedFiles[0] ?? null);
      } else {
        // Unknown provider — no detail endpoints available.
        setFullPR(null);
        setFiles([]);
        setComments([]);
        setCommits([]);
      }
    } catch (e) {
      const msg = String(e);
      // 404 is the most common case — user manually picked the wrong
      // provider, or the repo is private and the token lacks access.
      // Translate it to a friendly message.
      if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
        setLoadError(
          t('pages.prReviewNotFound', {
            defaultValue: 'PR #{n} was not found on {provider}. Check that the provider chip in the header matches your repo, and that your token has access to {owner}/{repo}.',
            n: pr.number, provider, owner, repo,
          })
        );
      } else {
        setLoadError(msg);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr.number, owner, repo, provider, gitlabProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Normalize GithubPullRequest.user → SelectedPR.author so the rest of the
  // component reads one field.
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
    commits: fullPR.commits ?? commits.length,
    comments: fullPR.comments ?? 0,
    reviewComments: fullPR.review_comments ?? 0,
  } : null;

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: t('pages.prTabOverview', { defaultValue: 'Overview' }) },
    { id: 'commits', label: t('pages.prTabCommits', { defaultValue: 'Commits' }), count: commits.length },
    { id: 'files', label: t('pages.prTabFiles', { defaultValue: 'Files' }), count: files.length },
    { id: 'discussion', label: t('pages.prTabDiscussion', { defaultValue: 'Discussion' }), count: comments.length },
  ];

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
            {stats && (
              <>
                <span className="ml-2 text-status-added">+{stats.additions}</span>
                <span className="text-status-deleted">-{stats.deletions}</span>
              </>
            )}
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
      {displayPR.state === 'open' && !loadError && (
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
              <span className="flex items-center gap-1">
                <GitCommit size={10} />
                {stats.commits} {t('pages.prCommits', { defaultValue: 'commits' })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      {!loadError && (
        <div className="flex items-center border-b border-border-subtle bg-bg-secondary">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={cn(
                'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5',
                activeTab === tab.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className={cn(
                  'text-3xs px-1 rounded',
                  activeTab === tab.id ? 'bg-accent text-text-inverse' : 'bg-bg-tertiary text-text-tertiary'
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full text-text-tertiary text-sm gap-2">
            <Loader size={14} className="animate-spin" />
            {t('common.loading')}
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center h-full text-text-tertiary p-8 gap-3">
            <AlertCircle size={32} className="text-status-deleted opacity-60" />
            <div className="text-sm text-text-primary font-medium max-w-md text-center">
              {t('pages.prReviewLoadFailed', { defaultValue: 'Failed to load PR review' })}
            </div>
            <div className="text-xs max-w-lg text-center whitespace-pre-wrap">{loadError}</div>
            <div className="text-2xs text-text-tertiary font-mono mt-2 px-3 py-1 bg-bg-tertiary rounded">
              {provider} / {owner}/{repo} / #{pr.number}
            </div>
            <button
              className="btn btn-secondary text-xs mt-2 flex items-center gap-1"
              onClick={() => void load()}
            >
              <RefreshCw size={11} />
              {t('common.retry', { defaultValue: 'Retry' })}
            </button>
          </div>
        ) : activeTab === 'overview' ? (
          <div className="overflow-y-auto h-full">
            {displayPR.body ? (
              <div className="px-4 py-3">
                <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold mb-2">
                  {t('pages.prDescription', { defaultValue: 'Description' })}
                </div>
                <MarkdownRenderer text={displayPR.body} />
              </div>
            ) : (
              <div className="px-4 py-3 text-text-tertiary text-xs italic">
                {t('pages.prNoDescription', { defaultValue: 'No description provided.' })}
              </div>
            )}
            {/* Meta summary */}
            {stats && (
              <div className="px-4 py-3 border-t border-border-subtle">
                <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold mb-2">
                  {t('pages.prMeta', { defaultValue: 'Summary' })}
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="bg-bg-tertiary p-2 rounded">
                    <div className="text-2xs text-text-tertiary uppercase">{t('pages.prFiles', { defaultValue: 'files' })}</div>
                    <div className="text-sm font-medium">{stats.changedFiles}</div>
                  </div>
                  <div className="bg-bg-tertiary p-2 rounded">
                    <div className="text-2xs text-text-tertiary uppercase">{t('pages.prCommits', { defaultValue: 'commits' })}</div>
                    <div className="text-sm font-medium">{stats.commits}</div>
                  </div>
                  <div className="bg-bg-tertiary p-2 rounded">
                    <div className="text-2xs text-text-tertiary uppercase">{t('pages.prComments', { defaultValue: 'comments' })}</div>
                    <div className="text-sm font-medium">{stats.comments + stats.reviewComments}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : activeTab === 'commits' ? (
          <div className="overflow-y-auto h-full">
            {commits.length === 0 ? (
              <div className="p-8 text-center text-text-tertiary text-xs italic">
                {t('pages.prNoCommits', { defaultValue: 'No commits found.' })}
              </div>
            ) : (
              commits.map((c) => (
                <div
                  key={c.sha}
                  className="px-4 py-2 border-b border-border-subtle hover:bg-bg-hover cursor-pointer flex items-start gap-2"
                  onClick={() => api.app.openExternal(c.html_url)}
                  title={t('common.openExternal', { defaultValue: 'Open commit in browser' })}
                >
                  <GitCommit size={12} className="mt-0.5 text-text-tertiary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-text-primary whitespace-pre-wrap break-words">
                      {c.commit.message.split('\n')[0]}
                    </div>
                    {c.commit.message.includes('\n') && (
                      <div className="text-2xs text-text-tertiary mt-0.5 whitespace-pre-wrap break-words opacity-70">
                        {c.commit.message.split('\n').slice(1).join('\n').trim()}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1 text-2xs text-text-tertiary">
                      {c.author && (
                        <>
                          <Avatar name={c.author.login} email={undefined} size={10} avatarUrl={c.author.avatar_url} />
                          <span className="text-text-secondary">{c.author.login}</span>
                          <span>·</span>
                        </>
                      )}
                      <span>{formatDate(c.commit.author.date)}</span>
                      <span>·</span>
                      <code className="mono text-text-tertiary">{shortHash(c.sha)}</code>
                    </div>
                  </div>
                  <ExternalLink size={10} className="text-text-tertiary opacity-0 group-hover:opacity-100 mt-1" />
                </div>
              ))
            )}
          </div>
        ) : activeTab === 'files' ? (
          <div className="flex h-full">
            {/* Files list */}
            <div className="w-1/3 border-r border-border-subtle overflow-y-auto flex-shrink-0">
              <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold px-3 py-1.5 border-b border-border-subtle bg-bg-tertiary sticky top-0">
                {t('pages.prChangedFiles', { defaultValue: 'Changed files' })} ({files.length})
              </div>
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
            {/* Diff view */}
            <div className="flex-1 overflow-y-auto bg-bg-secondary">
              {selectedFile?.patch ? (
                <>
                  <div className="px-3 py-1.5 text-xs font-mono text-text-tertiary border-b border-border-subtle sticky top-0 bg-bg-secondary flex items-center justify-between">
                    <span className="truncate">{selectedFile.filename}</span>
                    <span className="flex items-center gap-2 text-2xs">
                      <span className="text-status-added">+{selectedFile.additions}</span>
                      <span className="text-status-deleted">-{selectedFile.deletions}</span>
                    </span>
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
                </>
              ) : selectedFile ? (
                <div className="p-4 text-center text-text-tertiary text-xs italic">
                  {t('pages.prDiffTooBig', { defaultValue: 'Diff for this file is too large to display inline. Open it on GitHub.' })}
                  <div className="mt-2">
                    <button
                      className="text-accent hover:underline text-xs"
                      onClick={() => api.app.openExternal(selectedFile.blob_url)}
                    >
                      {t('pages.prOpenFileExternal', { defaultValue: 'Open on GitHub' })}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 text-center text-text-tertiary text-xs italic">
                  {t('pages.prSelectFile', { defaultValue: 'Select a file to view its diff' })}
                </div>
              )}
            </div>
          </div>
        ) : (
          // discussion tab
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto">
              {comments.length === 0 ? (
                <div className="p-8 text-center text-text-tertiary text-xs italic">
                  {t('pages.prNoComments', { defaultValue: 'No comments yet.' })}
                </div>
              ) : (
                <div className="px-4 py-3 space-y-2">
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
            {provider === 'github' && (
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
        )}
      </div>
    </div>
  );
}
