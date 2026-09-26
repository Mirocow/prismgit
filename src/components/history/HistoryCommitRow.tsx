/**
 * HistoryCommitRow — one virtualized commit row in the History graph list,
 * extracted from HistoryPage's inline row markup and MEMOIZED.
 *
 * WHY (RENDER-PERF): the History list virtualizes with useLazyList, so every
 * scroll frame re-renders the visible window (~40 rows). With the row markup
 * INLINE in HistoryPage, each scroll frame re-created and re-reconciled every
 * visible row (~40 rows x ~120 JSX lines: sync indicator, ref badges, CI
 * badge, bugtraq linkification, avatar, hash link). In dev-mode React that
 * was ~60ms of main-thread work per wheel event — visible scroll jank.
 *
 * With this memoized component, a scroll frame only renders the rows that
 * ENTERED the window; rows that merely moved keep identical props
 * (row objects come from the memoized graphRows array → stable identities,
 * and all non-primitive inputs are either stable or precomputed primitives)
 * and bail out of re-rendering entirely.
 *
 * Prop discipline (keeps memo effective):
 *  - `entry` is a row object from the memoized graphRows array — stable
 *    identity for the lifetime of that commit list.
 *  - everything the row needs from volatile parent state (status sync info,
 *    incoming set, ciStatus map) is precomputed by the PARENT into
 *    primitives — so e.g. a status refresh no longer re-renders all rows
 *    just to update the ONE "Working tree sync" badge on the first row.
 */
import { memo } from 'react';
import { Avatar } from '../Avatar';
import { CommitHashLink } from '../StatusBar';
import type { LogEntry } from '../../lib/api';
import { api } from '../../lib/api';
import { formatTime, getAuthorColor, getInitials } from '../../lib/authorBadges';
import { linkifyCommitMessage } from '../../lib/bugtraq';
import { RefBadges } from '../../lib/refBadge';
import { cn, shortHash } from '../../lib/utils';
import { ArrowDown, ArrowUp, PlugConnected, PlugDisconnected } from '../icons';

export const HISTORY_ROW_HEIGHT = 32;

export interface HistoryRowSyncInfo {
  current?: string | null;
  tracking?: string | null;
  ahead: number;
  behind: number;
}

interface HistoryCommitRowProps {
  entry: LogEntry;
  /** Row index in the FULL graphRows array (virtualization-independent). */
  realIdx: number;
  isSelected: boolean;
  /** Multi-select (squash-transfer): row is part of the commit GROUP selection. */
  isMultiSelected?: boolean;
  /** Only the first overall row renders the working-tree sync indicator. */
  sync: HistoryRowSyncInfo | null;
  /** Precomputed: incomingHashes.has(entry.hash). */
  isIncoming: boolean;
  /** Precomputed remote label for the incoming badge (or null). */
  incomingRemoteLabel: string | null;
  /** Precomputed CI conclusion (or null). */
  ciConclusion: string | null;
  ciTotalChecks: number;
  showGraph: boolean;
  graphWidth: number;
  bugtraqConfig: Parameters<typeof linkifyCommitMessage>[1];
  onRefsChanged: () => void;
  /** Click with modifier info: ctrl/meta toggles group selection, shift
   *  selects a range (History squash-transfer multi-select). */
  onSelect: (idx: number, hash: string, mods: { ctrl: boolean; shift: boolean }) => void;
  onContextMenu: (e: React.MouseEvent, entry: LogEntry, idx: number) => void;
}

