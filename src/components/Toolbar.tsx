import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type BranchInfo, type RemoteInfo } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { pickDefaultPullBranch, pickDefaultPushBranch } from '../lib/pullPushDefaults';
import { describePushResult } from '../lib/pushResult';
import { getRepoInProgressState } from '../lib/repoState';
import { getThemeMeta } from '../lib/themes';
import { cn } from '../lib/utils';
import { useGitStore, surfaceConflictedState } from '../stores/gitStore';
import { navCanGoBack, navCanGoForward, useNavHistoryStore } from '../stores/navHistoryStore';
import { useOperationLogStore } from '../stores/operationLogStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastActions } from '../stores/toastStore';
import { offerPushRejection } from '../stores/pushRejectionStore';
import { DEFAULT_TOOLBAR_GROUPS, useToolbarStore, type ToolbarGroupKey, type ToolbarGroups } from '../stores/toolbarStore';
import { confirmDialog } from './ConfirmDialog';
import appLogo from '../assets/app-logo.png';
import { AlertCircle, ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, CloudDownload, Download, ExternalLink, EyeOff, FileText, Folder, GitBranch, GitCommit, GitMerge, GitPullRequest, Keyboard, Loader, Minus, Moon, Plus, RefreshCw, RotateCcw, Search, Settings as SettingsIcon, Sparkles, Star, StashPop, Sun, Terminal, Trash } from './icons';

// Toolbar groups live in a shared zustand store (toolbarStore.ts) so the
// customize editor applies to BOTH toolbars (top row + git actions row) live.
// Default groups & localStorage persistence are handled there.

// Window control buttons — frameless window
function WindowControls() {
  const { t } = useI18n();
  const handleMinimize = () => api.window.minimize();
  const handleMaximize = async () => {
    const isMax = await api.window.isMaximized();
    if (isMax) {
      // Need to unmaximize — call maximize which toggles
      api.window.maximize();
    } else {
      api.window.maximize();
    }
  };
  const handleClose = () => api.window.close();

  return (
    <div className="flex items-center no-drag shrink-0">
      <button
        className="flex items-center justify-center w-11 h-9 hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-text-secondary"
        onClick={handleMinimize}
        title={t('shell.minimize')}
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4.5" width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button
        className="flex items-center justify-center w-11 h-9 hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-text-secondary"
        onClick={handleMaximize}
        title={t('shell.maximize')}
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button
        className="flex items-center justify-center w-11 h-9 hover:bg-red-500 hover:text-white transition-colors text-text-secondary rounded-bl-md"
        onClick={handleClose}
        title={t('common.close')}
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0,0 L10,10 M10,0 L0,10" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
    </div>
  );
}

interface ToolbarProps {
  onFind?: () => void;
  /** Global cross-entity search (commits/branches/tags/files/stashes). */
  onGlobalSearch?: () => void;
  onGitFlow?: () => void;
  onInteractiveRebase?: () => void;
  onRepoInfo?: () => void;
  onShowShortcuts?: () => void;
  onShowClone?: () => void;
  onToggleCommandLog?: () => void;
  onShowInit?: () => void;
  /** LAR-3 — toggle the AI Assistant chat panel. */
  onToggleAiAssistant?: () => void;
}

