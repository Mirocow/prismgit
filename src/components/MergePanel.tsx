import { useState, useEffect, useCallback } from 'react';
import { X, AlertCircle, Check, RotateCcw, Loader, GitMerge } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api } from '../lib/api';

interface MergeState {
  inProgress: boolean;
  conflictedFiles: string[];
}

export function MergePanel({
  targetBranch,
  onClose,
}: {
  targetBranch: string;
  onClose: () => void;
}) {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const [state, setState] = useState<MergeState>({ inProgress: false, conflictedFiles: [] });
  const [loading, setLoading] = useState(false);
  const [noFf, setNoFf] = useState(false);
  const [squash, setSquash] = useState(false);

  const loadState = useCallback(async () => {
    try {
      const s = await api.git.status(repo.path);
      setState({
        inProgress: s.isMerging,
        conflictedFiles: s.conflicted,
      });
    } catch (e) {
      toast.error('Failed to load merge state', String(e));
    }
  }, [repo.path, toast]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const handleMerge = async () => {
    setLoading(true);
    try {
      const result = await api.git.merge(repo.path, targetBranch, { noFf, squash });
      if (result.conflicts.length > 0) {
        toast.warning(
          `Merge conflicts in ${result.conflicts.length} files`,
          result.conflicts.join('\n')
        );
      } else if (result.fastForward) {
        toast.success('Fast-forward merge complete');
        onClose();
      } else if (result.alreadyUpToDate) {
        toast.info('Already up to date');
        onClose();
      } else {
        toast.success('Merge complete');
        onClose();
      }
      await loadState();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Merge failed', String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAbort = async () => {
    if (!confirm('Abort merge? All changes will be lost.')) return;
    setLoading(true);
    try {
      await api.git.abortMerge(repo.path);
      toast.success('Merge aborted');
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
      await api.git.continueMerge(repo.path);
      toast.success('Merge completed');
      await loadState();
      await refreshStatus(repo.path);
      onClose();
    } catch (e) {
      toast.error('Continue failed', String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-bg-elevated border-t border-border-strong shadow-lg z-40 animate-slide-up">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-default">
        <div className="flex items-center gap-2">
          <GitMerge size={14} className="text-accent" />
          <span className="text-sm font-medium">
            {state.inProgress ? 'Merge in progress' : `Merge '${targetBranch}'`}
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
                <div className="text-xs text-text-secondary mb-2 flex items-center gap-2">
                  <AlertCircle size={12} className="text-status-conflict" />
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
                        title="Open file"
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
                No conflicts. You can complete the merge.
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                className="btn btn-primary"
                onClick={handleContinue}
                disabled={loading || state.conflictedFiles.length > 0}
              >
                {loading ? <Loader size={13} className="spin" /> : <Check size={13} />}
                Continue
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
            <div className="flex items-center gap-4 mb-3">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={noFf}
                  onChange={(e) => setNoFf(e.target.checked)}
                />
                <span>No fast-forward</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={squash}
                  onChange={(e) => setSquash(e.target.checked)}
                />
                <span>Squash</span>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="btn btn-primary"
                onClick={handleMerge}
                disabled={loading}
              >
                {loading ? <Loader size={13} className="spin" /> : <GitMerge size={13} />}
                Merge
              </button>
              <button className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
