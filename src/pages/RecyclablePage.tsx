import { useState, useEffect, useCallback } from 'react';
import { RotateCcw, RefreshCw, Trash, Copy, AlertCircle, GitBranch, Plus, X } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { api, type RecyclableCommit } from '../lib/api';
import { cn, formatDate, shortHash, copyToClipboard } from '../lib/utils';
import { CommitHashLink } from '../components/StatusBar';
import { useSelectionStore } from '../stores/selectionStore';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
import { blockedOperationToast } from '../lib/repoState';
import { useI18n } from '../lib/i18n';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';

/**
 * Recyclable Commits — unreachable reflog commits that are eligible for GC.
 * SmartGit Manual: "Recyclable Commits checkbox in Branches View shows commits
 * found in .git/logs files (i.e., reflog commits not reachable from any ref).
 * Recyclable commits are eligible for GC after the configured retention period
 * (default 90 days)."
 *
 * This page surfaces those commits, lets the user recover them via cherry-pick
 * or branch creation, or expire them via `git reflog expire`.
 *
 * UX rules:
 *   - Every recovery action is explicit + confirmed.
 *   - Cherry-pick surfaces real conflicts (file list + count), not just a generic
 *     "failed" toast.
 *   - Create branch uses a proper prompt dialog (window.prompt is blocked in some
 *     Electron contexts) and validates the branch name.
 *   - A warning banner shows the GC retention countdown so the user understands
 *     what "recyclable" actually means.
 */
