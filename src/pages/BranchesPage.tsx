import { useState, useEffect, useCallback, useRef } from 'react';
import {
  GitBranch, Plus, RefreshCw, Trash, GitMerge, Check, ArrowUp, ArrowDown,
  ExternalLink, Upload, ChevronDown, ChevronRight, X, Pencil, CloudDownload,
  Settings as Cog, Loader, Tag as TagIcon, Package, Download, AlertCircle, Sparkles,
} from '../components/icons';
import { MergePanel } from '../components/MergePanel';
import { EmptyState } from '../components/EmptyState';
import { FilterInput } from '../components/FilterInput';
import { BranchTrackingIndicator } from '../components/BranchTrackingIndicator';
import { generateBranchNames, type LLMProvider } from '../lib/aiCommitMessages';
import type { AppSettings } from '../../electron/types/settings-api';
import { useSettingsStore } from '../stores/settingsStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
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
import { getRepoInProgressState } from '../lib/repoState';
import { resolveDefaultRemote } from '../lib/remotes';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
import { confirmWithRemember, CONFIRMATION_IDS } from '../lib/confirmations';
import { useI18n } from '../lib/i18n';
import { useDateFormatter } from '../lib/formatDate';

/**
 * MED-3 — Build an LLMProvider from AppSettings, or null if AI is not
 * configured. Mirrors the same-named helper in ChangesPage so the New
 * Branch dialog can offer AI name suggestions using the SAME provider
 * the user already set up for AI commit messages.
 */
function buildAIProvider(settings: Partial<AppSettings> | undefined): LLMProvider | null {
  if (!settings?.aiProvider) return null;
  const type = settings.aiProvider as LLMProvider['type'];
  const id = settings.aiProvider;
  const url = settings.aiUrl || '';
  const model = settings.aiModel || '';
  if (!model) return null;
  return { id, name: id, type, url, apiKey: settings.aiApiKey, model };
}