export const HistoryCommitRow = memo(function HistoryCommitRow({
  entry,
  realIdx,
  isSelected,
  isMultiSelected = false,
  sync,
  isIncoming,
  incomingRemoteLabel,
  ciConclusion,
  ciTotalChecks,
  showGraph,
  graphWidth,
  bugtraqConfig,
  onRefsChanged,
  onSelect,
  onContextMenu,
}: HistoryCommitRowProps) {
  const isHEAD = entry.refs.some(r => r.includes('HEAD'));

  return (
    <div
      className={cn('flex items-center gap-2 border-b border-border-subtle cursor-pointer relative',
        isMultiSelected
          // Group selection (squash-transfer): accent tint + accent inset bar
          ? 'bg-accent/15 shadow-[inset_2px_0_0_0_var(--accent)]'
          : isSelected
            ? 'bg-bg-selected'
            : 'hover:bg-bg-hover',
        // Incoming (remote-only) commits get a subtle tinted background
        isIncoming && !isSelected && !isMultiSelected && 'bg-blue-50/30 dark:bg-blue-950/10')}
      style={{ height: HISTORY_ROW_HEIGHT, paddingLeft: showGraph ? graphWidth + 8 : 8, zIndex: 4 }}
      onClick={(e) => onSelect(realIdx, entry.hash, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
      onContextMenu={(e) => onContextMenu(e, entry, realIdx)}
    >
      {isHEAD && <span className="text-2xs text-text-primary shrink-0" style={{ width: 8 }}>▶</span>}

      {/**  Sync indicator */}
      {sync && sync.current && sync.tracking && (
        <div
          className={cn('flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-2xs font-medium',
            sync.ahead > 0 && sync.behind > 0
              ? 'border-status-modified/40 bg-status-modified/10 text-status-modified'
              : sync.ahead > 0
                ? 'border-status-added/40 bg-status-added/10 text-status-added'
                : sync.behind > 0
                  ? 'border-status-info/40 bg-status-info/10 text-status-info'
                  : 'border-status-added/30 bg-status-added/5 text-status-added')}
          title={
            sync.ahead === 0 && sync.behind === 0
              ? `In sync with ${sync.tracking}`
              : `Local: ${sync.current} · Upstream: ${sync.tracking}\n` +
                `↑ ${sync.ahead} commit(s) ahead · ↓ ${sync.behind} commit(s) behind`
          }
        >
          {sync.ahead === 0 && sync.behind === 0 ? (
            /* In sync — plug CONNECTED (вилка в розетке) */
            <span className="flex items-center gap-0.5">
              <PlugConnected size={14} />
            </span>
          ) : (
            /* Out of sync — plug DISCONNECTED (вилка отдельно) + counts */
            <>
              <PlugDisconnected size={14} />
              {sync.ahead > 0 && (
                <span className="flex items-center gap-0.5 ml-0.5">
                  <ArrowUp size={9} />
                  {sync.ahead}
                </span>
              )}
              {sync.behind > 0 && (
                <span className="flex items-center gap-0.5 ml-0.5">
                  <ArrowDown size={9} />
                  {sync.behind}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {!isHEAD && <span style={{ width: 8 }} className="shrink-0" />}

      {/* Decorations: tags first, then HEAD/branches/remotes — parsed
          from BOTH short and --decorate=full shapes (see refBadge). */}
      {/* Show up to 5 ref badges per row so tags (often grouped with
          branches and remotes) are visible at a glance. */}
      <RefBadges refs={entry.refs} max={5} hash={entry.hash} onChanged={onRefsChanged} />

      {/* Incoming badge — commit exists only on remote, not yet pulled.
          In VS Code style: a dashed "↓ incoming" label with the remote
          branch name. */}
      {isIncoming && (
        <span className="shrink-0 text-2xs px-1.5 py-0.5 rounded border border-dashed border-status-info text-status-info font-medium flex items-center gap-0.5"
          title="Incoming — this commit exists on a remote but has not been pulled into a local branch yet. Use Pull to bring it into your local branch.">
          ↓
          {incomingRemoteLabel && (
            <span className="opacity-75">
              {incomingRemoteLabel}
            </span>
          )}
        </span>
      )}

      {/* GitHub Actions CI badge (SmartGit "My History" CI integrations) */}
      {ciConclusion && (
        <span
          className="shrink-0 text-2xs"
          title={`CI: ${ciConclusion} (${ciTotalChecks} checks)`}
        >
          {ciConclusion === 'success' && <span className="text-green-500">●</span>}
          {ciConclusion === 'failure' && <span className="text-red-500">●</span>}
          {ciConclusion === 'running' && <span className="text-yellow-500 animate-pulse">●</span>}
        </span>
      )}

      <span className={cn('flex-1 truncate text-xs', isSelected ? 'font-semibold text-text-primary' : 'font-medium text-text-primary')}>
        {bugtraqConfig
          ? linkifyCommitMessage(entry.subject, bugtraqConfig).map((seg, i) =>
              seg.url ? (
                <a
                  key={i}
                  href={seg.url}
                  className="text-accent hover:underline"
                  onClick={(e) => { e.stopPropagation(); api.app.openExternal(seg.url!); }}
                >
                  {seg.text}
                </a>
              ) : (
                <span key={i}>{seg.text}</span>
              )
            )
          : entry.subject}
      </span>

      {/* Hash — clicking ANY commit hash opens History focused on
          that commit (same as PARENTS links); copy lives in the
          right-click menu and the row menu. */}
      <CommitHashLink
        hash={entry.hash}
        plain
        display={entry.hashAbbrev || shortHash(entry.hash)}
        className="text-text-tertiary/60 shrink-0 truncate"
      />

      {/* Author avatar — Gravatar image if the author's email
          is from a known provider (GitHub / GitLab noreply),
          otherwise the colored-initial fallback badge.
          QW-6 / Task (gravatar). */}
      <Avatar name={entry.author.name} email={entry.author.email} size={16} />
      <span className="text-2xs text-text-tertiary shrink-0" style={{ width: 70, textAlign: 'right' }}>
        {formatTime(entry.author.date)}
      </span>
    </div>
  );
});
