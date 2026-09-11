import { useState, useEffect, useCallback } from 'react';
import { History, RefreshCw, Trash, ChevronDown, ChevronRight } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { api, type ReflogEntry } from '../lib/api';
import { cn, formatDate, shortHash, copyToClipboard } from '../lib/utils';
import { useSelectionStore } from '../stores/selectionStore';
import { CommitHashLink } from '../components/StatusBar';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
import { useContextMenu } from '../lib/useContextMenu';
import { useI18n } from '../lib/i18n';

const REFS = ['HEAD', 'ORIG_HEAD', 'refs/heads', 'refs/remotes'];

export function ReflogPage() {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastActions();
  const showContextMenu = useContextMenu();
  const selectedCommitHash = useSelectionStore((s) => s.selectedCommitHash);
  const [entries, setEntries] = useState<ReflogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [ref, setRef] = useState('HEAD');
  const [showRefPicker, setShowRefPicker] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.reflog(repo.path, ref, 500);
      setEntries(result);
    } catch (e) {
      toast.error(t('pages.reflogLoadFailed'), String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, ref, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (entry: ReflogEntry) => {
    if (!(await confirmDialog({
      title: t('pages.reflogDeleteTitle'),
      message: t('pages.reflogDeleteMessage', { selector: entry.selector }),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return;
    try {
      await api.git.reflogDelete(repo.path, entry.index, ref);
      toast.success(t('pages.reflogDeleted'));
      await load();
    } catch (e) {
      toast.error(t('pages.deleteFailed'), String(e));
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('nav.reflog')}</span>
          <button
            className="text-xs px-2 py-0.5 bg-bg-tertiary rounded flex items-center gap-1 hover:bg-bg-hover"
            onClick={() => setShowRefPicker(!showRefPicker)}
          >
            <span className="font-mono text-accent">{ref}</span>
            {showRefPicker ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
          <span className="text-2xs text-text-tertiary">{t('pages.entriesCount', { count: entries.length })}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title={t('common.refresh')} onClick={load}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {showRefPicker && (
        <div className="border-b border-border-default bg-bg-tertiary p-2">
          <input
            type="text"
            className="w-full text-sm font-mono"
            placeholder={t('pages.reflogRefPlaceholder')}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setShowRefPicker(false);
                load();
              }
              if (e.key === 'Escape') setShowRefPicker(false);
            }}
            autoFocus
          />
          <div className="flex gap-1 mt-2 flex-wrap">
            {REFS.map((r) => (
              <button
                key={r}
                className="text-2xs px-2 py-0.5 bg-bg-secondary rounded hover:bg-bg-hover"
                onClick={() => {
                  setRef(r);
                  setShowRefPicker(false);
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">{t('common.loading')}</div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <History size={32} className="mb-2 opacity-50" />
            <div className="text-sm">{t('pages.noReflogEntries')}</div>
            <div className="text-xs mt-1">{t('pages.reflogEmptyFor', { ref })}</div>
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.index}
              className={cn(
                'group flex items-start gap-3 px-3 py-2 border-b border-border-subtle hover:bg-bg-hover cursor-pointer',
                selectedCommitHash === entry.hash && 'bg-bg-selected'
              )}
              onClick={() => useSelectionStore.getState().selectCommit(entry.hash)}
              onContextMenu={(e) => {
                e.preventDefault();
                showContextMenu([
                  { label: t('pages.menuViewCommitInHistory'), clickId: 'view-commit' },
                  { type: 'separator' },
                  { label: t('history.copyShortHash'), clickId: 'copy-short' },
                  { label: t('history.copyFullHash'), clickId: 'copy-full' },
                  { label: t('pages.menuCopyMessage'), clickId: 'copy-msg' },
                  { type: 'separator' },
                  { label: t('pages.menuDeleteEntry'), clickId: 'delete' },
                ], (action) => {
                  switch (action) {
                    case 'view-commit':
                      useSelectionStore.getState().selectCommit(entry.hash);
                      window.location.hash = '#/history';
                      break;
                    case 'copy-short': copyToClipboard(shortHash(entry.hash)); toast.success(t('pages.copied')); break;
                    case 'copy-full': copyToClipboard(entry.hash); toast.success(t('pages.copied')); break;
                    case 'copy-msg': copyToClipboard(entry.message); toast.success(t('pages.copied')); break;
                    case 'delete': handleDelete(entry); break;
                  }
                });
              }}
            >
              <code className="text-xs font-mono text-text-tertiary flex-shrink-0 mt-0.5">
                {entry.selector}
              </code>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary">{entry.message}</div>
                <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
                  <CommitHashLink hash={entry.hash} />
                  <span>·</span>
                  <span>{entry.author.name}</span>
                  <span>·</span>
                  <span>{formatDate(entry.date)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                <button
                  className="icon-btn !w-5 !h-5"
                  title={t('pages.copyHashTitle')}
                  onClick={() => {
                    copyToClipboard(entry.hash);
                    toast.success(t('pages.hashCopied'));
                  }}
                >
                  <span className="text-2xs">{t('pages.copyHashShort')}</span>
                </button>
                <button
                  className="icon-btn !w-5 !h-5 hover:!text-status-deleted"
                  title={t('pages.deleteEntryTitle')}
                  onClick={() => handleDelete(entry)}
                >
                  <Trash size={11} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
