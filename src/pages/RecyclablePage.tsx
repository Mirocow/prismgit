import { useState, useEffect, useCallback } from 'react';
import { RotateCcw, RefreshCw, Trash, Copy, AlertCircle, GitBranch, Plus, X } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api, type RecyclableCommit } from '../lib/api';
import { cn, formatDate, shortHash, copyToClipboard } from '../lib/utils';
import { CommitHashLink } from '../components/StatusBar';
import { useSelectionStore } from '../stores/selectionStore';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';

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
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
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
      toast.error('Failed to load recyclable commits', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCherryPick = async (hash: string) => {
    setBusyHash(hash);
    try {
      const result = await api.git.cherryPick(repo.path, [hash]);
      if (result.conflicts.length > 0) {
        setConflictInfo({ hash, files: result.conflicts });
        toast.warning(
          `Cherry-pick has ${result.conflicts.length} conflict${result.conflicts.length === 1 ? '' : 's'}`,
          'Resolve the conflicts in the Changes view, then commit.',
        );
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
        toast.success(`Cherry-picked ${shortHash(hash)}`, 'Commit applied to current branch.');
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
          `Cherry-pick of ${shortHash(hash)} is empty`,
          'The changes are already applied. The repository is now in cherry-picking state — use Skip in the banner to drop this commit, or Abort to cancel.',
        );
        // Refresh status so the global SequencerPanel banner appears.
        await refreshStatus(repo.path);
      } else if (/dirty index|uncommitted changes/i.test(msg)) {
        toast.error('Cherry-pick blocked', 'Commit or stash your current changes first.');
      } else {
        toast.error('Cherry-pick failed', msg);
      }
    } finally {
      setBusyHash(null);
    }
  };

  const handleCreateBranch = async (hash: string) => {
    const defaultName = `recover/${hash.substring(0, 8)}`;
    const name = await promptDialog({
      title: `Create branch at ${shortHash(hash)}`,
      message: 'Branch name for recovery (this does NOT switch to the new branch):',
      confirmLabel: 'Create branch',
      input: { initialValue: defaultName, placeholder: 'recover/abc12345' },
    });
    if (!name?.trim()) return;
    // Validate branch name (cheap client-side check)
    const trimmed = name.trim();
    if (/\s/.test(trimmed)) {
      toast.error('Invalid branch name', 'Branch names cannot contain whitespace.');
      return;
    }
    if (trimmed.startsWith('-') || trimmed.startsWith('/')) {
      toast.error('Invalid branch name', 'Branch name must not start with "-" or "/".');
      return;
    }
    setBusyHash(hash);
    try {
      await api.git.createBranch(repo.path, trimmed, hash);
      toast.success(`Created branch '${trimmed}'`, `At ${shortHash(hash)} — switch to it from Branches view.`);
      selectBranch(trimmed);
      await load();
    } catch (e) {
      const msg = String(e);
      if (/already exists|not a valid object|not a valid branch name/i.test(msg)) {
        toast.error('Create branch failed', msg);
      } else {
        toast.error('Create branch failed', msg);
      }
    } finally {
      setBusyHash(null);
    }
  };

  const handleExpireAll = async () => {
    if (!(await confirmDialog({
      title: 'Expire all recyclable commits?',
      message: `This runs \`git reflog expire --expire=now --all\` and \`git gc --prune=now\`.\n\n${commits.length} commit${commits.length === 1 ? '' : 's'} will be permanently lost. There is NO recovery after this.`,
      confirmLabel: 'Expire all',
      danger: true,
    }))) return;
    setBusyHash('expire-all');
    try {
      await api.git.raw(repo.path, ['reflog', 'expire', '--expire=now', '--all']);
      await api.git.raw(repo.path, ['gc', '--prune=now']);
      toast.success('Recyclable commits expired', `${commits.length} commit${commits.length === 1 ? '' : 's'} pruned.`);
      await load();
    } catch (e) {
      toast.error('Expire failed', String(e));
    } finally {
      setBusyHash(null);
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
              disabled={busyHash === 'expire-all'}
              title="Run git reflog expire --expire=now --all && git gc --prune=now"
            >
              <Trash size={11} /> Expire all
            </button>
          )}
        </div>
      </div>

      {/* Info banner — explain what "recyclable" means + retention */}
      <div className="px-3 py-1.5 border-b border-border-subtle bg-bg-tertiary flex items-center gap-2">
        <AlertCircle size={12} className="text-status-warning flex-shrink-0" />
        <span className="text-2xs text-text-secondary">
          <strong>Recyclable commits</strong> are unreachable from any branch or tag.
          They will be <strong>garbage-collected after 90 days</strong> (default reflog retention).
          Recover them by creating a branch or cherry-picking onto the current branch.
        </span>
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
            {filtered.map((c, i) => {
              const isBusy = busyHash === c.hash;
              return (
                <div
                  key={c.hash}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border-subtle hover:bg-bg-hover cursor-pointer group',
                    i % 2 === 0 ? '' : 'bg-bg-tertiary/30',
                    isBusy && 'opacity-50'
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
                      className="icon-btn !w-5 !h-5 !text-accent hover:!bg-accent-muted"
                      title="Create branch at this commit  (no checkout)"
                      disabled={isBusy}
                      onClick={(e) => { e.stopPropagation(); handleCreateBranch(c.hash); }}
                    >
                      <GitBranch size={11} />
                    </button>
                    <button
                      className="icon-btn !w-5 !h-5 !text-status-added hover:!bg-status-added/15"
                      title="Cherry-pick onto current branch"
                      disabled={isBusy}
                      onClick={(e) => { e.stopPropagation(); handleCherryPick(c.hash); }}
                    >
                      <Plus size={11} />
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
              );
            })}
          </>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1 border-t border-border-default bg-bg-tertiary text-2xs text-text-tertiary">
        Hover a row · <GitBranch size={9} className="inline" /> Create branch (recover) · <Plus size={9} className="inline" /> Cherry-pick onto current · Click row = view commit
      </div>
    </div>
  );
}
