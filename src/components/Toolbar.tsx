import { RefreshCw, GitBranch, ArrowUp, ArrowDown, GitCommit, GitPullRequest, CloudDownload, Sync, ExternalLink, Folder, AlertCircle, Search, Sun, Moon, GitMerge, RotateCcw, Star, Plus, Minus, Trash, EyeOff } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { useSettingsStore } from '../stores/settingsStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

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

  const handleRefresh = () => {
    if (!currentRepo) return;
    refreshStatus(currentRepo.path);
  };

  const handlePush = async () => {
    if (!currentRepo) return;
    try {
      await push(currentRepo.path);
      toast.success('Pushed successfully');
    } catch (e) {
      toast.error('Push failed', String(e));
    }
  };

  const handlePull = async () => {
    if (!currentRepo) return;
    try {
      await pull(currentRepo.path);
      toast.success('Pulled successfully');
    } catch (e) {
      toast.error('Pull failed', String(e));
    }
  };

  const handleFetch = async () => {
    if (!currentRepo) return;
    try {
      await fetch(currentRepo.path, undefined, true);
      toast.success('Fetch completed');
    } catch (e) {
      toast.error('Fetch failed', String(e));
    }
  };

  const handleSynchronize = async () => {
    if (!currentRepo) return;
    try {
      await fetch(currentRepo.path, undefined, true);
      await pull(currentRepo.path);
      await push(currentRepo.path);
      toast.success('Synchronized successfully');
    } catch (e) {
      toast.error('Synchronize failed', String(e));
    }
  };

  const handleOpenInBrowser = async () => {
    if (!currentRepo) return;
    try {
      const info = await api.git.extractRepoInfo(currentRepo.path);
      if (info.webUrl && info.provider !== 'unknown') {
        api.app.openExternal(info.webUrl);
      } else {
        toast.info('Repository has no remote URL');
      }
    } catch (e) {
      toast.error('Failed to open in browser', String(e));
    }
  };

  const handleRevealInFileManager = async () => {
    if (!currentRepo) return;
    try {
      await api.git.revealInFileManager(currentRepo.path);
    } catch (e) {
      toast.error('Failed to reveal in file manager', String(e));
    }
  };

  const isInProgress = status?.isMerging || status?.isRebasing || status?.isCherryPicking || status?.isReverting;
  const isBisecting = status?.isBisecting;

  // Toolbar button with text label below icon (SmartGit style)
  const ToolButton = ({ icon: Icon, label, onClick, disabled, title }: {
    icon: typeof RefreshCw; label: string; onClick: () => void; disabled?: boolean; title?: string;
  }) => (
    <button
      className="flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded hover:bg-bg-hover transition-colors no-drag disabled:opacity-40 disabled:cursor-not-allowed"
      onClick={onClick}
      disabled={disabled}
      title={title || label}
    >
      <Icon size={16} />
      <span className="text-2xs text-text-secondary">{label}</span>
    </button>
  );

  const Divider = () => <div className="w-px h-8 bg-border-default mx-1" />;

  return (
    <header className="titlebar-drag flex items-center px-2 h-12 bg-bg-tertiary border-b border-border-default flex-shrink-0">
      {/* Pull / Sync / Push group */}
      <div className="flex items-center no-drag">
        <ToolButton icon={ArrowDown} label="Pull" onClick={handlePull} disabled={disabled} />
        <ToolButton icon={Sync} label="Sync" onClick={handleSynchronize} disabled={disabled} title="Synchronize (fetch + pull + push)" />
        <ToolButton icon={ArrowUp} label="Push" onClick={handlePush} disabled={disabled} />
      </div>

      <Divider />

      {/* Stage / Unstage / Discard group */}
      <div className="flex items-center no-drag">
        <ToolButton icon={Plus} label="Stage" onClick={() => currentRepo && useGitStore.getState().stageAll(currentRepo.path)} disabled={disabled} title="Stage all changes" />
        <ToolButton icon={Minus} label="Unstage" onClick={() => currentRepo && api.git.raw(currentRepo.path, ['reset', 'HEAD', '--', '.'])} disabled={disabled} title="Unstage all" />
        <ToolButton icon={Trash} label="Discard" onClick={() => {
          if (!currentRepo || !confirm('Discard all uncommitted changes? This cannot be undone.')) return;
          api.git.raw(currentRepo.path, ['checkout', '--', '.']).then(() => {
            toast.success('Changes discarded');
            refreshStatus(currentRepo.path);
          }).catch((e) => toast.error('Discard failed', String(e)));
        }} disabled={disabled} title="Discard all changes" />
      </div>

      <Divider />

      {/* Stash group */}
      <div className="flex items-center no-drag">
        <ToolButton icon={CloudDownload} label="Save Stash" onClick={() => {
          if (!currentRepo) return;
          api.git.stashPush(currentRepo.path, undefined, true).then(() => {
            toast.success('Stash saved');
            refreshStatus(currentRepo.path);
          }).catch((e) => toast.error('Stash failed', String(e)));
        }} disabled={disabled} />
        <ToolButton icon={GitPullRequest} label="Apply Stash" onClick={() => {
          if (!currentRepo) return;
          api.git.stashList(currentRepo.path).then(stashes => {
            if (stashes.length === 0) {
              toast.info('No stashes available');
              return;
            }
            api.git.stashApply(currentRepo.path, 0).then(() => {
              toast.success('Stash applied');
              refreshStatus(currentRepo.path);
            }).catch((e) => toast.error('Apply failed', String(e)));
          });
        }} disabled={disabled} />
      </div>

      <Divider />

      {/* Log / Blame / Investigate group */}
      <div className="flex items-center no-drag">
        <ToolButton icon={GitBranch} label="Log" onClick={() => { window.location.hash = '#/history'; }} disabled={disabled} title="Open History/Log" />
        <ToolButton icon={Search} label="Blame" onClick={() => { window.location.hash = '#/blame'; }} disabled={disabled} />
        <ToolButton icon={Search} label="Investigate" onClick={() => { window.location.hash = '#/investigate'; }} disabled={disabled} />
      </div>

      <Divider />

      {/* Git-Flow / Merge / Rebase group */}
      <div className="flex items-center no-drag">
        <ToolButton icon={GitMerge} label="Git-Flow" onClick={() => onGitFlow && onGitFlow()} disabled={disabled} />
        <ToolButton icon={GitMerge} label="Merge" onClick={() => { window.location.hash = '#/branches'; }} disabled={disabled} />
        <ToolButton icon={RotateCcw} label="Rebase" onClick={() => onInteractiveRebase && onInteractiveRebase()} disabled={disabled} />
      </div>

      {/* Center: branch info */}
      <div className="flex-1 flex items-center justify-center no-drag">
        {currentRepo && status ? (
          <div className="flex items-center gap-3 text-xs">
            {isInProgress && (
              <span className="badge badge-modified flex items-center gap-1 animate-pulse">
                <AlertCircle size={10} />
                {status.isMerging ? 'MERGING' : status.isRebasing ? 'REBASING' : status.isCherryPicking ? 'CHERRY-PICKING' : 'REVERTING'}
              </span>
            )}
            {isBisecting && (
              <span className="badge badge-modified flex items-center gap-1">
                <AlertCircle size={10} />
                BISECTING
              </span>
            )}
            <div className="flex items-center gap-1 text-text-secondary">
              <GitBranch size={12} />
              <span className="font-medium text-text-primary">
                {status.current || (status.detached ? 'DETACHED' : 'HEAD')}
              </span>
            </div>
            {status.tracking && (
              <span className="text-text-tertiary">→ {status.tracking}</span>
            )}
            {(status.ahead > 0 || status.behind > 0) && (
              <div className="flex items-center gap-2">
                {status.ahead > 0 && (
                  <span className="flex items-center gap-0.5 text-status-added">
                    <ArrowUp size={11} />
                    {status.ahead}
                  </span>
                )}
                {status.behind > 0 && (
                  <span className="flex items-center gap-0.5 text-status-modified">
                    <ArrowDown size={11} />
                    {status.behind}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-text-tertiary">SmartGit Electron</div>
        )}
      </div>

      {/* Right: utility buttons */}
      <div className="flex items-center gap-1 no-drag">
        <button
          className="icon-btn"
          title="Repository info"
          onClick={() => onRepoInfo && onRepoInfo()}
          disabled={disabled}
        >
          <Star size={14} className={currentMetadata?.favorite ? 'text-status-modified fill-current' : ''} />
        </button>
        <button
          className="icon-btn"
          title="Find object (Ctrl+F)"
          onClick={() => onFind && onFind()}
          disabled={disabled}
        >
          <Search size={14} />
        </button>
        <button
          className="icon-btn"
          title="Open in browser"
          onClick={handleOpenInBrowser}
          disabled={disabled}
        >
          <ExternalLink size={14} />
        </button>
        <button
          className="icon-btn"
          title="Reveal in file manager"
          onClick={handleRevealInFileManager}
          disabled={disabled}
        >
          <Folder size={14} />
        </button>
        <div className="w-px h-5 bg-border-default mx-1" />
        <button
          className="icon-btn"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme (Ctrl+Shift+T)`}
          onClick={() => toggleTheme()}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </header>
  );
}
