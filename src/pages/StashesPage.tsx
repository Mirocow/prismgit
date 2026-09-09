import { useState, useEffect, useCallback } from 'react';
import { Package, RefreshCw, Plus, Trash, Download, Upload, Check, FileText, ChevronDown, ChevronRight, X } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api, type StashEntry, type DiffResult } from '../lib/api';
import { formatDate, shortHash } from '../lib/utils';
import { CommitHashLink } from '../components/StatusBar';
import { DiffViewer } from '../components/DiffViewer';
import { cn } from '../lib/utils';

export function StashesPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [stashMessage, setStashMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(false);
  // View stash content (diff)
  const [viewingStash, setViewingStash] = useState<number | null>(null);
  const [stashDiff, setStashDiff] = useState<DiffResult | null>(null);
  const [stashDiffLoading, setStashDiffLoading] = useState(false);

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
    if (!confirm(`Pop stash@{${stash.index}}?\n\nThis will apply the stashed changes to your working tree and remove the stash.\n\nStash message: "${stash.message}"`)) return;
    try {
      await api.git.stashPop(repo.path, stash.index);
      toast.success(`Stash@{${stash.index}} popped`);
      setViewingStash(null);
      setStashDiff(null);
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
    if (!confirm(`Drop stash@{${stash.index}}?\n\nThis will permanently delete the stash.\n\nStash message: "${stash.message}"`)) return;
    try {
      await api.git.stashDrop(repo.path, stash.index);
      toast.success(`Stash@{${stash.index}} dropped`);
      setViewingStash(null);
      setStashDiff(null);
      await load();
    } catch (e) {
      toast.error('Stash drop failed', String(e));
    }
  };

  // View stash content — shows diff between stash and its parent
  const handleViewStash = async (stash: StashEntry) => {
    if (viewingStash === stash.index) {
      setViewingStash(null);
      setStashDiff(null);
      return;
    }
    setViewingStash(stash.index);
    setStashDiffLoading(true);
    setStashDiff(null);
    try {
      // git stash show -p stash@{N} shows the diff of the stash vs its base
      const rawDiff = await api.git.raw(repo.path, ['stash', 'show', '-p', '--no-color', `stash@{${stash.index}}`]);
      // Parse the raw diff into DiffResult structure
      const lines = rawDiff.split('\n');
      const hunks: any[] = [];
      let currentHunk: any = null;
      let oldLine = 0, newLine = 0;
      for (const line of lines) {
        if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) continue;
        if (line.startsWith('@@')) {
          if (currentHunk) hunks.push(currentHunk);
          const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
          if (match) {
            currentHunk = {
              oldStart: parseInt(match[1]), oldLines: parseInt(match[2] || '1'),
              newStart: parseInt(match[3]), newLines: parseInt(match[4] || '1'),
              header: line, lines: []
            };
            oldLine = parseInt(match[1]);
            newLine = parseInt(match[3]);
          }
          continue;
        }
        if (currentHunk) {
          if (line.startsWith('+')) {
            currentHunk.lines.push({ type: 'add', content: line.substring(1), oldLineNumber: null, newLineNumber: newLine++ });
          } else if (line.startsWith('-')) {
            currentHunk.lines.push({ type: 'del', content: line.substring(1), oldLineNumber: oldLine++, newLineNumber: null });
          } else if (line.startsWith(' ')) {
            currentHunk.lines.push({ type: 'context', content: line.substring(1), oldLineNumber: oldLine++, newLineNumber: newLine++ });
          }
        }
      }
      if (currentHunk) hunks.push(currentHunk);
      setStashDiff({
        oldContent: '', newContent: '', oldPath: `stash@{${stash.index}}`, newPath: `stash@{${stash.index}}`,
        hunks, binary: false, newFile: false, deletedFile: false, renamedFile: false,
      });
    } catch (e) {
      toast.error('Failed to load stash diff', String(e));
    } finally {
      setStashDiffLoading(false);
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
            <div key={s.index}>
              <div
                className="group flex items-center gap-3 px-3 py-2 border-b border-border-subtle hover:bg-bg-hover cursor-pointer"
                onClick={() => handleViewStash(s)}
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
                {/* Expand/collapse indicator */}
                <span className="flex-shrink-0 text-text-tertiary">
                  {viewingStash === s.index ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="icon-btn !w-6 !h-6"
                    title="View stash content"
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
                    className="icon-btn !w-6 !h-6 hover:!text-status-deleted"
                    title="Drop (delete)"
                    onClick={() => handleDrop(s)}
                  >
                    <Trash size={12} />
                  </button>
                </div>
              </div>
              {/* Stash content diff viewer — expandable */}
              {viewingStash === s.index && (
                <div className="border-b border-border-default bg-bg-primary max-h-96 overflow-y-auto">
                  {stashDiffLoading ? (
                    <div className="p-4 text-center text-text-tertiary text-xs">Loading stash diff...</div>
                  ) : stashDiff ? (
                    <DiffViewer diff={stashDiff} filePath={`stash@{${s.index}}`} />
                  ) : (
                    <div className="p-4 text-center text-text-tertiary text-xs">No diff content</div>
                  )}
                </div>
              )}
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
