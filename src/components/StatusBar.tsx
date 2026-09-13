import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { useOperationLogStore } from '../stores/operationLogStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { memo, useEffect, useState, useCallback } from 'react';
import { ArrowUp, ArrowDown, Loader, ChevronUp, ChevronDown } from './icons';
import { FooterCounters } from './FooterCounters';
import { useContextMenu } from '../lib/useContextMenu';
import { buildHashMenu, runHashMenuAction } from '../lib/commitMenu';
import { describePushResult } from '../lib/pushResult';
import { useI18n } from '../lib/i18n';

/**
 * Clickable commit hash — clicking jumps to History and focuses that commit.
 * Used everywhere (StatusBar, Tags, Reflog, Stashes, journal, detail panel) for
 * cross-tool navigation.
 *
 * Implementation notes:
 * - Sets selectedCommitHash in global store (History subscribes to it)
 * - Navigates to /history via window.location.hash (only if not already there)
 * - History's useEffect on selectedCommitHash will auto-scroll to the commit
 *   if it's already in the loaded list, otherwise the next loadHistory() will
 *   include it (or user can search by hash)
 * - Right-click opens a context menu (Copy Short/Full Hash, View in History,
 *   Open in Browser) — "right-click must work on every UI element"
 * - Pass `plain` for the compact in-row look (no badge chrome)
 */
export const CommitHashLink = memo(function CommitHashLink({ hash, short = true, className, plain = false, display }: {
  hash: string;
  short?: boolean;
  className?: string;
  /** Compact flat style for dense rows (History list). */
  plain?: boolean;
  /** Override the visible text (e.g. git's own abbrev length). */
  display?: string;
}) {
  const selectCommit = useSelectionStore((s) => s.selectCommit);
  const repo = useRepositoryStore((s) => s.currentRepo);
  const showContextMenu = useContextMenu();
  const { t } = useI18n();
  const handleClick = useCallback((e: React.MouseEvent) => {
    // Don't let the row's own click handler also fire — the hash targets its
    // own commit (same behavior as clicking a parent hash in PARENTS).
    e.stopPropagation();
    // Set global selection FIRST — History's useEffect will pick this up
    // and scroll to the commit if it's already loaded, or trigger a reload.
    selectCommit(hash);
    if (!window.location.hash.startsWith('#/history')) {
      window.location.hash = '#/history';
    }
  }, [hash, selectCommit]);
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(buildHashMenu({ hash, repoPath: repo?.path }), (id) =>
      runHashMenuAction(id, { hash, repoPath: repo?.path }));
  }, [hash, repo, showContextMenu]);
  const displayText = display ?? (short ? hash.substring(0, 7) : hash);
  return (
    <code
      className={cn(
        plain
          ? 'font-mono text-2xs cursor-pointer hover:text-accent transition-colors'
          : 'font-mono text-2xs px-1 py-0.5 rounded bg-bg-tertiary border border-border-subtle cursor-pointer hover:bg-accent-muted hover:border-accent hover:text-accent transition-colors',
        className,
      )}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={t('shell.clickToViewCommit', { hash })}
    >
      {displayText}
    </code>
  );
});

