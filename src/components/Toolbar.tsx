import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type BranchInfo, type RemoteInfo } from '../lib/api';
import { describePushResult } from '../lib/pushResult';
import { cn } from '../lib/utils';
import { useGitStore } from '../stores/gitStore';
import { useOperationLogStore } from '../stores/operationLogStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastStore } from '../stores/toastStore';
import { DEFAULT_TOOLBAR_GROUPS, useToolbarStore, type ToolbarGroupKey, type ToolbarGroups } from '../stores/toolbarStore';
import { confirmDialog } from './ConfirmDialog';
import { getRepoInProgressState, isRepoBusy } from '../lib/repoState';
import { useI18n } from '../lib/i18n';
import { AlertCircle, ArrowDown, ArrowUp, ChevronDown, CloudDownload, Download, ExternalLink, EyeOff, FileText, Folder, GitBranch, GitMerge, GitPullRequest, Keyboard, Loader, Minus, Moon, Plus, RefreshCw, RotateCcw, Search, Settings as SettingsIcon, Star, Sun, Terminal, Trash } from './icons';

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
    <div className="flex items-center no-drag flex-shrink-0">
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
  onGitFlow?: () => void;
  onInteractiveRebase?: () => void;
  onRepoInfo?: () => void;
  onShowShortcuts?: () => void;
  onShowClone?: () => void;
  onToggleCommandLog?: () => void;
  onShowInit?: () => void;
}

export function Toolbar({ onFind, onGitFlow, onInteractiveRebase, onRepoInfo, onShowShortcuts, onShowClone, onShowInit, onToggleCommandLog }: ToolbarProps = {}) {
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const currentMetadata = useRepositoryStore((s) => s.currentMetadata);
  const status = useGitStore((s) => s.status);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);
  const fetch = useGitStore((s) => s.fetch);
  const toast = useToastStore();
  const theme = useSettingsStore((s) => s.theme);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
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
    catch (e) { toast.error(t('shell.pushFailed'), String(e)); }
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
    } catch (e) { toast.error(t('shell.synchronizeFailed'), String(e)); }
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
      className="flex items-center h-10 bg-bg-tertiary border-b border-border-default flex-shrink-0 select-none titlebar-drag"
    >
      {/* App name + repo management buttons (left) */}
      <div className="flex items-center gap-2 px-3 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-purple) 100%)' }}>
            <GitBranch size={11} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-xs font-bold text-text-primary tracking-tight">PrismGit</span>
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
            <IconButton icon={Search} onClick={() => onFind && onFind()} disabled={disabled} title={t('shell.findObject')} />
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
        <IconButton
          icon={Keyboard}
          onClick={() => onShowShortcuts && onShowShortcuts()}
          title={t('shell.keyboardShortcutsTooltip')}
        />
        <IconButton
          icon={theme === 'dark' ? Sun : Moon}
          onClick={() => toggleTheme()}
          title={theme === 'dark' ? t('shell.switchToLightTheme') : t('shell.switchToDarkTheme')}
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
 *   - [✓] Force push (--force-with-lease)
 *   - Push tags
 */
