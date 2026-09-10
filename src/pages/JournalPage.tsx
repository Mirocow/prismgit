import { useState, useEffect, useCallback, useMemo } from 'react';
import { RotateCcw, RefreshCw, CornerDownRight, Copy, GitCommit } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { CommitHashLink } from '../components/StatusBar';
import { api, type ReflogEntry } from '../lib/api';
import { cn, formatDate, shortHash, copyToClipboard } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
import { useContextMenu } from '../lib/useContextMenu';

export function JournalPage() {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const showContextMenu = useContextMenu();
  const selectedCommitHash = useSelectionStore((s) => s.selectedCommitHash);
  const [entries, setEntries] = useState<ReflogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'commit' | 'checkout' | 'merge' | 'rebase' | 'reset' | 'other'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.reflog(repo.path, 'HEAD', 200);
      setEntries(result);
    } catch (e) {
      toast.error(t('pages.journalLoadFailed'), String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'all') return entries;
    return entries.filter((e) => {
      const msg = e.message.toLowerCase();
      if (filter === 'commit') return msg.startsWith('commit:') || msg.startsWith('commit (');
      if (filter === 'checkout') return msg.startsWith('checkout:');
      if (filter === 'merge') return msg.startsWith('merge ');
      if (filter === 'rebase') return msg.startsWith('rebase') || msg.startsWith('rebase-i');
      if (filter === 'reset') return msg.startsWith('reset');
      return !(
        msg.startsWith('commit:') || msg.startsWith('checkout:') ||
        msg.startsWith('merge ') || msg.startsWith('rebase') || msg.startsWith('reset')
      );
    });
  }, [entries, filter]);

  const handleCherryPick = async (entry: ReflogEntry) => {
    if (!(await confirmDialog({
      title: t('pages.journalCherryPickTitle', { hash: shortHash(entry.hash) }),
      message: t('pages.journalCherryPickMessage', { message: entry.message.substring(0, 80) }),
      confirmLabel: t('pages.cherryPickButton'),
    }))) return;
    try {
      const result = await api.git.cherryPick(repo.path, [entry.hash]);
      if (result.conflicts.length > 0) {
        toast.warning(t('pages.conflictsCount', { count: result.conflicts.length }), result.conflicts.join('\n'));
      } else {
        toast.success(t('pages.cherryPicked'));
      }
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('pages.cherryPickFailed'), String(e));
    }
  };

  const handleResetToHere = async (entry: ReflogEntry) => {
    if (!(await confirmDialog({
      title: t('pages.journalResetTitle', { hash: shortHash(entry.hash) }),
      message: t('pages.resetHardWarning'),
      confirmLabel: t('pages.reset'),
      danger: true,
    }))) return;
    try {
      await api.git.reset(repo.path, 'hard', entry.hash);
      toast.success(t('pages.resetToHash', { hash: shortHash(entry.hash) }));
      await refreshStatus(repo.path);
      await load();
    } catch (e) {
      toast.error(t('pages.resetFailed'), String(e));
    }
  };

  const FILTERS: { key: typeof filter; label: string }[] = [
    { key: 'all', label: t('common.all') },
    { key: 'commit', label: t('pages.filterCommits') },
    { key: 'checkout', label: t('pages.filterCheckouts') },
    { key: 'merge', label: t('history.merges') },
    { key: 'rebase', label: t('pages.filterRebases') },
    { key: 'reset', label: t('pages.filterResets') },
    { key: 'other', label: t('pages.filterOther') },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('pages.journalTitle')}</span>
          <span className="text-2xs text-text-tertiary">{t('pages.entriesCount', { count: filtered.length })}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title={t('common.refresh')} onClick={load}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border-default bg-bg-tertiary overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={cn(
              'text-2xs px-2 py-1 rounded whitespace-nowrap',
              filter === f.key
                ? 'bg-accent text-text-inverse'
                : 'text-text-secondary hover:bg-bg-hover'
            )}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">{t('common.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <RotateCcw size={32} className="mb-2 opacity-50" />
            <div className="text-sm">{t('pages.noJournalEntries')}</div>
          </div>
        ) : (
          filtered.map((entry, idx) => (
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
                  { label: t('pages.menuCherryPick'), clickId: 'cherry-pick' },
                  { label: t('pages.menuResetHard'), clickId: 'reset-hard' },
                ], (action) => {
                  switch (action) {
                    case 'view-commit':
                      useSelectionStore.getState().selectCommit(entry.hash);
                      window.location.hash = '#/history';
                      break;
                    case 'copy-short': copyToClipboard(shortHash(entry.hash)); toast.success(t('pages.copied')); break;
                    case 'copy-full': copyToClipboard(entry.hash); toast.success(t('pages.copied')); break;
                    case 'copy-msg': copyToClipboard(entry.message); toast.success(t('pages.copied')); break;
                    case 'cherry-pick': handleCherryPick(entry); break;
                    case 'reset-hard': handleResetToHere(entry); break;
                  }
                });
              }}
            >
              <code className="text-2xs font-mono text-text-tertiary flex-shrink-0 mt-0.5 w-20">
                {entry.selector}
              </code>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary">{entry.message}</div>
                <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
                  <CornerDownRight size={9} />
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
                  <Copy size={10} />
                </button>
                <button
                  className="icon-btn !w-5 !h-5"
                  title={t('pages.cherryPickTitleHint')}
                  onClick={() => handleCherryPick(entry)}
                >
                  <GitCommit size={10} />
                </button>
                <button
                  className="icon-btn !w-5 !h-5 hover:!text-status-deleted"
                  title={t('pages.resetHardHere')}
                  onClick={() => handleResetToHere(entry)}
                >
                  <RotateCcw size={10} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
