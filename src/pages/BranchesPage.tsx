import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, Plus, RefreshCw, Trash, GitMerge, Check, ArrowUp, ArrowDown,
  ExternalLink, Upload, ChevronDown, ChevronRight, X, Pencil,
} from '../components/icons';
import { MergePanel } from '../components/MergePanel';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type BranchInfo } from '../lib/api';
import { useContextMenu, type ContextMenuItem } from '../lib/useContextMenu';
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
  const [draggedBranch, setDraggedBranch] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const showContextMenu = useContextMenu();

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

  useEffect(() => { load(); }, [load]);

  const handleCheckout = async (branch: BranchInfo) => {
    if (branch.current) return;
    try {
      await api.git.checkout(repo.path, branch.name);
      toast.success(`Checked out ${branch.name}`);
      await load();
      await refreshStatus(repo.path);
    } catch (e) { toast.error('Checkout failed', String(e)); }
  };

  const handleCreate = async () => {
    if (!newBranchName.trim()) { toast.warning('Name required'); return; }
    try {
      await api.git.createBranch(repo.path, newBranchName, newBranchStart || undefined);
      if (newBranchCheckout) await api.git.checkout(repo.path, newBranchName);
      toast.success(`Branch '${newBranchName}' created`);
      setShowNewDialog(false);
      setNewBranchName(''); setNewBranchStart('HEAD'); setNewBranchCheckout(true);
      await load();
      await refreshStatus(repo.path);
    } catch (e) { toast.error('Failed', String(e)); }
  };

  const handleDelete = async (branch: BranchInfo) => {
    if (!confirm(`Delete branch '${branch.name}'?`)) return;
    try {
      await api.git.deleteBranch(repo.path, branch.name, false, branch.remote);
      toast.success(`Deleted '${branch.name}'`);
      await load();
    } catch (e) { toast.error('Delete failed', String(e)); }
  };

  const handleDeleteRemote = async (branch: BranchInfo) => {
    const remoteBranch = branch.name.replace(/^[^/]+\//, '');
    if (!confirm(`Delete remote branch '${branch.name}'?`)) return;
    try {
      await api.git.deleteBranch(repo.path, remoteBranch, true, true);
      toast.success(`Deleted remote '${remoteBranch}'`);
      await load();
    } catch (e) { toast.error('Failed', String(e)); }
  };

  const handleRename = async (oldName: string) => {
    if (!renameValue.trim()) { setRenaming(null); return; }
    try {
      await api.git.renameBranch(repo.path, oldName, renameValue);
      toast.success(`Renamed to '${renameValue}'`);
      setRenaming(null); setRenameValue('');
      await load();
    } catch (e) { toast.error('Rename failed', String(e)); }
  };

  const handleMerge = async (branch: string) => {
    setMergeTarget(branch);
  };

  const handlePushBranch = async (branch: BranchInfo) => {
    try {
      await api.git.push(repo.path, 'origin', branch.name, !branch.tracking);
      toast.success(`Pushed '${branch.name}'`);
      await load();
      await refreshStatus(repo.path);
    } catch (e) { toast.error('Push failed', String(e)); }
  };

  const handleOpenInBrowser = async (branch: BranchInfo) => {
    try {
      const info = await api.git.extractRepoInfo(repo.path);
      if (info.webUrl) api.app.openExternal(`${info.webUrl}/tree/${branch.name}`);
      else toast.info('No remote URL');
    } catch (e) { toast.error('Failed', String(e)); }
  };

  const toggleGroup = (group: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const showBranchContextMenu = (e: React.MouseEvent, b: BranchInfo) => {
    e.preventDefault();
    e.stopPropagation();
    const items: ContextMenuItem[] = [];
    if (!b.current && !b.remote) {
      items.push({ label: 'Checkout', clickId: 'checkout' });
      items.push({ type: 'separator' });
      items.push({ label: 'Merge into current', clickId: 'merge' });
      items.push({ label: 'Rebase onto this branch', clickId: 'rebase' });
      items.push({ type: 'separator' });
      items.push({ label: 'Push to origin', clickId: 'push' });
      items.push({ label: 'Rename...', clickId: 'rename' });
      items.push({ label: 'Delete', clickId: 'delete' });
    } else if (b.remote) {
      items.push({ label: 'Create local branch from...', clickId: 'create-local' });
      items.push({ type: 'separator' });
      items.push({ label: 'Merge into current', clickId: 'merge' });
      items.push({ type: 'separator' });
      items.push({ label: 'Open in Browser', clickId: 'browser' });
      items.push({ label: 'Delete remote branch', clickId: 'delete-remote' });
    }
    if (items.length > 0) {
      showContextMenu(items, (action) => {
        if (action === 'checkout') handleCheckout(b);
        else if (action === 'merge') handleMerge(b.name);
        else if (action === 'rebase') api.git.rebase(repo.path, b.name).then(() => { toast.success('Rebase started'); refreshStatus(repo.path); }).catch((e) => toast.error('Rebase failed', String(e)));
        else if (action === 'push') handlePushBranch(b);
        else if (action === 'rename') { setRenaming(b.name); setRenameValue(b.name); }
        else if (action === 'delete') handleDelete(b);
        else if (action === 'create-local') { const name = b.name.replace(/^[^/]+\//, ''); setNewBranchName(name); setNewBranchStart(b.name); setNewBranchCheckout(true); setShowNewDialog(true); }
        else if (action === 'browser') handleOpenInBrowser(b);
        else if (action === 'delete-remote') handleDeleteRemote(b);
      });
    }
  };

  const filtered = branches.filter(b => b.name.toLowerCase().includes(search.toLowerCase()));

  // Group branches: Local, then by remote
  const localBranches = filtered.filter(b => !b.remote);
  const remoteGroups: Record<string, BranchInfo[]> = {};
  for (const b of filtered.filter(b => b.remote)) {
    const remoteName = b.name.split('/')[0];
    if (!remoteGroups[remoteName]) remoteGroups[remoteName] = [];
    remoteGroups[remoteName].push(b);
  }

  const renderBranchRow = (b: BranchInfo) => {
    const isRenaming = renaming === b.name;
    return (
      <div
        key={b.name}
        className={cn(
          'group flex items-center gap-2 px-3 py-1 cursor-pointer text-xs border-b border-border-subtle hover:bg-bg-hover',
          b.current && 'bg-bg-active font-medium',
          draggedBranch === b.name && 'opacity-50'
        )}
        draggable={!b.remote}
        onDragStart={(e) => { setDraggedBranch(b.name); e.dataTransfer.effectAllowed = 'move'; }}
        onDragEnd={() => setDraggedBranch(null)}
        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
        onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('drag-over');
          if (draggedBranch && draggedBranch !== b.name) {
            // Drop draggedBranch onto b → merge draggedBranch into b
            // If b is current branch — just merge draggedBranch into current.
            // Otherwise: do NOT auto-checkout; just open the merge panel targeting draggedBranch
            // (user can decide to checkout first via the panel).
            if (b.current) {
              handleMerge(draggedBranch);
            } else {
              // Open merge panel; user can review before commit
              handleMerge(draggedBranch);
              toast.info(`Drop target '${b.name}' is not the current branch — merge will go into current branch.`);
            }
          }
          setDraggedBranch(null);
        }}
        onClick={(e) => {
          // Ctrl/Cmd-click: select branch in global store (no checkout) — propagates to History filter
          if (e.ctrlKey || e.metaKey) {
            useSelectionStore.getState().selectBranch(b.name);
            toast.info(`Selected branch '${b.name}' — visible in History filter`);
            return;
          }
          // Plain click: select in global store AND navigate to History to see this branch's log
          useSelectionStore.getState().selectBranch(b.name);
          if (!b.current) handleCheckout(b);
        }}
        onContextMenu={(e) => showBranchContextMenu(e, b)}
      >
        {/* Current branch indicator */}
        <span className="w-3 flex-shrink-0">
          {b.current && <span className="text-text-primary">▶</span>}
        </span>
        <GitBranch size={12} className={b.current ? 'text-accent' : 'text-text-tertiary'} flex-shrink-0 />
        {/* Name or rename input */}
        <div className="flex-1 min-w-0">
          {isRenaming ? (
            <input
              type="text" className="text-xs w-full" value={renameValue} autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRename(b.name); if (e.key === 'Escape') setRenaming(null); }}
              onBlur={() => handleRename(b.name)}
            />
          ) : (
            <div className="flex items-center gap-2">
              <span className="truncate">{b.name}</span>
              {b.tracking && <span className="text-2xs text-text-tertiary">→ {b.tracking}</span>}
              {b.ahead !== undefined && b.ahead > 0 && (
                <span className="text-2xs text-status-added flex items-center gap-0.5">
                  <ArrowUp size={9} />{b.ahead}
                </span>
              )}
              {b.behind !== undefined && b.behind > 0 && (
                <span className="text-2xs text-status-modified flex items-center gap-0.5">
                  <ArrowDown size={9} />{b.behind}
                </span>
              )}
            </div>
          )}
        </div>
        {/* Last commit info */}
        {b.lastCommit && (
          <div className="flex items-center gap-1 text-2xs text-text-tertiary flex-shrink-0">
            <code className="font-mono">{shortHash(b.lastCommit.hash)}</code>
            <span className="hidden lg:inline truncate" style={{ maxWidth: 150 }}>{b.lastCommit.message}</span>
            <span>· {formatDate(b.lastCommit.date)}</span>
          </div>
        )}
        {/* Hover actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
          {!b.current && !b.remote && (
            <>
              <button className="icon-btn !w-5 !h-5" title="Merge into current"
                onClick={(e) => { e.stopPropagation(); handleMerge(b.name); }}>
                <GitMerge size={11} />
              </button>
              <button className="icon-btn !w-5 !h-5" title="Push"
                onClick={(e) => { e.stopPropagation(); handlePushBranch(b); }}>
                <Upload size={11} />
              </button>
              <button className="icon-btn !w-5 !h-5" title="Rename"
                onClick={(e) => { e.stopPropagation(); setRenaming(b.name); setRenameValue(b.name); }}>
                <Pencil size={11} />
              </button>
              <button className="icon-btn !w-5 !h-5 hover:!text-status-deleted" title="Delete"
                onClick={(e) => { e.stopPropagation(); handleDelete(b); }}>
                <Trash size={11} />
              </button>
            </>
          )}
          {b.remote && (
            <>
              <button className="icon-btn !w-5 !h-5" title="Merge into current"
                onClick={(e) => { e.stopPropagation(); handleMerge(b.name); }}>
                <GitMerge size={11} />
              </button>
              <button className="icon-btn !w-5 !h-5" title="Open in browser"
                onClick={(e) => { e.stopPropagation(); handleOpenInBrowser(b); }}>
                <ExternalLink size={11} />
              </button>
              <button className="icon-btn !w-5 !h-5 hover:!text-status-deleted" title="Delete remote"
                onClick={(e) => { e.stopPropagation(); handleDeleteRemote(b); }}>
                <Trash size={11} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderGroup = (label: string, count: number, items: BranchInfo[], groupKey: string) => {
    const collapsed = collapsedGroups.has(groupKey);
    return (
      <div key={groupKey}>
        <div
          className="flex items-center gap-1 px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-b border-border-default cursor-pointer hover:bg-bg-hover"
          onClick={() => toggleGroup(groupKey)}
        >
          {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          <span>{label}</span>
          <span className="text-text-tertiary">({count})</span>
        </div>
        {!collapsed && items.map(renderBranchRow)}
      </div>
    );
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-border-default bg-bg-tertiary" style={{ height: 28 }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Branches</span>
          <span className="text-2xs text-text-tertiary">
            {localBranches.length} local · {Object.values(remoteGroups).reduce((a, b) => a + b.length, 0)} remote
          </span>
        </div>
        <div className="flex items-center gap-1">
          <input type="text" placeholder="Filter..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="text-xs w-32 px-2 py-0.5" />
          <button className="icon-btn !w-5 !h-5" title="Refresh" onClick={load}>
            <RefreshCw size={11} />
          </button>
          <button className="btn btn-primary text-2xs !py-0.5 !px-2" onClick={() => setShowNewDialog(true)}>
            <Plus size={11} /> New
          </button>
        </div>
      </div>

      {/* Branch list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-text-tertiary text-sm">
            {search ? 'No branches match' : 'No branches'}
          </div>
        ) : (
          <>
            {/* Local branches */}
            {renderGroup('Local Branches', localBranches.length, localBranches, 'local')}

            {/* Remote groups */}
            {Object.entries(remoteGroups).map(([remoteName, remoteBranches]) => {
              // Try to get remote URL
              const remoteBranch = remoteBranches[0];
              const remoteUrl = remoteBranch?.name.includes('origin') ? status?.tracking?.split('->')[1]?.trim() : '';
              return renderGroup(
                `${remoteName}${remoteUrl ? ` — ${remoteUrl}` : ''}`,
                remoteBranches.length,
                remoteBranches,
                `remote-${remoteName}`
              );
            })}
          </>
        )}
      </div>

      {/* Info bar at bottom */}
      <div className="px-3 py-1 border-t border-border-default bg-bg-tertiary text-2xs text-text-tertiary">
        Tip: Drag a branch onto another to merge · Right-click for more actions
      </div>

      {/* New branch dialog */}
      {showNewDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNewDialog(false)}>
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4 flex items-center gap-2">
              <GitBranch size={16} /> New Branch
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Name</label>
                <input type="text" className="w-full text-sm" placeholder="feature/my-branch"
                  value={newBranchName} autoFocus
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Starting point</label>
                <input type="text" className="w-full text-sm font-mono" value={newBranchStart}
                  onChange={(e) => setNewBranchStart(e.target.value)}
                  placeholder="HEAD, branch name, or commit hash" />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={newBranchCheckout} onChange={(e) => setNewBranchCheckout(e.target.checked)} />
                Checkout after creation
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowNewDialog(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate}>
                <Check size={13} /> Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge panel */}
      {mergeTarget && (
        <MergePanel targetBranch={mergeTarget} onClose={() => setMergeTarget(null)} />
      )}
    </div>
  );
}
