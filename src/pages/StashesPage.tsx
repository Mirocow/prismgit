import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, RefreshCw, Plus, Trash, Download, Upload, Check, FileText, ChevronDown, ChevronRight, X, GitBranch } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type StashEntry, type DiffResult } from '../lib/api';
import { formatDate, shortHash, copyToClipboard } from '../lib/utils';
import { CommitHashLink } from '../components/StatusBar';
import { cn } from '../lib/utils';

import { useEscapeKey } from '../hooks/useEscapeKey';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
import { useContextMenu } from '../lib/useContextMenu';
export function StashesPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const showContextMenu = useContextMenu();
  const navigate = useNavigate();
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  useEscapeKey(showNewDialog, () => setShowNewDialog(false));
  const [stashMessage, setStashMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.stashList(repo.path);
      setStashes(result);
    } catch (e) {
      toast.error('Failed to load stashes', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleStashPush = async () => {
    try {
      await api.git.stashPush(repo.path, stashMessage || undefined, includeUntracked);
      toast.success('Changes stashed');
      setShowNewDialog(false);
      setStashMessage('');
      setIncludeUntracked(false);
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Stash failed', String(e));
    }
  };

  const handlePop = async (stash: StashEntry) => {
    if (!(await confirmDialog({
      title: `Pop stash@{${stash.index}}`,
      message: `Apply the stashed changes to your working tree and remove the stash?\n\nStash message: "${stash.message}"`,
      confirmLabel: 'Pop',
    }))) return;
    try {
      await api.git.stashPop(repo.path, stash.index);
      toast.success(`Stash@{${stash.index}} popped`);
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Stash pop failed', String(e));
    }
  };

  const handleApply = async (stash: StashEntry) => {
    try {
      await api.git.stashApply(repo.path, stash.index);
      toast.success(`Stash@{${stash.index}} applied (stash kept)`);
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Stash apply failed', String(e));
    }
  };

  const handleDrop = async (stash: StashEntry) => {
    if (!(await confirmDialog({
      title: `Drop stash@{${stash.index}}`,
      message: `This permanently deletes the stash.\n\nStash message: "${stash.message}"`,
      confirmLabel: 'Drop',
      danger: true,
    }))) return;
    try {
      await api.git.stashDrop(repo.path, stash.index);
      toast.success(`Stash@{${stash.index}} dropped`);
      await load();
    } catch (e) {
      toast.error('Stash drop failed', String(e));
    }
  };

  // Create a new branch from the stash's base commit and apply the stash there.
  // Useful when the stash no longer applies cleanly onto the current branch.
  const handleStashBranch = async (stash: StashEntry) => {
    const branchName = await promptDialog({
      title: `Create branch from stash@{${stash.index}}`,
      message: `A new branch is created from the stash's base commit and the stash is applied there.\n\nStash message: "${stash.message}"`,
      confirmLabel: 'Create branch',
      input: { placeholder: 'branch name' },
      validate: (v) => (!v ? 'Enter the branch name' : /\s/.test(v) ? 'Branch name cannot contain spaces' : null),
    });
    if (!branchName || !branchName.trim()) return;
    try {
      await api.git.stashBranch(repo.path, branchName.trim(), stash.index);
      toast.success(`Branch '${branchName.trim()}' created from stash@{${stash.index}} and stash applied`);
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Stash branch failed', String(e));
    }
  };

  // View stash content — opens in Diff tool comparing the stash commit against
  // the commit it was based on (parent[0] = stash^). This shows what the stash
  // would actually apply if popped, NOT a comparison with the current HEAD.
  //
  // Previous bug: we used `selectCommit(stash.hash)` which DiffPage interpreted
  // as `baseRef = stash.hash`, then computed diff(baseRef, working tree) — that
  // showed unrelated working-tree changes instead of the stash contents.
  const handleViewStash = (stash: StashEntry) => {
    useSelectionStore.getState().setDiffRequest({
      // stash.hash^ is the commit the stash was created on top of (parent[0]).
      // Stashes are merge commits with 2 parents (or 3 if -u/--include-untracked):
      //   parent[0] = base commit (HEAD at stash time)
      //   parent[1] = index state when stashed
      //   parent[2] (optional) = untracked files commit
      // Comparing parent[0] vs the stash commit gives the working-tree changes
      // that were stashed — exactly what users expect to see.
      baseRef: `${stash.hash}^`,
      compareRef: stash.hash,
      filePath: '.',
    });
    navigate('/diff');
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Stashes</span>
          <span className="text-2xs text-text-tertiary">{stashes.length} entries</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title="Refresh" onClick={load}>
            <RefreshCw size={13} />
          </button>
          <button
            className="btn btn-primary text-xs"
            onClick={() => setShowNewDialog(true)}
          >
            <Plus size={12} />
            Stash Changes
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="empty-state">
            <div className="spinner mb-3" />
            <div className="empty-state-title">Loading stashes...</div>
          </div>
        ) : stashes.length === 0 ? (
          <div className="empty-state">
            <Package size={48} className="empty-state-icon" />
            <div className="empty-state-title">No stashes yet</div>
            <div className="empty-state-desc">
              Stashes save your uncommitted changes temporarily so you can switch
              branches or pull updates without losing work. Click "Stash Changes" above.
            </div>
          </div>
        ) : (
          stashes.map((s) => (
            <div key={s.index}>
              <div
                className="group flex items-center gap-3 px-3 py-2 border-b border-border-subtle hover:bg-bg-hover cursor-pointer"
                onClick={() => handleViewStash(s)}
                title="Click to open in Diff tool"
                onContextMenu={(e) => {
                  e.preventDefault();
                  showContextMenu([
                    { label: 'View Stash (Diff tool)', clickId: 'view' },
                    { type: 'separator' },
                    { label: `Apply stash@{${s.index}}`, clickId: 'apply' },
                    { label: `Pop stash@{${s.index}}...`, clickId: 'pop' },
                    { label: 'Branch from Stash...', clickId: 'branch' },
                    { type: 'separator' },
                    { label: `Drop stash@{${s.index}}...`, clickId: 'drop' },
                    { type: 'separator' },
                    { label: 'Copy Message', clickId: 'copy-msg' },
                    { label: 'Copy Hash', clickId: 'copy-hash' },
                  ], (action) => {
                    switch (action) {
                      case 'view': handleViewStash(s); break;
                      case 'apply': handleApply(s); break;
                      case 'pop': handlePop(s); break;
                      case 'branch': handleStashBranch(s); break;
                      case 'drop': handleDrop(s); break;
                      case 'copy-msg': copyToClipboard(s.message); toast.success('Copied'); break;
                      case 'copy-hash': copyToClipboard(s.hash); toast.success('Copied'); break;
                    }
                  });
                }}
              >
                <code className="text-xs font-mono text-text-tertiary flex-shrink-0">
                  stash@{'{' + s.index + '}'}
                </code>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary truncate">{s.message}</div>
                  <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
                    <CommitHashLink hash={s.hash} />
                    <span>· {formatDate(s.date)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="icon-btn !w-6 !h-6"
                    title="Open in Diff tool"
                    onClick={() => handleViewStash(s)}
                  >
                    <FileText size={12} />
                  </button>
                  <button
                    className="icon-btn !w-6 !h-6"
                    title="Apply (keep stash)"
                    onClick={() => handleApply(s)}
                  >
                    <Check size={12} />
                  </button>
                  <button
                    className="icon-btn !w-6 !h-6"
                    title="Pop (apply + drop)"
                    onClick={() => handlePop(s)}
                  >
                    <Upload size={12} />
                  </button>
                  <button
                    className="icon-btn !w-6 !h-6"
                    title="Create branch from stash and apply it there (git stash branch)"
                    onClick={() => handleStashBranch(s)}
                  >
                    <GitBranch size={12} />
                  </button>
                  <button
                    className="icon-btn !w-6 !h-6 hover:!text-status-deleted"
                    title="Drop (delete)"
                    onClick={() => handleDrop(s)}
                  >
                    <Trash size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {showNewDialog && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/55 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setShowNewDialog(false)}
        >
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4">Stash Changes</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Message (optional)</label>
                <input
                  type="text"
                  className="w-full text-sm"
                  placeholder="WIP: feature X"
                  value={stashMessage}
                  autoFocus
                  onChange={(e) => setStashMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleStashPush()}
                />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeUntracked}
                  onChange={(e) => setIncludeUntracked(e.target.checked)}
                />
                Include untracked files
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowNewDialog(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleStashPush}>
                <Download size={13} />
                Stash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
