/**
 * Task 6 — BranchTrackingIndicator.
 *
 * Visual indicator of the local↔remote tracking relationship:
 *   - When the branch has an upstream tracking ref, render a "plug" icon
 *     (a 2-prong fork plugged INTO a socket).
 *   - When the branch has NO upstream tracking, render the plug with a
 *     dashed outline next to an empty socket — to visually communicate
 *     "this local branch has no remote counterpart; push -u to wire it".
 *
 * Used in BranchesPage row + HistoryPage graph node hover. Pure SVG, no
 * icon-library dependency.
 */

export interface BranchTrackingIndicatorProps {
  /** True if the branch has an upstream tracking ref (b.tracking). */
  tracking: boolean;
  /** Show the upstream name as a title tooltip. */
  upstreamName?: string;
  /** Compact mode — smaller icon (for inline rows). */
  size?: number;
}

export function BranchTrackingIndicator({
  tracking,
  upstreamName,
  size = 14,
}: BranchTrackingIndicatorProps) {
  const title = tracking
    ? `Tracking ${upstreamName ?? 'remote'}`
    : 'No upstream — push -u to set tracking';
  // Plug = a 2-prong fork (two vertical lines with circles at top).
  // Socket = a horizontal line with two small holes the prongs slot into.
  // When tracking, the plug is drawn overlapping the socket (plugged in).
  // When not tracking, a small gap separates them + dashed outline.
  const color = tracking ? 'var(--status-added)' : 'var(--text-tertiary)';
  const opacity = tracking ? 1 : 0.6;

  return (
    <span role="img" aria-label={title} title={title} style={{ display: 'inline-flex', flexShrink: 0 }}>
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ opacity }}
    >
      {/* Socket — horizontal bar with two holes */}
      <line x1="3" y1="18" x2="21" y2="18" />
      <circle cx="9" cy="18" r="1.5" fill="var(--bg-primary)" stroke={color} strokeWidth={1.5} />
      <circle cx="15" cy="18" r="1.5" fill="var(--bg-primary)" stroke={color} strokeWidth={1.5} />
      {/* Plug — two prongs going up */}
      {tracking ? (
        // Prongs inserted INTO the socket — drawn from y=15 up to y=10
        <>
          <line x1="9" y1="15" x2="9" y2="10" />
          <line x1="15" y1="15" x2="15" y2="10" />
          <line x1="6" y1="10" x2="18" y2="10" />
          {/* Plug handle */}
          <rect x="9" y="6" width="6" height="4" rx="1" fill={color} stroke={color} />
        </>
      ) : (
        // Prongs hover above the socket — gap + dashed wire
        <>
          <line x1="9" y1="13" x2="9" y2="8" strokeDasharray="2 2" />
          <line x1="15" y1="13" x2="15" y2="8" strokeDasharray="2 2" />
          <line x1="6" y1="8" x2="18" y2="8" />
          <rect x="9" y="4" width="6" height="4" rx="1" fill="none" stroke={color} strokeDasharray="2 2" />
        </>
      )}
    </svg>
    </span>
  );
}
