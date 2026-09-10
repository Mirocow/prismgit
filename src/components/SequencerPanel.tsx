import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Check, X, Loader, RotateCcw } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api } from '../lib/api';
import { confirmDialog, promptDialog } from './ConfirmDialog';

interface SequencerPanelProps {
  kind: 'cherry-pick' | 'revert';
  repoPath: string;
  /** Called when the sequencer state clears (panel can be hidden by parent). */
  onClose?: () => void;
}

/**
 * Floating panel shown while a cherry-pick or revert sequence is in progress
 * (e.g. stopped on conflicts). Offers Continue (after staging resolved files)
 * and Abort actions — mirrors the RebasePanel UX for the other sequencer.
 */
export function SequencerPanel({ kind, repoPath, onClose }: SequencerPanelProps) {
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
      if (kind === 'cherry-pick') await api.git.cherryPickContinue(repoPath);
      else await api.git.revertContinue(repoPath);
      toast.success(`${kind === 'cherry-pick' ? 'Cherry-pick' : 'Revert'} continued`);
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
      title: `Abort ${kind}`,
      message: `The repository returns to its state before the ${kind} started.`,
      confirmLabel: 'Abort',
      danger: true,
    }))) return;
    setBusy('abort');
    try {
      if (kind === 'cherry-pick') await api.git.cherryPickAbort(repoPath);
      else await api.git.revertAbort(repoPath);
      toast.info(`${kind === 'cherry-pick' ? 'Cherry-pick' : 'Revert'} aborted`);
      await refreshStatus(repoPath);
      onClose?.();
    } catch (e) {
      toast.error('Abort failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const label = kind === 'cherry-pick' ? 'Cherry-pick' : 'Revert';

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-bg-elevated border-t border-border-strong shadow-lg z-40 animate-slide-up">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <AlertCircle size={16} className="text-status-modified flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">
            {label} in progress — {conflicted.length > 0 ? `${conflicted.length} conflicted file${conflicted.length > 1 ? 's' : ''}` : 'waiting to continue'}
          </div>
          {conflicted.length > 0 && (
            <div className="text-2xs text-text-tertiary truncate mt-0.5">
              Resolve conflicts (stage the files), then Continue: {conflicted.slice(0, 5).join(', ')}
              {conflicted.length > 5 && ` +${conflicted.length - 5} more`}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            className="btn btn-primary text-xs"
            onClick={handleContinue}
            disabled={busy !== null || conflicted.length > 0}
            title={conflicted.length > 0 ? 'Stage resolved files first' : `git ${kind === 'cherry-pick' ? 'cherry-pick' : 'revert'} --continue`}
          >
            {busy === 'continue' ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
            Continue
          </button>
          <button
            className="btn btn-secondary text-xs hover:!text-status-deleted"
            onClick={handleAbort}
            disabled={busy !== null}
            title={`git ${kind === 'cherry-pick' ? 'cherry-pick' : 'revert'} --abort`}
          >
            {busy === 'abort' ? <Loader size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            Abort
          </button>
        </div>
      </div>
    </div>
  );
}
