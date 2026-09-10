import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, Plus, RefreshCw, Trash, GitMerge, Check, ArrowUp, ArrowDown,
  ExternalLink, Upload, ChevronDown, ChevronRight, X, Pencil, CloudDownload,
  Settings as Cog, Loader,
} from '../components/icons';
import { MergePanel } from '../components/MergePanel';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useOperationLogStore } from '../stores/operationLogStore';
import { api, type BranchInfo, type RemoteInfo } from '../lib/api';
import { useContextMenu, type ContextMenuItem } from '../lib/useContextMenu';
import { cn, formatDate, shortHash } from '../lib/utils';

import { useEscapeKey } from '../hooks/useEscapeKey';
import { RenameDialog, RemoteConfigDialog } from '../components/RemoteDialogs';
import { isBackgroundFetchEnabled, setBackgroundFetchForRepo } from '../lib/backgroundFetch';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
export function BranchesPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const { refreshStatus } = useGitStore();
  const toast = useToastStore();
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showNewDialog, setShowNewDialog] = useState(false);
  useEscapeKey(showNewDialog, () => setShowNewDialog(false));
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchStart, setNewBranchStart] = useState('HEAD');
  const [newBranchCheckout, setNewBranchCheckout] = useState(true);
  // SmartGit-style dialogs: rename (branch/remote) + configure/add remote
  const [renameTarget, setRenameTarget] = useState<{ kind: 'branch' | 'remote'; oldName: string } | null>(null);
  const [configRemote, setConfigRemote] = useState<{ mode: 'configure' | 'add'; name?: string } | null>(null);
  const [remotesMap, setRemotesMap] = useState<Record<string, RemoteInfo>>({});
  const [remoteBusy, setRemoteBusy] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [draggedBranch, setDraggedBranch] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const showContextMenu = useContextMenu();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [branchList, remoteList] = await Promise.all([
        api.git.branches(repo.path),
        api.git.remotes(repo.path).catch(() => [] as RemoteInfo[]),
      ]);
      setBranches(branchList);
      setRemotesMap(Object.fromEntries(remoteList.map((r) => [r.name, r])));
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
      await useOperationLogStore.getState().logOperation(
        'Check Out Branch', repo.path, `git checkout ${branch.name}`,
        () => api.git.checkout(repo.path, branch.name)
      );
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
    if (!(await confirmDialog({
      title: `Delete branch '${branch.name}'`,
      message: 'This removes the local branch reference. If the branch is not fully merged, use force-delete.',
      confirmLabel: 'Delete',
      danger: true,
    }))) return;
    try {
      await api.git.deleteBranch(repo.path, branch.name, false, branch.remote);
      toast.success(`Deleted '${branch.name}'`);
      await load();
    } catch (e) { toast.error('Delete failed', String(e)); }
  };

  const handleDeleteRemote = async (branch: BranchInfo) => {
    const remoteBranch = branch.name.replace(/^[^/]+\//, '');
    if (!(await confirmDialog({
      title: `Delete remote branch '${branch.name}'`,
      message: "This runs 'git push origin --delete' and permanently removes the branch from the remote repository.",
      confirmLabel: 'Delete',
      danger: true,
    }))) return;
    try {
      await api.git.deleteBranch(repo.path, remoteBranch, true, true);
      toast.success(`Deleted remote '${remoteBranch}'`);
      await load();
    } catch (e) { toast.error('Failed', String(e)); }
  };

  const handleRenameSubmit = async (newName: string) => {
    if (!renameTarget) return;
    const { kind, oldName } = renameTarget;
    setRemoteBusy(`rename-${oldName}`);
    try {
      if (kind === 'branch') {
        await api.git.renameBranch(repo.path, oldName, newName);
        toast.success(`Branch renamed to '${newName}'`);
        await load();
        await refreshStatus(repo.path);
      } else {
        await api.git.renameRemote(repo.path, oldName, newName);
        toast.success(`Remote renamed to '${newName}'`);
        await load();
      }
      setRenameTarget(null);
    } catch (e) {
      toast.error('Rename failed', String(e));
    } finally {
      setRemoteBusy(null);
    }
  };

  const validateBranchName = (name: string): string | null => {
    if (name === renameTarget?.oldName) return null; // unchanged — submit disabled, no error
    if (!name) return 'Name is required';
    if (/\s/.test(name)) return 'Branch name must not contain whitespace';
    if (name.startsWith('-') || name.startsWith('/')) return 'Branch name must not start with "-" or "/"';
    if (name.endsWith('.lock') || name.includes('..') || /[~^:?*[\]\\@{]/.test(name)) return 'Branch name contains invalid characters';
    if (branches.some((b) => b.name === name)) return `Branch '${name}' already exists`;
    return null;
  };

  const handleFetchRemote = async (name: string) => {
    setRemoteBusy(name);
    try {
      await api.git.fetch(repo.path, name, true);
      toast.success(`Fetched '${name}' (with prune)`);
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(`Fetch '${name}' failed`, String(e));
    } finally {
      setRemoteBusy(null);
    }
  };

  const handleRemoveRemote = async (name: string) => {
    if (!(await confirmDialog({
      title: `Remove remote '${name}'`,
      message: 'This only removes the remote configuration — local branches and data stay untouched.',
      confirmLabel: 'Remove',
      danger: true,
    }))) return;
    setRemoteBusy(name);
    try {
      await api.git.removeRemote(repo.path, name);
      toast.success(`Remote '${name}' removed`);
      await load();
    } catch (e) {
      toast.error('Remove remote failed', String(e));
    } finally {
      setRemoteBusy(null);
    }
  };

  const handleConfigSubmit = async (data: { name: string; fetchUrl: string; pushUrl: string; background: boolean }) => {
    if (!configRemote) return;
    setRemoteBusy('config');
    try {
      if (configRemote.mode === 'add') {
        await api.git.addRemote(repo.path, data.name, data.fetchUrl);
        toast.success(`Remote '${data.name}' added`);
      } else {
        const info = remotesMap[configRemote.name!];
        if (data.fetchUrl !== info?.refs.fetch) {
          await api.git.setRemoteUrl(repo.path, configRemote.name!, data.fetchUrl);
        }
        const existingPush = info?.refs.push ?? '';
        if (data.pushUrl && data.pushUrl !== existingPush) {
          await api.git.setRemoteUrl(repo.path, configRemote.name!, data.pushUrl, true);
        } else if (!data.pushUrl && existingPush && existingPush !== data.fetchUrl) {
          // Cleared the push URL — reset it back to the fetch URL
          await api.git.setRemoteUrl(repo.path, configRemote.name!, data.fetchUrl, true);
        }
        toast.success(`Remote '${configRemote.name}' configured`);
      }
      setBackgroundFetchForRepo(repo.path, data.name, data.background);
      setConfigRemote(null);
      await load();
    } catch (e) {
      toast.error('Configure remote failed', String(e));
    } finally {
      setRemoteBusy(null);
    }
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
  useEscapeKey(!!compareBranch, () => setCompareBranch(null));
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

    if (b.remote) {
      // === REMOTE BRANCH CONTEXT MENU ===
      items.push({ label: 'Check Out (create local tracking branch)...', clickId: 'checkout-remote' });
      items.push({ type: 'separator' });
      items.push({ label: 'Merge into current', clickId: 'merge' });
      items.push({ type: 'separator' });
      items.push({ label: 'Open in Browser', clickId: 'browser' });
      items.push({ label: 'Delete remote branch', clickId: 'delete-remote' });
    } else {
      // === LOCAL BRANCH CONTEXT MENU (matches SmartGit ideal) ===

      // Group 1: Checkout / Merge / Rebase
      if (!b.current) {
        items.push({ label: 'Check Out...', clickId: 'checkout' });
        items.push({ label: 'Merge...', clickId: 'merge' });
        items.push({ label: 'Rebase...', clickId: 'rebase' });
        items.push({ label: 'Fast-Forward Merge', clickId: 'ff-merge' });
        items.push({ type: 'separator' });
      }

      // Group 2: Push
      items.push({ label: 'Push', clickId: 'push' });
      items.push({ label: 'Push To...', clickId: 'push-to' });
      items.push({ type: 'separator' });

      // Group 3: Log / Reset
      items.push({ label: 'Log', clickId: 'log' });
      if (!b.current) {
        items.push({ label: 'Reset...', clickId: 'reset' });
        items.push({ label: 'Reset Advanced...', clickId: 'reset-advanced' });
      }
      items.push({ type: 'separator' });

      // Group 4: Rename / Delete
      items.push({ label: 'Rename...', clickId: 'rename' });
      if (!b.current) {
        items.push({ label: 'Delete...', clickId: 'delete' });
      }
      items.push({ type: 'separator' });

      // Group 5: Tracking
      if (b.tracking) {
        items.push({ label: `Tracking: ${b.tracking}`, clickId: '_noop', enabled: false });
        items.push({ label: 'Stop Tracking...', clickId: 'stop-tracking' });
      } else {
        items.push({ label: 'Set Tracked Branch...', clickId: 'set-tracking' });
      }
      items.push({ type: 'separator' });

      // Group 6: Copy
      items.push({ label: 'Copy', clickId: 'copy' });
    }

    if (items.length > 0) {
      showContextMenu(items, async (action) => {
        // === Checkout ===
        if (action === 'checkout') handleCheckout(b);

        // === Checkout remote (create local tracking branch) ===
        else if (action === 'checkout-remote') {
          const localName = b.name.replace(/^[^/]+\//, '');
          if (!(await confirmDialog({
            title: `Checkout remote branch '${b.name}'`,
            message: `This creates a local branch '${localName}' tracking '${b.name}' and switches to it.`,
            confirmLabel: 'Checkout',
          }))) return;
          api.git.checkout(repo.path, b.name, { track: true }).then(() => {
            toast.success(`Checked out '${localName}' (tracking ${b.name})`);
            load(); refreshStatus(repo.path);
          }).catch((e) => toast.error('Checkout failed', String(e)));
        }

        // === Merge ===
        else if (action === 'merge') handleMerge(b.name);

        // === Rebase ===
        else if (action === 'rebase') {
          if (!(await confirmDialog({ title: `Rebase onto '${b.name}'`, message: `This rebases your current branch onto '${b.name}'.`, confirmLabel: 'Rebase' }))) return;
          useOperationLogStore.getState().logOperation(
            `Rebase onto ${b.name}`, repo.path, `git rebase ${b.name}`,
            () => api.git.rebase(repo.path, b.name)
          ).then(() => { toast.success('Rebase complete'); refreshStatus(repo.path); })
           .catch((e) => toast.error('Rebase failed', String(e)));
        }

        // === Fast-Forward Merge ===
        else if (action === 'ff-merge') {
          useOperationLogStore.getState().logOperation(
            `Fast-Forward Merge ${b.name}`, repo.path, `git merge --ff-only ${b.name}`,
            () => api.git.merge(repo.path, b.name, { ffOnly: true })
          ).then(async (result) => {
            if (result.fastForward) toast.success(`Fast-forwarded to ${b.name}`);
            else toast.info(`${b.name} is not ahead of current — no fast-forward possible`);
            await load(); await refreshStatus(repo.path);
          }).catch((e) => toast.error('Fast-forward failed', String(e)));
        }

        // === Push ===
        else if (action === 'push') handlePushBranch(b);

        // === Push To... (choose remote) ===
        else if (action === 'push-to') {
          const remoteName = b.tracking ? b.tracking.split('/')[0] : 'origin';
          const branchName = b.name;
          if (!(await confirmDialog({
            title: `Push '${branchName}' to '${remoteName}'`,
            message: `This runs: git push ${remoteName} ${branchName}${!b.tracking ? ' (sets upstream with -u)' : ''}`,
            confirmLabel: 'Push',
          }))) return;
          useOperationLogStore.getState().logOperation(
            `Push ${branchName} to ${remoteName}`, repo.path,
            `git push ${remoteName} ${branchName}`,
            () => api.git.push(repo.path, remoteName, branchName, !b.tracking)
          ).then(() => { toast.success(`Pushed ${branchName} to ${remoteName}`); refreshStatus(repo.path); })
           .catch((e) => toast.error('Push failed', String(e)));
        }

        // === Log (show this branch's history in History page) ===
        else if (action === 'log') {
          useSelectionStore.getState().selectBranch(b.name);
          window.location.hash = '#/history';
        }

        // === Reset (reset current HEAD to this branch's commit) ===
        else if (action === 'reset') {
          if (!(await confirmDialog({
            title: `Reset to '${b.name}'`,
            message: `This will reset your current HEAD to match '${b.name}'.\n\nChoose reset mode in the next step.`,
            confirmLabel: 'Reset...',
          }))) return;
          // Reset hard to this branch's last commit
          const lastHash = b.lastCommit?.hash;
          if (!lastHash) { toast.warning('Cannot determine commit hash'); return; }
          if (!(await confirmDialog({
            title: `Reset --hard to ${b.name}`,
            message: `WARNING: This discards ALL uncommitted changes and moves HEAD to ${lastHash.substring(0, 7)}.\n\nThis cannot be undone.`,
            confirmLabel: 'Reset --hard',
          }))) return;
          useOperationLogStore.getState().logOperation(
            `Reset to ${b.name}`, repo.path, `git reset --hard ${lastHash}`,
            () => api.git.reset(repo.path, 'hard', lastHash)
          ).then(() => { toast.success(`Reset to ${b.name}`); refreshStatus(repo.path); })
           .catch((e) => toast.error('Reset failed', String(e)));
        }

        // === Reset Advanced (soft/mixed options) ===
        else if (action === 'reset-advanced') {
          const lastHash = b.lastCommit?.hash;
          if (!lastHash) { toast.warning('Cannot determine commit hash'); return; }
          // Use a simple prompt for now — a full dialog would be better
          const mode = prompt(`Reset to ${b.name} (${lastHash.substring(0, 7)})\n\nEnter reset mode:\n  soft  — keep changes staged\n  mixed — keep changes unstaged (default)\n  hard  — discard all changes`, 'mixed');
          if (!mode || !['soft', 'mixed', 'hard', 'keep'].includes(mode)) return;
          useOperationLogStore.getState().logOperation(
            `Reset --${mode} to ${b.name}`, repo.path, `git reset --${mode} ${lastHash}`,
            () => api.git.reset(repo.path, mode as 'soft' | 'mixed' | 'hard' | 'keep', lastHash)
          ).then(() => { toast.success(`Reset --${mode} to ${b.name}`); refreshStatus(repo.path); })
           .catch((e) => toast.error('Reset failed', String(e)));
        }

        // === Rename ===
        else if (action === 'rename') setRenameTarget({ kind: 'branch', oldName: b.name });

        // === Delete ===
        else if (action === 'delete') handleDelete(b);

        // === Set Tracked Branch ===
        else if (action === 'set-tracking') {
          // List remote branches for user to pick
          const remoteBranches = branches.filter(br => br.remote).map(br => br.name);
          const tracking = prompt(`Set tracked branch for '${b.name}'\n\nAvailable remote branches:\n${remoteBranches.slice(0, 20).join('\n')}\n\nEnter remote branch name:`, b.tracking || `origin/${b.name}`);
          if (!tracking) return;
          useOperationLogStore.getState().logOperation(
            `Set tracking ${b.name} → ${tracking}`, repo.path,
            `git branch --set-upstream-to=${tracking} ${b.name}`,
            () => api.git.raw(repo.path, ['branch', '--set-upstream-to', tracking, b.name])
          ).then(() => { toast.success(`Tracking set to ${tracking}`); load(); })
           .catch((e) => toast.error('Failed to set tracking', String(e)));
        }

        // === Stop Tracking ===
        else if (action === 'stop-tracking') {
          if (!(await confirmDialog({
            title: `Stop tracking for '${b.name}'`,
            message: `This removes the upstream tracking reference for '${b.name}'. The branch itself is not affected.`,
            confirmLabel: 'Stop Tracking',
          }))) return;
          useOperationLogStore.getState().logOperation(
            `Stop tracking ${b.name}`, repo.path,
            `git branch --unset-upstream ${b.name}`,
            () => api.git.raw(repo.path, ['branch', '--unset-upstream', b.name])
          ).then(() => { toast.success(`Stopped tracking for ${b.name}`); load(); })
           .catch((e) => toast.error('Failed to stop tracking', String(e)));
        }

        // === Copy branch name ===
        else if (action === 'copy') {
          navigator.clipboard.writeText(b.name).then(() => toast.success(`Copied '${b.name}'`));
        }

        // === Compare ===
        else if (action === 'compare') handleCompare(b);

        // === Browser ===
        else if (action === 'browser') handleOpenInBrowser(b);

        // === Delete remote ===
        else if (action === 'delete-remote') handleDeleteRemote(b);

        // === Create local from remote ===
        else if (action === 'create-local') {
          const name = b.name.replace(/^[^/]+\//, '');
          setNewBranchName(name);
          setNewBranchStart(b.name);
          setNewBranchCheckout(true);
          setShowNewDialog(true);
        }
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
        {/* Name */}
        <div className="flex-1 min-w-0">
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
          {!b.remote && (
            <>
              {!b.current && (
                <button className="icon-btn !w-5 !h-5" title="Merge into current"
                  onClick={(e) => { e.stopPropagation(); handleMerge(b.name); }}>
                  <GitMerge size={11} />
                </button>
              )}
              {!b.current && (
                <button className="icon-btn !w-5 !h-5" title="Push"
                  onClick={(e) => { e.stopPropagation(); handlePushBranch(b); }}>
                  <Upload size={11} />
                </button>
              )}
              <button className="icon-btn !w-5 !h-5" title="Rename"
                onClick={(e) => { e.stopPropagation(); setRenameTarget({ kind: 'branch', oldName: b.name }); }}>
                <Pencil size={11} />
              </button>
              {!b.current && (
                <button className="icon-btn !w-5 !h-5 hover:!text-status-deleted" title="Delete"
                  onClick={(e) => { e.stopPropagation(); handleDelete(b); }}>
                  <Trash size={11} />
                </button>
              )}
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

  const showRemoteContextMenu = (e: React.MouseEvent, remoteName: string) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu([
      { label: `Fetch '${remoteName}'`, clickId: 'fetch' },
      { label: 'Configure remote properties...', clickId: 'configure' },
      { type: 'separator' },
      { label: 'Rename remote...', clickId: 'rename-remote' },
      { label: 'Remove remote...', clickId: 'remove-remote' },
      { type: 'separator' },
      { label: 'Add new remote...', clickId: 'add-remote' },
      { label: 'Manage all remotes (Remotes page)', clickId: 'manage' },
    ], (action) => {
      if (action === 'fetch') handleFetchRemote(remoteName);
      else if (action === 'configure') setConfigRemote({ mode: 'configure', name: remoteName });
      else if (action === 'rename-remote') setRenameTarget({ kind: 'remote', oldName: remoteName });
      else if (action === 'remove-remote') handleRemoveRemote(remoteName);
      else if (action === 'add-remote') setConfigRemote({ mode: 'add' });
      else if (action === 'manage') window.location.hash = '#/remotes';
    });
  };

  const renderGroup = (
    label: React.ReactNode,
    count: number,
    items: BranchInfo[],
    groupKey: string,
    headerExtra?: React.ReactNode,
    onHeaderContextMenu?: (e: React.MouseEvent) => void,
  ) => {
    const collapsed = collapsedGroups.has(groupKey);
    return (
      <div key={groupKey}>
        <div
          className="group flex items-center gap-1 px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-b border-border-default cursor-pointer hover:bg-bg-hover"
          onClick={() => toggleGroup(groupKey)}
          onContextMenu={onHeaderContextMenu}
        >
          {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          <span>{label}</span>
          <span className="text-text-tertiary">({count})</span>
          {headerExtra}
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

  /** SmartGit-style remote node: 'origin (2) — http://...' with fetch/configure actions. */
  const renderRemoteGroup = (remoteName: string, items: BranchInfo[], groupKey: string) => {
    const url = remotesMap[remoteName]?.refs.fetch ?? '';
    return renderGroup(
      remoteName,
      items.length,
      items,
      groupKey,
      <>
        {url && (
          <span
            className="ml-1 font-normal normal-case tracking-normal text-text-tertiary truncate min-w-0"
            style={{ maxWidth: '45%' }}
            title={`${remoteName} — ${url}`}
          >
            — {url}
          </span>
        )}
        <span className="flex-1" />
        {remoteBusy === remoteName ? (
          <Loader size={10} className="animate-spin text-accent" />
        ) : (
          <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
            <button
              className="icon-btn !w-4 !h-4"
              title={`Fetch '${remoteName}' (with prune)`}
              onClick={(e) => { e.stopPropagation(); handleFetchRemote(remoteName); }}
            >
              <CloudDownload size={10} />
            </button>
            <button
              className="icon-btn !w-4 !h-4"
              title="Configure remote properties..."
              onClick={(e) => { e.stopPropagation(); setConfigRemote({ mode: 'configure', name: remoteName }); }}
            >
              <Cog size={10} />
            </button>
          </span>
        )}
      </>,
      (e) => showRemoteContextMenu(e, remoteName),
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

            {/* Remote groups — SmartGit-style remote nodes with URL + management */}
            {Object.entries(remoteGroups).map(([remoteName, remoteBranches]) =>
              renderRemoteGroup(remoteName, remoteBranches, `remote-${remoteName}`)
            )}
            {Object.keys(remoteGroups).length === 0 && (
              <div className="flex items-center gap-2 px-3 py-2 text-2xs text-text-tertiary border-b border-border-subtle">
                No remotes configured.
                <button
                  className="text-accent hover:underline"
                  onClick={(e) => { e.stopPropagation(); setConfigRemote({ mode: 'add' }); }}
                >
                  Add remote...
                </button>
              </div>
            )}
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

      {/* Rename branch / remote dialog (SmartGit-style) */}
      {renameTarget && (
        <RenameDialog
          kind={renameTarget.kind}
          oldName={renameTarget.oldName}
          busy={remoteBusy === `rename-${renameTarget.oldName}`}
          validate={renameTarget.kind === 'branch' ? validateBranchName : undefined}
          onSubmit={handleRenameSubmit}
          onClose={() => setRenameTarget(null)}
        />
      )}

      {/* Configure / Add remote dialog (SmartGit-style: URL or Path + background poll) */}
      {configRemote && (
        <RemoteConfigDialog
          mode={configRemote.mode}
          name={configRemote.name}
          fetchUrl={configRemote.mode === 'configure' ? remotesMap[configRemote.name!]?.refs.fetch : ''}
          pushUrl={configRemote.mode === 'configure' ? remotesMap[configRemote.name!]?.refs.push : ''}
          background={
            configRemote.mode === 'configure' && configRemote.name
              ? isBackgroundFetchEnabled(repo.path, configRemote.name)
              : false
          }
          busy={remoteBusy === 'config'}
          onSubmit={handleConfigSubmit}
          onClose={() => setConfigRemote(null)}
        />
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