export function BranchesPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const status = useGitStore((s) => s.status);
  // In-progress operations (merge/rebase/cherry-pick/revert) block checkout,
  // push, pull — these would lose work or conflict with the sequencer state.
  // Fetch / Fetch All are still allowed (read-only on the working tree).
  const isInProgress = !!(status?.isMerging || status?.isRebasing || status?.isCherryPicking || status?.isReverting);
  const toast = useToastActions();
  const { t } = useI18n();
  // 0.7 — honors settings.dateFormat (relative / absolute / both)
  const fmtDate = useDateFormatter();

  // SmartGit: while a sequencer state (cherry-pick / revert / merge / rebase /
  // bisect) is in progress the branch is effectively "detached from its remote"
  // — the unfinished operation exists only locally. Pull and Checkout (and
  // other HEAD-movers) would DISCARD it, so they are blocked until the user
  // finishes it on the Changes page (Continue / Skip / Abort / Reset).
  const repoState = getRepoInProgressState(status);
  const blockedByRepoState = (): boolean => {
    if (!repoState) return false;
    toast.error(
      repoState.blockedTitle,
      repoState.blockedHint
    );
    return true;
  };
  // Back-compat alias used by the operation guards below.
  const blockedByCherryPick = blockedByRepoState;
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showNewDialog, setShowNewDialog] = useState(false);
  useEscapeKey(showNewDialog, () => setShowNewDialog(false));
  /**
   * QW-4 — anchor index for Shift+click range selection. Stored in a ref
   * (not state) because we don't want a re-render when it changes, and we
   * need the value to persist across renders without causing cascading
   * updates. Reset to null whenever the branch list is re-filtered
   * (otherwise Shift+click after a search would refer to a stale anchor).
   */
  const lastClickedIndex = useRef<number | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  // MED-3 — AI branch-name suggestion state
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [suggestedNames, setSuggestedNames] = useState<string[]>([]);
  const settings = useSettingsStore((s) => s.settings);
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
  // Multi-selection (Ctrl-click on rows OR checkbox). Stored in
  // selectedBranches Set in the global store so History / Diff can pick it
  // up and operate on a range of branches at once.
  const selectedBranches = useSelectionStore((s) => s.selectedBranches);
  const toggleBranch = useSelectionStore((s) => s.toggleBranch);
  const clearBranches = useSelectionStore((s) => s.clearBranches);
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
  // Esc clears branch multi-selection (when no dialog is open)
  useEscapeKey(selectedBranches.size > 0, () => clearBranches());

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
      toast.error(t('branches.loadFailed'), String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => { load(); }, [load]);

  // 2.1 — SmartGit "Warn when checkout changes submodule configuration".
  // Resolves true when checkout may proceed: the setting is off, the target
  // ships the same .gitmodules, or the user confirmed the change. Errors
  // from the diff probe never block checkout (best-effort warning).
  const guardSubmoduleCheckout = useCallback(async (target: string): Promise<boolean> => {
    if (settings?.warnSubmoduleChangesOnCheckout === false) return true;
    try {
      const changed = await api.git.hasSubmoduleConfigChanges(repo.path, target);
      if (!changed) return true;
      return await confirmWithRemember(CONFIRMATION_IDS.checkoutSubmoduleChange, {
        title: t('branches.submoduleWarnTitle'),
        message: t('branches.submoduleWarnMessage', { branch: target }),
        confirmLabel: t('branches.checkout'),
        danger: true,
      });
    } catch {
      return true;
    }
  }, [repo.path, settings?.warnSubmoduleChangesOnCheckout, t]);

  const handleCheckout = async (branch: BranchInfo, opts?: { autoStash?: boolean }) => {
    if (branch.current) return;
    if (blockedByCherryPick()) return;
    // 2.1 — SmartGit "Warn when checkout changes submodule configuration":
    // if the target branch ships a different .gitmodules, confirm first.
    if (!(await guardSubmoduleCheckout(branch.name))) return;
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
      toast.success(t('branches.checkedOut', { name: branch.name }));
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      const msg = String(e);
      // Detect "Your local changes would be overwritten" — offer auto-stash recovery.
      if (/would be overwritten|overwritten by checkout|local changes to the following files/i.test(msg)) {
        const ok = await confirmDialog({
          title: t('branches.checkoutBlockedTitle'),
          message: t('branches.checkoutBlockedMessage', { branch: branch.name }),
          confirmLabel: t('branches.stashAndCheckout'),
          cancelLabel: t('common.cancel'),
          danger: false,
        });
        if (ok) {
          // Retry with auto-stash. If it still fails, show the error.
          return handleCheckout(branch, { autoStash: true });
        }
        return; // user cancelled — keep current branch
      }
      toast.error(t('branches.checkoutFailed'), msg);
    }
  };

  const handleCreate = async () => {
    if (!newBranchName.trim()) { toast.warning(t('branches.nameRequired')); return; }
    try {
      await api.git.createBranch(repo.path, newBranchName, newBranchStart || undefined);
      if (newBranchCheckout) await api.git.checkout(repo.path, newBranchName);
      toast.success(t('branches.created', { name: newBranchName }));
      setShowNewDialog(false);
      setNewBranchName(''); setNewBranchStart('HEAD'); setNewBranchCheckout(true);
      // MED-3 — also clear AI suggestion state on dialog close.
      setSuggestedNames([]);
      await load();
      await refreshStatus(repo.path);
    } catch (e) { toast.error(t('branches.failed'), String(e)); }
  };

  /**
   * MED-3 — call the LLM with the current repo's changed file paths and
   * get back 3-5 kebab-case branch names. Shows them as clickable chips
   * below the name input; clicking a chip sets the name input.
   *
   * Cheap: we only send file paths (no diff body), so the request is
   * typically <500 tokens. The LLM provider comes from settingsStore
   * (same place the commit-message AI button reads from).
   */
  const handleAISuggestBranches = async () => {
    if (!repo) return;
    // Build provider from settings (mirrors ChangesPage's buildAIProvider).
    const provider = buildAIProvider(settings);
    if (!provider) { toast.info(t('branches.aiSuggestNoProvider')); return; }

    // Collect changed files: staged + untracked (no diff body — names only).
    let files: string[] = [];
    try {
      const [stagedOut, untrackedOut] = await Promise.all([
        api.git.raw(repo.path, ['diff', '--cached', '--name-only']),
        api.git.raw(repo.path, ['ls-files', '--others', '--exclude-standard']),
      ]);
      files = [
        ...stagedOut.split('\n').filter(Boolean),
        ...untrackedOut.split('\n').filter(Boolean),
      ];
    } catch (e) {
      toast.error(t('branches.aiSuggestFailed'), String(e));
      return;
    }
    if (files.length === 0) {
      toast.info(t('branches.aiSuggestNoChanges'));
      return;
    }

    // Pull recent branch names as style reference (max 5 local).
    const recentBranches = branches.filter(b => !b.remote).slice(0, 5).map(b => b.name);

    setAiSuggesting(true);
    setSuggestedNames([]);
    try {
      const names = await generateBranchNames({
        files,
        provider,
        recentBranches,
        count: 5,
      });
      if (names.length === 0) {
        toast.info(t('branches.aiSuggestNoChanges'));
      } else {
        setSuggestedNames(names);
      }
    } catch (e) {
      toast.error(t('branches.aiSuggestFailed'), String(e));
    } finally {
      setAiSuggesting(false);
    }
  };

  const handleDelete = async (branch: BranchInfo) => {
    // First attempt: non-force. If git refuses (not fully merged), offer force
    // — but warn that unmerged commits become Recyclable (recoverable 90 days).
    // 4.5 — supports persistent "Don't ask again" (confirmations registry).
    if (!(await confirmWithRemember(CONFIRMATION_IDS.branchDelete, {
      title: t('branches.deleteConfirmTitle', { name: branch.name }),
      message: t('branches.deleteConfirmMessage'),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return;
    try {
      await api.git.deleteBranch(repo.path, branch.name, false, branch.remote);
      toast.success(t('branches.deleted', { name: branch.name }));
      await load();
    } catch (e) {
      const msg = String(e);
      if (/not fully merged|branch.*not merged/i.test(msg)) {
        const ok = await confirmWithRemember(CONFIRMATION_IDS.branchForceDelete, {
          title: t('branches.forceDeleteTitle', { name: branch.name }),
          message: t('branches.forceDeleteMessage'),
          confirmLabel: t('branches.forceDelete'),
          cancelLabel: t('common.cancel'),
          danger: true,
        });
        if (!ok) return;
        try {
          await api.git.deleteBranch(repo.path, branch.name, true, branch.remote);
          toast.success(t('branches.forceDeleted', { name: branch.name }), t('branches.forceDeletedDetail'));
          await load();
        } catch (e2) { toast.error(t('branches.forceDeleteFailed'), String(e2)); }
      } else {
        toast.error(t('branches.deleteFailed'), msg);
      }
    }
  };

  const handleDeleteRemote = async (branch: BranchInfo) => {
    const remoteBranch = branch.name.replace(/^[^/]+\//, '');
    if (!(await confirmDialog({
      title: t('branches.deleteRemoteConfirmTitle', { name: branch.name }),
      message: t('branches.deleteRemoteConfirmMessage'),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return;
    try {
      await api.git.deleteBranch(repo.path, remoteBranch, true, true);
      toast.success(t('branches.deletedRemote', { name: remoteBranch }));
      await load();
    } catch (e) { toast.error(t('branches.failed'), String(e)); }
  };

  const handleRenameSubmit = async (newName: string) => {
    if (!renameTarget) return;
    const { kind, oldName } = renameTarget;
    setRemoteBusy(`rename-${oldName}`);
    try {
      if (kind === 'branch') {
        await api.git.renameBranch(repo.path, oldName, newName);
        toast.success(t('branches.renamedTo', { name: newName }));
        await load();
        await refreshStatus(repo.path);
      } else {
        await api.git.renameRemote(repo.path, oldName, newName);
        toast.success(t('branches.remoteRenamedTo', { name: newName }));
        await load();
      }
      setRenameTarget(null);
    } catch (e) {
      toast.error(t('branches.renameFailed'), String(e));
    } finally {
      setRemoteBusy(null);
    }
  };

  const validateBranchName = (name: string): string | null => {
    if (name === renameTarget?.oldName) return null; // unchanged — submit disabled, no error
    if (!name) return t('branches.nameIsRequired');
    if (/\s/.test(name)) return t('branches.nameNoWhitespace');
    if (name.startsWith('-') || name.startsWith('/')) return t('branches.nameNoLeadingDash');
    if (name.endsWith('.lock') || name.includes('..') || /[~^:?*[\]\\@{]/.test(name)) return t('branches.nameInvalidChars');
    if (branches.some((b) => b.name === name)) return t('branches.nameExists', { name });
    return null;
  };

  const handleFetchRemote = async (name: string) => {
    setRemoteBusy(name);
    try {
      await api.git.fetch(repo.path, name, true);
      toast.success(t('branches.fetchedWithPrune', { name }));
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('branches.fetchFailed', { name }), String(e));
    } finally {
      setRemoteBusy(null);
    }
  };

  const handleRemoveRemote = async (name: string) => {
    if (!(await confirmDialog({
      title: t('branches.removeRemoteTitle', { name }),
      message: t('branches.removeRemoteMessage'),
      confirmLabel: t('common.remove'),
      danger: true,
    }))) return;
    setRemoteBusy(name);
    try {
      await api.git.removeRemote(repo.path, name);
      toast.success(t('branches.remoteRemoved', { name }));
      await load();
    } catch (e) {
      toast.error(t('branches.removeRemoteFailed'), String(e));
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
        toast.success(t('branches.remoteAdded', { name: data.name }));
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
        toast.success(t('branches.remoteConfigured', { name: configRemote.name ?? '' }));
      }
      setBackgroundFetchForRepo(repo.path, data.name, data.background);
      setConfigRemote(null);
      await load();
    } catch (e) {
      toast.error(t('branches.configureRemoteFailed'), String(e));
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
    } catch (e) { toast.error(t('branches.pushFailed'), String(e)); }
  };

  const handleOpenInBrowser = async (branch: BranchInfo) => {
    try {
      const info = await api.git.extractRepoInfo(repo.path);
      if (info.webUrl) api.app.openExternal(`${info.webUrl}/tree/${branch.name}`);
      else toast.info(t('branches.noRemoteUrl'));
    } catch (e) { toast.error(t('branches.failed'), String(e)); }
  };

  /**
   * MED-5 — batch delete all selected branches.
   * Skips remote branches with a toast.info — they would otherwise need the
   * 'delete remote branch' flow (which has a separate confirmation). User
   * can still right-click each remote branch individually for the
   * remote-specific delete action.
   *
   * Reuses the existing per-branch deleteConfirm flow but as a single
   * grouped dialog. Per-branch failures are reported as separate toasts
   * (not a hard abort) so one 'not fully merged' branch doesn't stop
   * the rest of the batch.
   */
  const handleDeleteSelected = async () => {
    const all = Array.from(selectedBranches);
    if (all.length === 0) return;
    const ok = await confirmDialog({
      title: t('branches.batchDeleteTitle', { count: all.length }),
      message: t('branches.batchDeleteMessage', { names: all.join(', ') }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    let success = 0;
    let failed = 0;
    for (const name of all) {
      const isRemote = name.includes('/');
      // Skip remote branches — they need the remote-delete flow.
      if (isRemote) {
        toast.info(t('branches.batchSkipRemote', { name }));
        continue;
      }
      try {
        await api.git.deleteBranch(repo.path, name, false, false);
        success++;
      } catch (e) {
        const msg = String(e);
        if (/not fully merged|branch.*not merged/i.test(msg)) {
          // Offer force-delete for this one in batch mode — no second
          // confirm per branch; the user already opted into 'Delete all'.
          try {
            await api.git.deleteBranch(repo.path, name, true, false);
            success++;
          } catch (e2) {
            toast.error(t('branches.batchDeleteFailed', { name }), String(e2));
            failed++;
          }
        } else {
          toast.error(t('branches.batchDeleteFailed', { name }), msg);
          failed++;
        }
      }
    }
    clearBranches();
    await load();
    if (success > 0) toast.success(t('branches.batchDeleted', { count: success }));
    if (failed > 0) toast.warning(t('branches.batchFailed', { count: failed }));
  };

  /**
   * MED-5 — batch push all selected branches with -u (set-upstream).
   * Reuses the per-branch remote resolution: try branch.tracking's remote,
   * fall back to the default remote (origin → first configured).
   */
  const handlePushSelected = async () => {
    const all = Array.from(selectedBranches);
    if (all.length === 0) return;
    const defaultRemote = (await resolveDefaultRemote(repo.path)) || 'origin';
    let success = 0;
    let failed = 0;
    for (const name of all) {
      // Skip remote branches — pushing them is a no-op (they're upstream).
      if (name.includes('/')) {
        continue;
      }
      try {
        // Look up tracking info if available; otherwise push with -u to default.
        const branchInfo = branches.find(b => b.name === name);
        const remote = (branchInfo?.tracking ? branchInfo.tracking.split('/')[0] : '')
          || defaultRemote;
        const setUpstream = !branchInfo?.tracking;
        await api.git.push(repo.path, remote, name, setUpstream);
        success++;
      } catch (e) {
        toast.error(t('branches.batchPushFailed', { name }), String(e));
        failed++;
      }
    }
    if (success > 0) toast.success(t('branches.batchPushed', { count: success }));
    if (failed > 0) toast.warning(t('branches.batchFailed', { count: failed }));
    await load();
    await refreshStatus(repo.path);
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
      toast.success(t('branches.resetDone', { mode, ref: ref.substring(0, 7) }));
      setResetTarget(null);
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('branches.resetFailed'), String(e));
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
      toast.error(t('branches.pushFailed'), String(e));
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
      toast.success(t('branches.trackingSet', { branch: setTrackedTarget.branch, tracking }));
      setSetTrackedTarget(null);
      await load();
    } catch (e) {
      toast.error(t('branches.setTrackingFailed'), String(e));
    } finally {
      setSetTrackedBusy(false);
    }
  };

  // ===== Tag operations (Branches-page Tags section) =====
  const executeAddTag = async (data: { name: string; message: string; ref: string; force: boolean }) => {
    setTagBusy(true);
    try {
      await api.git.createTag(repo.path, data.name, data.message || undefined, data.ref, data.force);
      toast.success(data.message ? t('branches.tagCreatedAnnotated', { name: data.name }) : t('branches.tagCreated', { name: data.name }));
      setShowAddTag(false);
      setCollapsedGroups((prev) => { const n = new Set(prev); n.delete('tags'); return n; });
      await load();
    } catch (e) {
      toast.error(t('branches.tagCreateFailed'), String(e));
    } finally {
      setTagBusy(false);
    }
  };

  const handleDeleteTag = async (tag: TagInfo) => {
    if (!(await confirmDialog({
      title: t('branches.deleteTagTitle', { name: tag.name }),
      message: t('branches.deleteTagMessage'),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return;
    try {
      await api.git.deleteTag(repo.path, tag.name);
      toast.success(t('branches.tagDeleted', { name: tag.name }));
      await load();
    } catch (e) { toast.error(t('branches.tagDeleteFailed'), String(e)); }
  };

  const handlePushTag = async (tag: TagInfo) => {
    const remoteName = await promptDialog({
      title: t('branches.pushTagTitle', { name: tag.name }),
      message: t('branches.pushTagMessage'),
      confirmLabel: t('branches.push'),
      input: { initialValue: Object.keys(remotesMap)[0] || 'origin', placeholder: 'origin' },
    });
    if (!remoteName?.trim()) return;
    try {
      await useOperationLogStore.getState().logOperation(
        `Push tag ${tag.name} to ${remoteName}`, repo.path, `git push ${remoteName} ${tag.name}`,
        () => api.git.pushTag(repo.path, tag.name, remoteName.trim())
      );
      toast.success(t('branches.tagPushed', { name: tag.name, remote: remoteName }));
    } catch (e) { toast.error(t('branches.tagPushFailed'), String(e)); }
  };

  const showTagContextMenu = (e: React.MouseEvent, tag: TagInfo) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu([
      { label: t('branches.pushTo'), accelerator: 'CmdOrCtrl+Up', clickId: 'push-tag' },
      { type: 'separator' },
      { label: t('branches.showInLog'), accelerator: 'CmdOrCtrl+L', clickId: 'tag-log' },
      { type: 'separator' },
      { label: t('tags.copyName'), accelerator: 'CmdOrCtrl+C', clickId: 'tag-copy' },
      { label: t('tags.copyHash'), clickId: 'tag-copy-hash' },
      { type: 'separator' },
      { label: t('branches.deleteMenu'), clickId: 'tag-delete' },
    ], (action) => {
      if (action === 'push-tag') handlePushTag(tag);
      else if (action === 'tag-log') {
        useSelectionStore.getState().selectTag(tag.name);
        useSelectionStore.getState().selectCommit(tag.hash);
        window.location.hash = '#/history';
      } else if (action === 'tag-copy') {
        navigator.clipboard.writeText(tag.name).then(() => toast.success(t('branches.copied', { name: tag.name })));
      } else if (action === 'tag-copy-hash') {
        navigator.clipboard.writeText(tag.hash).then(() => toast.success(t('branches.hashCopied')));
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
      toast.success(t('branches.pulledFrom', { name: pullRemote }));
      setPullRemote(null);
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('branches.pullFailed', { name: pullRemote }), String(e));
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
      toast.success(t('branches.fetchedMore', { count: commits, name: moreRemote }));
      setMoreRemote(null);
      await load();
    } catch (e) {
      toast.error(t('branches.fetchMoreFailed', { name: moreRemote }), String(e));
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
      toast.success(depth > 0 ? t('branches.depthSet', { name: depthRemote, depth }) : t('branches.unshallowed', { name: depthRemote }));
      setDepthRemote(null);
      await load();
    } catch (e) {
      toast.error(t('branches.setDepthFailed', { name: depthRemote }), String(e));
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
      toast.error(t('branches.propertiesReadFailed', { name: remoteName }), String(e));
    } finally {
      setPropertiesLoading(false);
    }
  };

  const handleCopyRemoteUrl = async (remoteName: string) => {
    const url = remotesMap[remoteName]?.refs.fetch;
    if (!url) { toast.warning(t('branches.remoteNoUrl')); return; }
    navigator.clipboard.writeText(url).then(() => toast.success(t('branches.urlCopied')));
  };

  // ===== Stash operations (Branches-page Stashes section) =====
  const handleStashChanges = async () => {
    try {
      const out = await api.git.stashPush(repo.path, stashMsg.trim() || undefined, stashUntracked);
      if (!out || !out.trim()) {
        toast.info(t('stashes.nothingToStash'));
        return;
      }
      toast.success(t('stashes.stashed'));
      setShowStashDialog(false);
      setStashMsg('');
      setCollapsedGroups((prev) => { const n = new Set(prev); n.delete('stashes'); return n; });
      await load();
      await refreshStatus(repo.path);
    } catch (e) { toast.error(t('stashes.stashFailed'), String(e)); }
  };

  const handleApplyStash = async (s: StashEntry) => {
    if (!(await confirmDialog({
      title: t('stashes.applyStashAt', { index: s.index }),
      message: t('stashes.applyConfirmMessage', { message: s.message }),
      confirmLabel: t('stashes.apply'),
    }))) return;
    try {
      await useOperationLogStore.getState().logOperation(
        `Apply stash@{${s.index}}`, repo.path, `git stash apply stash@{${s.index}}`,
        () => api.git.stashApply(repo.path, s.index)
      );
      toast.success(t('stashes.appliedKept', { index: s.index }));
      await load();
      await refreshStatus(repo.path);
    } catch (e) { toast.error(t('stashes.applyFailed'), String(e)); }
  };

  const handleRenameStash = async (s: StashEntry) => {
    const newMessage = await promptDialog({
      title: t('stashes.renameTitle', { index: s.index }),
      message: t('stashes.renameMessage'),
      confirmLabel: t('common.rename'),
      input: { initialValue: s.message, placeholder: t('stashes.renamePlaceholder') },
      validate: (v) => (!v.trim() ? t('stashes.renameEmptyValidation') : null),
    });
    if (newMessage == null || !newMessage.trim() || newMessage === s.message) return;
    try {
      await useOperationLogStore.getState().logOperation(
        `Rename stash@{${s.index}}`, repo.path,
        `git stash rename (rebuild refs/stash)`,
        () => api.git.stashRename(repo.path, s.index, newMessage.trim())
      );
      toast.success(t('stashes.renamedToast', { index: s.index }));
      await load();
    } catch (e) { toast.error(t('stashes.renameFailed'), String(e)); }
  };

  const handleDropStash = async (s: StashEntry) => {
    if (!(await confirmDialog({
      title: t('stashes.dropStashAt', { index: s.index }),
      message: t('stashes.dropMessage', { message: s.message }),
      confirmLabel: t('stashes.drop'),
      danger: true,
    }))) return;
    try {
      await useOperationLogStore.getState().logOperation(
        `Drop stash@{${s.index}}`, repo.path, `git stash drop stash@{${s.index}}`,
        () => api.git.stashDrop(repo.path, s.index)
      );
      toast.success(t('stashes.dropped', { index: s.index }));
      await load();
    } catch (e) { toast.error(t('stashes.dropFailed'), String(e)); }
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
      { label: t('stashes.applyMenu'), accelerator: 'Shift+CmdOrCtrl+S', clickId: 'stash-apply' },
      { label: t('stashes.popMenu'), clickId: 'stash-pop' },
      { type: 'separator' },
      { label: t('stashes.showInLog'), accelerator: 'CmdOrCtrl+L', clickId: 'stash-log' },
      { type: 'separator' },
      { label: t('stashes.renameMenu'), accelerator: 'F2', clickId: 'stash-rename' },
      { label: t('stashes.dropMenu'), clickId: 'stash-drop' },
      { type: 'separator' },
      { label: t('stashes.copyMessage'), clickId: 'stash-copy' },
    ], (action) => {
      if (action === 'stash-apply') handleApplyStash(s);
      else if (action === 'stash-pop') {
        confirmDialog({
          title: t('stashes.popStashAt', { index: s.index }),
          message: t('stashes.popMessageBranches', { message: s.message }),
          confirmLabel: t('stashes.pop'),
        }).then(async (ok) => {
          if (!ok) return;
          try {
            await useOperationLogStore.getState().logOperation(
              `Pop stash@{${s.index}}`, repo.path, `git stash pop stash@{${s.index}}`,
              () => api.git.stashPop(repo.path, s.index)
            );
            toast.success(t('stashes.popped', { index: s.index }));
            await load();
            await refreshStatus(repo.path);
          } catch (e) { toast.error(t('stashes.popFailed'), String(e)); }
        });
      }
      else if (action === 'stash-log') handleStashShowInLog(s);
      else if (action === 'stash-rename') handleRenameStash(s);
      else if (action === 'stash-drop') handleDropStash(s);
      else if (action === 'stash-copy') {
        navigator.clipboard.writeText(s.message).then(() => toast.success(t('stashes.copied')));
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
        toast.warning(t('branches.cannotCompareDetached'));
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
      toast.error(t('branches.compareFailed'), String(e));
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
      setComparePatch(text || t('branches.noDifferences'));
    } catch (e) {
      toast.error(t('branches.patchPreviewFailed'), String(e));
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
      items.push({ label: t('branches.checkoutMenu'), accelerator: 'CmdOrCtrl+G', clickId: 'checkout-remote', enabled: !isInProgress });
      items.push({ type: 'separator' });
      items.push({ label: t('branches.merge'), clickId: 'merge' });
      items.push({ label: t('branches.rebase'), accelerator: 'CmdOrCtrl+D', clickId: 'rebase' });
      items.push({ type: 'separator' });
      // Push is meaningless for a remote-only branch — shown disabled like Fork does.
      items.push({ label: t('branches.push'), accelerator: 'CmdOrCtrl+Up', enabled: false, clickId: '_noop' });
      items.push({ label: t('branches.pushTo'), accelerator: 'Shift+CmdOrCtrl+Up', clickId: 'push-to-remote', enabled: !isInProgress });
      items.push({ type: 'separator' });
      items.push({ label: t('branches.log'), accelerator: 'CmdOrCtrl+L', clickId: 'log' });
      items.push({ type: 'separator' });
      items.push({ label: t('branches.resetMenu'), accelerator: 'CmdOrCtrl+R', clickId: 'reset-remote' });
      items.push({ label: t('branches.resetAdvancedMenu'), accelerator: 'Shift+CmdOrCtrl+R', clickId: 'reset-advanced-remote' });
      items.push({ type: 'separator' });
      items.push({ label: t('branches.deleteMenu'), clickId: 'delete-remote' });
      items.push({ type: 'separator' });
      items.push({ label: t('common.copy'), accelerator: 'CmdOrCtrl+C', clickId: 'copy' });
      items.push({ label: t('branches.openInBrowser'), clickId: 'browser' });
    } else {
      // === LOCAL BRANCH CONTEXT MENU (matches Fork) ===

      // Group 1: Checkout / Merge / Rebase
      if (!b.current) {
        items.push({ label: t('branches.checkoutMenu'), accelerator: 'CmdOrCtrl+G', clickId: 'checkout', enabled: !isInProgress });
        items.push({ type: 'separator' });
        items.push({ label: t('branches.merge'), clickId: 'merge' });
        items.push({ label: t('branches.rebase'), accelerator: 'CmdOrCtrl+D', clickId: 'rebase' });
        items.push({ label: t('branches.ffMerge'), clickId: 'ff-merge' });
        items.push({ type: 'separator' });
      }

      // Group 2: Push
      items.push({ label: t('branches.push'), accelerator: 'CmdOrCtrl+Up', clickId: 'push', enabled: !isInProgress });
      items.push({ label: t('branches.pushTo'), accelerator: 'Shift+CmdOrCtrl+Up', clickId: 'push-to', enabled: !isInProgress });
      // SmartGit Manual: Push to Gerrit — refs/for/<branch>
      items.push({ label: t('branches.pushToGerrit'), clickId: 'push-gerrit' });
      items.push({ type: 'separator' });

      // Task 14 — Worktree actions (moved from the deleted Worktrees page).
      items.push({ label: t('branches.createWorktree'), clickId: 'create-worktree', enabled: !isInProgress });
      items.push({ type: 'separator' });

      // Group 3: Log / Reset
      items.push({ label: t('branches.log'), accelerator: 'CmdOrCtrl+L', clickId: 'log' });
      items.push({ type: 'separator' });
      items.push({ label: t('branches.resetMenu'), accelerator: 'CmdOrCtrl+R', clickId: 'reset' });
      items.push({ label: t('branches.resetAdvancedMenu'), accelerator: 'Shift+CmdOrCtrl+R', clickId: 'reset-advanced' });
      items.push({ type: 'separator' });

      // Group 4: Rename / Delete
      items.push({ label: t('branches.renameMenu'), accelerator: 'F2', clickId: 'rename' });
      if (!b.current) {
        items.push({ label: t('branches.deleteMenu'), clickId: 'delete' });
      }
      items.push({ type: 'separator' });

      // Group 5: Tracking
      if (b.tracking) {
        items.push({ label: t('branches.trackingLabel', { name: b.tracking }), clickId: '_noop', enabled: false });
        items.push({ label: t('branches.setTracked'), clickId: 'set-tracking' });
        items.push({ label: t('branches.stopTrackingMenu'), clickId: 'stop-tracking' });
      } else {
        items.push({ label: t('branches.setTracked'), clickId: 'set-tracking' });
        items.push({ label: t('branches.stopTrackingMenu'), enabled: false, clickId: '_noop' });
      }
      items.push({ type: 'separator' });

      // Group 6: Copy
      items.push({ label: t('common.copy'), accelerator: 'CmdOrCtrl+C', clickId: 'copy' });
    }

    if (items.length > 0) {
      showContextMenu(items, async (action) => {
        // === Checkout ===
        if (action === 'checkout') handleCheckout(b);

        // Task 14 — Create worktree from this branch.
        // Uses git worktree add <path> <branch>; prompts for the path.
        else if (action === 'create-worktree') {
          const defaultPath = `${repo.path}-wt-${b.name.replace('/', '-')}`;
          const wtPath = await promptDialog({
            title: t('branches.createWorktreeTitle', { name: b.name }),
            message: t('branches.createWorktreeMessage'),
            input: { initialValue: defaultPath },
            confirmLabel: t('common.create'),
          });
          if (!wtPath) return;
          try {
            await api.git.raw(repo.path, ['worktree', 'add', wtPath, b.name]);
            toast.success(t('branches.worktreeCreated', { path: wtPath }));
          } catch (e) {
            toast.error(t('branches.worktreeCreateFailed'), String(e));
          }
        }

        // === Checkout remote (create local tracking branch) ===
        else if (action === 'checkout-remote') {
          const localName = b.name.replace(/^[^/]+\//, '');
          if (!(await confirmDialog({
            title: t('branches.checkoutRemoteTitle', { name: b.name }),
            message: t('branches.checkoutRemoteMessage', { local: localName, remote: b.name }),
            confirmLabel: t('branches.checkout'),
          }))) return;
          if (!(await guardSubmoduleCheckout(b.name))) return; // 2.1 — .gitmodules diff warning
          api.git.checkout(repo.path, b.name, { track: true }).then(() => {
            toast.success(t('branches.checkedOutTracking', { local: localName, remote: b.name }));
            load(); refreshStatus(repo.path);
          }).catch((e) => toast.error(t('branches.checkoutFailed'), String(e)));
        }

        // === Merge ===
        else if (action === 'merge') handleMerge(b.name);

        // === Rebase ===
        else if (action === 'rebase') {
          if (!(await confirmDialog({ title: t('branches.rebaseOntoTitle', { name: b.name }), message: t('branches.rebaseOntoMessage', { name: b.name }), confirmLabel: t('toolbar.rebase') }))) return;
          useOperationLogStore.getState().logOperation(
            `Rebase onto ${b.name}`, repo.path, `git rebase ${b.name}`,
            () => api.git.rebase(repo.path, b.name)
          ).then(() => { toast.success(t('status.rebaseComplete')); refreshStatus(repo.path); })
           .catch((e) => toast.error(t('branches.rebaseFailed'), String(e)));
        }

        // === Fast-Forward Merge ===
        else if (action === 'ff-merge') {
          useOperationLogStore.getState().logOperation(
            `Fast-Forward Merge ${b.name}`, repo.path, `git merge --ff-only ${b.name}`,
            () => api.git.merge(repo.path, b.name, { ffOnly: true })
          ).then(async (result) => {
            if (result.fastForward) toast.success(t('branches.fastForwarded', { name: b.name }));
            else toast.info(t('branches.noFastForward', { name: b.name }));
            await load(); await refreshStatus(repo.path);
          }).catch((e) => toast.error(t('branches.fastForwardFailed'), String(e)));
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
          const topic = window.prompt(t('branches.gerritPrompt', { branch: branchName }), '');
          try {
            const output = await api.git.pushToGerrit(repo.path, branchName, remoteName, {
              topic: topic || undefined,
            });
            toast.success(t('branches.pushedToGerrit', { branch: branchName }), output.split('\n')[0] || '');
            await refreshStatus(repo.path);
          } catch (e) { toast.error(t('branches.pushGerritFailed'), String(e)); }
        }

        // === Log (show this branch's history in History page) ===
        else if (action === 'log') {
          useSelectionStore.getState().selectBranch(b.name);
          window.location.hash = '#/history';
        }

        // === Reset current branch to this branch's commit (mode dialog) ===
        else if (action === 'reset' || action === 'reset-remote') {
          if (!b.lastCommit?.hash) { toast.warning(t('branches.cannotDetermineHash')); return; }
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
            title: t('branches.stopTrackingTitle', { name: b.name }),
            message: t('branches.stopTrackingMessage', { name: b.name }),
            confirmLabel: t('branches.stopTrackingConfirm'),
          }))) return;
          useOperationLogStore.getState().logOperation(
            `Stop tracking ${b.name}`, repo.path,
            `git branch --unset-upstream ${b.name}`,
            () => api.git.raw(repo.path, ['branch', '--unset-upstream', b.name])
          ).then(() => { toast.success(t('branches.stoppedTracking', { name: b.name })); load(); })
           .catch((e) => toast.error(t('branches.stopTrackingFailed'), String(e)));
        }

        // === Copy branch name ===
        else if (action === 'copy') {
          navigator.clipboard.writeText(b.name).then(() => toast.success(t('branches.copied', { name: b.name })));
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
            toast.warning(t('branches.pushToNeedsCurrent'));
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
  // QW-4 — reset the Shift+click anchor whenever the filter changes;
  // otherwise the anchor index would refer to a different branch than
  // the one the user originally clicked on.
  useEffect(() => {
    lastClickedIndex.current = null;
  }, [search]);
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
    // Selected = either single-selection (globalSelectedBranch) OR part of
    // the multi-selection set. Both should highlight the row.
    const isMultiSelected = selectedBranches.has(b.name);
    const isSingleSelected = globalSelectedBranch === b.name && !b.current;
    return (
      <div
        key={b.name}
        className={cn(
          'group flex items-center gap-2 px-3 py-1 cursor-pointer text-xs border-b border-border-subtle hover:bg-bg-hover',
          b.current && 'bg-bg-active font-medium',
          isSingleSelected && 'bg-bg-selected',
          isMultiSelected && !b.current && 'bg-bg-selected',
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
              toast.info(t('branches.dropTargetNotCurrent', { name: b.name }));
            }
          }
          setDraggedBranch(null);
        }}
        onClick={(e) => {
          // Find this branch's index in the FILTERED list (the same list
          // that's being rendered). We need it for Shift+click range.
          const index = filtered.findIndex(b2 => b2.name === b.name);

          // Ctrl/Cmd-click: toggle branch in multi-selection set. Allows
          // picking several branches at once for batch operations
          // (e.g. multi-branch History filter, multi-branch Diff).
          if (e.ctrlKey || e.metaKey) {
            toggleBranch(b.name);
            lastClickedIndex.current = index >= 0 ? index : null;
            return;
          }

          // Shift+click: select the contiguous range between the last
          // clicked anchor and this row. Replaces any previous selection.
          // (Matches the standard file-explorer / spreadsheet behaviour.)
          if (e.shiftKey && lastClickedIndex.current !== null && index >= 0) {
            const start = Math.min(lastClickedIndex.current, index);
            const end = Math.max(lastClickedIndex.current, index);
            const rangeNames = filtered.slice(start, end + 1).map(b2 => b2.name);
            useSelectionStore.getState().selectBranchRange(rangeNames);
            // Anchor stays at lastClickedIndex.current so a subsequent
            // Shift+click extends from the original anchor.
            return;
          }

          // Plain click: SELECT ONLY — never checkout.
          // Checkout must be an explicit action (Checkout button, context-menu,
          // or double-click). Selecting a branch just sets it as the active
          // branch for History filtering / merge / rebase targeting.
          useSelectionStore.getState().selectBranch(b.name);
          lastClickedIndex.current = index >= 0 ? index : null;
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
            }).then(async (ok) => {
              if (!ok) return;
              if (!(await guardSubmoduleCheckout(b.name))) return; // 2.1 — .gitmodules diff warning
              api.git.checkout(repo.path, b.name, { track: true })
                .then(() => { toast.success(t('toast.git.checkoutSuccess', { ref: localName })); load(); refreshStatus(repo.path); })
                .catch((err) => toast.error(t('toast.git.checkoutFailed'), String(err)));
            });
            return;
          }
          if (!b.current) handleCheckout(b);
        }}
        onContextMenu={(e) => showBranchContextMenu(e, b)}
      >
        {/* Selection checkbox — toggles this branch in the multi-selection
            set. Click does NOT propagate to the row (otherwise it would
            also trigger single-select and clear the multi-set). */}
        <input
          type="checkbox"
          className="flex-shrink-0 cursor-pointer"
          checked={isMultiSelected}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleBranch(b.name)}
          title={isMultiSelected ? t('branches.deselectBranch') : t('branches.selectBranch')}
        />
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
        <GitBranch size={12} className={cn('flex-shrink-0', b.current ? 'text-accent' : 'text-text-tertiary')} />
        {/* Task 6 — visual fork/socket indicator for the local↔remote
            tracking relationship. Plug inserted into the socket when the
            branch has an upstream; hovering shows the upstream ref name. */}
        <BranchTrackingIndicator tracking={!!b.tracking} upstreamName={b.tracking} size={12} />
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
            {/* SmartGit: show the in-progress state explicitly on the branch —
                the unfinished operation is not committed yet, so the branch is
                effectively detached from its remote until it is finished. */}
            {b.current && repoState && (
              <span
                data-testid="repo-state-badge"
                className="text-2xs px-1 py-0.5 rounded bg-status-conflict/15 text-status-conflict border border-status-conflict/40 flex items-center gap-0.5 font-medium flex-shrink-0"
                title={`${repoState.bannerText} Not yet committed, detached from remote. Pull and Checkout would lead to loss of commits. Finish it on the Changes page.`}
              >
                ⚠ {repoState.badge}
              </span>
            )}
            {/* "gone" — upstream branch was deleted on the remote. Pull would
                fail; Push is the recovery. Surface this so the user understands
                why Pull is unavailable on this branch. */}
            {b.gone && (
              <span className="text-2xs px-1 py-0.5 rounded bg-status-deleted/15 text-status-deleted font-medium"
                title="The upstream branch was deleted on the remote. Pull is unavailable — Push to recreate it, or set a new tracked branch.">
                gone
              </span>
            )}
            {b.ahead !== undefined && b.ahead > 0 && (
              <span className="text-2xs px-1 py-0.5 rounded bg-status-added/15 text-status-added flex items-center gap-0.5 font-medium"
                title={b.current ? `${b.ahead} commit(s) ahead of upstream — Pull would attempt to merge or fail. Push to publish them.` : `${b.ahead} ahead of upstream`}>
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
            <span>· {fmtDate(b.lastCommit.date)}</span>
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
                  title={isInProgress ? t('branches.checkoutBlockedHint') : t('branches.checkoutRowHint')}
                  disabled={isInProgress}
                  onClick={(e) => { e.stopPropagation(); handleCheckout(b); }}
                >
                  <Check size={11} />
                </button>
              )}
              {!b.current && (
                <button className="icon-btn !w-5 !h-5" title={t('branches.mergeIntoCurrent')}
                  onClick={(e) => { e.stopPropagation(); handleMerge(b.name); }}>
                  <GitMerge size={11} />
                </button>
              )}
              {!b.current && (
                <button className="icon-btn !w-5 !h-5"
                  title={isInProgress ? t('branches.pushBlockedHint') : t('branches.push')}
                  disabled={isInProgress}
                  onClick={(e) => { e.stopPropagation(); handlePushBranch(b); }}>
                  <Upload size={11} />
                </button>
              )}
              <button className="icon-btn !w-5 !h-5" title={t('common.rename')}
                onClick={(e) => { e.stopPropagation(); setRenameTarget({ kind: 'branch', oldName: b.name }); }}>
                <Pencil size={11} />
              </button>
              {!b.current && (
                <button className="icon-btn !w-5 !h-5 hover:!text-status-deleted" title={t('common.delete')}
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
                title={isInProgress ? t('branches.checkoutBlockedHint') : t('branches.checkoutRemoteRowHint')}
                disabled={isInProgress}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isInProgress) return;
                  const localName = b.name.replace(/^[^/]+\//, '');
                  confirmDialog({
                    title: t('branches.checkoutRemoteTitle', { name: b.name }),
                    message: t('branches.checkoutRemoteMessage', { local: localName, remote: b.name }),
                    confirmLabel: t('branches.checkout'),
                  }).then(async (ok) => {
                    if (!ok) return;
                    if (!(await guardSubmoduleCheckout(b.name))) return; // 2.1 — .gitmodules diff warning
                    api.git.checkout(repo.path, b.name, { track: true })
                      .then(() => { toast.success(t('branches.checkedOut', { name: localName })); load(); refreshStatus(repo.path); })
                      .catch((err) => toast.error(t('branches.checkoutFailed'), String(err)));
                  });
                }}
              >
                <Check size={11} />
              </button>
              <button className="icon-btn !w-5 !h-5" title={t('branches.mergeIntoCurrent')}
                onClick={(e) => { e.stopPropagation(); handleMerge(b.name); }}>
                <GitMerge size={11} />
              </button>
              <button className="icon-btn !w-5 !h-5" title={t('branches.openInBrowserTooltip')}
                onClick={(e) => { e.stopPropagation(); handleOpenInBrowser(b); }}>
                <ExternalLink size={11} />
              </button>
              <button className="icon-btn !w-5 !h-5 hover:!text-status-deleted" title={t('branches.deleteRemoteTooltip')}
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
      { label: t('branches.addBranchMenu'), accelerator: 'F7', clickId: 'add-branch' },
    ], (action) => {
      if (action === 'add-branch') setShowNewDialog(true);
    });
  };

  const showRemoteContextMenu = (e: React.MouseEvent, remoteName: string) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu([
      { label: t('branches.pushTo'), accelerator: 'Shift+CmdOrCtrl+Up', clickId: 'remote-push-to' },
      { label: t('branches.pullMenu'), accelerator: 'CmdOrCtrl+Down', clickId: 'remote-pull' },
      { type: 'separator' },
      { label: t('remotes.fetch'), accelerator: 'Shift+CmdOrCtrl+Down', clickId: 'fetch' },
      { label: t('branches.fetchMoreMenu'), clickId: 'fetch-more' },
      { type: 'separator' },
      { label: t('branches.renameMenu'), accelerator: 'F2', clickId: 'rename-remote' },
      { label: t('branches.deleteMenu'), clickId: 'remove-remote' },
      { type: 'separator' },
      { label: t('branches.copyUrl'), clickId: 'copy-url' },
      { type: 'separator' },
      { label: t('branches.setDepthMenu'), clickId: 'set-depth' },
      { label: t('branches.propertiesMenu'), clickId: 'properties' },
      { type: 'separator' },
      { label: t('branches.configureRemote'), clickId: 'configure' },
      { label: t('branches.addNewRemote'), clickId: 'add-remote' },
      { label: t('branches.manageRemotes'), clickId: 'manage' },
    ], (action) => {
      if (action === 'remote-push-to') {
        // Push the CURRENT branch to this remote (Fork behavior) — via the
        // Push To dialog so the remote + target branch stay user-selectable.
        const current = branches.find((x) => x.current)?.name;
        if (!current) {
          toast.warning(t('branches.pushToNeedsCurrent'));
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
      { label: t('tags.addTagMenu'), accelerator: 'Shift+F7', clickId: 'add-tag' },
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
      { label: t('stashes.newStashMenu'), accelerator: 'Shift+CmdOrCtrl+S', clickId: 'stash-new' },
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
            {t('branches.showingFirst200', { count: items.length })}
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
          {t('branches.noBranchesFetched')}
          <CloudDownload size={10} /> {t('remotes.fetch')}
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
              title={t('branches.fetchRemoteTooltip', { name: remoteName })}
              onClick={(e) => { e.stopPropagation(); handleFetchRemote(remoteName); }}
            >
              <CloudDownload size={10} />
            </button>
            <button
              className="icon-btn !w-4 !h-4"
              title={t('branches.configureTooltip')}
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
        {tag.date && <span>· {fmtDate(tag.date)}</span>}
      </div>
    </div>
  );

  /** Fork-style stash row: "07/25/2025 02:55 PM: WIP on remove-sync: ..." */
  const renderStashRow = (s: StashEntry) => {
    const dateLabel = s.date ? fmtDate(s.date) : '';
    return (
      <div
        key={`stash-${s.index}`}
        className={cn(
          'group flex items-center gap-2 px-3 py-1 cursor-pointer text-xs border-b border-border-subtle hover:bg-bg-hover',
          globalSelectedStashIndex === s.index && 'bg-bg-selected'
        )}
        onClick={(e) => { handleStashShowInLog(s); e.stopPropagation(); }}
        onContextMenu={(e) => showStashContextMenu(e, s)}
        title={t('stashes.branchesRowTooltip')}
      >
        <span className="w-3 flex-shrink-0" />
        <Package size={12} className="text-text-tertiary flex-shrink-0" />
        <div className="flex-1 min-w-0 truncate">
          {dateLabel && <span className="text-text-secondary">{dateLabel}: </span>}
          <span className="text-text-primary">{s.message}</span>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
          <button className="icon-btn !w-5 !h-5" title={t('stashes.applyTooltip')}
            onClick={(e) => { e.stopPropagation(); handleApplyStash(s); }}>
            <Check size={11} />
          </button>
          <button className="icon-btn !w-5 !h-5" title={t('stashes.renameTooltip')}
            onClick={(e) => { e.stopPropagation(); handleRenameStash(s); }}>
            <Pencil size={11} />
          </button>
          <button className="icon-btn !w-5 !h-5 hover:!text-status-deleted" title={t('stashes.dropRowTooltip')}
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
          <span className="text-xs font-semibold">{t('branches.title')}</span>
          <span className="text-2xs text-text-tertiary">
            {t('branches.countSummary', {
              local: localBranches.length,
              remote: Object.values(remoteGroups).reduce((a, b) => a + b.length, 0),
              tags: filteredTags.length,
              stashes: filteredStashes.length,
            })}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <FilterInput
            value={search}
            onChange={setSearch}
            placeholder={t('branches.filterPlaceholder')}
            ariaLabel={t('branches.filterPlaceholder')}
          />
          <button className="icon-btn !w-6 !h-6" title={t('common.refresh')} onClick={load}>
            <RefreshCw size={12} />
          </button>
          <button className="btn btn-primary text-2xs !py-1 !px-2.5" onClick={() => setShowNewDialog(true)}>
            <Plus size={12} /> {t('branches.newButton')}
          </button>
        </div>
      </div>

      {/* Multi-selection action bar — shows count + clear button when one or
          more branches are selected via checkbox or Ctrl-click. The selection
          is global (stored in selectionStore.selectedBranches) so History / Diff
          can pick it up and operate on multiple branches at once. */}
      {selectedBranches.size > 0 && (
        <div className="px-3 py-1 border-b border-accent/40 bg-accent-muted/40 flex items-center gap-2">
          <span className="text-2xs font-semibold text-accent">
            {t('branches.selectedCount', { count: selectedBranches.size })}
          </span>
          <span className="text-2xs text-text-tertiary truncate min-w-0">
            {Array.from(selectedBranches).slice(0, 5).join(', ')}
            {selectedBranches.size > 5 && ` +${selectedBranches.size - 5}`}
          </span>
          {/* MED-5 — batch operations */}
          <button
            type="button"
            className="text-2xs px-2 py-0.5 rounded bg-status-deleted/15 text-status-deleted hover:bg-status-deleted/25 border border-status-deleted/30 flex items-center gap-1"
            onClick={handleDeleteSelected}
            disabled={blockedByRepoState()}
            title={t('branches.batchDeleteTooltip')}
          >
            <Trash size={10} />
            {t('branches.batchDelete', { count: selectedBranches.size })}
          </button>
          <button
            type="button"
            className="text-2xs px-2 py-0.5 rounded bg-status-added/15 text-status-added hover:bg-status-added/25 border border-status-added/30 flex items-center gap-1"
            onClick={handlePushSelected}
            disabled={blockedByRepoState()}
            title={t('branches.batchPushTooltip')}
          >
            <Upload size={10} />
            {t('branches.batchPush', { count: selectedBranches.size })}
          </button>
          <button
            className="ml-auto text-2xs px-2 py-0.5 hover:bg-bg-hover rounded text-text-secondary hover:text-text-primary"
            onClick={clearBranches}
            title={t('branches.clearSelectionTitle')}
          >
            {t('branches.clearSelection')}
          </button>
        </div>
      )}
      {/* In-progress warning banner — explains why checkout / push are blocked
          and points to the Changes page banner for Continue / Skip / Abort.
          Covers ALL five states (incl. bisect) via repoState. */}
      {repoState && (
        <div className="px-3 py-1.5 border-b border-status-warning/40 bg-status-warning/10 flex items-center gap-2">
          <AlertCircle size={12} className="text-status-warning flex-shrink-0" />
          <span className="text-2xs text-status-warning font-medium">
            {repoState.bannerText}
          </span>
          <span className="text-2xs text-text-tertiary">
            {repoState.key === 'cherry-picking' && status?.cherryPick?.commit && <>picking {shortHash(status.cherryPick.commit)}{status.cherryPick.subject ? ` “${status.cherryPick.subject}”` : null}. </>}
            {repoState.key === 'reverting' && status?.revert?.commit && <>reverting {shortHash(status.revert.commit)}{status.revert.subject ? ` “${status.revert.subject}”` : null}. </>}
            Checkout, Push, Pull and Discard are blocked. Finish it on the Changes page (Continue / Skip / Abort / Reset). Fetch / Fetch All are still allowed.
          </span>
        </div>
      )}
      {/* Detached HEAD warning — HEAD points at a commit, not a branch.
          Commits made here are not on any branch and will become Recyclable
          when HEAD moves. Surface this prominently. */}
      {status?.detached && !repoState && (
        <div className="px-3 py-1.5 border-b border-status-warning/40 bg-status-warning/10 flex items-center gap-2">
          <AlertCircle size={12} className="text-status-warning flex-shrink-0" />
          <span className="text-2xs text-status-warning font-medium">
            HEAD is detached.
          </span>
          <span className="text-2xs text-text-tertiary">
            You are not on a branch — new commits won't belong to any branch and will become Recyclable when you switch. Checkout a branch to re-attach.
          </span>
        </div>
      )}

      {/* Branch list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">{t('common.loading')}</div>
        ) : filtered.length === 0 && filteredTags.length === 0 && filteredStashes.length === 0 ? (
          <EmptyState
            icon={GitBranch}
            title={search ? t('branches.nothingMatches') : t('branches.empty')}
            description={search ? undefined : t('branches.emptyHint')}
            action={search ? undefined : { label: t('branches.newButton'), onClick: () => setShowNewDialog(true), disabled: blockedByRepoState() }}
          />
        ) : (
          <>
            {/* Local branches — header right-click: Add Branch... (F7) */}
            {renderGroup(t('branches.localBranches'), localBranches.length, localBranches, 'local', undefined, showLocalHeaderContextMenu)}

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
                {t('branches.noRemotesConfigured')}
                <button
                  className="text-accent hover:underline"
                  onClick={(e) => { e.stopPropagation(); setConfigRemote({ mode: 'add' }); }}
                >
                  {t('branches.addRemoteLink')}
                </button>
              </div>
            )}

            {/* Tags — header right-click: Add Tag... (Shift+F7) */}
            {renderGroup(t('tags.title'), filteredTags.length, filteredTags as unknown as BranchInfo[], 'tags', undefined, showTagsHeaderContextMenu, (t2) => renderTagRow(t2 as unknown as TagInfo))}

            {/* Stashes — header right-click: Stash Changes... */}
            {renderGroup(t('stashes.title'), filteredStashes.length, filteredStashes as unknown as BranchInfo[], 'stashes', undefined, showStashesHeaderContextMenu, (s) => renderStashRow(s as unknown as StashEntry))}
          </>
        )}
      </div>

      {/* Info bar at bottom */}
      <div className="px-3 py-1 border-t border-border-default bg-bg-tertiary text-2xs text-text-tertiary">
        {t('branches.tip')}
      </div>

      {/* New branch dialog */}
      {showNewDialog && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50" onClick={() => setShowNewDialog(false)}>
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4 flex items-center gap-2">
              <GitBranch size={16} /> {t('branches.new')}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">{t('branches.nameLabel')}</label>
                <div className="flex items-center gap-1">
                  <input type="text" className="flex-1 text-sm" placeholder="feature/my-branch"
                    value={newBranchName} autoFocus
                    onChange={(e) => setNewBranchName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
                  <button
                    type="button"
                    className="btn btn-secondary text-2xs !py-1 !px-2 flex-shrink-0"
                    onClick={handleAISuggestBranches}
                    disabled={aiSuggesting}
                    title={t('branches.aiSuggestTooltip')}
                  >
                    {aiSuggesting ? <Loader size={10} className="animate-spin" /> : <Sparkles size={10} />}
                    {aiSuggesting ? '...' : t('branches.aiSuggest')}
                  </button>
                </div>
                {suggestedNames.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {suggestedNames.map(name => (
                      <button
                        key={name}
                        type="button"
                        className="text-2xs px-2 py-0.5 border rounded hover:bg-bg-hover font-mono"
                        onClick={() => setNewBranchName(name)}
                        title={name}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">{t('branches.startingPoint')}</label>
                <input type="text" className="w-full text-sm font-mono" value={newBranchStart}
                  onChange={(e) => setNewBranchStart(e.target.value)}
                  placeholder={t('branches.startPlaceholder')} />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={newBranchCheckout} onChange={(e) => setNewBranchCheckout(e.target.checked)} />
                {t('branches.checkoutAfterCreate')}
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowNewDialog(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={handleCreate}>
                <Check size={13} /> {t('common.create')}
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
          <Loader size={12} className="animate-spin" /> {t('branches.loadingProperties')}
        </div>
      )}

      {/* New stash dialog (Stashes section header menu) */}
      {showStashDialog && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50" onClick={() => setShowStashDialog(false)}>
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4 flex items-center gap-2">
              <Package size={16} /> {t('changes.stashChanges')}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">{t('stashes.messageOptional')}</label>
                <input type="text" className="w-full text-sm" placeholder={t('stashes.messagePlaceholder')}
                  value={stashMsg} autoFocus
                  onChange={(e) => setStashMsg(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleStashChanges()} />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={stashUntracked} onChange={(e) => setStashUntracked(e.target.checked)} />
                {t('stashes.includeUntracked')}
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowStashDialog(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={handleStashChanges}>
                <Download size={13} /> {t('toolbar.stash')}
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
                <h3 className="text-base font-medium">{t('branches.compareTitle')}</h3>
                <div className="text-2xs text-text-tertiary mt-0.5">
                  <code className="text-accent">{compareCurrent || '?'}</code>
                  {' ←→ '}
                  <code className="text-accent">{compareBranch.name}</code>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {compareCounts && (
                  <>
                    <span className="badge badge-added">{t('branches.aheadBadge', { count: compareCounts.ahead })}</span>
                    <span className="badge badge-deleted">{t('branches.behindBadge', { count: compareCounts.behind })}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {compareLoading ? (
                <div className="text-center text-xs text-text-tertiary py-6">{t('branches.comparing')}</div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <button className="btn btn-secondary text-xs" onClick={handleComparePreview}>
                      {t('branches.previewPatch')}
                    </button>
                    <button className="btn btn-secondary text-xs" onClick={handleCompareOpenInDiff}>
                      {t('branches.openInDiffTool')}
                    </button>
                  </div>
                  {comparePatch && (
                    <pre className="text-2xs font-mono bg-bg-tertiary p-3 rounded max-h-64 overflow-auto whitespace-pre-wrap text-text-secondary border border-border-default">
                      {comparePatch}
                    </pre>
                  )}
                  <div>
                    <div className="text-2xs uppercase text-text-tertiary mb-1">
                      {t('branches.changedFilesCount', { count: compareFiles.length })}
                    </div>
                    <div className="border border-border-default rounded max-h-64 overflow-y-auto">
                      {compareFiles.length === 0 ? (
                        <div className="p-3 text-xs text-text-tertiary text-center">
                          {t('branches.noDifferencesTree')}
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
              <button className="btn btn-secondary text-xs" onClick={() => setCompareBranch(null)}>{t('common.close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
