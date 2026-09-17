/**
 * BranchSyncIndicator — visual "plug connected / disconnected" indicator
 * for branch rows across the app.
 *
 * Reusable component showing:
 *   - PlugConnected (green) when the branch is in sync with its upstream
 *     (ahead=0 AND behind=0 AND tracking/upstream exists).
 *   - PlugDisconnected (orange/red) when the branch is out of sync
 *     (ahead>0 OR behind>0 OR gone).
 *   - PlugDisconnected dimmed when the branch has NO tracking upstream
 *     (local-only, never pushed).
 *   - Nothing for remote branches without a tracking relationship (they
 *     are the upstream side — no "sync" concept applies).
 *
 * The component accepts BOTH `tracking` and `upstream` props because the
 * git backend sets them on different branch rows:
 *   - branches() sets `tracking` only on the CURRENT branch (from git status).
 *   - branches() sets `upstream` on non-current local branches with an
 *     upstream (from `git for-each-ref --format='%(upstream:short)'`).
 *
 * We use whichever is set: `tracking || upstream`. Without this fallback,
 * every non-current local branch with an upstream would render the dimmed
 * "No upstream" plug — wrong, because git itself confirms the upstream
 * exists via the `upstream` field.
 *
 * Used in: BranchesPage row, RefActionDialog row, HistoryPage graph row,
 * GlobalSearch branch rows. Replaces the older BranchTrackingIndicator
 * (which was SVG-only and didn't reflect ahead/behind state).
 */
import { PlugConnected, PlugDisconnected } from './icons';
import { cn } from '../lib/utils';

export interface BranchSyncIndicatorProps {
  /** Set on the CURRENT branch (from git status). */
  tracking?: string | null;
  /** Set on non-current local branches with an upstream (from for-each-ref). */
  upstream?: string | null;
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
  upstream,
  ahead,
  behind,
  gone,
  remote,
  size = 12,
  className,
}: BranchSyncIndicatorProps) {
  // Remote branches are the upstream side — no "sync" to display.
  if (remote) return null;

  // Resolve the effective upstream ref name — `tracking` is set by
  // `git status` for the current branch, `upstream` is set by
  // `for-each-ref` for non-current branches. Either one means the
  // branch HAS an upstream configured.
  const upstreamRef = tracking || upstream;

  // Local branch with no upstream at all — show dimmed disconnected plug.
  if (!upstreamRef) {
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
        title={`⚠ Upstream ${upstreamRef} was deleted on the remote. Push to recreate or set a new tracked branch.`}
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
        title={`In sync with ${upstreamRef}`}
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
    `Local ↔ ${upstreamRef}`,
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