function PushDropdown({ disabled }: { disabled: boolean }) {
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const toast = useToastStore();
  const refreshStatus = useGitStore((s) => s.refreshStatus);
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
  const [pushTags, setPushTags] = useState(false);

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
      // Default to the globally selected branch (from Branches page) when it
      // exists locally, otherwise the current branch. Auto -u when the chosen
      // branch has no upstream yet.
      const globallySelected = useSelectionStore.getState().selectedBranch;
      const chosen = globallySelected && brs.some(b => b.name === globallySelected && !b.remote)
        ? brs.find(b => b.name === globallySelected)
        : brs.find(b => b.current);
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
    const cmd = `git push ${selectedRemote} ${refspec} ${setUpstream ? '-u' : ''} ${force ? '--force-with-lease' : ''} ${pushTags ? '--tags' : ''}`.trim();
    try {
      const res = await useOperationLogStore.getState().logOperation(
        `Push ${b || 'current'} → ${selectedRemote}${remoteBranch.trim() ? '/' + remoteBranch.trim() : ''}${force ? ' (force)' : ''}${pushTags ? ' +tags' : ''}`,
        currentRepo.path, cmd,
        async () => {
          // When using HEAD:remoteBranch, we need to pass the refspec directly.
          // api.git.push takes `branch` as a simple name — but HEAD:main is a refspec.
          // So we pass refspec as the branch parameter; git push handles it correctly.
          const r = await api.git.push(currentRepo.path, selectedRemote, refspec, setUpstream && !remoteBranch.trim(), force, pushTags);
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
      toast.error(t('shell.pushFailed'), String(e));
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
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                    <span className="text-status-deleted">{t('shell.forcePush')}</span>
                  </label>
                </div>
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
  const toast = useToastStore();
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
  const loadRemoteBranches = useCallback(async () => {
    if (!currentRepo || !selectedRemote) { setRemoteBranches([]); return; }
    try {
      const brs = await api.git.branches(currentRepo.path);
      const prefix = `${selectedRemote}/`;
      const rem = brs.filter(b => b.remote && b.name.startsWith(prefix));
      setRemoteBranches(rem);
      // Default: remote branch matching the GLOBALLY selected branch (from
      // Branches/History — the pull target follows the app-wide selection),
      // then upstream-tracking of the CURRENT branch, then the first branch.
      setSelectedBranch(prev => {
        if (prev && rem.some(b => b.name === prev)) return prev;
        const globallySelected = useSelectionStore.getState().selectedBranch;
        const gMatch = globallySelected
          ? rem.find(r => r.name === `${prefix}${globallySelected}`)
          : undefined;
        if (gMatch) return gMatch.name;
        const cur = brs.find(b => b.current);
        const match = cur ? rem.find(r => r.name === `${prefix}${cur.name}`) : undefined;
        return match?.name || rem[0]?.name || '';
      });
    } catch { setRemoteBranches([]); }
  }, [currentRepo, selectedRemote]);
  useEffect(() => { loadRemoteBranches(); }, [loadRemoteBranches, open]);

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
      // Don't crash — show error, let user resolve conflicts via ConflictSolver
      const msg = String(e);
      if (msg.includes('CONFLICT') || msg.includes('conflict')) {
        toast.warning(t('shell.pullConflicts'), t('shell.useResolveConflicts'));
        refreshStatus(currentRepo.path);
      } else {
        toast.error(t('shell.pullFailed'), msg);
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
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const status = useGitStore((s) => s.status);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);
  const fetch = useGitStore((s) => s.fetch);
  const toast = useToastStore();
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
  const isInProgress = !!(status?.isMerging || status?.isRebasing || status?.isCherryPicking || status?.isReverting);

  // SmartGit: while a sequencer state (merge / rebase / cherry-pick / revert /
  // bisect) is active, Pull is NOT allowed — only Fetch / Fetch All remain
  // available (they never touch the working tree or HEAD).
  const repoState = getRepoInProgressState(status);
  const pullBlocked = repoState
    ? `${repoState.pullReason} — ${repoState.blockedHint}`
    : undefined;
  const isBusy = isRepoBusy(status);

  const handlePush = async () => {
    if (!currentRepo) return;
    try {
      await useOperationLogStore.getState().logOperation(
        'Push', currentRepo.path, 'git push',
        () => push(currentRepo.path)
      );
      toast.success('Pushed successfully');
    } catch (e) { toast.error('Push failed', String(e)); }
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
    } catch (e) {
      const msg = String(e);
      if (msg.includes('CONFLICT') || msg.includes('conflict')) {
        toast.warning('Pull resulted in conflicts', 'Use "Resolve Conflicts" button');
        refreshStatus(currentRepo.path);
      } else {
        toast.error('Pull failed', msg);
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
  const hasConflicts = status?.conflicted && status.conflicted.length > 0;
  const handleResolveConflicts = () => {
    if (status?.conflicted && status.conflicted.length > 0) {
      // Navigate to Changes and trigger conflict solver on first conflicted file
      navigate('/changes');
      // Set a global event that ChangesPage picks up
      window.dispatchEvent(new CustomEvent('smartgit:resolve-conflict', {
        detail: { file: status.conflicted[0] }
      }));
    }
  };

  return (
    <div className="flex items-center h-9 bg-bg-secondary border-b border-border-default flex-shrink-0 no-drag px-2 gap-0.5">
      {/* Conflict resolution button — only shown when conflicts exist */}
      {hasConflicts && (
        <>
          <button
            className="flex items-center gap-1.5 px-3 h-8 rounded-md transition-colors no-drag text-xs bg-status-conflict/15 text-status-conflict border border-status-conflict/40 hover:bg-status-conflict/25 font-medium animate-pulse"
            onClick={handleResolveConflicts}
            title={`${status?.conflicted?.length || 0} conflicted file(s) — click to resolve`}
          >
            <AlertCircle size={14} />
            <span>Resolve {status?.conflicted?.length || 0} Conflicts</span>
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
                <LabeledButton icon={Plus} label="Stage" iconColor={COLOR_GREEN} onClick={() => currentRepo && useGitStore.getState().stageAll(currentRepo.path)} disabled={disabled} title="Stage all changes" />
                <LabeledButton icon={Minus} label="Unstage" iconColor={COLOR_ORANGE} onClick={() => {
                  if (!currentRepo) return;
                  useOperationLogStore.getState().logOperation(
                    'Unstage All', currentRepo.path, 'git reset HEAD -- .',
                    () => api.git.raw(currentRepo.path, ['reset', 'HEAD', '--', '.'])
                  ).then(() => refreshStatus(currentRepo.path))
                   .catch((e) => toast.error('Unstage failed', String(e)));
                }} disabled={disabled} title="Unstage all changes" />
                <LabeledButton icon={Trash} label="Discard" iconColor={COLOR_RED} onClick={() => {
                  if (!currentRepo) return;
                  void confirmDialog({
                    title: 'Discard ALL uncommitted changes?',
                    message: 'This will permanently discard all staged and unstaged changes.\nThis cannot be undone.',
                    confirmLabel: 'Discard All',
                    danger: true,
                  }).then((ok) => {
                    if (!ok) return;
                    useOperationLogStore.getState().logOperation(
                      'Discard All', currentRepo.path, 'git checkout -- . && git clean -fd',
                      async () => {
                        await api.git.raw(currentRepo.path, ['checkout', '--', '.']);
                        await api.git.raw(currentRepo.path, ['clean', '-fd']);
                        await refreshStatus(currentRepo.path);
                      }
                    ).then(() => toast.success('Changes discarded'))
                     .catch((e) => toast.error('Discard failed', String(e)));
                  });
                }} disabled={disabled || isInProgress} title={isInProgress ? 'Blocked — finish the in-progress operation first' : 'Discard all changes'} />
                <Divider />
              </div>
            );
          case 'stash':
            return (
              <div key={key} className="flex items-center">
                <LabeledButton icon={CloudDownload} label="Stash" iconColor={COLOR_PURPLE} onClick={() => {
                  if (!currentRepo) return;
                  useOperationLogStore.getState().logOperation(
                    'Stash', currentRepo.path, 'git stash push -u',
                    () => api.git.stashPush(currentRepo.path, undefined, true)
                  ).then(() => {
                    toast.success('Stash saved'); refreshStatus(currentRepo.path);
                  }).catch((e) => toast.error('Stash failed', String(e)));
                }} disabled={disabled} title="Save stash" />
                <LabeledButton icon={GitPullRequest} label="Pop" iconColor={COLOR_PURPLE} onClick={() => {
                  if (!currentRepo) return;
                  api.git.stashList(currentRepo.path).then(stashes => {
                    if (stashes.length === 0) { toast.info('No stashes'); return; }
                    useOperationLogStore.getState().logOperation(
                      'Stash Pop', currentRepo.path, 'git stash pop stash@{0}',
                      () => api.git.stashPop(currentRepo.path, 0)
                    ).then(() => {
                      toast.success('Stash popped'); refreshStatus(currentRepo.path);
                    }).catch((e) => toast.error('Pop failed', String(e)));
                  });
                }} disabled={disabled} title="Pop latest stash (apply + drop)" />
                <Divider />
              </div>
            );
          case 'log':
            return (
              <div key={key} className="flex items-center">
                <LabeledButton icon={GitBranch} label="History" iconColor={COLOR_BLUE} onClick={() => navigate('/history')} disabled={disabled} title="Commit history" active={currentPath === '/history'} />
                <LabeledButton icon={FileText} label="Diff" iconColor={COLOR_BLUE} onClick={() => navigate('/diff')} disabled={disabled} title="Compare files between refs" active={currentPath === '/diff'} />
                <LabeledButton icon={Search} label="Blame" iconColor={COLOR_BLUE} onClick={() => navigate('/blame')} disabled={disabled} title="Blame a file" active={currentPath === '/blame'} />
                <Divider />
              </div>
            );
          case 'workflows':
            return (
              <div key={key} className="flex items-center">
                <LabeledButton icon={GitMerge} label="Git-Flow" iconColor={COLOR_ORANGE} onClick={() => onGitFlow && onGitFlow()} disabled={disabled} title="Git-Flow operations" />
                <LabeledButton icon={RotateCcw} label="Rebase" iconColor={COLOR_ORANGE} onClick={() => onInteractiveRebase && onInteractiveRebase()} disabled={disabled} title="Interactive rebase" />
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