export function Toolbar({ onFind, onGlobalSearch, onGitFlow, onInteractiveRebase, onRepoInfo, onShowShortcuts, onShowClone, onShowInit, onToggleCommandLog, onToggleAiAssistant }: ToolbarProps = {}) {
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const currentMetadata = useRepositoryStore((s) => s.currentMetadata);
  // RENDER-PERF: no `s.status` subscription here — the main Toolbar renders
  // NO status-derived UI (the center badges area is empty; git status chips
  // live in GitToolbar below and in StatusBar). The dead subscription
  // re-rendered this 1.2k-line component on every status refresh (~5s).
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);
  const fetch = useGitStore((s) => s.fetch);
  const toast = useToastActions();
  const theme = useSettingsStore((s) => s.theme);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
  const settings = useSettingsStore((s) => s.settings);
  // Read global selection — show file-history chip in header if set
  const globalPathFilter = useSelectionStore((s) => s.pathFilter);
  const setGlobalPathFilter = useSelectionStore((s) => s.setPathFilter);
  const selectedCommitHash = useSelectionStore((s) => s.selectedCommitHash);
  const selectedBranch = useSelectionStore((s) => s.selectedBranch);
  // Cross-tool selection chips: tag, stash, multi-branch set, author filter
  const selectedTag = useSelectionStore((s) => s.selectedTag);
  const selectedStashIndex = useSelectionStore((s) => s.selectedStashIndex);
  const selectedBranches = useSelectionStore((s) => s.selectedBranches);
  const authorFilter = useSelectionStore((s) => s.authorFilter);
  // Toolbar customization state — shared store, so edits apply to GitToolbar too
  const groups = useToolbarStore((s) => s.groups);
  const setGroup = useToolbarStore((s) => s.setGroup);
  const setGroups = useToolbarStore((s) => s.setGroups);
  const [showCustomize, setShowCustomize] = useState(false);
  const { t } = useI18n();

  const disabled = !currentRepo;
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;
  // Back/Forward button states (navHistoryStore selectors).
  const canGoBack = useNavHistoryStore(navCanGoBack);
  const canGoForward = useNavHistoryStore(navCanGoForward);

  // Color constants for icon colors (matching the screenshot style)
  const COLOR_BLUE = '#399ee6';
  const COLOR_GREEN = '#86b300';
  const COLOR_ORANGE = '#f2ae49';
  const COLOR_PURPLE = '#a37acc';
  const COLOR_RED = '#f07171';

  const handlePush = async () => {
    if (!currentRepo) return;
    try {
      const res = await push(currentRepo.path);
      const pr = describePushResult(res);
      if (pr.kind === 'error') toast.error(pr.title, pr.detail);
      else if (pr.kind === 'info') toast.info(pr.title, pr.detail);
      else toast.success(pr.title, pr.detail);
    }
    catch (e) {
      // Remote-conflict reaction (non-fast-forward / lease-stale /
      // protected / policy) — dialog with recovery actions; plain network
      // errors keep the old error toast.
      if (!offerPushRejection(e, { repoPath: currentRepo.path })) toast.error(t('shell.pushFailed'), String(e));
    }
  };
  const handlePull = async () => {
    if (!currentRepo) return;
    try { await pull(currentRepo.path); toast.success(t('status.pulledSuccessfully')); }
    catch (e) { toast.error(t('shell.pullFailed'), String(e)); }
  };
  const handleSynchronize = async () => {
    if (!currentRepo) return;
    try {
      await fetch(currentRepo.path, undefined, true);
      await pull(currentRepo.path);
      await push(currentRepo.path);
      toast.success(t('shell.synchronized'));
    } catch (e) {
      // The pull half may conflict (handled by gitStore.pull's own catch);
      // the push half may be REJECTED by the remote — react to that here.
      if (!offerPushRejection(e, { repoPath: currentRepo.path })) toast.error(t('shell.synchronizeFailed'), String(e));
    }
  };
  const handleOpenInBrowser = async () => {
    if (!currentRepo) return;
    try {
      const info = await api.git.extractRepoInfo(currentRepo.path);
      if (info.webUrl && info.provider !== 'unknown') { api.app.openExternal(info.webUrl); }
      else { toast.info(t('shell.noRemoteUrl')); }
    } catch (e) { toast.error(t('shell.openInBrowserFailed'), String(e)); }
  };
  const handleRevealInFileManager = async () => {
    if (!currentRepo) return;
    try { await api.git.revealInFileManager(currentRepo.path); }
    catch (e) { toast.error(t('shell.revealFailed'), String(e)); }
  };

  // SmartGit: while a sequencer state (merge/rebase/cherry-pick/revert/bisect)
  // is active, Pull is NOT allowed — only Fetch / Fetch All stay available.
  // The reaction lives in PullDropdown/GitToolbar below via lib/repoState.

  // Compact icon-only button
  const IconButton = ({ icon: Icon, onClick, disabled, title }: {
    icon: typeof RefreshCw; onClick: () => void; disabled?: boolean; title: string;
  }) => (
    <button
      className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-bg-hover transition-colors no-drag disabled:opacity-30 disabled:cursor-not-allowed text-text-secondary hover:text-text-primary"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <Icon size={15} />
    </button>
  );

  // Labeled button — icon + text label, flat style like platypusgit
  // iconColor: optional color for the icon (blue/green/orange/purple)
  const LabeledButton = ({ icon: Icon, label, onClick, disabled, title, iconColor, active }: {
    icon: typeof RefreshCw; label: string; onClick: () => void; disabled?: boolean; title: string;
    iconColor?: string; active?: boolean;
  }) => (
    <button
      className={cn(
        'flex items-center gap-1.5 px-3 h-8 rounded-md transition-colors no-drag disabled:opacity-30 disabled:cursor-not-allowed text-xs',
        active
          ? 'bg-accent text-text-inverse'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
      )}
      style={!active && iconColor ? { color: iconColor } : undefined}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <Icon size={14} />
      <span className="hidden md:inline">{label}</span>
    </button>
  );

  const Divider = () => <div className="w-px h-5 bg-border-subtle mx-2" />;

  return (
    <header
      className="flex items-center h-10 bg-bg-tertiary border-b border-border-default shrink-0 select-none titlebar-drag"
    >
      {/* App name + repo management buttons (left) */}
      <div className="flex items-center gap-2 px-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <img src={appLogo} alt="PrismGit" className="w-5 h-5 rounded-md" />
          <span className="text-xs font-bold text-text-primary tracking-tight">PrismGit</span>
        </div>
        {/* Back/Forward — browser-style navigation between tools and views
            (the user's «кнопок назад, вперёд как в браузере»). Keyboard:
            Alt+Left / Alt+Right (bound in App.tsx). */}
        <div className="flex items-center gap-0.5 no-drag ml-1">
          <button
            className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-bg-hover transition-colors text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={() => { const t = useNavHistoryStore.getState().back(); if (t != null) navigate(t); }}
            disabled={!canGoBack}
            title={t('shell.navBack', { defaultValue: 'Назад (Alt+←)' })}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-bg-hover transition-colors text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={() => { const t = useNavHistoryStore.getState().forward(); if (t != null) navigate(t); }}
            disabled={!canGoForward}
            title={t('shell.navForward', { defaultValue: 'Вперёд (Alt+→)' })}
          >
            <ChevronRight size={15} />
          </button>
        </div>
        {currentRepo && (
          <>
            <span className="text-text-tertiary text-xs">/</span>
            <span className="text-xs text-text-secondary font-medium">{currentRepo.name}</span>
          </>
        )}
        {/* Repo management buttons — always visible (even when no repo is open) */}
        <div className="flex items-center gap-0.5 ml-2">
          <IconButton
            icon={Folder}
            onClick={() => useRepositoryStore.getState().openRepositoryPicker()}
            title={t('shell.openRepoShortcut')}
          />
          <IconButton
            icon={Download}
            onClick={() => onShowClone && onShowClone()}
            title={t('welcome.cloneRepo')}
          />
          <IconButton
            icon={Plus}
            onClick={() => onShowInit && onShowInit()}
            title={t('welcome.newRepo')}
          />
        </div>
      </div>

      <Divider />

      {/* Center: status badges + global selections (draggable area) */}
      <div className="flex-1 flex items-center justify-center titlebar-drag gap-2">

      </div>

      {/* Right: utility buttons + customize */}
      <div className="flex items-center gap-0.5 no-drag pr-2 relative">
        {groups.utils && (
          <>
            <IconButton icon={Star} onClick={() => onRepoInfo && onRepoInfo()} disabled={disabled} title={t('shell.repoInfo')} />
            {/* Task 1 — search is enabled even when no repo is open.
                GlobalSearch falls back to repository-list search when
                currentRepo is null (see GlobalSearch's empty-state
                handling). */}
            <span data-tour="toolbar-global-search" style={{ display: 'inline-flex' }}>
              <IconButton icon={Search} onClick={() => onGlobalSearch && onGlobalSearch()} title={t('search.toolbarButtonTitle')} />
            </span>
            <IconButton icon={ExternalLink} onClick={handleOpenInBrowser} disabled={disabled} title={t('shell.openInBrowser')} />
            <IconButton icon={Folder} onClick={handleRevealInFileManager} disabled={disabled} title={t('shell.revealInFileManager')} />
            <Divider />
          </>
        )}
        <IconButton
          icon={Terminal}
          onClick={() => onToggleCommandLog && onToggleCommandLog()}
          title={t('shell.commandLogTooltip')}
        />
        {/* ONB-1 — spotlight this button as the entry-point for
            "press Ctrl+K anytime for command palette" tour step
            (the shortcuts dialog lists Ctrl+K as the first shortcut). */}
        <span data-tour="toolbar-command-palette" style={{ display: 'inline-flex' }}>
          <IconButton
            icon={Keyboard}
            onClick={() => onShowShortcuts && onShowShortcuts()}
            title={t('shell.keyboardShortcutsTooltip')}
          />
        </span>
        {/* LAR-3 — AI Assistant toggle button. Disabled when AI is not
            enabled in Settings (aiCommitMessagesEnabled). */}
        <IconButton
          icon={Sparkles}
          onClick={() => onToggleAiAssistant && onToggleAiAssistant()}
          disabled={!settings?.aiCommitMessagesEnabled}
          title={settings?.aiCommitMessagesEnabled ? t('aiAssistant.toggleTitle') : t('aiAssistant.disabledHint')}
        />
        <IconButton
          icon={(getThemeMeta(theme)?.isDark ?? false) ? Sun : Moon}
          onClick={() => toggleTheme()}
          title={(getThemeMeta(theme)?.isDark ?? false) ? t('shell.switchToLightTheme') : t('shell.switchToDarkTheme')}
        />
        {/* Customize toolbar button */}
        <button
          className="flex items-center justify-center w-7 h-7 rounded hover:bg-bg-hover transition-colors no-drag text-text-secondary hover:text-text-primary"
          onClick={() => setShowCustomize(!showCustomize)}
          title={t('shell.customizeToolbar')}
        >
          <SettingsIcon size={15} />
        </button>
        {showCustomize && (
          <div className="absolute top-full right-2 mt-1 bg-bg-elevated border border-border-default rounded shadow-lg z-50 min-w-72">
            <div className="px-3 py-2 text-2xs uppercase text-text-tertiary border-b border-border-subtle">
              {t('shell.toolbarEditorHint')}
            </div>
            <div className="py-1 max-h-72 overflow-y-auto">
              <div className="px-3 py-1 text-2xs uppercase text-text-tertiary bg-bg-tertiary">{t('shell.visible')}</div>
              {(Object.keys(groups) as Array<ToolbarGroupKey>)
                .filter(key => groups[key])
                .map((key, idx) => (
                  <div
                    key={key}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/toolbar-group', key);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const draggedKey = e.dataTransfer.getData('text/toolbar-group') as ToolbarGroupKey;
                      if (!draggedKey || draggedKey === key) return;
                      const groupKeys = Object.keys(groups) as Array<ToolbarGroupKey>;
                      const draggedIdx = groupKeys.indexOf(draggedKey);
                      const targetIdx = groupKeys.indexOf(key);
                      if (draggedIdx === -1 || targetIdx === -1) return;
                      const newOrdered: Record<string, boolean> = {};
                      const reordered = [...groupKeys];
                      reordered.splice(draggedIdx, 1);
                      reordered.splice(targetIdx, 0, draggedKey);
                      for (const k of reordered) newOrdered[k] = groups[k as ToolbarGroupKey];
                      setGroups(newOrdered as ToolbarGroups);
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover cursor-move text-xs"
                    title={t('shell.dragToReorder')}
                  >
                    <span className="text-text-tertiary">⋮⋮</span>
                    <span className="capitalize flex-1">{key}</span>
                    <button
                      className="text-text-tertiary hover:text-status-deleted"
                      onClick={(e) => { e.stopPropagation(); setGroup(key, false); }}
                      title={t('shell.hideGroup')}
                    >
                      <EyeOff size={11} />
                    </button>
                  </div>
                ))}
              {(Object.keys(groups) as Array<ToolbarGroupKey>)
                .filter(key => !groups[key]).length > 0 && (
                <>
                  <div className="px-3 py-1 text-2xs uppercase text-text-tertiary bg-bg-tertiary border-t border-border-subtle">{t('shell.hidden')}</div>
                  {(Object.keys(groups) as Array<ToolbarGroupKey>)
                    .filter(key => !groups[key])
                    .map(key => (
                      <div key={key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover text-xs opacity-60">
                        <span className="text-text-tertiary">⋯</span>
                        <span className="capitalize flex-1">{key}</span>
                        <button
                          className="text-text-tertiary hover:text-status-added"
                          onClick={() => setGroup(key, true)}
                          title={t('shell.showGroup')}
                        >
                          <Plus size={11} />
                        </button>
                      </div>
                    ))}
                </>
              )}
            </div>
            <div className="px-3 py-1 border-t border-border-subtle flex justify-between">
              <button className="text-2xs text-accent"
                onClick={() => setGroups(DEFAULT_TOOLBAR_GROUPS)}>
                {t('shell.resetToDefault')}
              </button>
              <button className="text-2xs btn btn-primary !py-0.5 !px-2"
                onClick={() => setShowCustomize(false)}>
                {t('shell.done')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Window controls (frameless) — minimize, maximize, close */}
      <WindowControls />
    </header>
  );
}

/**
 * Push dropdown — button + small chevron that opens a menu with:
 *   - Push to: <remote> (dropdown of ALL configured remotes, not just origin)
 *   - Push branch: <branch> (dropdown of local branches)
 *   - [✓] Set upstream (-u) — auto-enabled for fresh local branches
 *   - [✓] Force push + force-flag selector: --force (default) / --force-with-lease
 *   - Push tags
 */
function PushDropdown({ disabled }: { disabled: boolean }) {
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const toast = useToastActions();
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const settings = useSettingsStore((s) => s.settings);
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [defaultRemote, setDefaultRemote] = useState('origin');
  const [selectedRemote, setSelectedRemote] = useState('origin');
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [remoteBranch, setRemoteBranch] = useState('');
  const [setUpstream, setSetUpstream] = useState(false);
  const [force, setForce] = useState(false);
  // Force flag: real --force by default ("push --force everywhere"), lease
  // one click away. Persisted as the global forcePushMode setting so every
  // push surface in the app (Push To…, Branches, AI, palette, menu) follows.
  const [forceMode, setForceMode] = useState<'lease' | 'force'>(
    settings?.forcePushMode === 'lease' ? 'lease' : 'force'
  );
  const [pushTags, setPushTags] = useState(false);
  // 0.1 — Force-push policy gate: the isForcePushAllowed IPC existed with zero
  // renderer callers. Query it for the selected branch and disable the force
  // checkbox when the policy denies (deny / feature-only + protected branch).
  const [forceAllowed, setForceAllowed] = useState<{ allowed: boolean; reason: string } | null>(null);

  useEffect(() => {
    if (!selectedBranch || typeof api.git?.isForcePushAllowed !== 'function') { setForceAllowed(null); return; }
    let cancelled = false;
    api.git
      .isForcePushAllowed(selectedBranch, settings?.forcePushPolicy ?? 'feature-only', settings?.protectedBranches)
      .then((v) => { if (!cancelled) setForceAllowed(v); })
      .catch(() => { if (!cancelled) setForceAllowed(null); });
    return () => { cancelled = true; };
  }, [selectedBranch, settings?.forcePushPolicy, settings?.protectedBranches]);
  const forceDenied = forceAllowed != null && !forceAllowed.allowed;

  // Keep the local selector in sync with the global setting (e.g. changed in
  // Preferences or in another push surface).
  useEffect(() => {
    if (open) setForceMode(settings?.forcePushMode === 'lease' ? 'lease' : 'force');
  }, [open, settings?.forcePushMode]);

  // Load on mount too — the one-click Push button needs a valid default remote.
  useEffect(() => {
    if (!currentRepo) return;
    api.git.remotes(currentRepo.path).then(rs => {
      setRemotes(rs);
      const def = rs.find(r => r.name === 'origin')?.name || rs[0]?.name || '';
      setDefaultRemote(def);
      setSelectedRemote(def);
    }).catch(() => {});
  }, [currentRepo]);

  useEffect(() => {
    if (!currentRepo) return;
    api.git.branches(currentRepo.path).then(brs => {
      setBranches(brs.filter(b => !b.remote));
      // UNIFIED STATE: default to the CURRENT checked-out branch — the
      // working copy is what Push acts on. The global selection (Branches/
      // History browsing) is a VIEW filter, not an operation target: it used
      // to win here, so after browsing feature/v1 with feature/v3 checked
      // out, Push pre-filled v1 (user-reported "инструменты без единого
      // состояния"). It now only serves as a detached-HEAD fallback.
      const chosenName = pickDefaultPushBranch(
        brs.filter(b => !b.remote).map(b => ({ name: b.name, current: b.current })),
        useSelectionStore.getState().selectedBranch,
      );
      const chosen = brs.find(b => b.name === chosenName);
      setSelectedBranch(chosen?.name || '');
      setSetUpstream(!!chosen && !chosen.tracking);
    }).catch(() => {});
  }, [currentRepo, open]);

  const doPush = async (branch?: string) => {
    if (!currentRepo) return;
    const b = branch || selectedBranch;
    if (!selectedRemote) {
      toast.warning(t('shell.noRemotesConfigured'), t('shell.addRemoteFirst'));
      setOpen(false);
      return;
    }
    // Build the refspec. If the user specified a different remote branch
    // (remoteBranch), use HEAD:remoteBranch so we push the current HEAD's
    // commits to the named remote branch — e.g. push feature-branch commits
    // to origin/main via `git push origin HEAD:main`.
    // Without remoteBranch, use `branch` which pushes local→same-name remote.
    const refspec = remoteBranch.trim()
      ? `HEAD:${remoteBranch.trim()}`
      : b;
    const forceFlag = force ? (forceMode === 'lease' ? '--force-with-lease' : '--force') : '';
    const cmd = `git push ${selectedRemote} ${refspec} ${setUpstream ? '-u' : ''} ${forceFlag} ${pushTags ? '--tags' : ''}`.trim();
    try {
      const res = await useOperationLogStore.getState().logOperation(
        `Push ${b || 'current'} → ${selectedRemote}${remoteBranch.trim() ? '/' + remoteBranch.trim() : ''}${force ? ` (${forceFlag})` : ''}${pushTags ? ' +tags' : ''}`,
        currentRepo.path, cmd,
        async () => {
          // When using HEAD:remoteBranch, we need to pass the refspec directly.
          // api.git.push takes `branch` as a simple name — but HEAD:main is a refspec.
          // So we pass refspec as the branch parameter; git push handles it correctly.
          const r = await api.git.push(currentRepo.path, selectedRemote, refspec, setUpstream && !remoteBranch.trim(), force, pushTags, undefined, forceMode);
          await refreshStatus(currentRepo.path);
          // Also refresh repo stats in sidebar
          api.settings.refreshRepoStats(currentRepo.path).then(() => {
            useRepositoryStore.getState().loadMetadata();
          }).catch(() => {});
          return r;
        }
      );
      const t2 = describePushResult(res, selectedRemote, remoteBranch.trim() || b || undefined);
      if (t2.kind === 'error') toast.error(t2.title, t2.detail);
      else if (t2.kind === 'info') toast.info(t2.title, t2.detail);
      else toast.success(t2.title, t2.detail);
    } catch (e) {
      // Push To… carries its OWN parameters — the recovery actions must
      // retry the same remote/branch/target/force combination.
      const offered = offerPushRejection(e, {
        repoPath: currentRepo.path,
        remote: selectedRemote,
        branch: b,
        targetBranch: remoteBranch.trim() || undefined,
        force,
        forceMode,
      });
      if (!offered) toast.error(t('shell.pushFailed'), String(e));
    }
    setOpen(false);
    setForce(false);
    setPushTags(false);
    setRemoteBranch('');
  };

  return (
    <div className="relative">
      <div className="flex items-center">
        <button
          className="flex items-center gap-1.5 px-3 h-8 rounded-l-md transition-colors no-drag disabled:opacity-30 disabled:cursor-not-allowed text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover"
          style={{ color: '#86b300' }}
          onClick={() => doPush()}
          disabled={disabled || remotes.length === 0}
          title={remotes.length === 0 ? t('shell.noRemotesHint') : t('shell.pushCurrentBranchTo', { remote: defaultRemote })}
        >
          <ArrowUp size={14} />
          <span className="hidden md:inline">{t('toolbar.push')}</span>
        </button>
        <button
          className="flex items-center px-1.5 h-8 rounded-r-md transition-colors no-drag disabled:opacity-30 disabled:cursor-not-allowed text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover border-l border-border-subtle"
          onClick={() => setOpen(!open)}
          disabled={disabled}
          title={t('shell.pushOptions')}
        >
          <ChevronDown size={12} />
        </button>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 bg-bg-elevated border border-border-default rounded-md shadow-lg z-50 min-w-64">
            <div className="px-3 py-2 text-2xs uppercase text-text-tertiary border-b border-border-subtle">
              {t('toolbar.push')}
            </div>
            {remotes.length === 0 ? (
              <div className="px-3 py-3 text-xs text-text-tertiary">
                {t('shell.noRemotesText')}
                <div className="mt-1">{t('shell.pushNoRemotesHint')}</div>
              </div>
            ) : (
              <>
                <div className="p-2 space-y-2">
                  <div>
                    <label className="text-2xs text-text-tertiary block mb-1">{t('shell.remoteLabel')}</label>
                    <select
                      className="w-full text-xs px-2 py-1 bg-bg-secondary border border-border-default rounded font-mono"
                      value={selectedRemote}
                      onChange={(e) => setSelectedRemote(e.target.value)}
                    >
                      {remotes.map(r => (
                        <option key={r.name} value={r.name}>
                          {r.name}{r.name === defaultRemote && remotes.length > 1 ? ` ${t('shell.defaultSuffix')}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-2xs text-text-tertiary block mb-1">{t('shell.branchLabel')}</label>
                    <select
                      className="w-full text-xs px-2 py-1 bg-bg-secondary border border-border-default rounded font-mono"
                      value={selectedBranch}
                      onChange={(e) => {
                        setSelectedBranch(e.target.value);
                        const b = branches.find(x => x.name === e.target.value);
                        setSetUpstream(!!b && !b.tracking);
                      }}
                    >
                      {branches.map(b => (
                        <option key={b.name} value={b.name}>
                          {b.name}{b.current ? ` ${t('shell.currentSuffix')}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-2xs text-text-tertiary block mb-1">
                      {t('shell.remoteBranchOptional')}
                    </label>
                    <input
                      type="text"
                      className="w-full text-xs px-2 py-1 bg-bg-secondary border border-border-default rounded font-mono"
                      placeholder={t('shell.remoteBranchPlaceholder')}
                      value={remoteBranch}
                      onChange={(e) => setRemoteBranch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="px-3 py-1">
                  <label className="flex items-center gap-2 text-xs cursor-pointer" title={t('shell.setUpstreamTooltip')}>
                    <input type="checkbox" checked={setUpstream} onChange={(e) => setSetUpstream(e.target.checked)} />
                    <span>{t('shell.setUpstream')}</span>
                  </label>
                </div>
                <div className="px-3 py-1">
                  <label
                    className={cn('flex items-center gap-2 text-xs', forceDenied ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer')}
                    title={forceDenied ? forceAllowed!.reason : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={force}
                      disabled={forceDenied}
                      onChange={(e) => setForce(e.target.checked)}
                    />
                    <span className="text-status-deleted">{t('shell.forcePush')}</span>
                    {forceDenied && <span className="text-2xs text-text-tertiary">— {forceAllowed!.reason}</span>}
                  </label>
                </div>
                {force && (
                  <div className="px-3 py-1 pl-7">
                    <label className="text-2xs text-text-tertiary block mb-1">{t('shell.forceMode')}</label>
                    <select
                      data-testid="push-force-mode"
                      className="w-full text-xs px-2 py-1 bg-bg-secondary border border-border-default rounded font-mono"
                      value={forceMode}
                      onChange={(e) => {
                        const v = e.target.value as 'lease' | 'force';
                        setForceMode(v);
                        // Persist globally — every push surface follows this choice.
                        useSettingsStore.getState().setSetting('forcePushMode', v).catch(() => {});
                      }}
                    >
                      <option value="force">--force</option>
                      <option value="lease">--force-with-lease</option>
                    </select>
                  </div>
                )}
                <div className="px-3 py-1">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={pushTags} onChange={(e) => setPushTags(e.target.checked)} />
                    <span>{t('shell.pushTags')}</span>
                  </label>
                </div>
                <div className="px-3 py-2 border-t border-border-subtle flex gap-2">
                  <button
                    className="btn btn-primary text-xs flex-1"
                    onClick={() => doPush()}
                    disabled={!selectedBranch}
                  >
                    <ArrowUp size={12} /> {t('shell.pushToRemote', { remote: selectedRemote })}
                  </button>
                  <button className="btn btn-secondary text-xs" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Pull dropdown — button + small chevron that opens a menu with:
 *   - Remote selector (ALL configured remotes — mirrors the Push dropdown)
 *   - Remote branch selector scoped to the chosen remote
 *   - [✓] Rebase instead of merge
 *   - [✓] No fast-forward
 *   - "Fetch <remote> now" when the remote has no fetched branches yet
 *
 * Fixes the old behavior where the one-click Pull silently did NOTHING until
 * the user first opened the options menu (selectedBranch was only loaded on
 * open), and where a freshly added remote (nothing fetched) left an EMPTY
 * branch dropdown with no way to pull from it at all.
 */
function PullDropdown({ disabled, pullBlocked }: { disabled: boolean; /** Reason Pull is blocked (in-progress repo state) — undefined when allowed */ pullBlocked?: string }) {
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const toast = useToastActions();
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const settings = useSettingsStore((s) => s.settings);
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [selectedRemote, setSelectedRemote] = useState('');
  const [remoteBranches, setRemoteBranches] = useState<BranchInfo[]>([]);
  // Stored as "origin/main" — remote + branch in one ref name
  const [selectedBranch, setSelectedBranch] = useState('');
  const [useRebase, setUseRebase] = useState(false);
  const [noFF, setNoFF] = useState(false);
  const [fetching, setFetching] = useState(false);

  // Remotes load on MOUNT (repo change too) — the one-click Pull button needs
  // a valid remote without opening the options menu first.
  useEffect(() => {
    if (!currentRepo) return;
    api.git.remotes(currentRepo.path).then(rs => {
      setRemotes(rs);
      setSelectedRemote(prev =>
        prev && rs.some(r => r.name === prev)
          ? prev
          : (rs.find(r => r.name === 'origin')?.name || rs[0]?.name || '')
      );
    }).catch(() => {});
  }, [currentRepo]);

  // Remote branches load on mount + when the menu opens or the remote changes.
  // `resetDefault` — when the dropdown (re)OPENS we re-resolve the default from
  // the CURRENT checked-out branch (unified state). Within an open session
  // (e.g. after an in-dialog Fetch refreshes the branch list) the user's
  // explicit dropdown pick is preserved.
  const loadRemoteBranches = useCallback(async (opts?: { resetDefault?: boolean }) => {
    if (!currentRepo || !selectedRemote) { setRemoteBranches([]); return; }
    try {
      const brs = await api.git.branches(currentRepo.path);
      const prefix = `${selectedRemote}/`;
      const rem = brs.filter(b => b.remote && b.name.startsWith(prefix));
      setRemoteBranches(rem);
      // UNIFIED STATE: the default pull target is the remote counterpart of
      // the CURRENT checked-out branch. The GLOBAL selection (Branches/
      // History browsing) used to win here — after the user browsed
      // feature/v1 while feature/v3 was checked out, Pull pre-filled v1 and
      // `git pull origin feature/v1` merged the wrong branch into the
      // working tree (user-reported).
      setSelectedBranch(prev =>
        pickDefaultPullBranch(
          rem.map(b => b.name),
          brs.find(b => b.current)?.name ?? null,
          prev,
          !!opts?.resetDefault,
        ),
      );
    } catch { setRemoteBranches([]); }
  }, [currentRepo, selectedRemote]);
  useEffect(() => { loadRemoteBranches({ resetDefault: true }); }, [loadRemoteBranches, open]);

  const fetchRemoteNow = async () => {
    if (!currentRepo || !selectedRemote) return;
    setFetching(true);
    try {
      await api.git.fetch(currentRepo.path, selectedRemote, false, true);
      toast.success(t('shell.fetchedRemote', { remote: selectedRemote }), t('shell.remoteBranchesUpdated'));
    } catch (e) {
      toast.error(t('shell.fetchRemoteFailed', { remote: selectedRemote }), String(e));
    } finally {
      setFetching(false);
      loadRemoteBranches();
    }
  };

  const doPull = async () => {
    if (!currentRepo) return;
    // SmartGit: Pull would merge/rebase over an in-progress state (merge,
    // rebase, cherry-pick, revert, bisect) and discard it — blocked. Fetch /
    // Fetch All remain available (they never touch the working tree).
    if (pullBlocked) {
      toast.error(t('shell.pullNotAvailable'), pullBlocked);
      setOpen(false);
      return;
    }
    if (!selectedBranch) {
      toast.warning(
        t('shell.nothingToPull'),
        remotes.length === 0
          ? t('shell.noRemotesHint')
          : t('shell.noFetchedBranchesOn', { remote: selectedRemote || t('shell.anyRemote') })
      );
      setOpen(false);
      return;
    }
    try {
      // Extract remote + branch from "origin/branch-name"
      const parts = selectedBranch.split('/');
      const remote = parts[0];
      const branch = parts.slice(1).join('/');
      // Read pull strategy from settings — merge or rebase
      // If dropdown has explicit rebase checkbox, use that. Otherwise use settings default.
      const shouldRebase = useRebase || (settings.pullStrategy === 'rebase');
      const cmd = `git pull ${remote} ${branch} ${shouldRebase ? '--rebase' : ''} ${noFF ? '--no-ff' : ''}`.trim();
      await useOperationLogStore.getState().logOperation(
        `Pull from ${selectedBranch}${shouldRebase ? ' (rebase)' : ' (merge)'}`,
        currentRepo.path, cmd,
        async () => {
          await api.git.pull(currentRepo.path, remote, branch, shouldRebase, noFF);
          await refreshStatus(currentRepo.path);
        }
      );
      toast.success(shouldRebase
        ? t('shell.pulledFromRebase', { branch: selectedBranch })
        : t('shell.pulledFromMerge', { branch: selectedBranch }));
    } catch (e) {
      // Don't crash — detect a conflicted pull from the REPO STATE (git
      // streams CONFLICT lines to stdout, so message-matching is brittle)
      // and take the user to the Conflicts UI. A plain transient toast was
      // reported as "ничего не произошло".
      const conflicted = await surfaceConflictedState(currentRepo.path);
      if (!conflicted) {
        toast.error(t('shell.pullFailed'), String(e));
      }
    }
    setOpen(false);
    setUseRebase(false);
    setNoFF(false);
  };

  const pullTarget = selectedBranch || selectedRemote;
  return (
    <div className="relative">
      <div className="flex items-center">
        <button
          className="flex items-center gap-1.5 px-3 h-8 rounded-l-md transition-colors no-drag disabled:opacity-30 disabled:cursor-not-allowed text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover"
          style={{ color: '#399ee6' }}
          onClick={() => doPull()}
          disabled={disabled || !!pullBlocked}
          title={pullBlocked
            ? t('shell.pullBlocked', { reason: pullBlocked })
            : pullTarget
              ? t('shell.pullTargetTooltip', { ref: pullTarget })
              : t('shell.pullNoBranches')}
        >
          <ArrowDown size={14} />
          <span className="hidden md:inline">{t('toolbar.pull')}</span>
        </button>
        <button
          className="flex items-center px-1.5 h-8 rounded-r-md transition-colors no-drag disabled:opacity-30 disabled:cursor-not-allowed text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover border-l border-border-subtle"
          onClick={() => setOpen(!open)}
          disabled={disabled}
          title={t('shell.pullOptions')}
        >
          <ChevronDown size={12} />
        </button>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 bg-bg-elevated border border-border-default rounded-md shadow-lg z-50 min-w-64">
            {/* SmartGit: during an in-progress state Pull is blocked, but the
                menu stays reachable — Fetch / Fetch All remain available. */}
            {pullBlocked && (
              <div className="px-3 py-2 text-2xs bg-status-conflict/10 text-status-conflict border-b border-status-conflict/30">
                Pull is blocked while {pullBlocked}
                <div className="text-text-tertiary mt-0.5">Use Fetch / Fetch All — they never touch the working tree.</div>
              </div>
            )}
            {/* Quick actions: Fetch from / Fetch All */}
            <div className="px-3 py-2 border-b border-border-subtle flex gap-2">
              <button
                className="btn btn-secondary text-2xs flex-1"
                onClick={async () => {
                  if (!currentRepo || !selectedRemote) return;
                  try {
                    await api.git.fetch(currentRepo.path, selectedRemote, true, true);
                    toast.success(t('shell.fetchedFromRemote', { remote: selectedRemote }), t('shell.remoteBranchesUpdated'));
                    await refreshStatus(currentRepo.path);
                    loadRemoteBranches();
                  } catch (e) { toast.error(t('shell.fetchRemoteFailed', { remote: selectedRemote }), String(e)); }
                }}
                disabled={!selectedRemote || remotes.length === 0}
                title={`git fetch ${selectedRemote || '<remote>'} --prune --tags`}
              >
                <CloudDownload size={11} /> {t('toolbar.fetchFrom')}
              </button>
              <button
                className="btn btn-secondary text-2xs flex-1"
                onClick={async () => {
                  if (!currentRepo) return;
                  try {
                    await api.git.fetchAll(currentRepo.path, true);
                    toast.success(t('shell.fetchedAllRemotes'), t('shell.remoteBranchesUpdated'));
                    await refreshStatus(currentRepo.path);
                    loadRemoteBranches();
                  } catch (e) { toast.error(t('shell.fetchAllFailed'), String(e)); }
                }}
                disabled={remotes.length === 0}
                title="git fetch --all --prune --tags"
              >
                <CloudDownload size={11} /> {t('toolbar.fetchAll')}
              </button>
            </div>
            <div className="px-3 py-2 text-2xs uppercase text-text-tertiary border-b border-border-subtle">
              {t('toolbar.pullFromRemote')}
            </div>
            {remotes.length === 0 ? (
              <div className="px-3 py-3 text-xs text-text-tertiary">
                {t('shell.noRemotesText')}
                <div className="mt-1">{t('shell.pullNoRemotesHint')}</div>
              </div>
            ) : (
              <>
                <div className="p-2 space-y-2">
                  <div>
                    <label className="text-2xs text-text-tertiary block mb-1">{t('shell.remoteLabel')}</label>
                    <select
                      className="w-full text-xs px-2 py-1 bg-bg-secondary border border-border-default rounded font-mono"
                      value={selectedRemote}
                      onChange={(e) => { setSelectedRemote(e.target.value); setSelectedBranch(''); }}
                    >
                      {remotes.map(r => (
                        <option key={r.name} value={r.name} title={r.refs?.fetch}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-2xs text-text-tertiary block mb-1">{t('shell.remoteBranchLabel')}</label>
                    {remoteBranches.length > 0 ? (
                      <select
                        className="w-full text-xs px-2 py-1 bg-bg-secondary border border-border-default rounded font-mono"
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                      >
                        {remoteBranches.map(b => (
                          <option key={b.name} value={b.name}>{b.name}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-xs text-text-tertiary px-1 py-1">
                        {t('shell.noFetchedBranches', { remote: selectedRemote })}
                      </div>
                    )}
                  </div>
                  {remoteBranches.length === 0 && (
                    <button
                      className="btn btn-secondary text-xs w-full"
                      onClick={fetchRemoteNow}
                      disabled={fetching || !selectedRemote}
                      title={`git fetch ${selectedRemote} --tags`}
                    >
                      {fetching ? <Loader size={12} className="spin" /> : <CloudDownload size={12} />}
                      {t('shell.fetchRemoteNow', { remote: selectedRemote })}
                    </button>
                  )}
                </div>
                <div className="px-3 py-1">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={useRebase} onChange={(e) => setUseRebase(e.target.checked)} />
                    <span>{t('shell.rebaseInsteadOfMerge')}</span>
                  </label>
                </div>
                <div className="px-3 py-1">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={noFF} onChange={(e) => setNoFF(e.target.checked)} />
                    <span>{t('shell.noFastForward')}</span>
                  </label>
                </div>
                <div className="px-3 py-2 border-t border-border-subtle flex gap-2">
                  <button
                    className="btn btn-primary text-xs flex-1"
                    onClick={() => doPull()}
                    disabled={!selectedBranch || !!pullBlocked}
                    title={pullBlocked ? `Pull is blocked — ${pullBlocked}` : undefined}
                  >
                    <ArrowDown size={12} /> {useRebase ? t('shell.pullRebase') : t('toolbar.pull')}
                  </button>
                  <button className="btn btn-secondary text-xs" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Git Toolbar — second row, below the main Toolbar.
 * Contains the colored git operation buttons (Fetch, Push, Stage, Stash, History, Diff, Blame, Git-Flow, Rebase).
 * This is the toolbar the user wants to be separate from the app-level header.
 */
export function GitToolbar({ onGitFlow, onInteractiveRebase }: { onGitFlow?: () => void; onInteractiveRebase?: () => void } = {}) {
  const { t } = useI18n();
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  // RENDER-PERF: GitToolbar previously subscribed to the whole `s.status`
  // object and re-rendered on every status refresh (~5s of watcher churn),
  // even though it only renders (a) which sequencer state is active and
  // (b) the conflict count + first conflicted file. Selectors below return
  // STABLE identities:
  //  - getRepoInProgressState() returns a CONSTANT object from the STATES
  //    table (same reference for the same state key) → the component only
  //    re-renders when the state actually CHANGES.
  //  - conflictCount / firstConflictFile are primitives.
  const repoState = useGitStore((s) => getRepoInProgressState(s.status));
  const conflictCount = useGitStore((s) => s.status?.conflicted?.length ?? 0);
  const firstConflictFile = useGitStore((s) => s.status?.conflicted?.[0]);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);
  const fetch = useGitStore((s) => s.fetch);
  const toast = useToastActions();
  const settings = useSettingsStore((s) => s.settings);
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  // Shared toolbar groups — the customize editor (gear icon in the top toolbar)
  // controls these live; hiding a group here also removes it from the second row.
  const groups = useToolbarStore((s) => s.groups);

  const disabled = !currentRepo;
  // In-progress sequencer states block Push/Discard — they would conflict
  // with the in-progress merge/rebase/cherry-pick/revert. Fetch/Fetch All are
  // still allowed (read-only on the working tree). Bisect does NOT block.
  const isInProgress = !!repoState && repoState.key !== 'bisecting';

  // SmartGit: while a sequencer state (merge / rebase / cherry-pick / revert /
  // bisect) is active, Pull is NOT allowed — only Fetch / Fetch All remain
  // available (they never touch the working tree or HEAD).
  const pullBlocked = repoState
    ? `${repoState.pullReason} — ${repoState.blockedHint}`
    : undefined;
  const isBusy = !!repoState;

  const handlePush = async () => {
    if (!currentRepo) return;
    try {
      await useOperationLogStore.getState().logOperation(
        'Push', currentRepo.path, 'git push',
        () => push(currentRepo.path)
      );
      toast.success(t('toast.git.pushSuccess'));
      // Notify History page to reload (one-shot event, no loop).
      window.dispatchEvent(new CustomEvent('smartgit:history-refresh'));
    } catch (e) { toast.error(t('toast.git.pushFailed'), String(e)); }
  };
  const handlePull = async () => {
    if (!currentRepo) return;
    try {
      // Use settings strategy: merge or rebase
      const shouldRebase = settings.pullStrategy === 'rebase';
      const cmd = shouldRebase ? 'git pull --rebase origin' : 'git pull origin';
      await useOperationLogStore.getState().logOperation(
        shouldRebase ? 'Pull (Rebase)' : 'Pull (Merge)',
        currentRepo.path, cmd,
        async () => {
          await api.git.pull(currentRepo.path, 'origin', undefined, shouldRebase, false);
          await refreshStatus(currentRepo.path);
        }
      );
      toast.success(`Pulled ${shouldRebase ? '(rebase)' : '(merge)'}`);
      window.dispatchEvent(new CustomEvent('smartgit:history-refresh'));
    } catch (e) {
      // Conflicted pull → repo is mid-merge — detect from repo state and
      // open the Conflicts UI (toast + navigation handled centrally).
      const conflicted = await surfaceConflictedState(currentRepo.path);
      if (!conflicted) {
        toast.error(t('toast.git.pullFailed'), String(e));
      }
    }
  };

  const COLOR_BLUE = '#399ee6';
  const COLOR_GREEN = '#86b300';
  const COLOR_ORANGE = '#f2ae49';
  const COLOR_PURPLE = '#a37acc';
  const COLOR_RED = '#f07171';

  const LabeledButton = ({ icon: Icon, label, onClick, disabled, title, iconColor, active }: {
    icon: typeof RefreshCw; label: string; onClick: () => void; disabled?: boolean; title: string;
    iconColor?: string; active?: boolean;
  }) => (
    <button
      className={cn(
        'flex items-center gap-1.5 px-3 h-8 rounded-md transition-colors no-drag disabled:opacity-30 disabled:cursor-not-allowed text-xs',
        active
          ? 'bg-accent text-text-inverse'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
      )}
      style={!active && iconColor ? { color: iconColor } : undefined}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <Icon size={14} />
      <span className="hidden md:inline">{label}</span>
    </button>
  );

  const Divider = () => <div className="w-px h-5 bg-border-subtle mx-2" />;

  if (!currentRepo) return null;

  // Show conflict resolution button when conflicts exist
  // (RENDER-PERF: derived from the primitive selectors above — conflictCount
  // and firstConflictFile — instead of the whole status object.)
  const hasConflicts = conflictCount > 0;
  const handleResolveConflicts = () => {
    if (firstConflictFile) {
      // Navigate to Changes and trigger conflict solver on first conflicted file
      navigate('/changes');
      // Set a global event that ChangesPage picks up
      window.dispatchEvent(new CustomEvent('smartgit:resolve-conflict', {
        detail: { file: firstConflictFile }
      }));
    }
  };

  return (
    <div className="flex items-center h-9 bg-bg-secondary border-b border-border-default shrink-0 no-drag px-2 gap-0.5">
      {/* Conflict resolution button — only shown when conflicts exist */}
      {hasConflicts && (
        <>
          <button
            className="flex items-center gap-1.5 px-3 h-8 rounded-md transition-colors no-drag text-xs bg-status-conflict/15 text-status-conflict border border-status-conflict/40 hover:bg-status-conflict/25 font-medium animate-pulse"
            onClick={handleResolveConflicts}
            title={t('shell.conflictsTooltip', { count: conflictCount })}
          >
            <AlertCircle size={14} />
            <span>{t('shell.resolveConflicts', { count: conflictCount })}</span>
          </button>
          <Divider />
        </>
      )}
      {(Object.keys(groups) as Array<ToolbarGroupKey>).map(key => {
        if (!groups[key]) return null;
        switch (key) {
          case 'sync':
            return (
              <div key={key} className="flex items-center">
                <PullDropdown disabled={disabled} pullBlocked={pullBlocked} />
                <PushDropdown disabled={disabled || isInProgress} />
                {isBusy && <span data-testid="toolbar-state-badge" className="text-2xs text-status-conflict ml-1 flex items-center gap-1" title={repoState?.blockedHint}><AlertCircle size={11} />{repoState?.badge}</span>}
                <Divider />
              </div>
            );
          case 'stage':
            return (
              <div key={key} className="flex items-center">
                <LabeledButton icon={Plus} label={t('action.button.stage')} iconColor={COLOR_GREEN} onClick={() => currentRepo && useGitStore.getState().stageAll(currentRepo.path)} disabled={disabled} title={t('toolbar.stageAllTooltip')} />
                <LabeledButton icon={Minus} label={t('action.button.unstage')} iconColor={COLOR_ORANGE} onClick={() => {
                  if (!currentRepo) return;
                  useOperationLogStore.getState().logOperation(
                    t('action.button.unstage'), currentRepo.path, 'git reset HEAD -- .',
                    () => api.git.raw(currentRepo.path, ['reset', 'HEAD', '--', '.'])
                  ).then(() => refreshStatus(currentRepo.path))
                   .catch((e) => toast.error(t('toast.git.unstageFailed'), String(e)));
                }} disabled={disabled} title={t('action.title.unstageAll')} />
                <LabeledButton icon={Trash} label={t('action.button.discard')} iconColor={COLOR_RED} onClick={() => {
                  if (!currentRepo) return;
                  void confirmDialog({
                    title: t('action.title.discardAllChanges'),
                    message: t('toast.git.discardAllConfirm'),
                    confirmLabel: t('action.button.discard'),
                    danger: true,
                  }).then((ok) => {
                    if (!ok) return;
                    useOperationLogStore.getState().logOperation(
                      t('action.button.discard'), currentRepo.path, 'git checkout -- . && git clean -fd',
                      async () => {
                        await api.git.raw(currentRepo.path, ['checkout', '--', '.']);
                        await api.git.raw(currentRepo.path, ['clean', '-fd']);
                        await refreshStatus(currentRepo.path);
                      }
                    ).then(() => toast.success(t('toast.git.discardSuccess')))
                     .catch((e) => toast.error(t('toast.git.discardFailed'), String(e)));
                  });
                }} disabled={disabled || isInProgress} title={isInProgress ? t('action.title.blockedByInProgress') : t('action.title.discardAllChanges')} />
                <Divider />
              </div>
            );
          case 'changes':
            // Changes button — placed before History/Diff/Blame (the user
            // wanted the most-used tool first). Opens the /changes page.
            return (
              <div key={key} className="flex items-center">
                <LabeledButton icon={GitCommit} label={t('action.button.changes', { defaultValue: 'Changes' })} iconColor={COLOR_GREEN} onClick={() => navigate('/changes')} disabled={disabled} title={t('action.title.changes', { defaultValue: 'Working tree changes' })} active={currentPath === '/changes'} />
                <Divider />
              </div>
            );
          case 'stash':
            return (
              <div key={key} className="flex items-center">
                <LabeledButton icon={CloudDownload} label={t('action.button.stash')} iconColor={COLOR_PURPLE} onClick={() => {
                  if (!currentRepo) return;
                  useOperationLogStore.getState().logOperation(
                    t('action.button.stash'), currentRepo.path, 'git stash push -u',
                    () => api.git.stashPush(currentRepo.path, undefined, true)
                  ).then(() => {
                    toast.success(t('toast.stash.saved')); refreshStatus(currentRepo.path);
                  }).catch((e) => toast.error(t('toast.stash.failed'), String(e)));
                }} disabled={disabled} title={t('action.title.saveStash')} />
                {/* Pop stash icon: a box with an upward arrow coming out of it
                    (custom StashPop icon). Previously GitPullRequest (PR icon,
                    misleading), then Upload (just an arrow, ambiguous).
                    StashPop clearly communicates "lift changes back out of the
                    stash box into the working tree". */}
                <LabeledButton icon={StashPop} label={t('action.button.pop')} iconColor={COLOR_PURPLE} onClick={() => {
                  if (!currentRepo) return;
                  api.git.stashList(currentRepo.path).then(stashes => {
                    if (stashes.length === 0) { toast.info(t('toast.stash.none')); return; }
                    useOperationLogStore.getState().logOperation(
                      t('action.button.pop'), currentRepo.path, 'git stash pop stash@{0}',
                      () => api.git.stashPop(currentRepo.path, 0)
                    ).then(() => {
                      toast.success(t('toast.stash.popped')); refreshStatus(currentRepo.path);
                    }).catch((e) => toast.error(t('toast.stash.popFailed'), String(e)));
                  });
                }} disabled={disabled} title={t('action.title.popStash')} />
                <Divider />
              </div>
            );
          case 'log':
            return (
              <div key={key} className="flex items-center">
                <LabeledButton icon={GitBranch} label={t('action.button.history')} iconColor={COLOR_BLUE} onClick={() => navigate('/history')} disabled={disabled} title={t('action.title.commitHistory')} active={currentPath === '/history'} />
                <LabeledButton icon={FileText} label={t('action.button.diff')} iconColor={COLOR_BLUE} onClick={() => navigate('/diff')} disabled={disabled} title={t('action.title.compareFiles')} active={currentPath === '/diff'} />
                <LabeledButton icon={Search} label={t('action.button.blame')} iconColor={COLOR_BLUE} onClick={() => navigate('/blame')} disabled={disabled} title={t('action.title.blameFile')} active={currentPath === '/blame'} />
                <Divider />
              </div>
            );
          case 'workflows':
            return (
              <div key={key} className="flex items-center">
                <LabeledButton icon={GitMerge} label={t('nav.gitflow', { defaultValue: 'Git-Flow' })} iconColor={COLOR_ORANGE} onClick={() => onGitFlow && onGitFlow()} disabled={disabled} title={t('action.title.gitFlow')} />
                <LabeledButton icon={RotateCcw} label={t('action.button.rebase')} iconColor={COLOR_ORANGE} onClick={() => onInteractiveRebase && onInteractiveRebase()} disabled={disabled} title={t('action.title.interactiveRebase')} />
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