export function RecyclablePage() {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastActions();
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const selectCommit = useSelectionStore((s) => s.selectCommit);
  const selectBranch = useSelectionStore((s) => s.selectBranch);
  const [commits, setCommits] = useState<RecyclableCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [busyHash, setBusyHash] = useState<string | null>(null);
  const [conflictInfo, setConflictInfo] = useState<{ hash: string; files: string[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.recyclableCommits(repo.path);
      setCommits(result);
    } catch (e) {
      toast.error(t('pages.recyclableLoadFailed'), String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCherryPick = async (hash: string) => {
    // SmartGit: while an in-progress state is active no other HEAD-moving
    // operation may start — it would discard the unfinished one.
    const status = useGitStore.getState().status;
    const blocked = blockedOperationToast(status);
    if (blocked) {
      toast.error(blocked.title, blocked.hint);
      return;
    }
    setBusyHash(hash);
    try {
      const result = await api.git.cherryPick(repo.path, [hash]);
      if (result.conflicts.length > 0) {
        setConflictInfo({ hash, files: result.conflicts });
        toast.warning(
          t('pages.cherryPickConflictsFiles', { count: result.conflicts.length }),
          t('pages.cherryPickConflictsDetail'),
        );
      } else if (result.empty) {
        // "The previous cherry-pick is now empty" — the commit's changes are
        // already applied to HEAD. The repo stays in cherry-picking-state and
        // MUST be resolved on the Changes page (Skip / Commit Empty / Abort).
        toast.warning(
          t('pages.cherryPickEmpty'),
          t('pages.cherryPickEmptyDetail')
        );
      } else if (result.error) {
        toast.error(t('pages.cherryPickFailed'), result.error);
      } else {
        toast.success(t('pages.recyclableCherryPicked', { hash: shortHash(hash) }), t('pages.recyclableCherryPickedDetail'));
      }
      await refreshStatus(repo.path);
      await load();
    } catch (e) {
      const msg = String(e);
      // Detect common recoverable states
      if (/nothing to commit|already applied|previous cherry-pick is now empty/i.test(msg)) {
        // The cherry-pick is now empty (the changes are already applied).
        // The repository is in CHERRY_PICK_HEAD state — offer Skip.
        toast.warning(
          t('pages.cherryPickEmptyHint', { hash: shortHash(hash) }),
          t('pages.cherryPickEmptyStateDetail'),
        );
        // Refresh status so the global SequencerPanel banner appears.
        await refreshStatus(repo.path);
      } else if (/dirty index|uncommitted changes/i.test(msg)) {
        toast.error(t('pages.cherryPickBlocked'), t('pages.cherryPickBlockedDetail'));
      } else {
        toast.error(t('pages.cherryPickFailed'), msg);
      }
    } finally {
      setBusyHash(null);
    }
  };

  const handleCreateBranch = async (hash: string) => {
    const defaultName = `recover/${hash.substring(0, 8)}`;
    const name = await promptDialog({
      title: t('pages.recyclableBranchAt', { hash: shortHash(hash) }),
      message: t('pages.recyclableBranchPromptDetail'),
      confirmLabel: t('pages.recyclableBranchCreate'),
      input: { initialValue: defaultName, placeholder: 'recover/abc12345' },
    });
    if (!name?.trim()) return;
    // Validate branch name (cheap client-side check)
    const trimmed = name.trim();
    if (/\s/.test(trimmed)) {
      toast.error(t('pages.invalidBranchName'), t('pages.invalidBranchNameWs'));
      return;
    }
    if (trimmed.startsWith('-') || trimmed.startsWith('/')) {
      toast.error(t('pages.invalidBranchName'), t('pages.invalidBranchNameDash'));
      return;
    }
    setBusyHash(hash);
    try {
      await api.git.createBranch(repo.path, trimmed, hash);
      toast.success(t('pages.branchCreatedName', { name: trimmed }), t('pages.branchCreatedAtDetail', { hash: shortHash(hash) }));
      selectBranch(trimmed);
      await load();
    } catch (e) {
      toast.error(t('pages.createBranchFailed'), String(e));
    } finally {
      setBusyHash(null);
    }
  };

  const handleExpireAll = async () => {
    if (!(await confirmDialog({
      title: t('pages.expireAllTitle'),
      message: t('pages.expireAllMessage', { count: commits.length }),
      confirmLabel: t('pages.expireAllButton'),
      danger: true,
    }))) return;
    setBusyHash('expire-all');
    try {
      await api.git.raw(repo.path, ['reflog', 'expire', '--expire=now', '--all']);
      await api.git.raw(repo.path, ['gc', '--prune=now']);
      toast.success(t('pages.recyclableExpired'), t('pages.recyclableExpiredDetail', { count: commits.length }));
      await load();
    } catch (e) {
      toast.error(t('pages.expireFailed'), String(e));
    } finally {
      setBusyHash(null);
    }
  };

  const filtered = commits.filter(c =>
    c.subject.toLowerCase().includes(search.toLowerCase()) ||
    c.hash.toLowerCase().includes(search.toLowerCase()) ||
    c.source.toLowerCase().includes(search.toLowerCase())
  );

  // --- DataGrid columns + cell renderers ---
  // Sortable + resizable: click header to sort by hash/subject/source/date,
  // drag column edge to resize (persisted to localStorage via gridId).
  const recyclableColumns: DataGridColumn<RecyclableCommit>[] = [
    { key: 'hash', header: t('pages.colHash') || 'Hash', width: 90, sortAccessor: (c) => c.hash },
    { key: 'subject', header: t('pages.colSubject') || 'Subject', width: 400, sortAccessor: (c) => c.subject.toLowerCase() },
    { key: 'source', header: t('pages.colSource') || 'Source', width: 110, sortAccessor: (c) => c.source },
    { key: 'date', header: t('pages.colDate') || 'Date', width: 140, sortAccessor: (c) => new Date(c.date).getTime() },
    { key: 'actions', header: '', width: 100, resizable: false, sortable: false },
  ];

  const renderRecyclableCell = (c: RecyclableCommit, col: DataGridColumn<RecyclableCommit>) => {
    switch (col.key) {
      case 'hash':
        return <CommitHashLink hash={c.hash} short className="font-mono text-accent" />;
      case 'subject':
        return <span className="truncate block" title={c.subject}>{c.subject}</span>;
      case 'source':
        return <span className="text-2xs text-text-tertiary font-mono" title={c.source}>{c.source}</span>;
      case 'date':
        return <span className="text-2xs text-text-tertiary">{formatDate(c.date)}</span>;
      case 'actions':
        return null; // rendered by renderRow wrapper below
      default:
        return null;
    }
  };

  const renderRecyclableRow = (c: RecyclableCommit, _idx: number, cells: React.ReactNode) => {
    const isBusy = busyHash === c.hash;
    return (
      <div
        className={cn(
          'flex items-stretch cursor-pointer hover:bg-bg-hover transition-colors group',
          isBusy && 'opacity-50'
        )}
      >
        {cells}
        {/* Action buttons — visible on hover, render after the actions cell */}
        <div className="flex items-center gap-1 pr-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          <button
            className="icon-btn !w-5 !h-5 !text-accent hover:!bg-accent-muted"
            title={t('pages.createBranchAt')}
            disabled={isBusy}
            onClick={(e) => { e.stopPropagation(); handleCreateBranch(c.hash); }}
          >
            <GitBranch size={11} />
          </button>
          <button
            className="icon-btn !w-5 !h-5 !text-status-added hover:!bg-status-added/15"
            title={t('pages.cherryPickTitleHint')}
            disabled={isBusy}
            onClick={(e) => { e.stopPropagation(); handleCherryPick(c.hash); }}
          >
            <Plus size={11} />
          </button>
          <button
            className="icon-btn !w-5 !h-5"
            title={t('pages.copyHashTitle')}
            onClick={(e) => { e.stopPropagation(); copyToClipboard(c.hash); toast.success(t('pages.copied')); }}
          >
            <Copy size={10} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <RotateCcw size={14} className="text-accent" />
          <span className="text-sm font-medium">{t('pages.recyclableTitle')}</span>
          <span className="text-2xs text-text-tertiary">
            {t('pages.recyclableCounts', { unreachable: commits.length, shown: filtered.length })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title={t('common.refresh')} onClick={load}>
            <RefreshCw size={13} />
          </button>
          {commits.length > 0 && (
            <button
              className="btn btn-danger text-xs"
              onClick={handleExpireAll}
              disabled={busyHash === 'expire-all'}
              title="Run git reflog expire --expire=now --all && git gc --prune=now"
            >
              <Trash size={11} /> {t('pages.expireAllButton')}
            </button>
          )}
        </div>
      </div>

      {/* Info banner — explain what "recyclable" means + retention */}
      <div className="px-3 py-1.5 border-b border-border-subtle bg-bg-tertiary flex items-center gap-2">
        <AlertCircle size={12} className="text-status-warning flex-shrink-0" />
        <span className="text-2xs text-text-secondary">
          {t('pages.recyclableBanner')}
        </span>
      </div>

      <div className="px-3 py-1.5 border-b border-border-subtle bg-bg-tertiary">
        <input
          type="text"
          className="w-full text-xs"
          placeholder={t('pages.recyclableFilterPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Conflict info panel — shows files when cherry-pick had conflicts */}
      {conflictInfo && (
        <div className="border-b border-status-warning/40 bg-status-warning/10 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-2xs font-semibold text-status-warning flex items-center gap-1">
              <AlertCircle size={12} />
              {conflictInfo.files.length} conflict{conflictInfo.files.length === 1 ? '' : 's'} from cherry-pick of {shortHash(conflictInfo.hash)}
            </span>
            <button
              className="icon-btn !w-4 !h-4"
              title="Dismiss"
              onClick={() => setConflictInfo(null)}
            >
              <X size={10} />
            </button>
          </div>
          <div className="mt-1 max-h-32 overflow-y-auto">
            {conflictInfo.files.map(f => (
              <div key={f} className="text-2xs font-mono text-text-secondary truncate" title={f}>{f}</div>
            ))}
          </div>
          <div className="mt-1 text-2xs text-text-tertiary">
            Resolve in the Changes view, then commit to complete the cherry-pick.
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">{t('common.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <AlertCircle size={32} className="mb-2 opacity-50" />
            <div className="text-sm">{t('pages.recyclableEmpty')}</div>
            <div className="text-xs mt-1">
              {t('pages.recyclableEmptyHint')}
            </div>
          </div>
        ) : (
          <DataGrid<RecyclableCommit>
            gridId="recyclable-page"
            columns={recyclableColumns}
            rows={filtered}
            getCell={renderRecyclableCell}
            renderRow={renderRecyclableRow}
            onRowClick={(row) => selectCommit(row.hash)}
            emptyState={
              <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
                <AlertCircle size={32} className="mb-2 opacity-50" />
                <div className="text-sm">{t('pages.recyclableEmpty')}</div>
              </div>
            }
          />
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1 border-t border-border-default bg-bg-tertiary text-2xs text-text-tertiary">
        {t('pages.recyclableFooterHint')}
      </div>
    </div>
  );
}
