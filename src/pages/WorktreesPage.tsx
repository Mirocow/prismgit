import { useState, useEffect, useCallback } from 'react';
import { FolderTree, RefreshCw, Plus, Trash, Folder, GitBranch, AlertCircle, Loader, CheckCircle, CornerDownRight } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type WorktreeInfo } from '../lib/api';
import { cn, shortHash } from '../lib/utils';

import { useEscapeKey } from '../hooks/useEscapeKey';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
export function WorktreesPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  useEscapeKey(showAdd, () => setShowAdd(false));
  const [newPath, setNewPath] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [detach, setDetach] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.worktrees(repo.path);
      setWorktrees(result);
    } catch (e) {
      toast.error('Failed to load worktrees', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleBrowse = async () => {
    const p = await api.fs.openDirectoryPicker();
    if (p) setNewPath(p);
  };

  const handleAdd = async () => {
    if (!newPath.trim()) {
      toast.warning('Target path is required');
      return;
    }
    setBusy('add');
    try {
      await api.git.worktreeAdd(repo.path, newPath, newBranch || undefined, undefined, detach);
      toast.success('Worktree added');
      setShowAdd(false);
      setNewPath('');
      setNewBranch('');
      setDetach(false);
      await load();
    } catch (e) {
      toast.error('Failed to add worktree', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (wt: WorktreeInfo) => {
    if (!(await confirmDialog({
      title: 'Remove worktree',
      message: `Remove the worktree at\n${wt.path}?\n\nThe branch is kept — only this working-copy folder is unlinked.`,
      confirmLabel: 'Remove',
      danger: true,
    }))) return;
    setBusy(wt.path);
    try {
      await api.git.worktreeRemove(repo.path, wt.path, false);
      toast.success('Worktree removed');
      await load();
    } catch (e) {
      // Try with force if normal remove fails
      if (await confirmDialog({
        title: 'Force remove worktree',
        message: 'The worktree could not be removed cleanly — it may contain uncommitted changes.\nForce remove anyway?',
        confirmLabel: 'Force remove',
        danger: true,
      })) {
        try {
          await api.git.worktreeRemove(repo.path, wt.path, true);
          toast.success('Worktree force-removed');
          await load();
        } catch (e2) {
          toast.error('Force remove failed', String(e2));
        }
      }
    } finally {
      setBusy(null);
    }
  };

  const handlePrune = async () => {
    setBusy('prune');
    try {
      await api.git.worktreePrune(repo.path);
      toast.success('Worktrees pruned');
      await load();
    } catch (e) {
      toast.error('Prune failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleOpen = async (wt: WorktreeInfo) => {
    if (wt.bare) return;
    await api.git.openFile(wt.path);
  };

  // Move a linked worktree to a new location (git worktree move).
  // Does not touch the branch or the files inside — just relocates the directory.
  const handleMove = async (wt: WorktreeInfo) => {
    const target = await promptDialog({
      title: 'Move worktree',
      message: `Move the worktree to a new location.\nCurrent location:\n${wt.path}`,
      confirmLabel: 'Move',
      input: { initialValue: wt.path, placeholder: '/new/path' },
      validate: (v) => (!v ? 'Enter the new path' : null),
    });
    if (!target || target === wt.path) return;
    setBusy(wt.path);
    try {
      await api.git.worktreeMove(repo.path, wt.path, target.trim());
      toast.success(`Worktree moved to ${target.trim()}`);
      await load();
    } catch (e) {
      toast.error('Move failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const mainWorktree = worktrees[0];
  const linkedWorktrees = worktrees.slice(1);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Worktrees</span>
          <span className="text-2xs text-text-tertiary">{worktrees.length} worktrees</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title="Refresh" onClick={load}>
            <RefreshCw size={13} />
          </button>
          <button
            className="btn btn-secondary text-xs"
            onClick={handlePrune}
            disabled={busy === 'prune'}
            title="Prune stale worktree metadata"
          >
            {busy === 'prune' ? <Loader size={12} className="animate-spin" /> : <Trash size={12} />}
            Prune
          </button>
          <button
            className="btn btn-primary text-xs"
            onClick={() => setShowAdd(true)}
          >
            <Plus size={12} />
            Add Worktree
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
        ) : worktrees.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <FolderTree size={32} className="mb-2 opacity-50" />
            <div className="text-sm">No worktrees</div>
            <div className="text-xs mt-1">Add a worktree to work on multiple branches simultaneously</div>
          </div>
        ) : (
          <>
            {/* Main worktree */}
            {mainWorktree && (
              <div className="border-b border-border-default">
                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary flex items-center gap-2">
                  <Folder size={11} /> Main
                </div>
                <div className="flex items-center gap-3 px-3 py-3">
                  <Folder size={16} className="text-accent" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{mainWorktree.path}</div>
                    <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
                      <code className="font-mono">{shortHash(mainWorktree.head)}</code>
                      {mainWorktree.branch && (
                        <span className="flex items-center gap-1">
                          <GitBranch size={10} />
                          {mainWorktree.branch}
                        </span>
                      )}
                      {mainWorktree.bare && <span className="badge badge-modified">BARE</span>}
                    </div>
                  </div>
                  {mainWorktree.branch && (
                    <button
                      className="btn btn-secondary text-xs"
                      title={`Show log of '${mainWorktree.branch}'`}
                      onClick={() => {
                        useSelectionStore.getState().selectBranch(mainWorktree.branch!);
                        window.location.hash = '#/history';
                      }}
                    >
                      Log
                    </button>
                  )}
                  <button
                    className="btn btn-secondary text-xs"
                    onClick={() => handleOpen(mainWorktree)}
                  >
                    Open
                  </button>
                </div>
              </div>
            )}

            {/* Linked worktrees */}
            {linkedWorktrees.length > 0 && (
              <div>
                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary flex items-center gap-2 mt-2">
                  <CornerDownRight size={11} /> Linked ({linkedWorktrees.length})
                </div>
                {linkedWorktrees.map((wt) => (
                  <div
                    key={wt.path}
                    className="group flex items-center gap-3 px-3 py-3 border-b border-border-subtle hover:bg-bg-hover"
                  >
                    <FolderTree size={16} className="text-accent flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{wt.path}</div>
                      <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5 flex-wrap">
                        <code className="font-mono">{shortHash(wt.head)}</code>
                        {wt.branch && (
                          <span className="flex items-center gap-1">
                            <GitBranch size={10} />
                            {wt.branch}
                          </span>
                        )}
                        {wt.detached && <span className="badge badge-modified">DETACHED</span>}
                        {wt.locked && (
                          <span className="badge badge-renamed flex items-center gap-1">
                            <AlertCircle size={9} /> LOCKED
                          </span>
                        )}
                        {wt.prunable && (
                          <span className="badge badge-deleted">PRUNABLE</span>
                        )}
                      </div>
                      {wt.lockedReason && (
                        <div className="text-2xs text-text-tertiary mt-1 italic">{wt.lockedReason}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {busy === wt.path ? (
                        <Loader size={14} className="animate-spin text-accent" />
                      ) : (
                        <>
                          {wt.branch && (
                            <button
                              className="btn btn-secondary text-xs"
                              title={`Show log of '${wt.branch}'`}
                              onClick={() => {
                                useSelectionStore.getState().selectBranch(wt.branch!);
                                window.location.hash = '#/history';
                              }}
                            >
                              Log
                            </button>
                          )}
                          <button
                            className="btn btn-secondary text-xs"
                            onClick={() => handleOpen(wt)}
                          >
                            Open
                          </button>
                          <button
                            className="btn btn-secondary text-xs"
                            onClick={() => handleMove(wt)}
                            title="Move worktree to a new location (git worktree move)"
                          >
                            Move
                          </button>
                          <button
                            className="icon-btn !w-6 !h-6 hover:!text-status-deleted"
                            title="Remove worktree"
                            onClick={() => handleRemove(wt)}
                          >
                            <Trash size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showAdd && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/55 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setShowAdd(false)}
        >
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4">Add Worktree</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Target path</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 text-sm font-mono"
                    placeholder="/path/to/worktree"
                    value={newPath}
                    autoFocus
                    onChange={(e) => setNewPath(e.target.value)}
                  />
                  <button className="btn btn-secondary" onClick={handleBrowse}>
                    <Folder size={12} />
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Branch name (optional)</label>
                <input
                  type="text"
                  className="w-full text-sm"
                  placeholder="feature/new-feature"
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                  disabled={detach}
                />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={detach}
                  onChange={(e) => setDetach(e.target.checked)}
                />
                Detach HEAD (no branch)
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={busy === 'add'}>
                {busy === 'add' ? <Loader size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
