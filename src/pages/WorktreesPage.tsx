import { useState, useEffect, useCallback } from 'react';
import { FolderTree, RefreshCw, Plus, Trash, Folder, GitBranch, AlertCircle, Loader, CheckCircle, CornerDownRight } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type WorktreeInfo } from '../lib/api';
import { cn, shortHash } from '../lib/utils';

import { useEscapeKey } from '../hooks/useEscapeKey';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
import { useI18n } from '../lib/i18n';
export function WorktreesPage() {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastActions();
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
      toast.error(t('pages.worktreeLoadFailed'), String(e));
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
      toast.warning(t('pages.worktreePathRequired'));
      return;
    }
    setBusy('add');
    try {
      await api.git.worktreeAdd(repo.path, newPath, newBranch || undefined, undefined, detach);
      toast.success(t('pages.worktreeAdded'));
      setShowAdd(false);
      setNewPath('');
      setNewBranch('');
      setDetach(false);
      await load();
    } catch (e) {
      toast.error(t('pages.worktreeAddFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (wt: WorktreeInfo) => {
    if (!(await confirmDialog({
      title: t('pages.worktreeRemoveTitle'),
      message: t('pages.worktreeRemoveMessage', { path: wt.path }),
      confirmLabel: t('common.remove'),
      danger: true,
    }))) return;
    setBusy(wt.path);
    try {
      await api.git.worktreeRemove(repo.path, wt.path, false);
      toast.success(t('pages.worktreeRemoved'));
      await load();
    } catch (e) {
      // Try with force if normal remove fails
      if (await confirmDialog({
        title: t('pages.worktreeForceRemoveTitle'),
        message: t('pages.worktreeForceRemoveMessage'),
        confirmLabel: t('pages.forceRemove'),
        danger: true,
      })) {
        try {
          await api.git.worktreeRemove(repo.path, wt.path, true);
          toast.success(t('pages.worktreeForceRemoved'));
          await load();
        } catch (e2) {
          toast.error(t('pages.forceRemoveFailed'), String(e2));
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
      toast.success(t('pages.worktreesPruned'));
      await load();
    } catch (e) {
      toast.error(t('pages.pruneFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleOpen = async (wt: WorktreeInfo) => {
    if (wt.bare) return;
    await api.git.openFile(wt.path);
  };

  // Open this worktree folder in VS Code (not the OS file manager)
  const handleOpenInVsCode = async (wt: WorktreeInfo) => {
    if (wt.bare) return;
    try {
      const res = await api.vscode.open(wt.path);
      if (res.ok) toast.success(t('vscode.opened'));
      else toast.error(t('vscode.openFailed'));
    } catch (e) {
      toast.error(t('vscode.openFailed'), String(e));
    }
  };

  // Move a linked worktree to a new location (git worktree move).
  // Does not touch the branch or the files inside — just relocates the directory.
  const handleMove = async (wt: WorktreeInfo) => {
    const target = await promptDialog({
      title: t('pages.worktreeMoveTitle'),
      message: t('pages.worktreeMoveMessage', { path: wt.path }),
      confirmLabel: t('pages.move'),
      input: { initialValue: wt.path, placeholder: '/new/path' },
      validate: (v) => (!v ? t('pages.enterNewPath') : null),
    });
    if (!target || target === wt.path) return;
    setBusy(wt.path);
    try {
      await api.git.worktreeMove(repo.path, wt.path, target.trim());
      toast.success(t('pages.worktreeMoved', { path: target.trim() }));
      await load();
    } catch (e) {
      toast.error(t('pages.moveFailed'), String(e));
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
          <span className="text-sm font-medium">{t('nav.worktrees')}</span>
          <span className="text-2xs text-text-tertiary">{t('pages.worktreesCount', { count: worktrees.length })}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title={t('common.refresh')} onClick={load}>
            <RefreshCw size={13} />
          </button>
          <button
            className="btn btn-secondary text-xs"
            onClick={handlePrune}
            disabled={busy === 'prune'}
            title={t('pages.pruneTitle')}
          >
            {busy === 'prune' ? <Loader size={12} className="animate-spin" /> : <Trash size={12} />}
            {t('pages.prune')}
          </button>
          <button
            className="btn btn-primary text-xs"
            onClick={() => setShowAdd(true)}
          >
            <Plus size={12} />
            {t('pages.addWorktree')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">{t('common.loading')}</div>
        ) : worktrees.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <FolderTree size={32} className="mb-2 opacity-50" />
            <div className="text-sm">{t('pages.noWorktrees')}</div>
            <div className="text-xs mt-1">{t('pages.noWorktreesHint')}</div>
          </div>
        ) : (
          <>
            {/* Main worktree */}
            {mainWorktree && (
              <div className="border-b border-border-default">
                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary flex items-center gap-2">
                  <Folder size={11} /> {t('pages.mainSection')}
                </div>
                <div className="flex items-center gap-3 px-3 py-3">
                  <Folder size={16} className="text-accent" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{mainWorktree.path}</div>
                    <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
                      <code
                        className="font-mono cursor-pointer hover:text-accent hover:underline"
                        title={t('pages.selectCommitHint')}
                        onClick={() => {
                          useSelectionStore.getState().selectCommit(mainWorktree.head);
                          window.location.hash = '#/history';
                        }}
                      >
                        {shortHash(mainWorktree.head)}
                      </code>
                      {mainWorktree.branch && (
                        <span className="flex items-center gap-1">
                          <GitBranch size={10} />
                          {mainWorktree.branch}
                        </span>
                      )}
                      {mainWorktree.bare && <span className="badge badge-modified">{t('pages.badgeBare')}</span>}
                    </div>
                  </div>
                  {mainWorktree.branch && (
                    <button
                      className="btn btn-secondary text-xs"
                      title={t('pages.showLogOf', { name: mainWorktree.branch })}
                      onClick={() => {
                        useSelectionStore.getState().selectBranch(mainWorktree.branch!);
                        window.location.hash = '#/history';
                      }}
                    >
                      {t('branches.log')}
                    </button>
                  )}
                  <button
                    className="btn btn-secondary text-xs"
                    onClick={() => handleOpen(mainWorktree)}
                  >
                    {t('pages.open')}
                  </button>
                  {!mainWorktree.bare && (
                    <button
                      className="btn btn-secondary text-xs"
                      title={t('vscode.openInVscode')}
                      onClick={() => handleOpenInVsCode(mainWorktree)}
                    >
                      VS Code
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Linked worktrees */}
            {linkedWorktrees.length > 0 && (
              <div>
                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary flex items-center gap-2 mt-2">
                  <CornerDownRight size={11} /> {t('pages.linkedCount', { count: linkedWorktrees.length })}
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
                        <code
                          className="font-mono cursor-pointer hover:text-accent hover:underline"
                          title={t('pages.selectCommitHint')}
                          onClick={() => {
                            useSelectionStore.getState().selectCommit(wt.head);
                            window.location.hash = '#/history';
                          }}
                        >
                          {shortHash(wt.head)}
                        </code>
                        {wt.branch && (
                          <span className="flex items-center gap-1">
                            <GitBranch size={10} />
                            {wt.branch}
                          </span>
                        )}
                        {wt.detached && <span className="badge badge-modified">{t('pages.badgeDetached')}</span>}
                        {wt.locked && (
                          <span className="badge badge-renamed flex items-center gap-1">
                            <AlertCircle size={9} /> {t('pages.badgeLocked')}
                          </span>
                        )}
                        {wt.prunable && (
                          <span className="badge badge-deleted">{t('pages.badgePrunable')}</span>
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
                              title={t('pages.showLogOf', { name: wt.branch })}
                              onClick={() => {
                                useSelectionStore.getState().selectBranch(wt.branch!);
                                window.location.hash = '#/history';
                              }}
                            >
                              {t('branches.log')}
                            </button>
                          )}
                          <button
                            className="btn btn-secondary text-xs"
                            onClick={() => handleOpen(wt)}
                          >
                            {t('pages.open')}
                          </button>
                          <button
                            className="btn btn-secondary text-xs"
                            title={t('vscode.openInVscode')}
                            onClick={() => handleOpenInVsCode(wt)}
                          >
                            VS Code
                          </button>
                          <button
                            className="btn btn-secondary text-xs"
                            onClick={() => handleMove(wt)}
                            title={t('pages.worktreeMoveButtonTitle')}
                          >
                            {t('pages.move')}
                          </button>
                          <button
                            className="icon-btn !w-6 !h-6 hover:!text-status-deleted"
                            title={t('pages.worktreeRemoveTitle')}
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
          className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50"
          onClick={() => setShowAdd(false)}
        >
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4">{t('pages.addWorktree')}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">{t('pages.targetPathLabel')}</label>
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
                <label className="text-xs text-text-tertiary block mb-1">{t('pages.branchNameOptional')}</label>
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
                {t('pages.detachHead')}
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={busy === 'add'}>
                {busy === 'add' ? <Loader size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                {t('common.add')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
