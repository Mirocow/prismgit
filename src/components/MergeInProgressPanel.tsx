import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Check, Loader, RotateCcw, GitMerge, X } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { api } from '../lib/api';
import { confirmDialog } from './ConfirmDialog';
import { useI18n } from '../lib/i18n';

interface MergeInProgressPanelProps {
  repoPath: string;
  /** Called when the merge state clears (panel can be hidden by parent). */
  onClose?: () => void;
}

/**
 * Floating panel shown while a merge is in progress (MERGE_HEAD exists).
 * Mirrors SequencerPanel UX: Continue (after staging resolved files),
 * Abort, and a clickable list of conflicted files.
 *
 * Unlike MergePanel (which is the START dialog with targetBranch picker),
 * this panel handles the IN-PROGRESS state — what to do when conflicts
 * happened mid-merge or when the user just needs to commit the merge.
 */
export function MergeInProgressPanel({ repoPath, onClose }: MergeInProgressPanelProps) {
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastActions();
  const { t } = useI18n();
  const [conflicted, setConflicted] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      const s = await api.git.status(repoPath);
      setConflicted(s.conflicted);
    } catch {
      setConflicted([]);
    }
  }, [repoPath]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const handleContinue = async () => {
    setBusy('continue');
    try {
      await api.git.continueMerge(repoPath);
      toast.success(t('toast.merge.committed'));
      await refreshStatus(repoPath);
      onClose?.();
    } catch (e) {
      toast.error(t('toast.merge.continueFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleAbort = async () => {
    if (!(await confirmDialog({
      title: t('changes.abortMergeDialogTitle'),
      message: t('changes.abortMergeDialogMessage'),
      confirmLabel: t('changes.abortButtonLabel'),
      danger: true,
    }))) return;
    setBusy('abort');
    try {
      await api.git.abortMerge(repoPath);
      toast.info(t('toast.merge.aborted'));
      await refreshStatus(repoPath);
      onClose?.();
    } catch (e) {
      toast.error(t('toast.merge.abortFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-bg-elevated border-t border-status-modified/50 shadow-lg z-40 animate-slide-up">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <GitMerge size={16} className="text-status-modified flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">
            {t('changes.mergeInProgressTitle')} —{' '}
            {conflicted.length > 0
              ? t('changes.nConflictedFilesInline', { count: conflicted.length })
              : t('changes.mergeInProgressReady')}
          </div>
          <div className="text-2xs text-text-tertiary mt-0.5">
            {t('changes.mergeInProgressHint')}
          </div>
          {conflicted.length > 0 && (
            <div className="text-2xs text-text-tertiary mt-0.5 flex flex-wrap gap-1">
              {conflicted.map((f) => (
                <div key={f} className="flex items-center gap-0.5 bg-bg-tertiary rounded px-1 py-0.5 group/conflict">
                  <span
                    className="mono cursor-pointer hover:text-accent truncate"
                    style={{ maxWidth: 200 }}
                    title={t('changes.selectFileHint')}
                    onClick={() => {
                      useSelectionStore.getState().selectFile(f);
                      window.location.hash = '#/changes';
                    }}
                  >
                    {f}
                  </span>
                  {/* Per-file inline resolution — Take ours / Take theirs / Solver.
                      SmartGit/GitKraken pattern: no need to open the full solver
                      for trivial conflicts. */}
                  <button
                    className="text-2xs px-1 rounded border border-status-added/30 bg-status-added/10 text-status-added hover:bg-status-added/20 transition-colors"
                    title="Take ours (git checkout --ours)"
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await api.git.raw(repoPath, ['checkout', '--ours', '--', f]);
                        await api.git.add(repoPath, [f]);
                        toast.success(t('changes.takeOursToast', { file: f }));
                        await refreshStatus(repoPath);
                        loadState();
                      } catch (err) { toast.error(t('toast.merge.takeOursFailed'), String(err)); }
                    }}
                  >
                    O
                  </button>
                  <button
                    className="text-2xs px-1 rounded border border-status-modified/30 bg-status-modified/10 text-status-modified hover:bg-status-modified/20 transition-colors"
                    title="Take theirs (git checkout --theirs)"
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await api.git.raw(repoPath, ['checkout', '--theirs', '--', f]);
                        await api.git.add(repoPath, [f]);
                        toast.success(t('changes.takeTheirsToast', { file: f }));
                        await refreshStatus(repoPath);
                        loadState();
                      } catch (err) { toast.error(t('toast.merge.takeTheirsFailed'), String(err)); }
                    }}
                  >
                    T
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            className="btn btn-primary text-xs"
            onClick={handleContinue}
            disabled={busy !== null || conflicted.length > 0}
            title={conflicted.length > 0 ? t('changes.stageResolvedFirst') : t('changes.gitCommitNoEditHint')}
          >
            {busy === 'continue' ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
            {t('changes.continueButtonLabel')}
          </button>
          <button
            className="btn btn-secondary text-xs hover:!text-status-deleted"
            onClick={handleAbort}
            disabled={busy !== null}
            title={t('changes.gitMergeAbortHint')}
          >
            {busy === 'abort' ? <Loader size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            {t('changes.abortButtonLabel')}
          </button>
        </div>
      </div>
    </div>
  );
}
