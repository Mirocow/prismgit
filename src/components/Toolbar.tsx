import { RefreshCw, GitBranch, ArrowUp, ArrowDown, GitCommit, GitPullRequest, CloudDownload, Sync, ExternalLink, Folder, AlertCircle, Search, Sun, Moon, GitMerge, RotateCcw, Star, Plus, Minus, Trash } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { useSettingsStore } from '../stores/settingsStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

// Window control buttons — frameless window
function WindowControls() {
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
        title="Minimize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4.5" width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button
        className="flex items-center justify-center w-11 h-9 hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-text-secondary"
        onClick={handleMaximize}
        title="Maximize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button
        className="flex items-center justify-center w-11 h-9 hover:bg-red-500 hover:text-white transition-colors text-text-secondary"
        onClick={handleClose}
        title="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0,0 L10,10 M10,0 L0,10" stroke="currentColor" strokeWidth="1.2" /></svg>
      </button>
    </div>
  );
}

interface ToolbarProps {
  onFind?: () => void;
  onGitFlow?: () => void;
  onInteractiveRebase?: () => void;
  onRepoInfo?: () => void;
}

export function Toolbar({ onFind, onGitFlow, onInteractiveRebase, onRepoInfo }: ToolbarProps = {}) {
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

  const disabled = !currentRepo;

  const handlePush = async () => {
    if (!currentRepo) return;
    try { await push(currentRepo.path); toast.success('Pushed successfully'); }
    catch (e) { toast.error('Push failed', String(e)); }
  };
  const handlePull = async () => {
    if (!currentRepo) return;
    try { await pull(currentRepo.path); toast.success('Pulled successfully'); }
    catch (e) { toast.error('Pull failed', String(e)); }
  };
  const handleSynchronize = async () => {
    if (!currentRepo) return;
    try {
      await fetch(currentRepo.path, undefined, true);
      await pull(currentRepo.path);
      await push(currentRepo.path);
      toast.success('Synchronized successfully');
    } catch (e) { toast.error('Synchronize failed', String(e)); }
  };
  const handleOpenInBrowser = async () => {
    if (!currentRepo) return;
    try {
      const info = await api.git.extractRepoInfo(currentRepo.path);
      if (info.webUrl && info.provider !== 'unknown') { api.app.openExternal(info.webUrl); }
      else { toast.info('Repository has no remote URL'); }
    } catch (e) { toast.error('Failed to open in browser', String(e)); }
  };
  const handleRevealInFileManager = async () => {
    if (!currentRepo) return;
    try { await api.git.revealInFileManager(currentRepo.path); }
    catch (e) { toast.error('Failed to reveal in file manager', String(e)); }
  };

  const isInProgress = status?.isMerging || status?.isRebasing || status?.isCherryPicking || status?.isReverting;
  const isBisecting = status?.isBisecting;

  // Compact icon-only button
  const IconButton = ({ icon: Icon, onClick, disabled, title }: {
    icon: typeof RefreshCw; onClick: () => void; disabled?: boolean; title: string;
  }) => (
    <button
      className="flex items-center justify-center w-7 h-7 rounded hover:bg-bg-hover transition-colors no-drag disabled:opacity-30 disabled:cursor-not-allowed text-text-secondary hover:text-text-primary"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <Icon size={15} />
    </button>
  );

  const Divider = () => <div className="w-px h-5 bg-border-subtle mx-1.5" />;

  return (
    <header
      className="flex items-center h-9 bg-bg-tertiary border-b border-border-default flex-shrink-0 select-none titlebar-drag"
    >
      {/* App name (left, like Ollama Code) */}
      <div className="flex items-center gap-2 px-3 flex-shrink-0">
        <span className="text-xs font-semibold text-accent">SmartGit</span>
        {currentRepo && (
          <>
            <span className="text-text-tertiary text-xs">/</span>
            <span className="text-xs text-text-secondary">{currentRepo.name}</span>
          </>
        )}
      </div>

      <Divider />

      {/* Git action buttons — compact, icon-only */}
      <div className="flex items-center no-drag">
        <IconButton icon={ArrowDown} onClick={handlePull} disabled={disabled} title="Pull" />
        <IconButton icon={Sync} onClick={handleSynchronize} disabled={disabled} title="Sync (fetch+pull+push)" />
        <IconButton icon={ArrowUp} onClick={handlePush} disabled={disabled} title="Push" />

        <Divider />

        <IconButton icon={Plus} onClick={() => currentRepo && useGitStore.getState().stageAll(currentRepo.path)} disabled={disabled} title="Stage All" />
        <IconButton icon={Minus} onClick={() => currentRepo && api.git.raw(currentRepo.path, ['reset', 'HEAD', '--', '.'])} disabled={disabled} title="Unstage All" />
        <IconButton icon={Trash} onClick={() => {
          if (!currentRepo || !confirm('Discard all uncommitted changes?')) return;
          api.git.raw(currentRepo.path, ['checkout', '--', '.']).then(() => {
            toast.success('Changes discarded'); refreshStatus(currentRepo.path);
          }).catch((e) => toast.error('Discard failed', String(e)));
        }} disabled={disabled} title="Discard All" />

        <Divider />

        <IconButton icon={CloudDownload} onClick={() => {
          if (!currentRepo) return;
          api.git.stashPush(currentRepo.path, undefined, true).then(() => {
            toast.success('Stash saved'); refreshStatus(currentRepo.path);
          }).catch((e) => toast.error('Stash failed', String(e)));
        }} disabled={disabled} title="Save Stash" />
        <IconButton icon={GitPullRequest} onClick={() => {
          if (!currentRepo) return;
          api.git.stashList(currentRepo.path).then(stashes => {
            if (stashes.length === 0) { toast.info('No stashes'); return; }
            api.git.stashApply(currentRepo.path, 0).then(() => {
              toast.success('Stash applied'); refreshStatus(currentRepo.path);
            }).catch((e) => toast.error('Apply failed', String(e)));
          });
        }} disabled={disabled} title="Apply Stash" />

        <Divider />

        <IconButton icon={GitBranch} onClick={() => { window.location.hash = '#/history'; }} disabled={disabled} title="Log" />
        <IconButton icon={Search} onClick={() => { window.location.hash = '#/blame'; }} disabled={disabled} title="Blame" />
        <IconButton icon={Search} onClick={() => { window.location.hash = '#/investigate'; }} disabled={disabled} title="Investigate" />

        <Divider />

        <IconButton icon={GitMerge} onClick={() => onGitFlow && onGitFlow()} disabled={disabled} title="Git-Flow" />
        <IconButton icon={RotateCcw} onClick={() => onInteractiveRebase && onInteractiveRebase()} disabled={disabled} title="Rebase" />
      </div>

      {/* Center: branch info (draggable area) */}
      <div className="flex-1 flex items-center justify-center titlebar-drag">
        {currentRepo && status ? (
          <div className="flex items-center gap-2 text-xs">
            {isInProgress && (
              <span className="badge badge-modified flex items-center gap-1 animate-pulse">
                <AlertCircle size={9} />
                {status.isMerging ? 'MERGING' : status.isRebasing ? 'REBASING' : 'CHERRY-PICK'}
              </span>
            )}
            {isBisecting && (
              <span className="badge badge-modified flex items-center gap-1">
                <AlertCircle size={9} /> BISECTING
              </span>
            )}
            <div className="flex items-center gap-1 text-text-secondary">
              <GitBranch size={11} />
              <span className="font-medium text-text-primary">{status.current || 'HEAD'}</span>
            </div>
            {status.tracking && <span className="text-text-tertiary">→ {status.tracking}</span>}
            {(status.ahead > 0 || status.behind > 0) && (
              <div className="flex items-center gap-1.5">
                {status.ahead > 0 && (
                  <span className="flex items-center gap-0.5 text-status-added">
                    <ArrowUp size={10} />{status.ahead}
                  </span>
                )}
                {status.behind > 0 && (
                  <span className="flex items-center gap-0.5 text-status-modified">
                    <ArrowDown size={10} />{status.behind}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Right: utility buttons */}
      <div className="flex items-center gap-0.5 no-drag pr-2">
        <IconButton icon={Star} onClick={() => onRepoInfo && onRepoInfo()} disabled={disabled} title="Repository Info" />
        <IconButton icon={Search} onClick={() => onFind && onFind()} disabled={disabled} title="Find Object (Ctrl+F)" />
        <IconButton icon={ExternalLink} onClick={handleOpenInBrowser} disabled={disabled} title="Open in Browser" />
        <IconButton icon={Folder} onClick={handleRevealInFileManager} disabled={disabled} title="Reveal in File Manager" />
        <Divider />
        <IconButton
          icon={theme === 'dark' ? Sun : Moon}
          onClick={() => toggleTheme()}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        />
      </div>

      {/* Window controls (frameless) — minimize, maximize, close */}
      <WindowControls />
    </header>
  );
}
