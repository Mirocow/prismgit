import { useState, useEffect, useCallback } from 'react';
import { RotateCcw, RefreshCw, Trash, Copy, AlertCircle } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api, type RecyclableCommit } from '../lib/api';
import { cn, formatDate, shortHash, copyToClipboard } from '../lib/utils';
import { CommitHashLink } from '../components/StatusBar';
import { useSelectionStore } from '../stores/selectionStore';
import { confirmDialog } from '../components/ConfirmDialog';

/**
 * Recyclable Commits — unreachable reflog commits that are eligible for GC.
 * SmartGit Manual: "Recyclable Commits checkbox in Branches View shows commits
 * found in .git/logs files (i.e., reflog commits not reachable from any ref).
 * Recyclable commits are eligible for GC after the configured retention period
 * (default 90 days)."
 *
 * This page surfaces those commits, lets the user recover them via cherry-pick
 * or branch creation, or expire them via `git reflog expire`.
 */
export function RecyclablePage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const selectCommit = useSelectionStore((s) => s.selectCommit);
  const [commits, setCommits] = useState<RecyclableCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.recyclableCommits(repo.path);
      setCommits(result);
    } catch (e) {
      toast.error('Failed to load recyclable commits', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCherryPick = async (hash: string) => {
    try {
      const result = await api.git.cherryPick(repo.path, [hash]);
      if (result.conflicts.length > 0) {
        toast.warning(`Cherry-pick conflicts in ${result.conflicts.length} files`, 'Resolve them on the Changes page, then press Continue');
      } else if (result.empty) {
        // "The previous cherry-pick is now empty" — the commit's changes are
        // already applied to HEAD. The repo stays in cherry-picking-state and
        // MUST be resolved on the Changes page (Skip / Commit Empty / Abort).
        toast.warning(
          'The cherry-pick is empty — these changes are already applied',
          'Resolve it on the Changes page: Skip (drop) or Commit Empty'
        );
      } else if (result.error) {
        toast.error('Cherry-pick failed', result.error);
      } else {
        toast.success(`Cherry-picked ${shortHash(hash)}`);
      }
      await refreshStatus(repo.path);
      await load();
    } catch (e) {
      toast.error('Cherry-pick failed', String(e));
    }
  };

  const handleCreateBranch = async (hash: string) => {
    const name = window.prompt('Branch name for recovery:', `recover/${hash.substring(0, 8)}`);
    if (!name) return;
    try {
      await api.git.createBranch(repo.path, name, hash);
      toast.success(`Created branch '${name}' at ${shortHash(hash)}`);
    } catch (e) {
      toast.error('Create branch failed', String(e));
    }
  };

  const handleExpireAll = async () => {
    if (!(await confirmDialog({
      title: 'Expire all recyclable commits',
      message: `This will run \`git reflog expire --expire=now --all\` and prune unreachable commits. ${commits.length} commits will be permanently lost.`,
      confirmLabel: 'Expire all',
      danger: true,
    }))) return;
    try {
      await api.git.raw(repo.path, ['reflog', 'expire', '--expire=now', '--all']);
      await api.git.raw(repo.path, ['gc', '--prune=now']);
      toast.success('Recyclable commits expired');
      await load();
    } catch (e) {
      toast.error('Expire failed', String(e));
    }
  };

  const filtered = commits.filter(c =>
    c.subject.toLowerCase().includes(search.toLowerCase()) ||
    c.hash.toLowerCase().includes(search.toLowerCase()) ||
    c.source.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <RotateCcw size={14} className="text-accent" />
          <span className="text-sm font-medium">Recyclable Commits</span>
          <span className="text-2xs text-text-tertiary">
            {commits.length} unreachable · {filtered.length} shown
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title="Refresh" onClick={load}>
            <RefreshCw size={13} />
          </button>
          {commits.length > 0 && (
            <button
              className="btn btn-danger text-xs"
              onClick={handleExpireAll}
              title="Run git reflog expire --expire=now --all && git gc --prune=now"
            >
              <Trash size={11} /> Expire all
            </button>
          )}
        </div>
      </div>

      <div className="px-3 py-1.5 border-b border-border-subtle bg-bg-tertiary">
        <input
          type="text"
          className="w-full text-xs"
          placeholder="Filter by subject, hash, or source..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <AlertCircle size={32} className="mb-2 opacity-50" />
            <div className="text-sm">No recyclable commits</div>
            <div className="text-xs mt-1">
              All reflog commits are reachable from branches or tags.
            </div>
          </div>
        ) : (
          <>
            <div className="px-3 py-1.5 text-2xs text-text-tertiary bg-bg-tertiary border-b border-border-subtle">
              Unreachable commits will be garbage-collected after 90 days (default). Recover them by creating a branch or cherry-picking.
            </div>
            {filtered.map((c, i) => (
              <div
                key={c.hash}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border-subtle hover:bg-bg-hover cursor-pointer group',
                  i % 2 === 0 ? '' : 'bg-bg-tertiary/30'
                )}
                onClick={() => selectCommit(c.hash)}
              >
                <span className="text-text-tertiary group-hover:text-accent">●</span>
                <CommitHashLink hash={c.hash} short className="font-mono text-accent shrink-0" />
                <span className="flex-1 truncate" title={c.subject}>{c.subject}</span>
                <span className="text-2xs text-text-tertiary font-mono shrink-0" title={c.source}>{c.source}</span>
                <span className="text-2xs text-text-tertiary shrink-0">{formatDate(c.date)}</span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    className="icon-btn !w-5 !h-5"
                    title="Create branch at this commit"
                    onClick={(e) => { e.stopPropagation(); handleCreateBranch(c.hash); }}
                  >
                    <span className="text-2xs">⎇</span>
                  </button>
                  <button
                    className="icon-btn !w-5 !h-5"
                    title="Cherry-pick this commit"
                    onClick={(e) => { e.stopPropagation(); handleCherryPick(c.hash); }}
                  >
                    <span className="text-2xs">+</span>
                  </button>
                  <button
                    className="icon-btn !w-5 !h-5"
                    title="Copy hash"
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(c.hash); toast.success('Copied'); }}
                  >
                    <Copy size={10} />
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
