/**
 * ActivityWave — visual commit activity timeline.
 *
 * Shows commits as vertical bars on a horizontal timeline, where:
 *   - Bar height = lines changed (additions + deletions)
 *   - Bar color = author color
 *   - Click = select that commit in HistoryPage
 *   - Hover = tooltip with date, author, subject, +N/-N
 *
 * This is the "audio wave" concept: the user sees spikes where
 * large changes happened, and can click a spike to jump directly
 * to that commit — instead of scrolling through 500 commits.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │ ▄█▄       ▄                                  │
 *   │ █████     ███      ▄    ← height = changes   │
 *   │ ███████▄  █████    ███                        │
 *   └─[Mar 1]──[Mar 5]─[Today]────────────────────► │
 *   ▲          ▲        ▲                            │
 *   commit1   commit2  commit3                      │
 */
import { useMemo, useState, useRef, useEffect } from 'react';
import type { LogEntry } from '../lib/api';
import { getAuthorColor } from '../lib/authorBadges';
import { cn, formatDate } from '../lib/utils';
import { useI18n } from '../lib/i18n';

interface ActivityWaveProps {
  commits: LogEntry[];
  selectedHash: string | null;
  onSelect: (hash: string) => void;
  /** Optional: pre-fetched commit stats (additions/deletions per hash).
   *  When provided, bars are sized by real change volume.
   *  When not provided, bars get equal height (flat wave). */
  commitStats?: Record<string, { additions: number; deletions: number; files: number }>;
  height?: number;
}

interface WaveBar {
  hash: string;
  subject: string;
  author: string;
  date: string;
  additions: number;
  deletions: number;
  total: number;
  height: number;  // normalized 0-1
  color: string;
  index: number;
}

export function ActivityWave({ commits, selectedHash, onSelect, commitStats, height = 48 }: ActivityWaveProps) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState<WaveBar | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build wave bars from commits.
  // Each commit becomes one bar. Height = sqrt(additions + deletions)
  // (sqrt to compress the range — otherwise one huge commit makes all
  // others invisible).
  const bars = useMemo<WaveBar[]>(() => {
    if (commits.length === 0) return [];
    // Use real stats from commitStats if available, otherwise default to 1.
    const totals = commits.map(c => {
      const stat = commitStats?.[c.hash];
      if (stat) return stat.additions + stat.deletions;
      return 1;
    });
    const maxTotal = Math.max(...totals, 1);
    return commits.map((c, idx) => {
      const stat = commitStats?.[c.hash];
      const additions = stat?.additions ?? 0;
      const deletions = stat?.deletions ?? 0;
      const total = additions + deletions || 1;
      const heightRatio = Math.sqrt(total / maxTotal);
      const { bg } = getAuthorColor(c.author.name);
      return {
        hash: c.hash,
        subject: c.subject,
        author: c.author.name,
        date: c.author.date,
        additions,
        deletions,
        total,
        height: heightRatio,
        color: bg,
        index: idx,
      };
    });
  }, [commits, commitStats]);

  if (bars.length === 0) return null;

  const barWidth = Math.max(2, Math.min(12, 800 / bars.length));

  return (
    <div
      ref={containerRef}
      className="relative flex-shrink-0 border-b border-border-subtle bg-bg-tertiary overflow-hidden"
      style={{ height }}
    >
      {/* Bars */}
      <div className="flex items-end h-full px-1 gap-px overflow-hidden">
        {bars.map((bar) => (
          <button
            key={bar.hash}
            className={cn(
              'flex-shrink-0 transition-all rounded-t-sm',
              'hover:opacity-80',
              selectedHash === bar.hash && 'ring-1 ring-accent ring-offset-1'
            )}
            style={{
              width: barWidth,
              height: `${Math.max(3, bar.height * (height - 6))}px`,
              backgroundColor: bar.color,
              minWidth: 1,
            }}
            onClick={() => onSelect(bar.hash)}
            onMouseEnter={(e) => {
              setHovered(bar);
              const rect = containerRef.current?.getBoundingClientRect();
              if (rect) setHoverX(e.clientX - rect.left);
            }}
            onMouseLeave={() => setHovered(null)}
            title={`${bar.subject}\n${bar.author} · ${formatDate(bar.date)}\n+${bar.additions} / -${bar.deletions}`}
          />
        ))}
      </div>

      {/* Tooltip */}
      {hovered && (
        <div
          className="absolute bottom-full mb-1 z-20 panel px-2 py-1 text-2xs shadow-lg whitespace-nowrap pointer-events-none"
          style={{
            left: Math.max(0, Math.min(hoverX - 100, (containerRef.current?.clientWidth ?? 0) - 200)),
          }}
        >
          <div className="font-medium text-text-primary truncate max-w-48">{hovered.subject}</div>
          <div className="text-text-tertiary">
            {hovered.author} · {formatDate(hovered.date)}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-status-added">+{hovered.additions}</span>
            <span className="text-status-deleted">-{hovered.deletions}</span>
          </div>
        </div>
      )}

      {/* Date labels at edges */}
      <div className="absolute bottom-0 left-1 text-3xs text-text-tertiary pointer-events-none">
        {formatDate(bars[0].date)}
      </div>
      <div className="absolute bottom-0 right-1 text-3xs text-text-tertiary pointer-events-none">
        {formatDate(bars[bars.length - 1].date)}
      </div>
    </div>
  );
}
