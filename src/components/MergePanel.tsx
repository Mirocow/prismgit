import { useState, useEffect, useCallback } from 'react';
import { X, AlertCircle, Check, RotateCcw, Loader, GitMerge, GitPullRequest, ArrowDown, ArrowUp } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api } from '../lib/api';
import { confirmDialog, promptDialog } from './ConfirmDialog';

interface MergeState {
  inProgress: boolean;
  conflictedFiles: string[];
}

type MergeStrategy = 'merge' | 'squash' | 'rebase' | 'ff-only';

type PreviewStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'clean'; ahead: number; behind: number }
  | { kind: 'conflicts'; files: string[]; ahead: number; behind: number }
  | { kind: 'uptodate' }
  | { kind: 'error'; message: string };

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
  const [strategy, setStrategy] = useState<MergeStrategy>('merge');
  const [preview, setPreview] = useState<PreviewStatus>({ kind: 'idle' });
  const [noFf, setNoFf] = useState(false);
  const [squash, setSquash] = useState(false);
  const [showConflicts, setShowConflicts] = useState(true);

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

  // Pre-merge preview using merge-tree + ahead/behind counts
  const loadPreview = useCallback(async () => {
    if (state.inProgress) {
      setPreview({ kind: 'idle' });
      return;
    }
    setPreview({ kind: 'loading' });
    try {
      // Get current branch HEAD SHA as "ours"
      const oursSha = await api.git.revParse(repo.path, 'HEAD');
      const theirsSha = await api.git.revParse(repo.path, targetBranch);
      if (!oursSha || !theirsSha) {
        setPreview({ kind: 'error', message: 'Cannot resolve refs' });
        return;
      }
      // If same SHA — already up to date
      if (oursSha === theirsSha) {
        setPreview({ kind: 'uptodate' });
        return;
      }
      // Ahead/behind counts
      const { ahead, behind } = await api.git.aheadBehind(repo.path, 'HEAD', targetBranch);
      // merge-tree to detect conflicts without touching working tree
      const result = await api.git.mergeTree(repo.path, oursSha, theirsSha);
      if (result.clean) {
        setPreview({ kind: 'clean', ahead, behind });
      } else if (result.conflicts.length > 0) {
        setPreview({ kind: 'conflicts', files: result.conflicts, ahead, behind });
      } else {
        // clean=false but no conflicts listed — probably unrelated histories or unsupported git
        setPreview({ kind: 'error', message: 'Cannot compute merge preview (need Git 2.38+)' });
      }
    } catch (e) {
      setPreview({ kind: 'error', message: String(e) });
    }
  }, [repo.path, targetBranch, state.inProgress]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const handleMerge = async () => {
    setLoading(true);
    try {
      const opts: { noFf?: boolean; squash?: boolean; ffOnly?: boolean } = {};
      if (strategy === 'squash' || squash) opts.squash = true;
      if (strategy === 'ff-only') opts.ffOnly = true;
      if (noFf && strategy === 'merge') opts.noFf = true;

      if (strategy === 'rebase') {
        // Rebase current branch onto target
        await api.git.rebase(repo.path, targetBranch);
        toast.success(`Rebased onto ${targetBranch}`);
        onClose();
        await refreshStatus(repo.path);
        return;
      }

      const result = await api.git.merge(repo.path, targetBranch, opts);
      if (result.conflicts.length > 0) {
        toast.warning(
          `Merge conflicts in ${result.conflicts.length} files`,
          result.conflicts.join('\n')
        );
        await loadState();
        await refreshStatus(repo.path);
      } else if (result.fastForward) {
        toast.success('Fast-forward merge complete');
        onClose();
        await refreshStatus(repo.path);
      } else if (result.alreadyUpToDate) {
        toast.info('Already up to date');
        onClose();
      } else {
        toast.success('Merge complete');
        onClose();
        await refreshStatus(repo.path);
      }
    } catch (e) {
      toast.error('Merge failed', String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAbort = async () => {
    if (!(await confirmDialog({
      title: 'Abort merge',
      message: 'Abort the current merge? All merge changes will be lost.',
      confirmLabel: 'Abort merge',
      danger: true,
    }))) return;
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
            {state.inProgress ? 'Merge in progress' : `Merge '${targetBranch}' → current branch`}
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
                    <div key={f} className="flex items-center gap-2 text-xs px-2 py-1 bg-bg-tertiary rounded">
                      <span className="text-status-conflict">●</span>
                      <code className="mono flex-1 truncate">{f}</code>
                      <button className="icon-btn !w-5 !h-5" title="Open file"
                        onClick={() => api.git.openFile(`${repo.path}/${f}`.replace(/\/+/g, '/'))}>
                        <Check size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-text-secondary mb-3">No conflicts. You can complete the merge.</div>
            )}
            <div className="flex items-center gap-2">
              <button className="btn btn-primary" onClick={handleContinue}
                disabled={loading || state.conflictedFiles.length > 0}>
                {loading ? <Loader size={13} className="spin" /> : <Check size={13} />}
                Continue
              </button>
              <button className="btn btn-danger" onClick={handleAbort} disabled={loading}>
                <RotateCcw size={13} /> Abort
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Pre-merge preview */}
            <div className="mb-3">
              {preview.kind === 'loading' && (
                <div className="text-xs text-text-tertiary flex items-center gap-2">
                  <Loader size={12} className="spin" /> Computing merge preview...
                </div>
              )}
              {preview.kind === 'clean' && (
                <div className="text-xs flex items-center gap-3 text-status-added">
                  <Check size={12} />
                  <span>Clean merge — no conflicts expected</span>
                  <span className="text-text-tertiary flex items-center gap-1">
                    <ArrowUp size={9} />{preview.ahead}
                    <ArrowDown size={9} />{preview.behind}
                  </span>
                </div>
              )}
              {preview.kind === 'conflicts' && (
                <div>
                  <div className="text-xs flex items-center gap-3 text-status-conflict mb-2">
                    <AlertCircle size={12} />
                    <span>{preview.files.length} file(s) will conflict</span>
                    <span className="text-text-tertiary flex items-center gap-1">
                      <ArrowUp size={9} />{preview.ahead}
                      <ArrowDown size={9} />{preview.behind}
                    </span>
                    <button className="text-2xs text-accent ml-auto" onClick={() => setShowConflicts(!showConflicts)}>
                      {showConflicts ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {showConflicts && (
                    <div className="space-y-1 max-h-32 overflow-y-auto mb-2">
                      {preview.files.map((f) => (
                        <div key={f} className="flex items-center gap-2 text-xs px-2 py-1 bg-bg-tertiary rounded">
                          <span className="text-status-conflict">●</span>
                          <code className="mono flex-1 truncate">{f}</code>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {preview.kind === 'uptodate' && (
                <div className="text-xs flex items-center gap-2 text-status-info">
                  <Check size={12} />
                  <span>Already up to date — target branch is fully merged.</span>
                </div>
              )}
              {preview.kind === 'error' && (
                <div className="text-xs flex items-center gap-2 text-status-modified">
                  <AlertCircle size={12} />
                  <span>{preview.message}</span>
                </div>
              )}
            </div>

            {/* Strategy selector */}
            <div className="flex items-center gap-4 mb-3">
              <span className="text-xs text-text-tertiary">Strategy:</span>
              {([
                { id: 'merge', label: 'Merge commit' },
                { id: 'squash', label: 'Squash' },
                { id: 'rebase', label: 'Rebase' },
                { id: 'ff-only', label: 'Fast-forward only' },
              ] as const).map(opt => (
                <label key={opt.id} className="flex items-center gap-1 text-xs cursor-pointer">
                  <input type="radio" name="strategy" value={opt.id} checked={strategy === opt.id}
                    onChange={() => setStrategy(opt.id)} />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>

            {/* Options for merge strategy */}
            {strategy === 'merge' && (
              <div className="flex items-center gap-4 mb-3">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={noFf}
                    onChange={(e) => setNoFf(e.target.checked)} />
                  <span>No fast-forward (always create merge commit)</span>
                </label>
              </div>
            )}
            {strategy === 'squash' && (
              <div className="text-xs text-text-tertiary mb-3">
                All commits from <code className="mono">{targetBranch}</code> will be combined into a single new commit.
              </div>
            )}

            <div className="flex items-center gap-2">
              <button className="btn btn-primary" onClick={handleMerge} disabled={loading}>
                {loading ? <Loader size={13} className="spin" /> : strategy === 'rebase' ? <GitPullRequest size={13} /> : <GitMerge size={13} />}
                {strategy === 'rebase' ? 'Rebase' : strategy === 'squash' ? 'Squash & Merge' : 'Merge'}
              </button>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
