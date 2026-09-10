import { useState, useEffect, useCallback, useMemo } from 'react';
import { RotateCcw, RefreshCw, CornerDownRight, Copy, GitCommit } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { CommitHashLink } from '../components/StatusBar';
import { api, type ReflogEntry } from '../lib/api';
import { cn, formatDate, shortHash, copyToClipboard } from '../lib/utils';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
import { useContextMenu } from '../lib/useContextMenu';

export function JournalPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const showContextMenu = useContextMenu();
  const [entries, setEntries] = useState<ReflogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'commit' | 'checkout' | 'merge' | 'rebase' | 'reset' | 'other'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.reflog(repo.path, 'HEAD', 200);
      setEntries(result);
    } catch (e) {
      toast.error('Failed to load journal', String(e));
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
      title: `Cherry-pick ${shortHash(entry.hash)}`,
      message: `Apply the changes from this commit onto your current branch?\n\nCommit: "${entry.message.substring(0, 80)}"`,
      confirmLabel: 'Cherry-pick',
    }))) return;
    try {
      const result = await api.git.cherryPick(repo.path, [entry.hash]);
      if (result.conflicts.length > 0) {
        toast.warning(`${result.conflicts.length} conflicts`, result.conflicts.join('\n'));
      } else {
        toast.success('Cherry-picked');
      }
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Cherry-pick failed', String(e));
    }
  };

  const handleResetToHere = async (entry: ReflogEntry) => {
    if (!(await confirmDialog({
      title: `Reset HEAD to ${shortHash(entry.hash)} (hard)`,
      message: 'All uncommitted changes will be lost!',
      confirmLabel: 'Reset',
      danger: true,
    }))) return;
    try {
      await api.git.reset(repo.path, 'hard', entry.hash);
      toast.success(`Reset to ${shortHash(entry.hash)}`);
      await refreshStatus(repo.path);
      await load();
    } catch (e) {
      toast.error('Reset failed', String(e));
    }
  };

  const FILTERS: { key: typeof filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'commit', label: 'Commits' },
    { key: 'checkout', label: 'Checkouts' },
    { key: 'merge', label: 'Merges' },
    { key: 'rebase', label: 'Rebases' },
    { key: 'reset', label: 'Resets' },
    { key: 'other', label: 'Other' },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Journal</span>
          <span className="text-2xs text-text-tertiary">{filtered.length} entries</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title="Refresh" onClick={load}>
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
          <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <RotateCcw size={32} className="mb-2 opacity-50" />
            <div className="text-sm">No journal entries</div>
          </div>
        ) : (
          filtered.map((entry, idx) => (
            <div
              key={entry.index}
              className="group flex items-start gap-3 px-3 py-2 border-b border-border-subtle hover:bg-bg-hover"
              onContextMenu={(e) => {
                e.preventDefault();
                showContextMenu([
                  { label: 'View Commit in History', clickId: 'view-commit' },
                  { type: 'separator' },
                  { label: 'Copy Short Hash', clickId: 'copy-short' },
                  { label: 'Copy Full Hash', clickId: 'copy-full' },
                  { label: 'Copy Message', clickId: 'copy-msg' },
                  { type: 'separator' },
                  { label: 'Cherry-pick this commit...', clickId: 'cherry-pick' },
                  { label: 'Reset HEAD here (hard)...', clickId: 'reset-hard' },
                ], (action) => {
                  switch (action) {
                    case 'view-commit':
                      useSelectionStore.getState().selectCommit(entry.hash);
                      window.location.hash = '#/history';
                      break;
                    case 'copy-short': copyToClipboard(shortHash(entry.hash)); toast.success('Copied'); break;
                    case 'copy-full': copyToClipboard(entry.hash); toast.success('Copied'); break;
                    case 'copy-msg': copyToClipboard(entry.message); toast.success('Copied'); break;
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
                  title="Copy hash"
                  onClick={() => {
                    copyToClipboard(entry.hash);
                    toast.success('Hash copied');
                  }}
                >
                  <Copy size={10} />
                </button>
                <button
                  className="icon-btn !w-5 !h-5"
                  title="Cherry-pick this commit"
                  onClick={() => handleCherryPick(entry)}
                >
                  <GitCommit size={10} />
                </button>
                <button
                  className="icon-btn !w-5 !h-5 hover:!text-status-deleted"
                  title="Reset HEAD to here (hard)"
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
