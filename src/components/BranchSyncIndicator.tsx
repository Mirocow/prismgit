/**
 * BranchSyncIndicator — visual "plug connected / disconnected" indicator
 * for branch rows across the app.
 *
 * Reusable component showing:
 *   - PlugConnected (green) when the branch is in sync with its upstream
 *     (ahead=0 AND behind=0 AND tracking exists).
 *   - PlugDisconnected (orange/red) when the branch is out of sync
 *     (ahead>0 OR behind>0 OR gone).
 *   - PlugDisconnected dimmed when the branch has NO tracking upstream
 *     (local-only, never pushed).
 *   - Nothing for remote branches without a tracking relationship (they
 *     are the upstream side — no "sync" concept applies).
 *
 * Used in: BranchesPage row, RefActionDialog row, HistoryPage graph row,
 * GlobalSearch branch rows. Replaces the older BranchTrackingIndicator
 * (which was SVG-only and didn't reflect ahead/behind state).
 */
import { PlugConnected, PlugDisconnected } from './icons';
import { cn } from '../lib/utils';

export interface BranchSyncIndicatorProps {
  /** True if the branch has an upstream tracking ref (`b.tracking`). */
  tracking?: string | null;
  /** Commits ahead of upstream. undefined = unknown. */
  ahead?: number;
  /** Commits behind upstream. undefined = unknown. */
  behind?: number;
  /** True if the upstream was deleted on the remote (gone). */
  gone?: boolean;
  /** True if this is a remote-tracking branch (refs/remotes/*). */
  remote?: boolean;
  /** Icon size in px. */
  size?: number;
  /** Optional className override (color tint). */
  className?: string;
}

export function BranchSyncIndicator({
  tracking,
  ahead,
  behind,
  gone,
  remote,
  size = 12,
  className,
}: BranchSyncIndicatorProps) {
  // Remote branches are the upstream side — no "sync" to display.
  if (remote) return null;

  // Local branch with no tracking — show dimmed disconnected plug.
  if (!tracking) {
    return (
      <span
        className={cn('inline-flex items-center text-text-tertiary/40', className)}
        title="No upstream — push -u to set tracking"
        role="img"
        aria-label="No upstream"
      >
        <PlugDisconnected size={size} />
      </span>
    );
  }

  // Gone — upstream was deleted on remote. Disconnected + red.
  if (gone) {
    return (
      <span
        className={cn('inline-flex items-center text-status-warning', className)}
        title={`⚠ Upstream ${tracking} was deleted on the remote. Push to recreate or set a new tracked branch.`}
        role="img"
        aria-label="Upstream gone"
      >
        <PlugDisconnected size={size} />
      </span>
    );
  }

  const aheadN = ahead ?? 0;
  const behindN = behind ?? 0;
  const inSync = aheadN === 0 && behindN === 0;

  if (inSync) {
    return (
      <span
        className={cn('inline-flex items-center text-status-added', className)}
        title={`In sync with ${tracking}`}
        role="img"
        aria-label="In sync"
      >
        <PlugConnected size={size} />
      </span>
    );
  }

  // Out of sync — disconnected plug + direction counts.
  const tone =
    aheadN > 0 && behindN > 0
      ? 'text-status-modified'
      : aheadN > 0
        ? 'text-status-added'
        : 'text-status-info';
  const title = [
    `Local ↔ ${tracking}`,
    aheadN > 0 ? `↑ ${aheadN} ahead` : '',
    behindN > 0 ? `↓ ${behindN} behind` : '',
  ].filter(Boolean).join(' · ');
  return (
    <span
      className={cn('inline-flex items-center', tone, className)}
      title={title}
      role="img"
      aria-label="Out of sync"
    >
      <PlugDisconnected size={size} />
    </span>
  );
}
