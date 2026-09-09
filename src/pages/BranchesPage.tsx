import { useState, useEffect, useCallback } from 'react';
import { GitBranch, Plus, RefreshCw, Trash, GitMerge, Edit, Check, ArrowUp, ArrowDown, ExternalLink, Upload } from '../components/icons';
import { MergePanel } from '../components/MergePanel';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api, type BranchInfo } from '../lib/api';
import { cn, formatDate, shortHash } from '../lib/utils';

export function BranchesPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const { status, refreshStatus } = useGitStore();
  const toast = useToastStore();
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchStart, setNewBranchStart] = useState('HEAD');
  const [newBranchCheckout, setNewBranchCheckout] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.branches(repo.path);
      setBranches(result);
    } catch (e) {
      toast.error('Failed to load branches', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCheckout = async (branch: BranchInfo) => {
    if (branch.current) return;
    try {
      await api.git.checkout(repo.path, branch.name);
      toast.success(`Checked out ${branch.name}`);
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Checkout failed', String(e));
    }
  };

  const handleCreate = async () => {
    if (!newBranchName.trim()) {
      toast.warning('Branch name is required');
      return;
    }
    try {
      await api.git.createBranch(repo.path, newBranchName, newBranchStart || undefined);
      if (newBranchCheckout) {
        await api.git.checkout(repo.path, newBranchName);
      }
      toast.success(`Branch '${newBranchName}' created`);
      setShowNewDialog(false);
      setNewBranchName('');
      setNewBranchStart('HEAD');
      setNewBranchCheckout(true);
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Failed to create branch', String(e));
    }
  };

  const handleDelete = async (branch: BranchInfo) => {
    if (!confirm(`Delete branch '${branch.name}'?`)) return;
    try {
      await api.git.deleteBranch(repo.path, branch.name, false);
      toast.success(`Branch '${branch.name}' deleted`);
      await load();
    } catch (e) {
      toast.error('Failed to delete branch', String(e));
    }
  };

  const handleRename = async (oldName: string) => {
    if (!renameValue.trim()) {
      setRenaming(null);
      return;
    }
    try {
      await api.git.renameBranch(repo.path, oldName, renameValue);
      toast.success(`Renamed to '${renameValue}'`);
      setRenaming(null);
      setRenameValue('');
      await load();
    } catch (e) {
      toast.error('Rename failed', String(e));
    }
  };

  const handleMerge = async (branch: string) => {
    try {
      const result = await api.git.merge(repo.path, branch, { noFf: false });
      if (result.conflicts.length > 0) {
        toast.warning(
          `Merge conflicts in ${result.conflicts.length} files`,
          result.conflicts.join(', ')
        );
      } else {
        toast.success(`Merged ${branch}`);
      }
      setMergeTarget(null);
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Merge failed', String(e));
    }
  };

  const handlePushBranch = async (branch: BranchInfo) => {
    try {
      await api.git.push(repo.path, 'origin', branch.name, true);
      toast.success(`Branch '${branch.name}' pushed`);
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Push failed', String(e));
    }
  };

  const handleOpenInBrowser = async (branch: BranchInfo) => {
    try {
      const info = await api.git.extractRepoInfo(repo.path);
      if (info.webUrl && info.provider !== 'unknown') {
        const url = `${info.webUrl}/tree/${branch.name}`;
        api.app.openExternal(url);
      } else {
        toast.info('Repository has no remote URL');
      }
    } catch (e) {
      toast.error('Failed to open in browser', String(e));
    }
  };

  const handleDeleteRemote = async (branch: BranchInfo) => {
    const remoteBranch = branch.name.replace(/^[^/]+\//, '');
    if (!confirm(`Delete remote branch '${branch.name}'?`)) return;
    try {
      await api.git.deleteBranch(repo.path, remoteBranch, true, true);
      toast.success(`Remote branch '${remoteBranch}' deleted`);
      await load();
    } catch (e) {
      toast.error('Failed to delete remote branch', String(e));
    }
  };

  const filtered = branches.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase())
  );

  const localBranches = filtered.filter((b) => !b.remote);
  const remoteBranches = filtered.filter((b) => b.remote);

  const renderBranchRow = (b: BranchInfo) => (
    <div
      key={b.name}
      className={cn(
        'group flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-border-subtle',
        b.current ? 'bg-accent-muted' : 'hover:bg-bg-hover'
      )}
      onClick={() => !b.remote && handleCheckout(b)}
    >
      <GitBranch
        size={14}
        className={b.current ? 'text-accent' : 'text-text-tertiary'}
      />
      <div className="flex-1 min-w-0">
        {renaming === b.name ? (
          <input
            type="text"
            className="text-xs w-full"
            value={renameValue}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename(b.name);
              if (e.key === 'Escape') setRenaming(null);
            }}
            onBlur={() => handleRename(b.name)}
          />
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-primary truncate">{b.name}</span>
            {b.current && (
              <span className="badge badge-added">CURRENT</span>
            )}
            {b.tracking && (
              <span className="text-2xs text-text-tertiary">→ {b.tracking}</span>
            )}
          </div>
        )}
        {b.lastCommit && (
          <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
            <code className="font-mono">{b.lastCommit.hash}</code>
            <span className="truncate">{b.lastCommit.message}</span>
            <span>· {formatDate(b.lastCommit.date)}</span>
          </div>
        )}
      </div>
      {(b.ahead !== undefined && b.ahead > 0) && (
        <span className="text-2xs text-status-added flex items-center">
          <ArrowUp size={10} className="mr-0.5" />
          {b.ahead}
        </span>
      )}
      {(b.behind !== undefined && b.behind > 0) && (
        <span className="text-2xs text-status-modified flex items-center">
          <ArrowDown size={10} className="mr-0.5" />
          {b.behind}
        </span>
      )}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
        {!b.current && !b.remote && (
          <>
            <button
              className="icon-btn !w-6 !h-6"
              title="Push to remote"
              onClick={(e) => {
                e.stopPropagation();
                handlePushBranch(b);
              }}
            >
              <Upload size={12} />
            </button>
            <button
              className="icon-btn !w-6 !h-6"
              title="Merge into current"
              onClick={(e) => {
                e.stopPropagation();
                setMergeTarget(b.name);
              }}
            >
              <GitMerge size={12} />
            </button>
            <button
              className="icon-btn !w-6 !h-6"
              title="Open in browser"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenInBrowser(b);
              }}
            >
              <ExternalLink size={12} />
            </button>
            <button
              className="icon-btn !w-6 !h-6"
              title="Rename"
              onClick={(e) => {
                e.stopPropagation();
                setRenaming(b.name);
                setRenameValue(b.name);
              }}
            >
              <Edit size={12} />
            </button>
            <button
              className="icon-btn !w-6 !h-6 hover:!text-status-deleted"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(b);
              }}
            >
              <Trash size={12} />
            </button>
          </>
        )}
        {b.remote && (
          <>
            <button
              className="icon-btn !w-6 !h-6"
              title="Open in browser"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenInBrowser(b);
              }}
            >
              <ExternalLink size={12} />
            </button>
            <button
              className="icon-btn !w-6 !h-6 hover:!text-status-deleted"
              title="Delete remote branch"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteRemote(b);
              }}
            >
              <Trash size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Branches</span>
          <span className="text-2xs text-text-tertiary">
            {localBranches.length} local · {remoteBranches.length} remote
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-xs w-48"
          />
          <button className="icon-btn" title="Refresh" onClick={load}>
            <RefreshCw size={13} />
          </button>
          <button
            className="btn btn-primary text-xs"
            onClick={() => setShowNewDialog(true)}
          >
            <Plus size={12} />
            New Branch
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Local */}
        <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-b border-border-default">
          Local
        </div>
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
        ) : (
          localBranches.map(renderBranchRow)
        )}

        {/* Remote */}
        <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-y border-border-default mt-2">
          Remote
        </div>
        {remoteBranches.map(renderBranchRow)}
      </div>

      {/* New branch dialog */}
      {showNewDialog && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowNewDialog(false)}
        >
          <div
            className="panel w-96 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-medium mb-4">New Branch</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Name</label>
                <input
                  type="text"
                  className="w-full text-sm"
                  placeholder="feature/my-branch"
                  value={newBranchName}
                  autoFocus
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                />
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Starting point</label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  value={newBranchStart}
                  onChange={(e) => setNewBranchStart(e.target.value)}
                  placeholder="HEAD, branch name, or commit hash"
                />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={newBranchCheckout}
                  onChange={(e) => setNewBranchCheckout(e.target.checked)}
                />
                Checkout after creation
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowNewDialog(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleCreate}>
                <Check size={13} />
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge panel - SmartGit-like with conflict resolution UI */}
      {mergeTarget && (
        <MergePanel
          targetBranch={mergeTarget}
          onClose={() => setMergeTarget(null)}
        />
      )}
    </div>
  );
}
