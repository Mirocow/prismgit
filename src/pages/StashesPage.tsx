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
import { useI18n } from '../lib/i18n';
export function StashesPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const { t } = useI18n();
  const showContextMenu = useContextMenu();
  const navigate = useNavigate();
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  useEscapeKey(showNewDialog, () => setShowNewDialog(false));
  const [stashMessage, setStashMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(false);
  // Global stash selection — shared with Branches stash section and the Toolbar
  // chip: clicking a stash here marks it everywhere (SmartGit behavior).
  const selectedStashIndex = useSelectionStore((s) => s.selectedStashIndex);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.stashList(repo.path);
      setStashes(result);
    } catch (e) {
      toast.error(t('stashes.loadFailed'), String(e));
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
      toast.success(t('stashes.stashed'));
      setShowNewDialog(false);
      setStashMessage('');
      setIncludeUntracked(false);
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('stashes.stashFailed'), String(e));
    }
  };

  const handlePop = async (stash: StashEntry) => {
    if (!(await confirmDialog({
      title: t('stashes.popStashAt', { index: stash.index }),
      message: t('stashes.popConfirmMessage', { message: stash.message }),
      confirmLabel: t('stashes.pop'),
    }))) return;
    try {
      await api.git.stashPop(repo.path, stash.index);
      toast.success(t('stashes.poppedStash', { index: stash.index }));
      // The popped stash no longer exists — clear the global selection if it pointed here
      if (useSelectionStore.getState().selectedStashIndex === stash.index) {
        useSelectionStore.getState().selectStash(null);
      }
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('stashes.popFailed'), String(e));
    }
  };

  const handleApply = async (stash: StashEntry) => {
    try {
      await api.git.stashApply(repo.path, stash.index);
      toast.success(t('stashes.appliedKeptStash', { index: stash.index }));
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('stashes.applyFailed'), String(e));
    }
  };

  const handleDrop = async (stash: StashEntry) => {
    if (!(await confirmDialog({
      title: t('stashes.dropStashAt', { index: stash.index }),
      message: t('stashes.dropConfirmMessage', { message: stash.message }),
      confirmLabel: t('stashes.drop'),
      danger: true,
    }))) return;
    try {
      await api.git.stashDrop(repo.path, stash.index);
      toast.success(t('stashes.droppedStash', { index: stash.index }));
      if (useSelectionStore.getState().selectedStashIndex === stash.index) {
        useSelectionStore.getState().selectStash(null);
      }
      await load();
    } catch (e) {
      toast.error(t('stashes.dropFailed'), String(e));
    }
  };

  // Create a new branch from the stash's base commit and apply the stash there.
  // Useful when the stash no longer applies cleanly onto the current branch.
  const handleStashBranch = async (stash: StashEntry) => {
    const branchName = await promptDialog({
      title: t('stashes.branchTitle', { index: stash.index }),
      message: t('stashes.branchMessage', { message: stash.message }),
      confirmLabel: t('stashes.createBranchButton'),
      input: { placeholder: t('stashes.branchNamePlaceholder') },
      validate: (v) => (!v ? t('stashes.branchNameRequired') : /\s/.test(v) ? t('stashes.branchNameNoSpaces') : null),
    });
    if (!branchName || !branchName.trim()) return;
    try {
      await api.git.stashBranch(repo.path, branchName.trim(), stash.index);
      toast.success(t('stashes.branchCreated', { name: branchName.trim(), index: stash.index }));
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('stashes.branchFailed'), String(e));
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
    // Mark this stash as the globally selected one (Toolbar chip + Branches)
    useSelectionStore.getState().selectStash(stash.index, stash.hash);
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
      // Stash anatomy viewer: plain stash^..stash misses untracked files
      // (they live in the stash's third parent) — see stashFiles.
      stashHash: stash.hash,
    });
    navigate('/diff');
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('stashes.title')}</span>
          <span className="text-2xs text-text-tertiary">{t('stashes.entriesCount', { count: stashes.length })}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title={t('common.refresh')} onClick={load}>
            <RefreshCw size={13} />
          </button>
          <button
            className="btn btn-primary text-xs"
            onClick={() => setShowNewDialog(true)}
          >
            <Plus size={12} />
            {t('changes.stashChanges')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="empty-state">
            <div className="spinner mb-3" />
            <div className="empty-state-title">{t('stashes.loading')}</div>
          </div>
        ) : stashes.length === 0 ? (
          <div className="empty-state">
            <Package size={48} className="empty-state-icon" />
            <div className="empty-state-title">{t('stashes.empty')}</div>
            <div className="empty-state-desc">
              {t('stashes.emptyDesc')}
            </div>
          </div>
        ) : (
          stashes.map((s) => (
            <div key={s.index} className={selectedStashIndex === s.index ? 'bg-accent/10 border-l-2 border-l-accent' : ''}>
              <div
                className="group flex items-center gap-3 px-3 py-2 border-b border-border-subtle hover:bg-bg-hover cursor-pointer"
                onClick={() => {
                  // Select globally, then open in Diff
                  handleViewStash(s);
                }}
                title={t('stashes.rowTooltip')}
                onContextMenu={(e) => {
                  e.preventDefault();
                  showContextMenu([
                    { label: t('stashes.viewMenu'), clickId: 'view' },
                    { type: 'separator' },
                    { label: t('stashes.applyItem', { index: s.index }), clickId: 'apply' },
                    { label: t('stashes.popStashAtMenu', { index: s.index }), clickId: 'pop' },
                    { label: t('stashes.branchMenu'), clickId: 'branch' },
                    { type: 'separator' },
                    { label: t('stashes.dropStashAtMenu', { index: s.index }), clickId: 'drop' },
                    { type: 'separator' },
                    { label: t('stashes.copyMessage'), clickId: 'copy-msg' },
                    { label: t('stashes.copyHash'), clickId: 'copy-hash' },
                  ], (action) => {
                    switch (action) {
                      case 'view': handleViewStash(s); break;
                      case 'apply':
                        useSelectionStore.getState().selectStash(s.index, s.hash);
                        handleApply(s);
                        break;
                      case 'pop': handlePop(s); break;
                      case 'branch': handleStashBranch(s); break;
                      case 'drop': handleDrop(s); break;
                      case 'copy-msg': copyToClipboard(s.message); toast.success(t('stashes.copied')); break;
                      case 'copy-hash': copyToClipboard(s.hash); toast.success(t('stashes.copied')); break;
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
                    title={t('stashes.openInDiffTooltip')}
                    onClick={() => handleViewStash(s)}
                  >
                    <FileText size={12} />
                  </button>
                  <button
                    className="icon-btn !w-6 !h-6"
                    title={t('stashes.applyKeptTooltip')}
                    onClick={() => handleApply(s)}
                  >
                    <Check size={12} />
                  </button>
                  <button
                    className="icon-btn !w-6 !h-6"
                    title={t('stashes.popTooltip')}
                    onClick={() => handlePop(s)}
                  >
                    <Upload size={12} />
                  </button>
                  <button
                    className="icon-btn !w-6 !h-6"
                    title={t('stashes.branchTooltip')}
                    onClick={() => handleStashBranch(s)}
                  >
                    <GitBranch size={12} />
                  </button>
                  <button
                    className="icon-btn !w-6 !h-6 hover:!text-status-deleted"
                    title={t('stashes.dropTooltip')}
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
          className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50"
          onClick={() => setShowNewDialog(false)}
        >
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4">{t('changes.stashChanges')}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">{t('stashes.messageOptional')}</label>
                <input
                  type="text"
                  className="w-full text-sm"
                  placeholder={t('stashes.messagePlaceholder')}
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
                {t('stashes.includeUntracked')}
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowNewDialog(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleStashPush}>
                <Download size={13} />
                {t('toolbar.stash')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
