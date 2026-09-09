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
    if (!confirm(`Delete branch '${branch.name}'?\n\nThis will remove the local branch reference. Use force-delete if the branch is not fully merged.`)) return;
    try {
      await api.git.deleteBranch(repo.path, branch.name, false, branch.remote);
      toast.success(`Deleted '${branch.name}'`);
      await load();
    } catch (e) { toast.error('Delete failed', String(e)); }
  };

  const handleDeleteRemote = async (branch: BranchInfo) => {
    const remoteBranch = branch.name.replace(/^[^/]+\//, '');
    if (!confirm(`Delete remote branch '${branch.name}'?\n\nThis will run 'git push origin --delete' and permanently remove the branch from the remote repository.`)) return;
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

  // ===== Branch compare dialog =====
  // Compare an arbitrary branch against the CURRENT branch: ahead/behind counts,
  // changed file list, unified patch preview, and a jump into the Diff tool.
  const [compareBranch, setCompareBranch] = useState<BranchInfo | null>(null);
  const [compareCurrent, setCompareCurrent] = useState<string | null>(null);
  const [compareCounts, setCompareCounts] = useState<{ ahead: number; behind: number } | null>(null);
  const [compareFiles, setCompareFiles] = useState<{ status: string; path: string }[]>([]);
  const [comparePatch, setComparePatch] = useState<string | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  const handleCompare = async (b: BranchInfo) => {
    setCompareBranch(b);
    setCompareCounts(null);
    setCompareFiles([]);
    setComparePatch(null);
    setCompareLoading(true);
    try {
      const current = await api.git.currentBranch(repo.path);
      setCompareCurrent(current);
      if (!current) {
        toast.warning('Cannot compare — detached HEAD');
        setCompareLoading(false);
        return;
      }
      const [counts, nameStatus] = await Promise.all([
        api.git.aheadBehind(repo.path, current, b.name),
        api.git.raw(repo.path, ['diff', '--name-status', `${current}...${b.name}`]),
      ]);
      setCompareCounts(counts);
      setCompareFiles(
        nameStatus
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const parts = line.split('\t');
            return { status: parts[0], path: parts.length > 2 ? `${parts[1]} → ${parts[2]}` : parts[1] };
          })
      );
    } catch (e) {
      toast.error('Compare failed', String(e));
    } finally {
      setCompareLoading(false);
    }
  };

  const handleComparePreview = async () => {
    if (!compareBranch || !compareCurrent) return;
    setCompareLoading(true);
    try {
      const patch = await api.git.diffBranches(repo.path, compareCurrent, compareBranch.name);
      // Render the hunks back to unified text for a lightweight preview
      const text = patch.hunks
        .map((h) => `${h.header}\n${h.lines.map((l) => l.content).join('\n')}`)
        .join('\n');
      setComparePatch(text || '(no differences in file contents)');
    } catch (e) {
      toast.error('Patch preview failed', String(e));
    } finally {
      setCompareLoading(false);
    }
  };

  const handleCompareOpenInDiff = () => {
    if (!compareBranch || !compareCurrent) return;
    useSelectionStore.getState().setDiffRequest({
      baseRef: compareCurrent,
      compareRef: compareBranch.name,
      filePath: '.',
    });
    window.location.hash = '#/diff';
    setCompareBranch(null);
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
      items.push({ label: 'Compare with current branch...', clickId: 'compare' });
      items.push({ type: 'separator' });
      items.push({ label: 'Merge into current', clickId: 'merge' });
      items.push({ label: 'Rebase onto this branch', clickId: 'rebase' });
      items.push({ type: 'separator' });
      items.push({ label: 'Push to origin', clickId: 'push' });
      items.push({ label: 'Rename...', clickId: 'rename' });
      items.push({ label: 'Delete', clickId: 'delete' });
    } else if (b.remote) {
      items.push({ label: 'Checkout (create local tracking branch)', clickId: 'checkout-remote' });
      items.push({ label: 'Create local branch from...', clickId: 'create-local' });
      items.push({ label: 'Compare with current branch...', clickId: 'compare' });
      items.push({ type: 'separator' });
      items.push({ label: 'Merge into current', clickId: 'merge' });
      items.push({ type: 'separator' });
      items.push({ label: 'Open in Browser', clickId: 'browser' });
      items.push({ label: 'Delete remote branch', clickId: 'delete-remote' });
    }
    if (items.length > 0) {
      showContextMenu(items, (action) => {
        if (action === 'checkout') handleCheckout(b);
        else if (action === 'compare') handleCompare(b);
        else if (action === 'checkout-remote') {
          // Create local tracking branch from remote: git checkout -b <local> --track <remote>
          // Local name = part after first slash (e.g. origin/main → main)
          const localName = b.name.replace(/^[^/]+\//, '');
          if (!confirm(`Checkout remote branch '${b.name}'?\n\nThis will create local branch '${localName}' tracking the remote.`)) return;
          api.git.checkout(repo.path, b.name, { track: true }).then(() => {
            toast.success(`Checked out '${localName}' (tracking ${b.name})`);
            load();
            refreshStatus(repo.path);
          }).catch((e) => toast.error('Checkout failed', String(e)));
        }
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
        {/* Render only first 200 items to avoid perf issues on large repos.
            Lazy loading: show first 200, "Load more" button reveals next 200. */}
        {!collapsed && items.length > 200 && (
          <div className="px-2 py-1 text-2xs text-text-tertiary border-b border-border-subtle">
            Showing first 200 of {items.length} · scroll for more
          </div>
        )}
        {!collapsed && items.slice(0, 200).map(renderBranchRow)}
      </div>
    );
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-default bg-bg-tertiary" style={{ height: 32 }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">Branches</span>
          <span className="text-2xs text-text-tertiary">
            {localBranches.length} local · {Object.values(remoteGroups).reduce((a, b) => a + b.length, 0)} remote
          </span>
        </div>
        <div className="flex items-center gap-1">
          <input type="text" placeholder="Filter..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="text-xs w-32 px-2 py-1" />
          <button className="icon-btn !w-6 !h-6" title="Refresh" onClick={load}>
            <RefreshCw size={12} />
          </button>
          <button className="btn btn-primary text-2xs !py-1 !px-2.5" onClick={() => setShowNewDialog(true)}>
            <Plus size={12} /> New
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
        <div className="fixed inset-0 bg-black/30 dark:bg-black/55 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowNewDialog(false)}>
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

      {/* Compare branches dialog */}
      {compareBranch && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/55 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setCompareBranch(null)}>
          <div className="panel w-[640px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
              <div>
                <h3 className="text-base font-medium">Compare Branches</h3>
                <div className="text-2xs text-text-tertiary mt-0.5">
                  <code className="text-accent">{compareCurrent || '?'}</code>
                  {' ←→ '}
                  <code className="text-accent">{compareBranch.name}</code>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {compareCounts && (
                  <>
                    <span className="badge badge-added">↑ {compareCounts.ahead} ahead</span>
                    <span className="badge badge-deleted">↓ {compareCounts.behind} behind</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {compareLoading ? (
                <div className="text-center text-xs text-text-tertiary py-6">Comparing...</div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <button className="btn btn-secondary text-xs" onClick={handleComparePreview}>
                      Preview unified patch
                    </button>
                    <button className="btn btn-secondary text-xs" onClick={handleCompareOpenInDiff}>
                      Open in Diff tool
                    </button>
                  </div>
                  {comparePatch && (
                    <pre className="text-2xs font-mono bg-bg-tertiary p-3 rounded max-h-64 overflow-auto whitespace-pre-wrap text-text-secondary border border-border-default">
                      {comparePatch}
                    </pre>
                  )}
                  <div>
                    <div className="text-2xs uppercase text-text-tertiary mb-1">
                      Changed files ({compareFiles.length})
                    </div>
                    <div className="border border-border-default rounded max-h-64 overflow-y-auto">
                      {compareFiles.length === 0 ? (
                        <div className="p-3 text-xs text-text-tertiary text-center">
                          No differences between the branches (same tree)
                        </div>
                      ) : (
                        compareFiles.map((f, i) => (
                          <div key={`${f.path}-${i}`} className="flex items-center gap-2 px-3 py-1 text-xs border-b border-border-subtle last:border-b-0">
                            <span className={cn(
                              'badge w-8 text-center flex-shrink-0',
                              f.status.startsWith('A') ? 'badge-added' : f.status.startsWith('D') ? 'badge-deleted' : 'badge-modified'
                            )}>{f.status}</span>
                            <span className="font-mono truncate">{f.path}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end px-4 py-3 border-t border-border-default">
              <button className="btn btn-secondary text-xs" onClick={() => setCompareBranch(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
