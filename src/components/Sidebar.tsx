import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Settings as SettingsIcon, FolderPlus, FolderGit, FolderGitOpen, Folder, FolderOpen,
  Plus, Pin, PinOff, X, Sun, Moon, Star, ChevronDown, ChevronRight, RefreshCw, AlertCircle,
} from './icons';
import { NAV_ITEMS, NAV_SHORTCUTS, NAV_DESCRIPTIONS, type NavItem } from './navItems';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useGitStore } from '../stores/gitStore';
import { ResizableSplitter, useResizableWidth, useResizableHeight } from './ResizableSplitter';
import { cn } from '../lib/utils';
import { confirmDialog, promptDialog } from './ConfirmDialog';
import { useContextMenu } from '../lib/useContextMenu';
import {
  buildRepoTree, canMoveGroup, flattenGroupOptions,
  type RepoGroupNode, type RepoItemNode,
} from '../lib/repoTree';
import type { RemoteCheckSummary } from '../lib/api';
import { api } from '../lib/api';
import { useToastStore } from '../stores/toastStore';
import { loadProjectPrefs, saveProjectPrefs } from '../lib/projectPrefs';

/**
 * Drag-and-drop payload for the repository tree. Chromium lowercases custom
 * MIME types, so the type itself is lowercase and the JSON is parsed
 * defensively on drop.
 */
const DND_MIME = 'application/x-prismgit-repoitem';
type DragPayload = { kind: 'repo'; path: string } | { kind: 'group'; id: string };

function timeAgo(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
}