export function StatusBar({
  showCommandLog,
  onToggleCommandLog,
}: {
  showCommandLog?: boolean;
  onToggleCommandLog?: () => void;
}) {
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const status = useGitStore((s) => s.status);
  const lastRefresh = useGitStore((s) => s.lastRefresh);
  // Global selected commit — visible from anywhere in the app
  const selectedCommitHash = useSelectionStore((s) => s.selectedCommitHash);
  const selectCommit = useSelectionStore((s) => s.selectCommit);
  const toast = useToastActions();
  const { t } = useI18n();
  // Task 18 — VSCode-style footer display settings.
  const footerVisible = useSettingsStore((s) => s.settings.footerVisible);
  const vis = (k: 'head' | 'inProgress' | 'selectedCommit' | 'stagedChanged' | 'aheadBehind' | 'updatedAt' | 'outputToggle') =>
    (footerVisible ?? {})[k] !== false;
  // Running operations — show a spinner + progress in the status bar
  const runningIds = useOperationLogStore((s) => s.runningIds);
  const ops = useOperationLogStore((s) => s.ops);
  const runningCount = runningIds.size;
  const currentRunningOp = ops.find((o) => runningIds.has(o.id));

  // HEAD commit hash — fetch once when branch changes
  const [headHash, setHeadHash] = useState<string | null>(null);
  useEffect(() => {
    if (!currentRepo || !status?.current) {
      setHeadHash(null);
      return;
    }
    api.git.revParse(currentRepo.path, 'HEAD')
      .then(h => setHeadHash(h.trim()))
      .catch(() => setHeadHash(null));
  }, [currentRepo, status?.current]);

  if (!currentRepo) {
    return (
      <footer className="h-7 bg-bg-tertiary border-t border-border-default flex items-center justify-between px-3 text-2xs text-text-tertiary flex-shrink-0">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-status-success inline-block" />
          {t('shell.ready')}
        </span>
        <span className="flex items-center gap-3">
          <span className="hidden sm:inline">
            {t('shell.pressPrefix')} <kbd>Ctrl</kbd>+<kbd>?</kbd> {t('shell.shortcutsSuffix')}
          </span>
          <span className="font-mono">PrismGit v2.0</span>
        </span>
      </footer>
    );
  }

  const changed = status?.files.length ?? 0;
  const staged = status?.staged.length ?? 0;

  return (
    <footer className="h-7 bg-bg-tertiary border-t border-border-default flex items-center justify-between px-3 text-2xs text-text-tertiary flex-shrink-0">
      <div className="flex items-center gap-3">
        {/* HEAD indicator — always visible, shows where you are.
            Bright accent background + ">" makes the current branch
            unmistakable from across the screen. */}
        {vis('head') && status?.current && headHash && (
          <span className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-accent-muted border border-accent/40" title={t('shell.currentHead')}>
            <span className="text-accent font-bold">{'>'}</span>
            <span className="text-accent font-semibold">{status.current}</span>
            <span className="text-text-tertiary">·</span>
            <CommitHashLink hash={headHash} />
          </span>
        )}
        {/* In-progress operation indicator — bright warning so the user
            knows the working tree is in a special state and destructive
            operations are blocked. Clicking it jumps to Changes where the
            SequencerPanel / MergePanel / RebasePanel banners live. */}
        {vis('inProgress') && (() => {
          const m = status?.isMerging, r = status?.isRebasing, c = status?.isCherryPicking, v = status?.isReverting, b = status?.isBisecting;
          if (!m && !r && !c && !v && !b) return null;
          let label = '';
          if (m) label = 'Merging';
          else if (r) label = 'Rebasing';
          else if (c) label = 'Cherry-picking';
          else if (v) label = 'Reverting';
          else if (b) label = 'Bisecting';
          return (
            <a
              href="#/changes"
              className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-status-warning/15 border border-status-warning/50 text-status-warning font-medium hover:bg-status-warning/25 transition-colors"
              title={`Working tree is in ${label.toLowerCase()} state. Click to open Changes and Continue / Skip / Abort.`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-status-warning inline-block animate-pulse" />
              {label} in progress
            </a>
          );
        })()}
        {/* Selected commit (if different from HEAD) */}
        {vis('selectedCommit') && selectedCommitHash && selectedCommitHash !== headHash && (
          <span className="flex items-center gap-1.5" title={t('shell.selectedCommitTooltip')}>
            <span className="text-text-tertiary">{t('shell.selectedLabel')}</span>
            <CommitHashLink hash={selectedCommitHash} />
            <button
              className="text-text-tertiary hover:text-text-primary transition-colors px-1"
              onClick={() => selectCommit(null)}
              title={t('shell.clearSelection')}
            >
              ✕
            </button>
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {/* Running operation indicator — spinner + action name */}
        {runningCount > 0 && currentRunningOp ? (
          <span className="flex items-center gap-1.5 text-accent" title={currentRunningOp.command || currentRunningOp.action}>
            <Loader size={10} className="spin" />
            <span className="text-2xs font-medium">{currentRunningOp.action}</span>
            {runningCount > 1 && (
              <span className="text-2xs text-text-tertiary">{t('shell.moreOps', { count: runningCount - 1 })}</span>
            )}
          </span>
        ) : (
          /* Clickable counters — quick jump to the working tree */
          vis('stagedChanged') && (
          <button
            className="flex items-center gap-1 hover:text-text-primary transition-colors cursor-pointer px-1 rounded"
            onClick={() => { window.location.hash = '#/changes'; }}
            title={t('shell.openChangesTooltip')}
          >
            {staged > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-status-added inline-block" />
                {t('shell.nStaged', { count: staged })}
              </span>
            )}
            {changed > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-status-modified inline-block" />
                {t('shell.nChanged', { count: changed })}
              </span>
            )}
          </button>
          )
        )}
        {/* Tasks 15/16/17/20 — footer counters for Recyclable/Stashes/Submodules/LFS.
            Click to jump to the corresponding page. */}
        <FooterCounters />
        {/* Ahead / behind — click to push / pull (VS Code-style sync buttons) */}
        {vis('aheadBehind') && status?.ahead ? (
          <button
            className="text-status-added flex items-center gap-0.5 font-medium hover:bg-bg-hover rounded px-1 py-0.5 transition-colors cursor-pointer"
            onClick={() => {
              if (!currentRepo) return;
              useGitStore.getState().push(currentRepo.path)
                .then((res) => {
                  const result = describePushResult(res);
                  if (result.kind === 'error') toast.error(result.title, result.detail);
                  else if (result.kind === 'info') toast.info(result.title, result.detail);
                  else toast.success(result.title, result.detail);
                })
                .catch((e) => toast.error(t('shell.pushFailed'), String(e)));
            }}
            title={t('shell.aheadTooltip', { count: status.ahead })}
          >
            <ArrowUp size={9} />{status.ahead}
          </button>
        ) : null}
        {vis('aheadBehind') && status?.behind ? (
          <button
            className="text-status-modified flex items-center gap-0.5 font-medium hover:bg-bg-hover rounded px-1 py-0.5 transition-colors cursor-pointer"
            onClick={() => {
              if (!currentRepo) return;
              useGitStore.getState().pull(currentRepo.path)
                .then(() => toast.success(t('status.pulledSuccessfully')))
                .catch((e) => toast.error(t('shell.pullFailed'), String(e)));
            }}
            title={t('shell.behindTooltip', { count: status.behind })}
          >
            <ArrowDown size={9} />{status.behind}
          </button>
        ) : null}
        {vis('updatedAt') && lastRefresh > 0 && (
          <button
            className="text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
            onClick={() => currentRepo && useGitStore.getState().refreshStatus(currentRepo.path)}
            title={t('shell.refreshStatusTooltip')}
          >
            {t('shell.updatedAt', { time: new Date(lastRefresh).toLocaleTimeString() })}
          </button>
        )}
        {/* Command Log toggle button */}
        {vis('outputToggle') && (
        <button
          className="flex items-center gap-1 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer px-1"
          onClick={() => onToggleCommandLog && onToggleCommandLog()}
          title={t('shell.toggleOutputTooltip')}
        >
          {showCommandLog ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
          <span className="text-2xs">{t('shell.outputPanel')}</span>
        </button>
        )}
      </div>
    </footer>
  );
}
