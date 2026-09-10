import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Check, X, Loader, RotateCcw, ChevronRight } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useSelectionStore } from '../stores/selectionStore';
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

  const handleSkip = async () => {
    setBusy('skip');
    try {
      if (kind === 'cherry-pick') await api.git.cherryPickSkip(repoPath);
      else await api.git.revertSkip(repoPath);
      toast.info(`${label} skipped`, 'The current commit was skipped; the sequence continues with the next one.');
      await refreshStatus(repoPath);
      onClose?.();
    } catch (e) {
      toast.error('Skip failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  // Commit Empty — only for cherry-pick. When the pick is empty (changes
  // already applied), `git cherry-pick --continue` refuses. The user can
  // either Skip (drop) or Commit Empty (commit it anyway via --allow-empty).
  // This folds the CherryPickStateBanner action into SequencerPanel so there
  // is ONE banner during cherry-pick (deduplication).
  const handleCommitEmpty = async () => {
    if (kind !== 'cherry-pick') return;
    setBusy('commit-empty');
    try {
      await api.git.cherryPickContinue(repoPath, true);
      toast.success('Empty commit created', 'Cherry-pick finished.');
      await refreshStatus(repoPath);
      onClose?.();
    } catch (e) {
      toast.error('Commit Empty failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const label = kind === 'cherry-pick' ? 'Cherry-pick' : 'Revert';

  // The sequencer may be in one of two states:
  //  1. Stopped on conflicts → user must resolve files (Continue disabled).
  //  2. Stopped on an empty commit (changes already applied) → user should
  //     Skip or Abort; Continue would fail with "nothing to commit".
  // We surface both in the banner so the user knows what to do.
  const isEmptyCommit = conflicted.length === 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-bg-elevated border-t border-status-modified/50 shadow-lg z-40 animate-slide-up">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <AlertCircle size={16} className="text-status-modified flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">
            {label} in progress —{' '}
            {conflicted.length > 0
              ? `${conflicted.length} conflicted file${conflicted.length > 1 ? 's' : ''}`
              : isEmptyCommit
                ? 'empty commit — Skip to drop it, or Abort'
                : 'waiting to continue'}
          </div>
          <div className="text-2xs text-text-tertiary mt-0.5">
            Working tree is in {label.toLowerCase()} state — other branch operations are blocked until you Continue, Skip, or Abort.
          </div>
          {conflicted.length > 0 && (
            <div className="text-2xs text-text-tertiary mt-0.5 flex flex-wrap gap-1">
              {conflicted.map((f) => (
                <span
                  key={f}
                  className="mono px-1.5 py-0.5 bg-bg-tertiary rounded cursor-pointer hover:text-accent"
                  title="Select this file — opens it in Changes / Conflict Solver"
                  onClick={() => {
                    // Cross-tool: conflicted file becomes the global selection
                    // and opens in Changes where it can be resolved.
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
            disabled={busy !== null || conflicted.length > 0 || isEmptyCommit}
            title={conflicted.length > 0 ? 'Stage resolved files first' : isEmptyCommit ? 'Empty commit — use Skip or Commit Empty' : `git ${kind === 'cherry-pick' ? 'cherry-pick' : 'revert'} --continue`}
          >
            {busy === 'continue' ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
            Continue
          </button>
          {/* Commit Empty — only for cherry-pick, only when the pick is empty.
              Folds the CherryPickStateBanner action into this panel (dedup). */}
          {kind === 'cherry-pick' && isEmptyCommit && (
            <button
              className="btn btn-secondary text-xs"
              onClick={handleCommitEmpty}
              disabled={busy !== null}
              title="git commit --allow-empty — commit the empty pick anyway"
            >
              {busy === 'commit-empty' ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
              Commit Empty
            </button>
          )}
          <button
            className="btn btn-secondary text-xs"
            onClick={handleSkip}
            disabled={busy !== null}
            title={`git ${kind === 'cherry-pick' ? 'cherry-pick' : 'revert'} --skip — drop this commit and move on`}
          >
            {busy === 'skip' ? <Loader size={12} className="animate-spin" /> : <ChevronRight size={12} />}
            Skip
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
