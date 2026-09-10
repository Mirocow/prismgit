import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, Plus, RefreshCw, Trash, GitMerge, Check, ArrowUp, ArrowDown,
  ExternalLink, Upload, ChevronDown, ChevronRight, X, Pencil, CloudDownload,
  Settings as Cog, Loader, Tag as TagIcon, Package, Download,
} from '../components/icons';
import { MergePanel } from '../components/MergePanel';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useOperationLogStore } from '../stores/operationLogStore';
import { api, type BranchInfo, type RemoteInfo, type TagInfo, type StashEntry, type RemoteProperties } from '../lib/api';
import { useContextMenu, type ContextMenuItem } from '../lib/useContextMenu';
import { cn, formatDate, shortHash } from '../lib/utils';

import { useEscapeKey } from '../hooks/useEscapeKey';
import { RenameDialog, RemoteConfigDialog } from '../components/RemoteDialogs';
import {
  ResetDialog, SetTrackedDialog, AddTagDialog, PullOptionsDialog,
  SetDepthDialog, FetchMoreDialog, RemotePropertiesDialog, PushToDialog, type ResetMode,
} from '../components/BranchDialogs';
import { isBackgroundFetchEnabled, setBackgroundFetchForRepo } from '../lib/backgroundFetch';
import { describePushResult } from '../lib/pushResult';
import { resolveDefaultRemote } from '../lib/remotes';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
export function BranchesPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const { refreshStatus, status } = useGitStore();
  const toast = useToastStore();

  // SmartGit: while a cherry-pick is in progress the branch is "detached from
  // its remote" — the picked commit exists only locally. Pull and Checkout
  // (and other HEAD-movers) would DISCARD the pick, so they are blocked until
  // the user finishes it on the Changes page (Continue / Skip / Abort).
  const cherryPicking = !!status?.isCherryPicking;
  // All sequencer states (merge / rebase / cherry-pick / revert) block
  // branch-switching operations — git would refuse anyway, and switching
  // mid-sequence would lose the in-progress state. Bisect is allowed (it
  // doesn't touch the working tree in a way that conflicts).
  const sequencerInProgress = !!(status?.isMerging || status?.isRebasing || status?.isCherryPicking || status?.isReverting);
  const blockedByCherryPick = (): boolean => {
    if (!sequencerInProgress) return false;
    const state = status?.isMerging ? 'merging' : status?.isRebasing ? 'rebasing' : status?.isCherryPicking ? 'cherry-picking' : 'reverting';
    toast.error(
      `${state.charAt(0).toUpperCase() + state.slice(1)} in progress`,
      `Finish it first on the Changes page (Continue / Skip / Abort) — this operation would lead to loss of the in-progress state.`
    );
    return true;
  };
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
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(['tags', 'stashes']));
  const showContextMenu = useContextMenu();

  // ===== Tags (Branches-page section, like Fork) =====
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [showAddTag, setShowAddTag] = useState(false);
  const [addTagDefaultRef, setAddTagDefaultRef] = useState('HEAD');
  const [tagBusy, setTagBusy] = useState(false);

  // ===== Stashes (Branches-page section, like Fork) =====
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [showStashDialog, setShowStashDialog] = useState(false);
  const [stashMsg, setStashMsg] = useState('');
  const [stashUntracked, setStashUntracked] = useState(true);

  // ===== Dialog targets for context-menu operations =====
  const [resetTarget, setResetTarget] = useState<{ branch: string; ref: string; advanced?: boolean } | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [setTrackedTarget, setSetTrackedTarget] = useState<{ branch: string; current?: string } | null>(null);
  const [setTrackedBusy, setSetTrackedBusy] = useState(false);
  // Push To... (choose remote + target branch) — local AND remote-branch menus
  const [pushToTarget, setPushToTarget] = useState<{ branch: string; defaultRemote: string; hasUpstream: boolean } | null>(null);
  const [pushToBusy, setPushToBusy] = useState(false);
  const [pullRemote, setPullRemote] = useState<string | null>(null);
  const [pullBusy, setPullBusy] = useState(false);
  const [depthRemote, setDepthRemote] = useState<string | null>(null);
  const [depthBusy, setDepthBusy] = useState(false);
  const [moreRemote, setMoreRemote] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [propertiesRemote, setPropertiesRemote] = useState<RemoteProperties | null>(null);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  // Reverse sync (read side): highlight whatever is GLOBALLY selected in any
  // other tool — a branch picked in History/Toolbar, a tag from Tags page, a
  // stash from Stashes page. BranchesPage used to be write-only.
  const globalSelectedBranch = useSelectionStore((s) => s.selectedBranch);
  const globalSelectedTag = useSelectionStore((s) => s.selectedTag);
  const globalSelectedStashIndex = useSelectionStore((s) => s.selectedStashIndex);
  useEscapeKey(!!showAddTag, () => setShowAddTag(false));
  useEscapeKey(!!showStashDialog, () => setShowStashDialog(false));
  useEscapeKey(!!resetTarget, () => setResetTarget(null));
  useEscapeKey(!!setTrackedTarget, () => setSetTrackedTarget(null));
  useEscapeKey(!!pushToTarget, () => setPushToTarget(null));
  useEscapeKey(!!pullRemote, () => setPullRemote(null));
  useEscapeKey(!!depthRemote, () => setDepthRemote(null));
  useEscapeKey(!!moreRemote, () => setMoreRemote(null));
  useEscapeKey(!!propertiesRemote, () => setPropertiesRemote(null));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [branchList, remoteList, tagList, stashList] = await Promise.all([
        api.git.branches(repo.path),
        api.git.remotes(repo.path).catch(() => [] as RemoteInfo[]),
        api.git.tags(repo.path).catch(() => [] as TagInfo[]),
        api.git.stashList(repo.path).catch(() => [] as StashEntry[]),
      ]);
      setBranches(branchList);
      setRemotesMap(Object.fromEntries(remoteList.map((r) => [r.name, r])));
      setTags(tagList);
      setStashes(stashList);
    } catch (e) {
      toast.error('Failed to load branches', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => { load(); }, [load]);

  const handleCheckout = async (branch: BranchInfo, opts?: { autoStash?: boolean }) => {
    if (branch.current) return;
    if (blockedByCherryPick()) return;
    const autoStash = opts?.autoStash ?? false;
    try {
      await useOperationLogStore.getState().logOperation(
        'Check Out Branch', repo.path,
        `git checkout ${branch.name}${autoStash ? '  (with auto-stash)' : ''}`,
        async () => {
          if (autoStash) {
            // Stash dirty work, checkout, then pop — never lose uncommitted changes.
            try { await api.git.raw(repo.path, ['stash', 'push', '-u', '-m', `auto-stash before checkout ${branch.name}`]); }
            catch { /* nothing to stash — proceed */ }
            try {
              await api.git.checkout(repo.path, branch.name);
            } finally {
              try { await api.git.raw(repo.path, ['stash', 'pop']); }
              catch { /* pop errors are surfaced separately */ }
            }
          } else {
            await api.git.checkout(repo.path, branch.name);
          }
        }
      );
      toast.success(`Checked out ${branch.name}`);
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      const msg = String(e);
      // Detect "Your local changes would be overwritten" — offer auto-stash recovery.
      if (/would be overwritten|overwritten by checkout|local changes to the following files/i.test(msg)) {
        const ok = await confirmDialog({
          title: `Checkout blocked by uncommitted changes`,
          message: `Some local changes would be overwritten by switching to '${branch.name}'.\n\nStash them now, switch, then pop the stash on the new branch?`,
          confirmLabel: 'Stash & checkout',
          cancelLabel: 'Cancel',
          danger: false,
        });
        if (ok) {
          // Retry with auto-stash. If it still fails, show the error.
          return handleCheckout(branch, { autoStash: true });
        }
        return; // user cancelled — keep current branch
      }
      toast.error('Checkout failed', msg);
    }
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
    // First attempt: non-force. If git refuses (not fully merged), offer force
    // — but warn that unmerged commits become Recyclable (recoverable 90 days).
    if (!(await confirmDialog({
      title: `Delete branch '${branch.name}'`,
      message: 'This removes the local branch reference.\n\nIf the branch is not fully merged into its upstream, its unique commits become Recyclable — recoverable for 90 days via the Recyclable page, then permanently garbage-collected.',
      confirmLabel: 'Delete',
      danger: true,
    }))) return;
    try {
      await api.git.deleteBranch(repo.path, branch.name, false, branch.remote);
      toast.success(`Deleted '${branch.name}'`);
      await load();
    } catch (e) {
      const msg = String(e);
      if (/not fully merged|branch.*not merged/i.test(msg)) {
        const ok = await confirmDialog({
          title: `Force-delete unmerged branch '${branch.name}'?`,
          message: 'This branch has commits not present in any other branch.\n\nForce-deleting makes those commits Recyclable — recoverable for 90 days via the Recyclable page, then permanently lost.',
          confirmLabel: 'Force delete',
          cancelLabel: 'Cancel',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.git.deleteBranch(repo.path, branch.name, true, branch.remote);
          toast.success(`Force-deleted '${branch.name}'`, 'Unique commits are now Recyclable — recover for 90 days.');
          await load();
        } catch (e2) { toast.error('Force delete failed', String(e2)); }
      } else {
        toast.error('Delete failed', msg);
      }
    }
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
    if (blockedByCherryPick()) return;
    setMergeTarget(branch);
  };

  const handlePushBranch = async (branch: BranchInfo) => {
    try {
      // Prefer the branch's own tracking remote; never hardcode 'origin' —
      // resolve it (origin → first configured remote).
      const remote = (branch.tracking ? branch.tracking.split('/')[0] : '')
        || (await resolveDefaultRemote(repo.path))
        || 'origin';
      const res = await api.git.push(repo.path, remote, branch.name, !branch.tracking);
      const t = describePushResult(res, remote, branch.name);
      if (t.kind === 'error') toast.error(t.title, t.detail);
      else if (t.kind === 'info') toast.info(t.title, t.detail);
      else toast.success(t.title, t.detail);
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

  // ===== Reset dialog executor (Reset... / Reset Advanced... for local AND remote branches) =====
  const executeReset = async (mode: ResetMode, ref: string) => {
    if (!resetTarget) return;
    if (blockedByCherryPick()) return;
    setResetBusy(true);
    try {
      await useOperationLogStore.getState().logOperation(
        `Reset --${mode} to ${ref}`, repo.path, `git reset --${mode} ${ref}`,
        () => api.git.reset(repo.path, mode, ref)
      );
      toast.success(`Reset --${mode} to ${ref.substring(0, 7)}`);
      setResetTarget(null);
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Reset failed', String(e));
    } finally {
      setResetBusy(false);
    }
  };

  // ===== Push To... executor (choose remote + target branch) =====
  const executePushTo = async (opts: { remote: string; targetBranch: string; setUpstream: boolean; force: boolean }) => {
    if (!pushToTarget) return;
    setPushToBusy(true);
    const src = pushToTarget.branch;
    const refspec = opts.targetBranch === src ? src : `${src}:${opts.targetBranch}`;
    try {
      const res = await useOperationLogStore.getState().logOperation(
        `Push ${src} → ${opts.remote}/${opts.targetBranch}`, repo.path,
        `git push ${opts.setUpstream ? '-u ' : ''}${opts.force ? '--force-with-lease ' : ''}${opts.remote} ${refspec}`,
        () => api.git.push(repo.path, opts.remote, src, opts.setUpstream, opts.force, false, opts.targetBranch)
      );
      const t = describePushResult(res, opts.remote, opts.targetBranch);
      if (t.kind === 'error') toast.error(t.title, t.detail);
      else if (t.kind === 'info') toast.info(t.title, t.detail);
      else toast.success(t.title, t.detail);
      setPushToTarget(null);
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Push failed', String(e));
    } finally {
      setPushToBusy(false);
    }
  };

  // ===== Set Tracked Branch executor =====
  const executeSetTracking = async (tracking: string) => {
    if (!setTrackedTarget) return;
    setSetTrackedBusy(true);
    try {
      await useOperationLogStore.getState().logOperation(
        `Set tracking ${setTrackedTarget.branch} → ${tracking}`, repo.path,
        `git branch --set-upstream-to=${tracking} ${setTrackedTarget.branch}`,
        () => api.git.raw(repo.path, ['branch', '--set-upstream-to', tracking, setTrackedTarget.branch])
      );
      toast.success(`Tracking of '${setTrackedTarget.branch}' set to ${tracking}`);
      setSetTrackedTarget(null);
      await load();
    } catch (e) {
      toast.error('Failed to set tracking', String(e));
    } finally {
      setSetTrackedBusy(false);
    }
  };

  // ===== Tag operations (Branches-page Tags section) =====
  const executeAddTag = async (data: { name: string; message: string; ref: string; force: boolean }) => {
    setTagBusy(true);
    try {
      await api.git.createTag(repo.path, data.name, data.message || undefined, data.ref, data.force);
      toast.success(`Tag '${data.name}' created${data.message ? ' (annotated)' : ''}`);
      setShowAddTag(false);
      setCollapsedGroups((prev) => { const n = new Set(prev); n.delete('tags'); return n; });
      await load();
    } catch (e) {
      toast.error('Tag creation failed', String(e));
    } finally {
      setTagBusy(false);
    }
  };

  const handleDeleteTag = async (tag: TagInfo) => {
    if (!(await confirmDialog({
      title: `Delete tag '${tag.name}'`,
      message: 'This removes the tag from the local repository. Remote tags are not affected.',
      confirmLabel: 'Delete',
      danger: true,
    }))) return;
    try {
      await api.git.deleteTag(repo.path, tag.name);
      toast.success(`Tag '${tag.name}' deleted`);
      await load();
    } catch (e) { toast.error('Delete tag failed', String(e)); }
  };

  const handlePushTag = async (tag: TagInfo) => {
    const remoteName = await promptDialog({
      title: `Push tag '${tag.name}'`,
      message: 'Push the tag to a remote:',
      confirmLabel: 'Push',
      input: { initialValue: Object.keys(remotesMap)[0] || 'origin', placeholder: 'origin' },
    });
    if (!remoteName?.trim()) return;
    try {
      await useOperationLogStore.getState().logOperation(
        `Push tag ${tag.name} to ${remoteName}`, repo.path, `git push ${remoteName} ${tag.name}`,
        () => api.git.pushTag(repo.path, tag.name, remoteName.trim())
      );
      toast.success(`Tag '${tag.name}' pushed to ${remoteName}`);
    } catch (e) { toast.error('Push tag failed', String(e)); }
  };

  const showTagContextMenu = (e: React.MouseEvent, tag: TagInfo) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu([
      { label: 'Push To...', accelerator: 'CmdOrCtrl+Up', clickId: 'push-tag' },
      { type: 'separator' },
      { label: 'Show in Log', accelerator: 'CmdOrCtrl+L', clickId: 'tag-log' },
      { type: 'separator' },
      { label: 'Copy Name', accelerator: 'CmdOrCtrl+C', clickId: 'tag-copy' },
      { label: 'Copy Hash', clickId: 'tag-copy-hash' },
      { type: 'separator' },
      { label: 'Delete...', clickId: 'tag-delete' },
    ], (action) => {
      if (action === 'push-tag') handlePushTag(tag);
      else if (action === 'tag-log') {
        useSelectionStore.getState().selectTag(tag.name);
        useSelectionStore.getState().selectCommit(tag.hash);
        window.location.hash = '#/history';
      } else if (action === 'tag-copy') {
        navigator.clipboard.writeText(tag.name).then(() => toast.success(`Copied '${tag.name}'`));
      } else if (action === 'tag-copy-hash') {
        navigator.clipboard.writeText(tag.hash).then(() => toast.success('Hash copied'));
      } else if (action === 'tag-delete') handleDeleteTag(tag);
    });
  };

  // ===== Remote operations: Pull / Fetch More / Set Depth / Properties / Copy URL =====
  const executePull = async (opts: { rebase: boolean; noFF: boolean }) => {
    if (!pullRemote) return;
    // Pull during cherry-pick would merge over an unfinished pick — the picked
    // commit is not committed yet and would be lost.
    if (blockedByCherryPick()) return;
    setPullBusy(true);
    try {
      await useOperationLogStore.getState().logOperation(
        `Pull from ${pullRemote}${opts.rebase ? ' (rebase)' : ''}`, repo.path,
        `git pull${opts.rebase ? ' --rebase' : ''}${opts.noFF ? ' --no-ff' : ''} ${pullRemote}`,
        () => api.git.pull(repo.path, pullRemote, undefined, opts.rebase, opts.noFF)
      );
      toast.success(`Pulled from '${pullRemote}'`);
      setPullRemote(null);
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(`Pull from '${pullRemote}' failed`, String(e));
    } finally {
      setPullBusy(false);
    }
  };

  const executeFetchMore = async (commits: number) => {
    if (!moreRemote) return;
    setMoreBusy(true);
    try {
      await useOperationLogStore.getState().logOperation(
        `Fetch more (+${commits}) from ${moreRemote}`, repo.path,
        `git fetch ${moreRemote} --deepen=${commits}`,
        () => api.git.fetchDeepen(repo.path, moreRemote, commits)
      );
      toast.success(`Fetched ${commits} more commits from '${moreRemote}'`);
      setMoreRemote(null);
      await load();
    } catch (e) {
      toast.error(`Fetch more failed for '${moreRemote}'`, String(e));
    } finally {
      setMoreBusy(false);
    }
  };

  const executeSetDepth = async (depth: number) => {
    if (!depthRemote) return;
    setDepthBusy(true);
    try {
      await useOperationLogStore.getState().logOperation(
        depth > 0 ? `Set fetch depth ${depth} for ${depthRemote}` : `Unshallow ${depthRemote}`, repo.path,
        depth > 0 ? `git fetch ${depthRemote} --depth=${depth}` : `git fetch --unshallow ${depthRemote}`,
        () => api.git.setFetchDepth(repo.path, depthRemote, depth)
      );
      toast.success(depth > 0 ? `Fetch depth of '${depthRemote}' set to ${depth}` : `'${depthRemote}' unshallowed — full history downloaded`);
      setDepthRemote(null);
      await load();
    } catch (e) {
      toast.error(`Set depth failed for '${depthRemote}'`, String(e));
    } finally {
      setDepthBusy(false);
    }
  };

  const handleShowProperties = async (remoteName: string) => {
    setPropertiesLoading(true);
    try {
      const props = await api.git.remoteProperties(repo.path, remoteName);
      setPropertiesRemote(props);
    } catch (e) {
      toast.error(`Failed to read properties of '${remoteName}'`, String(e));
    } finally {
      setPropertiesLoading(false);
    }
  };

  const handleCopyRemoteUrl = async (remoteName: string) => {
    const url = remotesMap[remoteName]?.refs.fetch;
    if (!url) { toast.warning('Remote has no URL'); return; }
    navigator.clipboard.writeText(url).then(() => toast.success('URL copied to clipboard'));
  };

  // ===== Stash operations (Branches-page Stashes section) =====
  const handleStashChanges = async () => {
    try {
      const out = await api.git.stashPush(repo.path, stashMsg.trim() || undefined, stashUntracked);
      if (!out || !out.trim()) {
        toast.info('No local changes to stash');
        return;
      }
      toast.success('Changes stashed');
      setShowStashDialog(false);
      setStashMsg('');
      setCollapsedGroups((prev) => { const n = new Set(prev); n.delete('stashes'); return n; });
      await load();
      await refreshStatus(repo.path);
    } catch (e) { toast.error('Stash failed', String(e)); }
  };

  const handleApplyStash = async (s: StashEntry) => {
    if (!(await confirmDialog({
      title: `Apply stash@{${s.index}}`,
      message: `Applies the stashed changes to the working tree and KEEPS the stash.\n\n"${s.message}"`,
      confirmLabel: 'Apply',
    }))) return;
    try {
      await useOperationLogStore.getState().logOperation(
        `Apply stash@{${s.index}}`, repo.path, `git stash apply stash@{${s.index}}`,
        () => api.git.stashApply(repo.path, s.index)
      );
      toast.success(`stash@{${s.index}} applied (stash kept)`);
      await load();
      await refreshStatus(repo.path);
    } catch (e) { toast.error('Stash apply failed', String(e)); }
  };

  const handleRenameStash = async (s: StashEntry) => {
    const newMessage = await promptDialog({
      title: `Rename stash@{${s.index}}`,
      message: 'Enter the new stash message:',
      confirmLabel: 'Rename',
      input: { initialValue: s.message, placeholder: 'WIP: ...' },
      validate: (v) => (!v.trim() ? 'Message must not be empty' : null),
    });
    if (newMessage == null || !newMessage.trim() || newMessage === s.message) return;
    try {
      await useOperationLogStore.getState().logOperation(
        `Rename stash@{${s.index}}`, repo.path,
        `git stash rename (rebuild refs/stash)`,
        () => api.git.stashRename(repo.path, s.index, newMessage.trim())
      );
      toast.success(`stash@{${s.index}} renamed`);
      await load();
    } catch (e) { toast.error('Stash rename failed', String(e)); }
  };

  const handleDropStash = async (s: StashEntry) => {
    if (!(await confirmDialog({
      title: `Drop stash@{${s.index}}`,
      message: `This permanently deletes the stash.\n\n"${s.message}"`,
      confirmLabel: 'Drop',
      danger: true,
    }))) return;
    try {
      await useOperationLogStore.getState().logOperation(
        `Drop stash@{${s.index}}`, repo.path, `git stash drop stash@{${s.index}}`,
        () => api.git.stashDrop(repo.path, s.index)
      );
      toast.success(`stash@{${s.index}} dropped`);
      await load();
    } catch (e) { toast.error('Stash drop failed', String(e)); }
  };

  const handleStashShowInLog = (s: StashEntry) => {
    // Stash selection is global — Branches and Stashes pages stay in sync
    useSelectionStore.getState().selectStash(s.index, s.hash);
    useSelectionStore.getState().selectCommit(s.hash);
    window.location.hash = '#/history';
  };

  const showStashContextMenu = (e: React.MouseEvent, s: StashEntry) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu([
      { label: 'Apply Stash...', accelerator: 'Shift+CmdOrCtrl+S', clickId: 'stash-apply' },
      { label: 'Pop Stash (apply + drop)', clickId: 'stash-pop' },
      { type: 'separator' },
      { label: 'Show Content in Log', accelerator: 'CmdOrCtrl+L', clickId: 'stash-log' },
      { type: 'separator' },
      { label: 'Rename Stash...', accelerator: 'F2', clickId: 'stash-rename' },
      { label: 'Drop Stash...', clickId: 'stash-drop' },
      { type: 'separator' },
      { label: 'Copy Message', clickId: 'stash-copy' },
    ], (action) => {
      if (action === 'stash-apply') handleApplyStash(s);
      else if (action === 'stash-pop') {
        confirmDialog({
          title: `Pop stash@{${s.index}}`,
          message: `Applies the stashed changes and REMOVES the stash.\n\n"${s.message}"`,
          confirmLabel: 'Pop',
        }).then(async (ok) => {
          if (!ok) return;
          try {
            await useOperationLogStore.getState().logOperation(
              `Pop stash@{${s.index}}`, repo.path, `git stash pop stash@{${s.index}}`,
              () => api.git.stashPop(repo.path, s.index)
            );
            toast.success(`stash@{${s.index}} popped`);
            await load();
            await refreshStatus(repo.path);
          } catch (e) { toast.error('Stash pop failed', String(e)); }
        });
      }
      else if (action === 'stash-log') handleStashShowInLog(s);
      else if (action === 'stash-rename') handleRenameStash(s);
      else if (action === 'stash-drop') handleDropStash(s);
      else if (action === 'stash-copy') {
        navigator.clipboard.writeText(s.message).then(() => toast.success('Message copied'));
      }
    });
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
      // === REMOTE BRANCH CONTEXT MENU (matches Fork: Check Out / Merge / Rebase /
      //     Push (disabled) / Push To / Log / Reset / Reset Advanced / Delete / Copy) ===
      items.push({ label: 'Check Out...', accelerator: 'CmdOrCtrl+G', clickId: 'checkout-remote' });
      items.push({ type: 'separator' });
      items.push({ label: 'Merge...', clickId: 'merge' });
      items.push({ label: 'Rebase...', accelerator: 'CmdOrCtrl+D', clickId: 'rebase' });
      items.push({ type: 'separator' });
      // Push is meaningless for a remote-only branch — shown disabled like Fork does.
      items.push({ label: 'Push', accelerator: 'CmdOrCtrl+Up', enabled: false, clickId: '_noop' });
      items.push({ label: 'Push To...', accelerator: 'Shift+CmdOrCtrl+Up', clickId: 'push-to-remote' });
      items.push({ type: 'separator' });
      items.push({ label: 'Log', accelerator: 'CmdOrCtrl+L', clickId: 'log' });
      items.push({ type: 'separator' });
      items.push({ label: 'Reset...', accelerator: 'CmdOrCtrl+R', clickId: 'reset-remote' });
      items.push({ label: 'Reset Advanced...', accelerator: 'Shift+CmdOrCtrl+R', clickId: 'reset-advanced-remote' });
      items.push({ type: 'separator' });
      items.push({ label: 'Delete...', clickId: 'delete-remote' });
      items.push({ type: 'separator' });
      items.push({ label: 'Copy', accelerator: 'CmdOrCtrl+C', clickId: 'copy' });
      items.push({ label: 'Open in Browser', clickId: 'browser' });
    } else {
      // === LOCAL BRANCH CONTEXT MENU (matches Fork) ===

      // Group 1: Checkout / Merge / Rebase
      if (!b.current) {
        items.push({ label: 'Check Out...', accelerator: 'CmdOrCtrl+G', clickId: 'checkout' });
        items.push({ type: 'separator' });
        items.push({ label: 'Merge...', clickId: 'merge' });
        items.push({ label: 'Rebase...', accelerator: 'CmdOrCtrl+D', clickId: 'rebase' });
        items.push({ label: 'Fast-Forward Merge', clickId: 'ff-merge' });
        items.push({ type: 'separator' });
      }

      // Group 2: Push
      items.push({ label: 'Push', accelerator: 'CmdOrCtrl+Up', clickId: 'push' });
      items.push({ label: 'Push To...', accelerator: 'Shift+CmdOrCtrl+Up', clickId: 'push-to' });
      // SmartGit Manual: Push to Gerrit — refs/for/<branch>
      items.push({ label: 'Push to Gerrit...', clickId: 'push-gerrit' });
      items.push({ type: 'separator' });

      // Group 3: Log / Reset
      items.push({ label: 'Log', accelerator: 'CmdOrCtrl+L', clickId: 'log' });
      items.push({ type: 'separator' });
      items.push({ label: 'Reset...', accelerator: 'CmdOrCtrl+R', clickId: 'reset' });
      items.push({ label: 'Reset Advanced...', accelerator: 'Shift+CmdOrCtrl+R', clickId: 'reset-advanced' });
      items.push({ type: 'separator' });

      // Group 4: Rename / Delete
      items.push({ label: 'Rename...', accelerator: 'F2', clickId: 'rename' });
      if (!b.current) {
        items.push({ label: 'Delete...', clickId: 'delete' });
      }
      items.push({ type: 'separator' });

      // Group 5: Tracking
      if (b.tracking) {
        items.push({ label: `Tracking: ${b.tracking}`, clickId: '_noop', enabled: false });
        items.push({ label: 'Set Tracked Branch...', clickId: 'set-tracking' });
        items.push({ label: 'Stop Tracking...', clickId: 'stop-tracking' });
      } else {
        items.push({ label: 'Set Tracked Branch...', clickId: 'set-tracking' });
        items.push({ label: 'Stop Tracking...', enabled: false, clickId: '_noop' });
      }
      items.push({ type: 'separator' });

      // Group 6: Copy
      items.push({ label: 'Copy', accelerator: 'CmdOrCtrl+C', clickId: 'copy' });
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

        // === Push To... (choose remote + target branch) ===
        else if (action === 'push-to') {
          const remoteName = b.tracking ? b.tracking.split('/')[0]
            : (await resolveDefaultRemote(repo.path)) || 'origin';
          setPushToTarget({ branch: b.name, defaultRemote: remoteName, hasUpstream: !!b.tracking });
        }

        // === Push to Gerrit (refs/for/<branch>) === SmartGit Manual
        else if (action === 'push-gerrit') {
          const remoteName = b.tracking ? b.tracking.split('/')[0] : 'origin';
          const branchName = b.name;
          const topic = window.prompt(`Push '${branchName}' to Gerrit (refs/for/${branchName}).\n\nOptional topic:`, '');
          try {
            const output = await api.git.pushToGerrit(repo.path, branchName, remoteName, {
              topic: topic || undefined,
            });
            toast.success(`Pushed to Gerrit: refs/for/${branchName}`, output.split('\n')[0] || '');
            await refreshStatus(repo.path);
          } catch (e) { toast.error('Push to Gerrit failed', String(e)); }
        }

        // === Log (show this branch's history in History page) ===
        else if (action === 'log') {
          useSelectionStore.getState().selectBranch(b.name);
          window.location.hash = '#/history';
        }

        // === Reset current branch to this branch's commit (mode dialog) ===
        else if (action === 'reset' || action === 'reset-remote') {
          if (!b.lastCommit?.hash) { toast.warning('Cannot determine commit hash'); return; }
          setResetTarget({ branch: b.name, ref: b.lastCommit.hash });
        }

        // === Reset Advanced (mode + editable ref) ===
        else if (action === 'reset-advanced' || action === 'reset-advanced-remote') {
          setResetTarget({ branch: b.name, ref: b.lastCommit?.hash || 'HEAD', advanced: true });
        }

        // === Rename ===
        else if (action === 'rename') setRenameTarget({ kind: 'branch', oldName: b.name });

        // === Delete ===
        else if (action === 'delete') handleDelete(b);

        // === Set Tracked Branch (dialog with remote-branch picker) ===
        else if (action === 'set-tracking') {
          setSetTrackedTarget({ branch: b.name, current: b.tracking });
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

        // === Push To... for a REMOTE branch: push the CURRENT branch to that
        // remote — with full remote + target-branch choice (same dialog) ===
        else if (action === 'push-to-remote') {
          const current = branches.find((x) => x.current)?.name || (await api.git.currentBranch(repo.path));
          if (!current || current === 'HEAD') {
            toast.warning('Push To needs a current branch (detached HEAD?)');
            return;
          }
          setPushToTarget({
            branch: current,
            defaultRemote: b.name.split('/')[0],
            hasUpstream: branches.some((x) => x.current && x.tracking),
          });
        }

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
  const filteredTags = tags.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));
  const filteredStashes = stashes.filter(s => s.message.toLowerCase().includes(search.toLowerCase()));

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
          globalSelectedBranch === b.name && !b.current && 'bg-bg-selected',
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
          // Ctrl/Cmd-click: select branch in global store ONLY (no checkout)
          if (e.ctrlKey || e.metaKey) {
            useSelectionStore.getState().selectBranch(b.name);
            toast.info(`Selected branch '${b.name}' — visible in History filter`);
            return;
          }
          // Plain click: SELECT ONLY — never checkout.
          // Checkout must be an explicit action (Checkout button, context-menu,
          // or double-click). Selecting a branch just sets it as the active
          // branch for History filtering / merge / rebase targeting.
          useSelectionStore.getState().selectBranch(b.name);
        }}
        onDoubleClick={(e) => {
          // Double-click is the explicit "checkout this branch" gesture.
          // (Mirrors IDE file trees where single-click selects, double-click opens.)
          if (b.remote) {
            // For remote branches: confirm + create tracking local branch.
            const localName = b.name.replace(/^[^/]+\//, '');
            confirmDialog({
              title: `Checkout remote branch '${b.name}'`,
              message: `This creates a local branch '${localName}' tracking '${b.name}' and switches to it.`,
              confirmLabel: 'Checkout',
            }).then((ok) => {
              if (!ok) return;
              api.git.checkout(repo.path, b.name, { track: true })
                .then(() => { toast.success(`Checked out '${localName}'`); load(); refreshStatus(repo.path); })
                .catch((err) => toast.error('Checkout failed', String(err)));
            });
            return;
          }
          if (!b.current) handleCheckout(b);
        }}
        onContextMenu={(e) => showBranchContextMenu(e, b)}
      >
        {/* Current branch indicator — ">" marks the checked-out branch (HEAD).
            Bright accent background + bold ">" + "HEAD" label so the user
            can always see at a glance which branch they are on. */}
        <span
          className={cn(
            'flex-shrink-0 flex items-center justify-center font-bold rounded-sm',
            b.current
              ? 'w-5 h-5 bg-accent text-text-inverse text-xs'
              : 'w-5 h-5 text-text-tertiary/30 text-xs'
          )}
          title={b.current ? `Current branch (HEAD) — you are on '${b.name}'` : 'Not current'}
        >
          {b.current ? '>' : ''}
        </span>
        <GitBranch size={12} className={b.current ? 'text-accent' : 'text-text-tertiary'} flex-shrink-0 />
        {/* Name */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('truncate', b.current ? 'font-bold text-accent' : 'font-medium text-text-primary')}>{b.name}</span>
            {b.current && (
              <span className="text-2xs px-1 py-0.5 rounded bg-accent text-text-inverse font-semibold uppercase tracking-wide">
                HEAD
              </span>
            )}
            {b.tracking && <span className="text-2xs text-text-tertiary">→ {b.tracking}</span>}
            {/* SmartGit: show cherry-picking state explicitly on the branch —
                the pick is not committed yet, so the branch is effectively
                detached from its remote until the pick is finished. */}
            {b.current && cherryPicking && (
              <span
                data-testid="cherry-pick-badge"
                className="text-2xs px-1 py-0.5 rounded bg-status-conflict/15 text-status-conflict border border-status-conflict/40 flex items-center gap-0.5 font-medium flex-shrink-0"
                title={`Cherry-picking ${status?.cherryPick?.commit ? shortHash(status.cherryPick.commit) : ''} — not yet committed, detached from remote. Pull and Checkout would lead to loss of commits. Finish the pick on the Changes page (Continue/Skip/Abort).`}
              >
                ⚠ cherry-picking
              </span>
            )}
            {b.ahead !== undefined && b.ahead > 0 && (
              <span className="text-2xs px-1 py-0.5 rounded bg-status-added/15 text-status-added flex items-center gap-0.5 font-medium">
                <ArrowUp size={8} />{b.ahead}
              </span>
            )}
            {b.behind !== undefined && b.behind > 0 && (
              <span className="text-2xs px-1 py-0.5 rounded bg-status-modified/15 text-status-modified flex items-center gap-0.5 font-medium">
                <ArrowDown size={8} />{b.behind}
              </span>
            )}
          </div>
        </div>
        {/* Last commit info */}
        {b.lastCommit && (
          <div className="flex items-center gap-1 text-2xs text-text-tertiary/70 flex-shrink-0">
            <code className="font-mono">{shortHash(b.lastCommit.hash)}</code>
            <span className="hidden lg:inline truncate" style={{ maxWidth: 150 }}>{b.lastCommit.message}</span>
            <span>· {formatDate(b.lastCommit.date)}</span>
          </div>
        )}
        {/* Hover actions — always faintly visible, brighten on hover.
            Checkout is the primary action (leftmost, accent color) — it is
            NEVER auto-fired by clicking the row itself. */}
        <div className="flex items-center gap-0.5 opacity-30 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {!b.remote && (
            <>
              {!b.current && (
                <button
                  className="icon-btn !w-5 !h-5 !text-accent hover:!bg-accent-muted"
                  title="Check out this branch  (or double-click the row)"
                  onClick={(e) => { e.stopPropagation(); handleCheckout(b); }}
                >
                  <Check size={11} />
                </button>
              )}
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
              <button
                className="icon-btn !w-5 !h-5 !text-accent hover:!bg-accent-muted"
                title="Check out as new local branch  (or double-click the row)"
                onClick={(e) => {
                  e.stopPropagation();
                  const localName = b.name.replace(/^[^/]+\//, '');
                  confirmDialog({
                    title: `Checkout remote branch '${b.name}'`,
                    message: `This creates a local branch '${localName}' tracking '${b.name}' and switches to it.`,
                    confirmLabel: 'Checkout',
                  }).then((ok) => {
                    if (!ok) return;
                    api.git.checkout(repo.path, b.name, { track: true })
                      .then(() => { toast.success(`Checked out '${localName}'`); load(); refreshStatus(repo.path); })
                      .catch((err) => toast.error('Checkout failed', String(err)));
                  });
                }}
              >
                <Check size={11} />
              </button>
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

  /** Header context menu for "Local Branches" (Fork-style: Add Branch... F7). */
  const showLocalHeaderContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu([
      { label: 'Add Branch...', accelerator: 'F7', clickId: 'add-branch' },
    ], (action) => {
      if (action === 'add-branch') setShowNewDialog(true);
    });
  };

  const showRemoteContextMenu = (e: React.MouseEvent, remoteName: string) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu([
      { label: 'Push To...', accelerator: 'Shift+CmdOrCtrl+Up', clickId: 'remote-push-to' },
      { label: 'Pull...', accelerator: 'CmdOrCtrl+Down', clickId: 'remote-pull' },
      { type: 'separator' },
      { label: 'Fetch', accelerator: 'Shift+CmdOrCtrl+Down', clickId: 'fetch' },
      { label: 'Fetch More...', clickId: 'fetch-more' },
      { type: 'separator' },
      { label: 'Rename...', accelerator: 'F2', clickId: 'rename-remote' },
      { label: 'Delete...', clickId: 'remove-remote' },
      { type: 'separator' },
      { label: 'Copy URL', clickId: 'copy-url' },
      { type: 'separator' },
      { label: 'Set Depth...', clickId: 'set-depth' },
      { label: 'Properties...', clickId: 'properties' },
      { type: 'separator' },
      { label: 'Configure remote...', clickId: 'configure' },
      { label: 'Add new remote...', clickId: 'add-remote' },
      { label: 'Manage all remotes (Remotes page)', clickId: 'manage' },
    ], (action) => {
      if (action === 'remote-push-to') {
        // Push the CURRENT branch to this remote (Fork behavior) — via the
        // Push To dialog so the remote + target branch stay user-selectable.
        const current = branches.find((x) => x.current)?.name;
        if (!current) {
          toast.warning('Push To needs a current branch (detached HEAD?)');
          return;
        }
        setPushToTarget({
          branch: current,
          defaultRemote: remoteName,
          hasUpstream: branches.some((x) => x.current && x.tracking),
        });
      }
      else if (action === 'remote-pull') setPullRemote(remoteName);
      else if (action === 'fetch') handleFetchRemote(remoteName);
      else if (action === 'fetch-more') setMoreRemote(remoteName);
      else if (action === 'configure') setConfigRemote({ mode: 'configure', name: remoteName });
      else if (action === 'rename-remote') setRenameTarget({ kind: 'remote', oldName: remoteName });
      else if (action === 'remove-remote') handleRemoveRemote(remoteName);
      else if (action === 'add-remote') setConfigRemote({ mode: 'add' });
      else if (action === 'copy-url') handleCopyRemoteUrl(remoteName);
      else if (action === 'set-depth') setDepthRemote(remoteName);
      else if (action === 'properties') handleShowProperties(remoteName);
      else if (action === 'manage') window.location.hash = '#/remotes';
    });
  };

  /** Header context menu for "Tags" (Fork-style: Add Tag... Shift+F7). */
  const showTagsHeaderContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu([
      { label: 'Add Tag...', accelerator: 'Shift+F7', clickId: 'add-tag' },
    ], (action) => {
      if (action === 'add-tag') {
        setAddTagDefaultRef(useSelectionStore.getState().selectedCommitHash || 'HEAD');
        setShowAddTag(true);
      }
    });
  };

  /** Header context menu for "Stashes" — create a new stash. */
  const showStashesHeaderContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu([
      { label: 'Stash Changes (New Stash)...', accelerator: 'Shift+CmdOrCtrl+S', clickId: 'stash-new' },
    ], (action) => {
      if (action === 'stash-new') setShowStashDialog(true);
    });
  };

  // F7 = Add Branch, Shift+F7 = Add Tag (only when this page is focused)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F7') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      if (e.shiftKey) {
        setAddTagDefaultRef(useSelectionStore.getState().selectedCommitHash || 'HEAD');
        setShowAddTag(true);
      } else {
        setShowNewDialog(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const renderGroup = (
    label: React.ReactNode,
    count: number,
    items: BranchInfo[],
    groupKey: string,
    headerExtra?: React.ReactNode,
    onHeaderContextMenu?: (e: React.MouseEvent) => void,
    renderRow?: (item: BranchInfo) => React.ReactNode,
  ) => {
    const collapsed = collapsedGroups.has(groupKey);
    const rowRenderer: (item: BranchInfo) => React.ReactNode = renderRow ?? renderBranchRow;
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
        {!collapsed && items.slice(0, 200).map(rowRenderer)}
      </div>
    );
  };

  /** SmartGit-style remote node: 'origin (2) — http://...' with fetch/configure actions. */
  const renderRemoteGroup = (remoteName: string, items: BranchInfo[], groupKey: string) => {
    const url = remotesMap[remoteName]?.refs.fetch ?? '';
    // A configured remote with NO fetched branches still renders one hint row —
    // otherwise it looks like the remote is missing entirely. While a filter is
    // active, missing branches just mean "nothing matches", so no hint then.
    const EMPTY_HINT = '__empty-remote__';
    const rows: BranchInfo[] = items.length > 0 ? items : (search.trim()
      ? []
      : [{ name: EMPTY_HINT, remote: true, current: false, tracking: null, hash: '', hashAbbrev: '', subject: '', author: { name: '', email: '', date: '', timestamp: 0 }, committer: { name: '', email: '', date: '', timestamp: 0 }, date: '' } as unknown as BranchInfo]);
    const rowRenderer = (b: BranchInfo) =>
      b.name === EMPTY_HINT ? (
        <div
          key={`${groupKey}-empty-hint`}
          className="flex items-center gap-2 px-3 py-1.5 text-2xs text-text-tertiary border-b border-border-subtle"
        >
          <span className="w-3 flex-shrink-0" />
          No branches fetched yet — hover the header and press
          <CloudDownload size={10} /> Fetch
        </div>
      ) : renderBranchRow(b);
    return renderGroup(
      remoteName,
      items.length,
      rows,
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
      rowRenderer,
    );
  };

  const renderTagRow = (tag: TagInfo) => (
    <div
      key={tag.name}
      className={cn(
        'group flex items-center gap-2 px-3 py-1 cursor-pointer text-xs border-b border-border-subtle hover:bg-bg-hover',
        globalSelectedTag === tag.name && 'bg-bg-selected'
      )}
      onClick={(e) => {
        // Click: select the tag globally and show the tagged commit in History
        useSelectionStore.getState().selectTag(tag.name);
        useSelectionStore.getState().selectCommit(tag.hash);
        window.location.hash = '#/history';
        e.stopPropagation();
      }}
      onContextMenu={(e) => showTagContextMenu(e, tag)}
    >
      <span className="w-3 flex-shrink-0" />
      <TagIcon size={12} className="text-text-tertiary flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-text-primary">{tag.name}</span>
          {!tag.lightweight && tag.annotation && (
            <span className="text-2xs text-text-tertiary truncate" style={{ maxWidth: 220 }} title={tag.annotation}>
              {tag.annotation}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 text-2xs text-text-tertiary/70 flex-shrink-0">
        <code className="font-mono">{tag.hashAbbrev}</code>
        {tag.date && <span>· {formatDate(tag.date)}</span>}
      </div>
    </div>
  );

  /** Fork-style stash row: "07/25/2025 02:55 PM: WIP on remove-sync: ..." */
  const renderStashRow = (s: StashEntry) => {
    const dateLabel = s.date ? formatDate(s.date) : '';
    return (
      <div
        key={`stash-${s.index}`}
        className={cn(
          'group flex items-center gap-2 px-3 py-1 cursor-pointer text-xs border-b border-border-subtle hover:bg-bg-hover',
          globalSelectedStashIndex === s.index && 'bg-bg-selected'
        )}
        onClick={(e) => { handleStashShowInLog(s); e.stopPropagation(); }}
        onContextMenu={(e) => showStashContextMenu(e, s)}
        title="Click: show content in Log · Right-click: stash menu"
      >
        <span className="w-3 flex-shrink-0" />
        <Package size={12} className="text-text-tertiary flex-shrink-0" />
        <div className="flex-1 min-w-0 truncate">
          {dateLabel && <span className="text-text-secondary">{dateLabel}: </span>}
          <span className="text-text-primary">{s.message}</span>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
          <button className="icon-btn !w-5 !h-5" title="Apply Stash (keep stash)"
            onClick={(e) => { e.stopPropagation(); handleApplyStash(s); }}>
            <Check size={11} />
          </button>
          <button className="icon-btn !w-5 !h-5" title="Rename Stash"
            onClick={(e) => { e.stopPropagation(); handleRenameStash(s); }}>
            <Pencil size={11} />
          </button>
          <button className="icon-btn !w-5 !h-5 hover:!text-status-deleted" title="Drop Stash"
            onClick={(e) => { e.stopPropagation(); handleDropStash(s); }}>
            <Trash size={11} />
          </button>
        </div>
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
            {localBranches.length} local · {Object.values(remoteGroups).reduce((a, b) => a + b.length, 0)} remote · {filteredTags.length} tags · {filteredStashes.length} stashes
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
        {/* SmartGit: explicit repo-level cherry-picking warning — Pull/Checkout blocked */}
        {cherryPicking && (
          <div
            data-testid="cherry-pick-warning"
            className="flex items-center gap-2 px-3 py-1.5 border-b border-status-conflict/40 bg-status-conflict/10 text-2xs text-status-conflict"
          >
            <span className="font-medium">Cherry-pick in progress</span>
            <span className="text-text-secondary">
              {status?.cherryPick?.commit && <>— picking <code className="font-mono">{shortHash(status.cherryPick.commit)}</code>{status.cherryPick.subject ? ` “${status.cherryPick.subject}”` : null}. </>}
              The current branch is detached from its remote until the pick is finished: Pull and Checkout would lead to loss of commits. Finish it on the Changes page — Continue, Skip or Abort.
            </span>
          </div>
        )}
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
        ) : filtered.length === 0 && filteredTags.length === 0 && filteredStashes.length === 0 ? (
          <div className="p-8 text-center text-text-tertiary text-sm">
            {search ? 'Nothing matches the filter' : 'No branches, tags or stashes'}
          </div>
        ) : (
          <>
            {/* Local branches — header right-click: Add Branch... (F7) */}
            {renderGroup('Local Branches', localBranches.length, localBranches, 'local', undefined, showLocalHeaderContextMenu)}

            {/* Remote groups — one per CONFIGURED remote (not just remotes that
                happen to have fetched branches): a freshly added remote shows
                up here immediately, with a Fetch hint when it has no branches yet. */}
            {Object.keys(remotesMap).length > 0 && (
              Object.keys(remotesMap).map((remoteName) =>
                renderRemoteGroup(remoteName, remoteGroups[remoteName] ?? [], `remote-${remoteName}`)
              )
            )}
            {Object.keys(remotesMap).length === 0 && (
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

            {/* Tags — header right-click: Add Tag... (Shift+F7) */}
            {renderGroup('Tags', filteredTags.length, filteredTags as unknown as BranchInfo[], 'tags', undefined, showTagsHeaderContextMenu, (t) => renderTagRow(t as unknown as TagInfo))}

            {/* Stashes — header right-click: Stash Changes... */}
            {renderGroup('Stashes', filteredStashes.length, filteredStashes as unknown as BranchInfo[], 'stashes', undefined, showStashesHeaderContextMenu, (s) => renderStashRow(s as unknown as StashEntry))}
          </>
        )}
      </div>

      {/* Info bar at bottom */}
      <div className="px-3 py-1 border-t border-border-default bg-bg-tertiary text-2xs text-text-tertiary">
        Tip: Click = select  ·  Double-click = checkout  ·  Drag onto another branch to merge  ·  Right-click for full menu
      </div>

      {/* New branch dialog */}
      {showNewDialog && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50" onClick={() => setShowNewDialog(false)}>
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

      {/* Reset / Reset Advanced dialog (local + remote branches) */}
      {resetTarget && (
        <ResetDialog
          branchName={resetTarget.branch}
          defaultRef={resetTarget.ref}
          advanced={resetTarget.advanced}
          busy={resetBusy}
          onSubmit={executeReset}
          onClose={() => setResetTarget(null)}
        />
      )}

      {/* Set Tracked Branch dialog (remote-branch picker) */}
      {setTrackedTarget && (
        <SetTrackedDialog
          branchName={setTrackedTarget.branch}
          remoteBranches={branches.filter((b) => b.remote).map((b) => b.name)}
          current={setTrackedTarget.current}
          busy={setTrackedBusy}
          onSubmit={executeSetTracking}
          onClose={() => setSetTrackedTarget(null)}
        />
      )}

      {/* Push To... dialog (choose remote repository + target branch) */}
      {pushToTarget && (
        <PushToDialog
          branchName={pushToTarget.branch}
          remotes={Object.keys(remotesMap)}
          defaultRemote={pushToTarget.defaultRemote}
          remoteBranches={branches.filter((b) => b.remote).map((b) => b.name)}
          hasUpstream={pushToTarget.hasUpstream}
          busy={pushToBusy}
          onSubmit={executePushTo}
          onClose={() => setPushToTarget(null)}
        />
      )}

      {/* Add Tag dialog (Tags section header / Shift+F7) */}
      {showAddTag && (
        <AddTagDialog
          defaultRef={addTagDefaultRef}
          busy={tagBusy}
          onSubmit={executeAddTag}
          onClose={() => setShowAddTag(false)}
        />
      )}

      {/* Pull options dialog (remote context menu) */}
      {pullRemote && (
        <PullOptionsDialog
          remoteName={pullRemote}
          busy={pullBusy}
          onSubmit={executePull}
          onClose={() => setPullRemote(null)}
        />
      )}

      {/* Set Depth dialog (remote context menu) */}
      {depthRemote && (
        <SetDepthDialog
          remoteName={depthRemote}
          busy={depthBusy}
          onSubmit={executeSetDepth}
          onClose={() => setDepthRemote(null)}
        />
      )}

      {/* Fetch More dialog (remote context menu) */}
      {moreRemote && (
        <FetchMoreDialog
          remoteName={moreRemote}
          busy={moreBusy}
          onSubmit={executeFetchMore}
          onClose={() => setMoreRemote(null)}
        />
      )}

      {/* Remote properties dialog (remote context menu) */}
      {propertiesRemote && (
        <RemotePropertiesDialog props={propertiesRemote} onClose={() => setPropertiesRemote(null)} />
      )}
      {propertiesLoading && !propertiesRemote && (
        <div className="fixed bottom-10 right-6 z-50 panel px-3 py-2 text-xs flex items-center gap-2">
          <Loader size={12} className="animate-spin" /> Loading remote properties...
        </div>
      )}

      {/* New stash dialog (Stashes section header menu) */}
      {showStashDialog && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50" onClick={() => setShowStashDialog(false)}>
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4 flex items-center gap-2">
              <Package size={16} /> Stash Changes
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Message (optional)</label>
                <input type="text" className="w-full text-sm" placeholder="WIP: feature X"
                  value={stashMsg} autoFocus
                  onChange={(e) => setStashMsg(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleStashChanges()} />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={stashUntracked} onChange={(e) => setStashUntracked(e.target.checked)} />
                Include untracked files
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowStashDialog(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleStashChanges}>
                <Download size={13} /> Stash
              </button>
            </div>
          </div>
        </div>
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
        <div className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50" onClick={() => setCompareBranch(null)}>
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
