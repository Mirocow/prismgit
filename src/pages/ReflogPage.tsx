import { useState, useEffect, useCallback } from 'react';
import { History, RefreshCw, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { api, type ReflogEntry } from '../lib/api';
import { cn, formatDate, shortHash, copyToClipboard } from '../lib/utils';

const REFS = ['HEAD', 'ORIG_HEAD', 'refs/heads', 'refs/remotes'];

export function ReflogPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
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
      toast.error('Failed to load reflog', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, ref, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (entry: ReflogEntry) => {
    if (!confirm(`Delete reflog entry ${entry.selector}?`)) return;
    try {
      await api.git.reflogDelete(repo.path, entry.index, ref);
      toast.success('Reflog entry deleted');
      await load();
    } catch (e) {
      toast.error('Failed to delete', String(e));
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Reflog</span>
          <button
            className="text-xs px-2 py-0.5 bg-bg-tertiary rounded flex items-center gap-1 hover:bg-bg-hover"
            onClick={() => setShowRefPicker(!showRefPicker)}
          >
            <span className="font-mono text-accent">{ref}</span>
            {showRefPicker ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
          <span className="text-2xs text-text-tertiary">{entries.length} entries</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title="Refresh" onClick={load}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {showRefPicker && (
        <div className="border-b border-border-default bg-bg-tertiary p-2">
          <input
            type="text"
            className="w-full text-sm font-mono"
            placeholder="Enter ref name (e.g., HEAD, refs/heads/main, refs/heads/feature/branch)"
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
          <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <History size={32} className="mb-2 opacity-50" />
            <div className="text-sm">No reflog entries</div>
            <div className="text-xs mt-1">The reflog is empty for {ref}</div>
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.index}
              className="group flex items-start gap-3 px-3 py-2 border-b border-border-subtle hover:bg-bg-hover"
            >
              <code className="text-xs font-mono text-text-tertiary flex-shrink-0 mt-0.5">
                {entry.selector}
              </code>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary">{entry.message}</div>
                <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
                  <code className="font-mono">{shortHash(entry.hash)}</code>
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
                  <span className="text-2xs">copy</span>
                </button>
                <button
                  className="icon-btn !w-5 !h-5 hover:!text-status-deleted"
                  title="Delete entry"
                  onClick={() => handleDelete(entry)}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
