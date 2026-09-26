/**
 * SquashToBranchDialog — History tool: send a selected group of commits to
 * ANOTHER branch as ONE squashed commit.
 *
 * Triggered from the History list multi-selection (Shift+click range /
 * Ctrl+click toggle → context menu or the "N selected" action bar).
 *
 * Target:
 *  - an EXISTING local branch, or
 *  - a NEW branch (forked at the range base — conflict-free — or at any
 *    other ref the user picks).
 *
 * Conflict handling (the user's explicit requirement): a READ-ONLY dry-run
 * runs first. When it finds conflicts, NOTHING has been touched yet — the
 * dialog switches to a warning step listing the conflicted files and asking
 * whether to proceed (checkout the target + apply, then resolve in Changes
 * with the standard cherry-pick flow: Continue / Skip / Abort).
 */
import { useState, useEffect, useCallback } from 'react';
import { X, GitBranch, AlertTriangle, Loader, Check, User } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastActions } from '../stores/toastStore';
import { api, type LogEntry, type BranchInfo, type SquashToBranchResult } from '../lib/api';
import { cn, shortHash } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface SquashToBranchDialogProps {
  /** Selected commits, ordered OLDEST → NEWEST. */
  commits: LogEntry[];
  onClose: () => void;
  /** Called after the repo state changed (squash landed / conflicts left). */
  onChanged: () => void;
}

