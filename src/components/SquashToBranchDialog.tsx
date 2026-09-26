/**
 * SquashToBranchDialog — «отправить группу коммитов в другую ветку одним
 * коммитом» (History multi-select → squash-transfer).
 *
 * Opened from the History page selection bar or the commit context menu
 * after the user multi-selects commits (Ctrl+click / Shift+click). The
 * backend (gitService.squashToBranch) cherry-picks the group onto the target
 * branch with --no-commit, creates ONE commit with the message edited here,
 * and checks the original branch back out.
 *
 * The message is prefilled GitHub-squash-style: the subjects of all selected
 * commits, oldest first — the user edits before sending.
 */
import { useEffect, useState } from 'react';
import { GitBranch, Layers, Loader, X } from './icons';
import { useI18n } from '../lib/i18n';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { cn, shortHash } from '../lib/utils';

interface SquashToBranchDialogProps {
  open: boolean;
  /** Local branch names to offer as targets (current branch excluded by the parent). */
  branches: string[];
  /** Currently checked-out branch — selecting it again is an error. */
  currentBranch: string;
  /** The selected commit group, OLDEST first (as it will be applied). */
  commits: { hash: string; subject: string }[];
  busy: boolean;
  onSubmit: (branch: string, message: string) => void;
  onClose: () => void;
}

export function SquashToBranchDialog({
  open,
  branches,
  currentBranch,
  commits,
  busy,
  onSubmit,
  onClose,
}: SquashToBranchDialogProps) {
  useEscapeKey(open && !busy, onClose);
  const { t } = useI18n();
  const [branch, setBranch] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (open) {
      setBranch(branches.find(b => b !== currentBranch) ?? '');
      // GitHub-style squash prefill: subjects of the selected commits.
      setMessage(commits.map(c => c.subject).join('\n\n'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const sameBranch = !!branch && branch === currentBranch;
  const canSubmit = !!branch && !sameBranch && message.trim() !== '' && !busy;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        className="panel w-[560px] max-h-[80vh] flex flex-col shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 className="text-base font-medium flex items-center gap-2">
            <Layers size={16} />
            {t('history.squashToTitle')}
          </h3>
          <button className="icon-btn" onClick={() => { if (!busy) onClose(); }}>
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* The commit group being transferred, oldest first. */}
          <div>
            <div className="text-2xs font-medium text-text-secondary mb-1">
              {t('history.squashToCommits', { count: commits.length })}
            </div>
            <div className="border border-border-default rounded max-h-36 overflow-y-auto bg-bg-secondary">
              {commits.map(c => (
                <div key={c.hash} className="flex items-center gap-2 px-2 py-1 border-b border-border-subtle last:border-b-0">
                  <code className="mono text-2xs text-accent shrink-0">{shortHash(c.hash)}</code>
                  <span className="text-xs text-text-primary truncate">{c.subject}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Target branch */}
          <label className="block">
            <span className="text-2xs font-medium text-text-secondary mb-1 block">{t('history.squashToTarget')}</span>
            <div className="relative">
              <GitBranch size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
              <select
                className="w-full text-sm bg-bg-primary border border-border-default rounded pl-7 pr-2 py-1.5 appearance-none"
                value={branch}
                disabled={busy}
                onChange={(e) => setBranch(e.target.value)}
              >
                {branches.length === 0 && <option value="">{t('history.squashToNoBranches')}</option>}
                {branches.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            {sameBranch && (
              <span className="text-2xs text-status-deleted mt-1 block">
                {t('history.squashToSameBranch', { branch })}
              </span>
            )}
          </label>

          {/* Commit message for the squashed commit */}
          <label className="block">
            <span className="text-2xs font-medium text-text-secondary mb-1 block">{t('history.squashToMessage')}</span>
            <textarea
              className="w-full text-xs mono bg-bg-primary border border-border-default rounded px-2 py-1.5 resize-y"
              rows={Math.min(8, Math.max(3, message.split('\n').length + 1))}
              value={message}
              disabled={busy}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('history.squashToMessage')}
            />
          </label>

          <p className="text-2xs text-text-tertiary leading-relaxed">
            {t('history.squashToWarning')}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default bg-bg-secondary flex-wrap">
          <button className="btn" disabled={busy} onClick={onClose}>
            {t('action.button.cancel')}
          </button>
          <button
            className={cn('btn btn-primary flex items-center gap-1.5')}
            disabled={!canSubmit}
            onClick={() => onSubmit(branch, message)}
          >
            {busy && <Loader size={12} className="spin" />}
            <GitBranch size={12} />
            {t('history.squashToAction')}
          </button>
        </div>
      </div>
    </div>
  );
}
