import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Check, Loader, RotateCcw, GitMerge, X } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useToastStore } from '../stores/toastStore';
import { api } from '../lib/api';
import { confirmDialog } from './ConfirmDialog';

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
  const toast = useToastStore();
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
      toast.success('Merge committed');
      await refreshStatus(repoPath);
      onClose?.();
    } catch (e) {
      toast.error('Continue failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleAbort = async () => {
    if (!(await confirmDialog({
      title: 'Abort merge?',
      message: 'The repository returns to its state before the merge started. All staged merge changes are discarded.',
      confirmLabel: 'Abort',
      danger: true,
    }))) return;
    setBusy('abort');
    try {
      await api.git.abortMerge(repoPath);
      toast.info('Merge aborted');
      await refreshStatus(repoPath);
      onClose?.();
    } catch (e) {
      toast.error('Abort failed', String(e));
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
            Merge in progress —{' '}
            {conflicted.length > 0
              ? `${conflicted.length} conflicted file${conflicted.length > 1 ? 's' : ''}`
              : 'ready to commit'}
          </div>
          <div className="text-2xs text-text-tertiary mt-0.5">
            Working tree is in merging state — other branch operations are blocked until you Continue or Abort.
          </div>
          {conflicted.length > 0 && (
            <div className="text-2xs text-text-tertiary mt-0.5 flex flex-wrap gap-1">
              {conflicted.map((f) => (
                <span
                  key={f}
                  className="mono px-1.5 py-0.5 bg-bg-tertiary rounded cursor-pointer hover:text-accent"
                  title="Select this file — opens it in Changes / Conflict Solver"
                  onClick={() => {
                    useSelectionStore.getState().selectFile(f);
                    window.location.hash = '#/changes';
                  }}
                >
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            className="btn btn-primary text-xs"
            onClick={handleContinue}
            disabled={busy !== null || conflicted.length > 0}
            title={conflicted.length > 0 ? 'Stage resolved files first' : 'git commit --no-edit'}
          >
            {busy === 'continue' ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
            Continue
          </button>
          <button
            className="btn btn-secondary text-xs hover:!text-status-deleted"
            onClick={handleAbort}
            disabled={busy !== null}
            title="git merge --abort"
          >
            {busy === 'abort' ? <Loader size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            Abort
          </button>
        </div>
      </div>
    </div>
  );
}