export function SquashToBranchDialog({ commits, onClose, onChanged }: SquashToBranchDialogProps) {
  useEscapeKey(true, onClose);
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastActions();
  const { t } = useI18n();

  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // ── Form state ──
  const oldest = commits[0];
  const newest = commits[commits.length - 1];
  const [message, setMessage] = useState(() => (
    commits.length > 0
      ? `${oldest.subject}\n\n${commits.map((c) => `* ${c.subject}`).join('\n')}`
      : ''
  ));
  const [targetKind, setTargetKind] = useState<'existing' | 'new'>('new');
  const [targetBranch, setTargetBranch] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchBase, setNewBranchBase] = useState('range-base');
  const [keepAuthor, setKeepAuthor] = useState(true);
  const [switchToTarget, setSwitchToTarget] = useState(true);

  // ── Conflict-confirmation step (dry-run result, repo still untouched) ──
  const [conflictPreview, setConflictPreview] = useState<{ branch: string; conflicts: string[] } | null>(null);

  const currentBranch = useGitStore((s) => s.status?.current ?? null);
  const localBranches = branches.filter((b) => !b.remote && b.name !== currentBranch);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.git.branches(repo.path);
        if (!cancelled) setBranches(list);
      } catch {
        /* dropdown stays empty — validation error will surface on submit */
      } finally {
        if (!cancelled) setBranchesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [repo.path]);

  // Default the existing-branch dropdown to the first candidate once loaded.
  useEffect(() => {
    if (targetKind === 'existing' && !targetBranch && localBranches.length > 0) {
      setTargetBranch(localBranches[0].name);
    }
  }, [targetKind, targetBranch, localBranches]);

  const validate = (): string | null => {
    if (!message.trim()) return t('dialogs.squashToBranch.errMessage');
    if (targetKind === 'existing' && !targetBranch) return t('dialogs.squashToBranch.errBranch');
    if (targetKind === 'new') {
      if (!newBranchName.trim()) return t('dialogs.squashToBranch.errName');
      if (!/^[^-/]/.test(newBranchName.trim())) return t('dialogs.squashToBranch.errName');
    }
    return null;
  };

  const run = useCallback(async (proceedOnConflict: boolean) => {
    const validationError = validate();
    if (validationError) { toast.error(t('dialogs.squashToBranch.title'), validationError); return; }
    setBusy(true);
    try {
      const result: SquashToBranchResult = await api.git.squashToBranch(repo.path, {
        commits: commits.map((c) => c.hash),
        target: targetKind === 'existing'
          ? { kind: 'existing', branch: targetBranch }
          : { kind: 'new', name: newBranchName.trim(), base: newBranchBase },
        message: message.trim(),
        keepAuthor,
        // Explicit user choice — the service only defaults when undefined.
        switchToTarget,
        proceedOnConflict,
      });
      switch (result.status) {
        case 'ok': {
          // Invalidate the (now stale) multi-selection + refresh everything.
          toast.success(
            t('toast.squashToBranch.done', { branch: result.branch }),
            result.switchedTo
              ? t('toast.squashToBranch.switched', { branch: result.switchedTo })
              : `${shortHash(result.commit)} · ${oldest.subject}`,
          );
          if (result.switchWarning) toast.warning(t('toast.squashToBranch.switchFailed'), result.switchWarning);
          onChanged();
          void refreshStatus(repo.path);
          onClose();
          break;
        }
        case 'conflicts-preview': {
          // Read-only outcome — ask the user before touching anything.
          setConflictPreview({ branch: result.branch, conflicts: result.conflicts });
          break;
        }
        case 'conflicts': {
          // Live route ran: conflicts are in the worktree on the target
          // branch; the standard cherry-pick resolve flow takes over.
          toast.warning(
            t('toast.squashToBranch.conflicts', { count: result.conflicts.length, branch: result.branch }),
            t('toast.squashToBranch.conflictsDetail'),
          );
          onChanged();
          void refreshStatus(repo.path);
          onClose();
          break;
        }
        case 'empty': {
          toast.info(t('toast.squashToBranch.empty', { branch: result.branch }));
          onChanged();
          onClose();
          break;
        }
      }
    } catch (e) {
      // Validation refusals (non-contiguous range, current branch, dirty
      // worktree, mid-operation…) — show as an error toast, keep the dialog
      // open so the user can fix the selection/inputs.
      toast.error(t('toast.squashToBranch.failed'), String(e));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.path, commits, targetKind, targetBranch, newBranchName, newBranchBase, message, keepAuthor, switchToTarget, toast, t, onChanged, onClose, refreshStatus, oldest?.subject]);

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="panel w-[620px] max-h-[85vh] flex flex-col shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 className="text-base font-medium flex items-center gap-2">
            <GitBranch size={16} />
            {t('dialogs.squashToBranch.title')}
          </h3>
          <button className="icon-btn" onClick={onClose} disabled={busy}>
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3 flex-1 min-h-0">
          {/* ── Range summary ── */}
          <div className="text-xs text-text-tertiary mb-3 flex items-center gap-2 flex-wrap">
            <span className="px-1.5 py-0.5 rounded bg-bg-tertiary border border-border-subtle font-medium text-text-secondary">
              {t('dialogs.squashToBranch.nCommits', { count: commits.length })}
            </span>
            <span className="font-mono">{shortHash(oldest.hash)}</span>
            <span>…</span>
            <span className="font-mono">{shortHash(newest.hash)}</span>
            <span className="flex items-center gap-1">
              {keepAuthor && <User size={12} />}
              {t('dialogs.squashToBranch.author', { name: oldest.author.name })}
            </span>
          </div>

          {conflictPreview ? (
            /* ── Conflict confirmation step (repo untouched so far) ── */
            <div>
              <div className="flex items-start gap-2 p-3 rounded border border-status-modified/40 bg-status-modified/10 text-sm">
                <AlertTriangle size={16} className="text-status-modified shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-text-primary">
                    {t('dialogs.squashToBranch.conflictTitle', { count: conflictPreview.conflicts.length, branch: conflictPreview.branch })}
                  </div>
                  <div className="text-xs text-text-secondary mt-1">
                    {t('dialogs.squashToBranch.conflictBody')}
                  </div>
                </div>
              </div>
              <ul className="mt-2 max-h-32 overflow-y-auto text-xs font-mono text-text-secondary border border-border-subtle rounded divide-y divide-border-subtle">
                {conflictPreview.conflicts.map((f) => (
                  <li key={f} className="px-2 py-1 truncate" title={f}>{f}</li>
                ))}
              </ul>
            </div>
          ) : (
            /* ── Form ── */
            <>
              {/* Commit message */}
              <label className="block text-xs font-medium text-text-secondary mb-1">
                {t('dialogs.squashToBranch.messageLabel')}
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                className="w-full text-xs font-mono px-2 py-1.5 bg-bg-tertiary border border-border-default rounded resize-y focus:outline-none focus:border-accent"
                placeholder={t('dialogs.squashToBranch.messagePlaceholder')}
                disabled={busy}
              />

              {/* Target: existing / new */}
              <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="radio"
                    checked={targetKind === 'new'}
                    onChange={() => { setTargetKind('new'); setSwitchToTarget(true); }}
                    disabled={busy}
                  />
                  {t('dialogs.squashToBranch.newBranch')}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder={t('dialogs.squashToBranch.namePlaceholder')}
                    className="flex-1 text-xs px-2 py-1 bg-bg-tertiary border border-border-default rounded font-mono focus:outline-none focus:border-accent"
                    disabled={busy || targetKind !== 'new'}
                  />
                  <select
                    value={newBranchBase}
                    onChange={(e) => setNewBranchBase(e.target.value)}
                    className="text-xs px-1.5 py-1 bg-bg-tertiary border border-border-default rounded min-w-0 flex-1"
                    disabled={busy || targetKind !== 'new'}
                    title={t('dialogs.squashToBranch.baseTitle')}
                  >
                    <option value="range-base">{t('dialogs.squashToBranch.baseRange')}</option>
                    {localBranches.map((b) => (
                      <option key={b.name} value={b.name}>
                        {t('dialogs.squashToBranch.baseBranch', { name: b.name })}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="radio"
                    checked={targetKind === 'existing'}
                    onChange={() => { setTargetKind('existing'); setSwitchToTarget(false); }}
                    disabled={busy}
                  />
                  {t('dialogs.squashToBranch.existingBranch')}
                </label>
                <select
                  value={targetBranch}
                  onChange={(e) => setTargetBranch(e.target.value)}
                  className="text-xs px-2 py-1 bg-bg-tertiary border border-border-default rounded w-full"
                  disabled={busy || targetKind !== 'existing' || branchesLoading}
                >
                  {branchesLoading && <option value="">{t('common.loadingEllipsis')}</option>}
                  {!branchesLoading && localBranches.length === 0 && (
                    <option value="">{t('dialogs.squashToBranch.noBranches')}</option>
                  )}
                  {localBranches.map((b) => (
                    <option key={b.name} value={b.name}>{b.name}</option>
                  ))}
                </select>
              </div>

              {/* Options */}
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-text-secondary">
                <label className="flex items-center gap-1.5 cursor-pointer" title={t('dialogs.squashToBranch.keepAuthorTitle')}>
                  <input
                    type="checkbox"
                    checked={keepAuthor}
                    onChange={(e) => setKeepAuthor(e.target.checked)}
                    disabled={busy}
                  />
                  {t('dialogs.squashToBranch.keepAuthor')}
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer" title={t('dialogs.squashToBranch.switchTitle')}>
                  <input
                    type="checkbox"
                    checked={switchToTarget}
                    onChange={(e) => setSwitchToTarget(e.target.checked)}
                    disabled={busy}
                  />
                  {t('dialogs.squashToBranch.switchAfter')}
                </label>
              </div>

              <p className="mt-3 text-2xs text-text-tertiary leading-relaxed">
                {t('dialogs.squashToBranch.hint')}
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default flex-wrap">
          {conflictPreview && (
            <button
              className="btn btn-secondary text-xs"
              onClick={() => setConflictPreview(null)}
              disabled={busy}
            >
              {t('common.cancel')}
            </button>
          )}
          {conflictPreview ? (
            <button
              className="btn btn-primary text-xs"
              onClick={() => void run(true)}
              disabled={busy}
            >
              {busy ? <Loader size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
              {t('dialogs.squashToBranch.proceedConflicts', { count: conflictPreview.conflicts.length })}
            </button>
          ) : (
            <button
              className={cn('btn btn-primary text-xs')}
              onClick={() => void run(false)}
              disabled={busy || commits.length < 2}
              title={commits.length < 2 ? t('dialogs.squashToBranch.needTwo') : undefined}
            >
              {busy ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
              {t('dialogs.squashToBranch.squashAction', { count: commits.length })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