/** Badge row for one repo from its latest remote check (↓ incoming / ↑ outgoing / dirty dot). */
function RemoteBadges({ check }: { check: RemoteCheckSummary | undefined }) {
  if (!check) return null;
  const remoteNames = check.remotes.join(', ') || 'remotes';
  return (
    <>
      {check.incoming > 0 && (
        <span
          className="text-2xs font-semibold text-status-added flex-shrink-0 tabular-nums"
          title={`${check.incoming} incoming commit(s) on ${remoteNames} — pull to update`}
        >
          ↓{check.incoming}
        </span>
      )}
      {check.outgoing > 0 && (
        <span
          className="text-2xs font-semibold text-status-modified flex-shrink-0 tabular-nums"
          title={`${check.outgoing} local commit(s) not pushed to ${remoteNames}`}
        >
          ↑{check.outgoing}
        </span>
      )}
      {check.dirty > 0 && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-status-modified flex-shrink-0"
          title={`${check.dirty} changed file(s) in the working tree`}
        />
      )}
      {check.error && (
        <span className="flex-shrink-0" title={`Remote check problem: ${check.error}`}>
          <AlertCircle size={10} className="text-status-deleted" />
        </span>
      )}
    </>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    repos, groups, metadata, remoteChecks, checkingRemotes, currentRepo,
    openRepository, removeRepo, pinRepo, checkRemotes, loadRepos,
    createGroup, renameGroup, deleteGroup, moveGroup, toggleGroupExpanded, assignRepoGroup,
  } = useRepositoryStore();
  const toast = useToastStore();
  const favoritePaths = useMemo(
    () => new Set(Object.entries(metadata).filter(([, m]) => m.favorite).map(([p]) => p)),
    [metadata]
  );
  const [showRepoList, setShowRepoList] = useState(true);
  const { width: sidebarWidth, handleResize: handleSidebarResize } = useResizableWidth(240, 180, 400);
  // SmartGit-style: vertical splitter between Repositories list and Navigation
  // panel in the sidebar — user can drag to give more space to either side.
  const { height: repoListHeight, setHeight: setRepoListHeight, handleResize: handleRepoListResize } = useResizableHeight(280, 120, 700);
  const theme = useSettingsStore((s) => s.theme);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
  // Live change counters for the Changes badge
  const changedCount = useGitStore((s) => s.status?.files.length ?? 0);
  const stagedCount = useGitStore((s) => s.status?.staged.length ?? 0);
  // Collapsible nav groups — click group header to collapse/expand
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Favorites — user-pinned tools shown at the top of the navigation
  const [favoriteTools, setFavoriteTools] = useState<string[]>([]);

  // Load favorite tools from project prefs when repo opens
  useEffect(() => {
    if (currentRepo) {
      const prefs = loadProjectPrefs(currentRepo.path);
      setFavoriteTools(prefs.favoriteTools || []);
    }
  }, [currentRepo?.path]);

  const toggleFavorite = useCallback((path: string) => {
    setFavoriteTools(prev => {
      const next = prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path];
      if (currentRepo) {
        saveProjectPrefs(currentRepo.path, { favoriteTools: next });
      }
      return next;
    });
  }, [currentRepo]);

  // Repository tree DnD state. dragPayload is mirrored in a ref because
  // dataTransfer.getData() is unavailable during dragover in Chromium.
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragPayloadRef = useRef<DragPayload | null>(null);
  const showContextMenu = useContextMenu();

  const collapsedGroupIds = useMemo(
    () => new Set(groups.filter((g) => g.expanded === false).map((g) => g.id)),
    [groups]
  );
  const tree = useMemo(
    () => buildRepoTree(groups, repos, { collapsed: collapsedGroupIds, favoritePaths }),
    [groups, repos, collapsedGroupIds, favoritePaths]
  );

  useEffect(() => {
    if (!currentRepo) {
      setShowRepoList(true);
    }
  }, [currentRepo]);

  const groups_ = NAV_ITEMS.reduce<Record<string, NavItem[]>>((acc, item) => {
    const g = item.group || 'Other';
    if (!acc[g]) acc[g] = [];
    acc[g].push(item);
    return acc;
  }, {});

  const handleNavigate = (path: string) => {
    navigate(path);
  };

  // ============= DnD handlers =============

  const handleDragStart = useCallback((e: React.DragEvent, payload: DragPayload) => {
    dragPayloadRef.current = payload;
    e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragEnd = useCallback(() => {
    dragPayloadRef.current = null;
    setDragOverId(null);
  }, []);

  const dropRepoIntoGroup = useCallback(async (repoPath: string, groupId: string | null) => {
    try {
      await assignRepoGroup(repoPath, groupId);
      if (groupId) await toggleGroupExpanded(groupId, true); // show the dropped repo
    } catch (e) {
      console.warn('[sidebar] drop repo failed:', e);
    }
  }, [assignRepoGroup, toggleGroupExpanded]);

  const dropGroupIntoGroup = useCallback(async (groupId: string, targetGroupId: string | null) => {
    if (!canMoveGroup(groups, groupId, targetGroupId)) return; // cycle — ignore silently
    try {
      await moveGroup(groupId, targetGroupId);
      if (targetGroupId) await toggleGroupExpanded(targetGroupId, true);
    } catch (e) {
      console.warn('[sidebar] drop group failed:', e);
    }
  }, [groups, moveGroup, toggleGroupExpanded]);

  const handleDrop = useCallback(async (e: React.DragEvent, targetGroupId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    // Check for external OS file/folder drag first
    const hasFiles = Array.from(e.dataTransfer?.types || []).some(
      (t) => t.toLowerCase() === 'files'
    );
    if (hasFiles) {
      // External OS folder drag — add repos to the list, optionally into this group
      setDragOverId(null);
      const files = Array.from(e.dataTransfer!.files);
      let addedCount = 0;
      let skippedCount = 0;
      for (const f of files) {
        const filePath = (f as File & { path?: string }).path;
        if (!filePath) continue;
        const name = filePath.split('/').pop() || filePath;
        try {
          const isRepo = await api.git.isRepo(filePath);
          if (isRepo) {
            await api.settings.addRepo({ path: filePath, name });
            // Assign to the target group if dropping on a group
            if (targetGroupId) {
              await api.settings.setRepoGroup(filePath, targetGroupId);
              // Expand the group so the new repo is visible
              await toggleGroupExpanded(targetGroupId, true);
            }
            api.settings.refreshRepoStats(filePath).then(() => {
              useRepositoryStore.getState().loadMetadata();
            }).catch(() => {});
            addedCount++;
          } else {
            skippedCount++;
          }
        } catch {
          skippedCount++;
        }
      }
      if (addedCount > 0) {
        await loadRepos();
        toast.success(
          `Added ${addedCount} repositor${addedCount === 1 ? 'y' : 'ies'}${targetGroupId ? ' to group' : ''}`,
          skippedCount > 0 ? `${skippedCount} folder(s) skipped (not a git repo)` : undefined
        );
      } else if (skippedCount > 0) {
        toast.warning('No git repositories found', `${skippedCount} folder(s) dropped`);
      }
      return;
    }
    // Internal drag — move repo/group
    const raw = e.dataTransfer.getData(DND_MIME);
    let payload: DragPayload | null = dragPayloadRef.current;
    if (raw) {
      try { payload = JSON.parse(raw) as DragPayload; } catch { /* keep ref fallback */ }
    }
    dragPayloadRef.current = null;
    setDragOverId(null);
    if (!payload) return;
    if (payload.kind === 'repo') await dropRepoIntoGroup(payload.path, targetGroupId);
    else await dropGroupIntoGroup(payload.id, targetGroupId);
  }, [dropRepoIntoGroup, dropGroupIntoGroup, loadRepos, toast, toggleGroupExpanded]);

  const handleGroupDragOver = useCallback((e: React.DragEvent, groupNode: RepoGroupNode) => {
    // Accept both internal drags and external OS file drags
    const isInternal = !!dragPayloadRef.current;
    const isExternal = Array.from(e.dataTransfer?.types || []).some(
      (t) => t.toLowerCase() === 'files'
    );
    if (!isInternal && !isExternal) return;
    if (isInternal) {
      const payload = dragPayloadRef.current!;
      if (payload.kind === 'group' && !canMoveGroup(groups, payload.id, groupNode.group.id)) return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = isExternal ? 'copy' : 'move';
    setDragOverId(groupNode.group.id);
  }, [groups]);

  // ============= Group / repo actions =============

  const handleCreateGroup = useCallback(async (parentId: string | null = null) => {
    const name = await promptDialog({
      title: parentId ? 'New subgroup' : 'New group',
      message: parentId ? 'Enter a name for the subgroup:' : 'Enter a name for the repository group:',
      input: { placeholder: 'e.g. Work, Clients, Sandbox' },
      confirmLabel: 'Create',
    });
    if (name == null || !name.trim()) return;
    try {
      await createGroup(name, parentId);
    } catch (e) {
      console.warn('[sidebar] create group failed:', e);
    }
  }, [createGroup]);

  const handleRenameGroup = useCallback(async (groupId: string, currentName: string) => {
    const name = await promptDialog({
      title: 'Rename group',
      input: { initialValue: currentName },
      confirmLabel: 'Rename',
    });
    if (name == null || !name.trim()) return;
    try {
      await renameGroup(groupId, name);
    } catch (e) {
      console.warn('[sidebar] rename group failed:', e);
    }
  }, [renameGroup]);

  const handleDeleteGroup = useCallback(async (groupId: string, groupName: string) => {
    if (!(await confirmDialog({
      title: `Delete group '${groupName}'`,
      message: 'Subgroups and repositories inside it are moved to the parent level — nothing is deleted from disk.',
      confirmLabel: 'Delete',
      danger: true,
    }))) return;
    try {
      await deleteGroup(groupId);
    } catch (e) {
      console.warn('[sidebar] delete group failed:', e);
    }
  }, [deleteGroup]);

  const showGroupMenu = useCallback((e: React.MouseEvent, node: RepoGroupNode) => {
    e.preventDefault();
    e.stopPropagation();
    void showContextMenu([
      { label: 'New subgroup', clickId: 'subgroup' },
      { label: 'Rename', clickId: 'rename' },
      { type: 'separator' },
      { label: 'Delete group', clickId: 'delete' },
    ], (clickId) => {
      if (clickId === 'subgroup') void handleCreateGroup(node.group.id);
      if (clickId === 'rename') void handleRenameGroup(node.group.id, node.group.name);
      if (clickId === 'delete') void handleDeleteGroup(node.group.id, node.group.name);
    });
  }, [showContextMenu, handleCreateGroup, handleRenameGroup, handleDeleteGroup]);

  const showRepoMenu = useCallback((e: React.MouseEvent, repoPath: string, repoGroupId: string | null | undefined) => {
    e.preventDefault();
    e.stopPropagation();
    const moveTargets = flattenGroupOptions(groups, repos, repoGroupId ?? undefined);
    const items = [
      ...moveTargets.map((t) => ({
        label: `${'\u00A0'.repeat(t.depth * 3)}${t.isRoot ? '· ' : ''}${t.name}`,
        clickId: `move:${t.id ?? 'root'}`,
      })),
      { type: 'separator' as const },
      ...(repoGroupId
        ? [{ label: 'Remove from group', clickId: 'ungroup' }]
        : []),
      { label: 'Check remotes now', clickId: 'check' },
      { type: 'separator' as const },
      { label: 'Repository Settings...', clickId: 'repo-settings' },
    ];
    void showContextMenu(items, (clickId) => {
      if (clickId.startsWith('move:')) {
        const target = clickId.slice('move:'.length);
        void dropRepoIntoGroup(repoPath, target === 'root' ? null : target);
      } else if (clickId === 'ungroup') {
        void dropRepoIntoGroup(repoPath, null);
      } else if (clickId === 'check') {
        void checkRemotes([repoPath]);
      } else if (clickId === 'repo-settings') {
        // Open the repo first (if not already current), then trigger settings dialog
        // via a custom DOM event that App.tsx listens for.
        void openRepository(repoPath).then(() => {
          window.dispatchEvent(new CustomEvent('prismgit:repo-settings'));
        });
      }
    });
  }, [showContextMenu, groups, repos, dropRepoIntoGroup, checkRemotes, openRepository]);

  // In-progress sequencer state for the CURRENT repo only — shown as a small
  // warning dot on the active repo row. Per-repo status for inactive repos
  // would require additional backend plumbing (RemoteCheckSummary doesn't
  // carry isMerging etc.) — left for a follow-up.
  const status = useGitStore((s) => s.status);
  const currentInProgress = !!(status?.isMerging || status?.isRebasing || status?.isCherryPicking || status?.isReverting);
  const currentBisecting = !!status?.isBisecting;
  const currentDetached = !!status?.detached;

  // ============= Tree rendering =============

  const renderRepoRow = (node: RepoItemNode) => {
    const repo = node.repo;
    const meta = metadata[repo.path];
    const isActive = currentRepo?.path === repo.path;
    // In-progress / detached indicators only apply to the active repo.
    const showInProgressBadge = isActive && currentInProgress;
    const showBisectBadge = isActive && currentBisecting;
    const showDetachedBadge = isActive && currentDetached;
    return (
      <div
        key={repo.path}
        draggable
        onDragStart={(e) => handleDragStart(e, { kind: 'repo', path: repo.path })}
        onDragEnd={handleDragEnd}
        // Repo rows are not drop targets: stop propagation so the root zone
        // doesn't light up, but no preventDefault → the browser shows the
        // "no-drop" cursor and no drop event fires here.
        onDragOver={(e) => e.stopPropagation()}
        onContextMenu={(e) => showRepoMenu(e, repo.path, repo.groupId)}
        className={cn(
          'group flex items-center gap-2 py-2 pr-2 cursor-pointer text-xs transition-colors hover:bg-bg-hover',
          isActive && 'bg-bg-active'
        )}
        style={{
          paddingLeft: `${node.depth * 14 + 12}px`,
          borderLeft: meta?.color ? `3px solid ${meta.color}` : undefined,
        }}
        onClick={(e) => { e.stopPropagation(); openRepository(repo.path); }}
        title={`${repo.path}${repo.groupId ? '\n(group)' : ''}`}
        data-testid={`repo-item-${repo.name}`}
      >
        {isActive ? <FolderGitOpen size={13} className="text-accent flex-shrink-0" /> : <FolderGit size={13} className="text-text-tertiary flex-shrink-0" />}
        <span className={cn('flex-1 truncate', isActive && 'text-accent font-medium')}>{repo.name}</span>
        {/* In-progress state badge — only on the active repo, only when one
            of the sequencer flags is true. Clicking opens Changes where the
            SequencerPanel / MergePanel / RebasePanel banners live. */}
        {showInProgressBadge && (
          <a
            href="#/changes"
            onClick={(e) => e.stopPropagation()}
            className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-status-warning inline-block animate-pulse"
            title={`Working tree is in ${status?.isMerging ? 'merging' : status?.isRebasing ? 'rebasing' : status?.isCherryPicking ? 'cherry-picking' : 'reverting'} state. Click to open Changes.`}
          />
        )}
        {showBisectBadge && !showInProgressBadge && (
          <span
            className="flex-shrink-0 text-2xs text-status-info font-semibold"
            title="Bisect in progress — see the Bisect page"
          >
            bisect
          </span>
        )}
        {showDetachedBadge && !showInProgressBadge && (
          <span
            className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-status-warning inline-block"
            title="HEAD is detached — commits won't belong to any branch"
          />
        )}
        <RemoteBadges check={remoteChecks[repo.path]} />
        {meta?.favorite && (
          <Star size={10} className="text-status-modified fill-current flex-shrink-0" />
        )}
        {meta?.tags && meta.tags.length > 0 && (
          <span className="text-2xs text-text-tertiary flex-shrink-0 px-1.5 py-0.5 rounded-full bg-bg-tertiary">
            {meta.tags.length}
          </span>
        )}
        <button
          className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 transition-opacity"
          title={repo.pinned ? 'Unpin' : 'Pin'}
          onClick={(e) => { e.stopPropagation(); pinRepo(repo.path, !repo.pinned); }}
        >
          {repo.pinned ? <PinOff size={10} /> : <Pin size={10} />}
        </button>
        <button
          className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 hover:!text-status-deleted transition-opacity"
          title="Remove from list"
          onClick={(e) => { e.stopPropagation(); removeRepo(repo.path); }}
        >
          <X size={10} />
        </button>
      </div>
    );
  };

  const renderGroupRow = (node: RepoGroupNode) => {
    const isExpanded = node.group.expanded !== false;
    const isDropTarget = dragOverId === node.group.id;
    return (
      <div key={`group-${node.group.id}`} className={cn(isDropTarget && 'bg-bg-hover')}>
        <div
          draggable
          onDragStart={(e) => handleDragStart(e, { kind: 'group', id: node.group.id })}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleGroupDragOver(e, node)}
          onDrop={(e) => void handleDrop(e, node.group.id)}
          onContextMenu={(e) => showGroupMenu(e, node)}
          onDoubleClick={() => void handleRenameGroup(node.group.id, node.group.name)}
          className={cn(
            'group flex items-center gap-1.5 py-1.5 pr-2 cursor-pointer text-xs transition-colors hover:bg-bg-hover select-none',
            isDropTarget && 'bg-accent-muted/40 outline outline-1 outline-accent -outline-offset-1'
          )}
          style={{ paddingLeft: `${node.depth * 14 + 4}px` }}
          title={`${node.group.name} — ${node.repoCount} repo(s). Drag repos or groups here; double-click to rename.`}
          data-testid={`repo-group-${node.group.name}`}
        >
          <button
            className="icon-btn !w-4 !h-4 !p-0 flex-shrink-0"
            title={isExpanded ? 'Collapse' : 'Expand'}
            onClick={(e) => { e.stopPropagation(); void toggleGroupExpanded(node.group.id, !isExpanded); }}
          >
            {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
          {isExpanded
            ? <FolderOpen size={12} className="text-accent flex-shrink-0" />
            : <Folder size={12} className="text-text-tertiary flex-shrink-0" />}
          <span className="flex-1 truncate font-medium">{node.group.name}</span>
          <span className="text-2xs text-text-tertiary flex-shrink-0 tabular-nums">{node.repoCount}</span>
          <button
            className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 transition-opacity"
            title="New subgroup"
            onClick={(e) => { e.stopPropagation(); void handleCreateGroup(node.group.id); }}
          >
            <FolderPlus size={10} />
          </button>
        </div>
        {isExpanded && node.children.map((child) =>
          child.type === 'group' ? renderGroupRow(child) : renderRepoRow(child)
        )}
      </div>
    );
  };

  return (
    <>
    <aside
      className="flex flex-col bg-bg-secondary flex-shrink-0 no-drag"
      style={{ width: sidebarWidth }}
    >
      {/* Repository switcher */}
      <div className="border-b border-border-default">
        <div className="flex items-center justify-between px-3 py-2.5">
          <button
            className="flex items-center gap-2 text-sm font-semibold hover:text-accent truncate transition-colors"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowRepoList(!showRepoList); }}
          >
            {showRepoList ? <FolderGitOpen size={15} className="text-accent" /> : <FolderGit size={15} className="text-text-secondary" />}
            <span className="truncate">{currentRepo ? currentRepo.name : 'Repositories'}</span>
            {currentRepo && metadata[currentRepo.path]?.favorite && (
              <Star size={11} className="text-status-modified fill-current" />
            )}
            <ChevronDown
              size={12}
              className={cn('text-text-tertiary transition-transform', showRepoList && 'rotate-180')}
            />
          </button>
          <div className="flex items-center gap-0.5">
            {currentRepo && (
              <button
                className="icon-btn no-drag flex-shrink-0 hover:!text-status-deleted !w-7 !h-7"
                title="Close repository (release memory, stop watcher, clear selections)"
                onClick={async (e) => {
                  e.preventDefault(); e.stopPropagation();
                  if (await confirmDialog({
                    title: `Close repository '${currentRepo.name}'`,
                    message: 'This stops the file-system watcher, clears the git cache and all selections, and frees memory.',
                    confirmLabel: 'Close',
                    danger: true,
                  })) {
                    useRepositoryStore.getState().closeRepository();
                  }
                }}
              >
                <X size={14} />
              </button>
            )}
            <button
              className="icon-btn no-drag flex-shrink-0 !w-7 !h-7"
              title={checkingRemotes ? 'Checking remotes…' : 'Check all repositories for remote changes (fetch + incoming/outgoing)'}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); void checkRemotes(); }}
            >
              <RefreshCw size={13} className={cn(checkingRemotes && 'animate-spin')} />
            </button>
            <button
              className="icon-btn no-drag flex-shrink-0 !w-7 !h-7"
              title="New repository group"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleCreateGroup(null); }}
            >
              <FolderPlus size={14} />
            </button>
            <button
              className="icon-btn no-drag flex-shrink-0 !w-7 !h-7"
              title="Open another repository..."
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); useRepositoryStore.getState().openRepositoryPicker(); }}
            >
              <FolderOpen size={14} />
            </button>
          </div>
        </div>

        {showRepoList && (
          <div
            className="overflow-y-auto border-t border-border-subtle relative"
            style={{ height: repoListHeight, flexShrink: 0 }}
            data-testid="repo-tree"
            onDragOver={(e) => {
              // Accept BOTH internal repo/group drags AND external OS file/folder drags.
              // Internal: dragPayloadRef.current is set (application/x-prismgit-repoitem).
              // External: dataTransfer.types contains 'Files' (OS file manager drag).
              const isInternal = !!dragPayloadRef.current;
              const isExternal = Array.from(e.dataTransfer?.types || []).some(
                (t) => t.toLowerCase() === 'files'
              );
              if (!isInternal && !isExternal) return;
              e.preventDefault();
              e.dataTransfer!.dropEffect = isExternal ? 'copy' : 'move';
              setDragOverId('root');
            }}
            onDragLeave={(e) => {
              const nextTarget = e.relatedTarget as Node | null;
              if (!nextTarget || !e.currentTarget.contains(nextTarget)) {
                setDragOverId((cur) => (cur === 'root' ? null : cur));
              }
            }}
            onDrop={(e) => void handleDrop(e, null)}
          >
            {repos.length === 0 && groups.length === 0 ? (
              <div
                className={cn('px-3 py-6 text-xs text-text-tertiary text-center', dragOverId === 'root' && 'bg-accent-muted/30')}
              >
                <Folder size={20} className="mx-auto mb-2 opacity-40" />
                No repositories yet.<br />Click <Plus size={10} className="inline" /> to add one.
              </div>
            ) : (
              <>
                {tree.nodes.map((node) =>
                  node.type === 'group' ? renderGroupRow(node) : renderRepoRow(node)
                )}
                {dragOverId === 'root' && (
                  <div className="px-3 py-2 text-2xs text-accent text-center bg-accent-muted/30 border-t border-dashed border-accent">
                    Drop here to move to the root level
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Vertical splitter — drag up/down to resize repo list vs navigation */}
      {showRepoList && (
        <ResizableSplitter direction="vertical" onResize={handleRepoListResize} />
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 scrollbar-thin" role="navigation" aria-label="Main navigation">
        {currentRepo ? (
          <>
          {/* Favorites section — user-pinned tools at the top */}
          {favoriteTools.length > 0 && (
            <div className="mb-3">
              <div className="px-3 py-1 text-2xs font-bold uppercase tracking-wider text-text-tertiary flex items-center gap-1">
                <Star size={9} className="text-status-modified fill-current" />
                Favorites
              </div>
              {favoriteTools.map(path => {
                const item = NAV_ITEMS.find(n => n.path === path);
                if (!item) return null;
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                const showBadge = item.path === '/changes' && changedCount > 0;
                const shortcut = NAV_SHORTCUTS[item.path];
                return (
                  <button
                    key={`fav-${item.path}`}
                    className={cn(
                      'group w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors cursor-pointer',
                      isActive
                        ? 'bg-accent-muted text-accent font-medium border-l-2 border-accent'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary border-l-2 border-transparent'
                    )}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleNavigate(item.path); }}
                    title={NAV_DESCRIPTIONS[item.path] || item.label}
                  >
                    <Icon size={15} />
                    <span>{item.label}</span>
                    {showBadge ? (
                      <span
                        className={cn(
                          'ml-auto text-2xs font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center',
                          stagedCount > 0 ? 'badge badge-added' : 'bg-accent-muted text-accent'
                        )}
                      >
                        {changedCount}
                      </span>
                    ) : shortcut ? (
                      <kbd className="ml-auto text-2xs text-text-tertiary border border-border-subtle rounded px-1 opacity-60">{shortcut}</kbd>
                    ) : null}
                    <button
                      className="opacity-0 group-hover:opacity-100 icon-btn !w-4 !h-4 !p-0 transition-opacity"
                      title="Remove from Favorites"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(item.path); }}
                    >
                      <Star size={10} className="text-status-modified fill-current" />
                    </button>
                  </button>
                );
              })}
            </div>
          )}

          {/* Regular navigation groups */}
          {Object.entries(groups_).map(([groupName, items]) => (
            <div key={groupName} className="mb-3">
              {true && (
                <button
                  className="px-3 py-1 text-2xs font-bold uppercase tracking-wider text-text-tertiary w-full flex items-center gap-1 hover:text-text-secondary transition-colors cursor-pointer"
                  role="heading"
                  aria-level={3}
                  onClick={() => {
                    const next = new Set(collapsedGroups);
                    if (next.has(groupName)) next.delete(groupName);
                    else next.add(groupName);
                    setCollapsedGroups(next);
                  }}
                  title={collapsedGroups.has(groupName) ? 'Expand' : 'Collapse'}
                >
                  {collapsedGroups.has(groupName) ? <ChevronRight size={9} /> : <ChevronDown size={9} />}
                  {groupName}
                </button>
              )}
              {!collapsedGroups.has(groupName) && items.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                // Changes item gets a live badge; others show their quick-nav key
                const showBadge = item.path === '/changes' && changedCount > 0;
                const shortcut = NAV_SHORTCUTS[item.path];
                const isFavorite = favoriteTools.includes(item.path);
                return (
                  <button
                    key={item.path}
                    className={cn(
                      'group w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors cursor-pointer',
                      isActive
                        ? 'bg-accent-muted text-accent font-medium border-l-2 border-accent'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary border-l-2 border-transparent'
                    )}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleNavigate(item.path); }}
                    title={NAV_DESCRIPTIONS[item.path] || item.label}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={item.label}
                  >
                    <Icon size={15} />
                    <span>{item.label}</span>
                    {showBadge ? (
                      <span
                        className={cn(
                          'ml-auto text-2xs font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center',
                          stagedCount > 0 ? 'badge badge-added' : 'bg-accent-muted text-accent'
                        )}
                        title={`${changedCount} file(s) with changes${stagedCount > 0 ? `, ${stagedCount} staged` : ''}`}
                      >
                        {changedCount}
                      </span>
                    ) : shortcut ? (
                      <kbd className="ml-auto text-2xs text-text-tertiary border border-border-subtle rounded px-1 opacity-60">{shortcut}</kbd>
                    ) : null}
                    {/* Favorite toggle star — appears on hover */}
                    <button
                      className={cn(
                        'icon-btn !w-4 !h-4 !p-0 transition-opacity',
                        isFavorite
                          ? 'opacity-100'
                          : 'opacity-0 group-hover:opacity-100'
                      )}
                      title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(item.path); }}
                    >
                      <Star size={10} className={cn(isFavorite ? 'text-status-modified fill-current' : 'text-text-tertiary')} />
                    </button>
                  </button>
                );
              })}
            </div>
          ))}
          </>
        ) : (
          <div className="px-3 py-4 text-xs text-text-tertiary text-center">
            Open a repository to access Git operations
          </div>
        )}
      </nav>

      {/* Bottom: theme toggle + settings */}
      <div className="border-t border-border-default p-2 space-y-1">
        <button
          className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleTheme(); }}
          title="Toggle theme (Ctrl+Shift+T)"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          <span>{theme === 'dark' ? 'Light Theme' : 'Dark Theme'}</span>
        </button>
        <button
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors cursor-pointer',
            location.pathname === '/settings'
              ? 'bg-bg-active text-text-primary'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          )}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleNavigate('/settings'); }}
        >
          <SettingsIcon size={15} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
    <ResizableSplitter direction="horizontal" onResize={handleSidebarResize} />
    </>
  );
}
