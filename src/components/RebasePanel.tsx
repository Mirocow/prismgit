import { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, AlertCircle, Check, SkipForward, RotateCcw, Loader } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api } from '../lib/api';

interface RebaseState {
  inProgress: boolean;
  currentCommit?: string;
  totalCommits?: number;
  conflictedFiles: string[];
}

export function RebasePanel({ onClose }: { onClose: () => void }) {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const [state, setState] = useState<RebaseState>({ inProgress: false, conflictedFiles: [] });
  const [loading, setLoading] = useState(false);
  const [targetBranch, setTargetBranch] = useState('');
  const [showStart, setShowStart] = useState(false);

  const loadState = useCallback(async () => {
    try {
      const s = await api.git.status(repo.path);
      const inProgress = s.isRebasing;
      setState({
        inProgress,
        conflictedFiles: s.conflicted,
      });
      if (!inProgress) setShowStart(true);
    } catch (e) {
      toast.error('Failed to load rebase state', String(e));
    }
  }, [repo.path, toast]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const handleStart = async () => {
    if (!targetBranch.trim()) {
      toast.warning('Target branch is required');
      return;
    }
    setLoading(true);
    try {
      await api.git.rebase(repo.path, targetBranch);
      toast.success(`Rebase onto ${targetBranch} started`);
      setShowStart(false);
      await loadState();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Rebase failed', String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAbort = async () => {
    if (!confirm('Abort rebase? All changes will be lost.')) return;
    setLoading(true);
    try {
      await api.git.rebase(repo.path, '', { abort: true });
      toast.success('Rebase aborted');
      await loadState();
      await refreshStatus(repo.path);
      onClose();
    } catch (e) {
      toast.error('Abort failed', String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    setLoading(true);
    try {
      await api.git.rebase(repo.path, '', { continue: true });
      toast.success('Rebase continued');
      await loadState();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Continue failed', String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    setLoading(true);
    try {
      await api.git.rebase(repo.path, '', { skip: true });
      toast.success('Commit skipped');
      await loadState();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Skip failed', String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-bg-elevated border-t border-border-strong shadow-lg z-40 animate-slide-up">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-default">
        <div className="flex items-center gap-2">
          <AlertCircle size={14} className="text-status-warning" />
          <span className="text-sm font-medium">
            {state.inProgress ? 'Rebase in progress' : 'Start Rebase'}
          </span>
          {state.inProgress && state.conflictedFiles.length > 0 && (
            <span className="badge badge-conflict">
              {state.conflictedFiles.length} CONFLICTS
            </span>
          )}
        </div>
        <button className="icon-btn" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      <div className="p-4">
        {state.inProgress ? (
          <>
            {state.conflictedFiles.length > 0 ? (
              <div className="mb-3">
                <div className="text-xs text-text-secondary mb-2">
                  Resolve conflicts in the following files, then continue:
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {state.conflictedFiles.map((f) => (
                    <div
                      key={f}
                      className="flex items-center gap-2 text-xs px-2 py-1 bg-bg-tertiary rounded"
                    >
                      <span className="text-status-conflict">●</span>
                      <code className="mono flex-1 truncate">{f}</code>
                      <button
                        className="icon-btn !w-5 !h-5"
                        title="Open in file manager"
                        onClick={() => {
                          const fullPath = `${repo.path}/${f}`.replace(/\/+/g, '/');
                          api.git.openFile(fullPath);
                        }}
                      >
                        <Check size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-text-secondary mb-3">
                No conflicts. You can continue the rebase.
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                className="btn btn-primary"
                onClick={handleContinue}
                disabled={loading || state.conflictedFiles.length > 0}
                title={state.conflictedFiles.length > 0 ? 'Resolve conflicts first' : 'Continue rebase'}
              >
                {loading ? <Loader size={13} className="spin" /> : <Check size={13} />}
                Continue
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleSkip}
                disabled={loading}
                title="Skip current commit"
              >
                <SkipForward size={13} />
                Skip
              </button>
              <button
                className="btn btn-danger"
                onClick={handleAbort}
                disabled={loading}
              >
                <RotateCcw size={13} />
                Abort
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-xs text-text-secondary mb-3">
              Rebase current branch onto another branch or commit.
            </div>
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                className="flex-1 mono text-sm"
                placeholder="branch-name or commit-hash"
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleStart()}
                autoFocus
              />
              <button
                className="btn btn-primary"
                onClick={handleStart}
                disabled={loading || !targetBranch.trim()}
              >
                {loading ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
                Start Rebase
              </button>
            </div>
            <div className="text-2xs text-text-tertiary">
              Tip: For interactive rebase with commit squashing/reordering, use{' '}
              <code className="mono">git rebase -i</code> from terminal.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
