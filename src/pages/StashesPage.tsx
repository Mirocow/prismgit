import { useState, useEffect, useCallback } from 'react';
import { Package, RefreshCw, Plus, Trash, Download, Upload, Check } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api, type StashEntry } from '../lib/api';
import { formatDate, shortHash } from '../lib/utils';
import { CommitHashLink } from '../components/StatusBar';

export function StashesPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
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

  const handlePop = async (index: number) => {
    if (!confirm(`Pop stash@{${index}}?`)) return;
    try {
      await api.git.stashPop(repo.path, index);
      toast.success('Stash popped');
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Stash pop failed', String(e));
    }
  };

  const handleApply = async (index: number) => {
    try {
      await api.git.stashApply(repo.path, index);
      toast.success('Stash applied');
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Stash apply failed', String(e));
    }
  };

  const handleDrop = async (index: number) => {
    if (!confirm(`Drop stash@{${index}}?`)) return;
    try {
      await api.git.stashDrop(repo.path, index);
      toast.success('Stash dropped');
      await load();
    } catch (e) {
      toast.error('Stash drop failed', String(e));
    }
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
          <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
        ) : stashes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <Package size={32} className="mb-2 opacity-50" />
            <div className="text-sm">No stashes</div>
            <div className="text-xs mt-1">Stash your changes to save them temporarily</div>
          </div>
        ) : (
          stashes.map((s) => (
            <div
              key={s.index}
              className="group flex items-center gap-3 px-3 py-2 border-b border-border-subtle hover:bg-bg-hover"
            >
              <code className="text-xs font-mono text-text-tertiary">
                stash@{'{' + s.index + '}'}
              </code>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary truncate">{s.message}</div>
                <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
                  <CommitHashLink hash={s.hash} />
                  <span>· {formatDate(s.date)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                <button
                  className="icon-btn !w-6 !h-6"
                  title="Apply"
                  onClick={() => handleApply(s.index)}
                >
                  <Check size={12} />
                </button>
                <button
                  className="icon-btn !w-6 !h-6"
                  title="Pop"
                  onClick={() => handlePop(s.index)}
                >
                  <Upload size={12} />
                </button>
                <button
                  className="icon-btn !w-6 !h-6 hover:!text-status-deleted"
                  title="Drop"
                  onClick={() => handleDrop(s.index)}
                >
                  <Trash size={12} />
                </button>
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
