/**
 * RefBadge — shared rendering of git decorations (tags / branches / remotes)
 * on commit rows, commit detail panels and the Changes journal.
 *
 * WHY: git decorations arrive in TWO different shapes depending on git
 * version/flags. Since the log parser runs with `--decorate=full`:
 *
 *   tag:     "tag: refs/tags/v2.0"   (full)  or  "tag: v2.0" (short)
 *   branch:  "refs/heads/feature"            or  "feature"
 *   HEAD:    "HEAD -> refs/heads/main"       or  "HEAD -> main"
 *   remote:  "refs/remotes/origin/dev"       or  "origin/dev"
 *   stash:   "refs/stash"                    or  "stash"
 *   detached "HEAD"
 *
 * The old History graph rows only understood the short "tag:" prefix, so with
 * --decorate=full tags rendered as remote-styled badges labelled
 * "refs/tags/v2.0". parseDecoratedRef normalizes both shapes into
 * { kind, label } so every surface shows clean "v2.0"-style badges.
 */
import { memo } from 'react';
import { Tag as TagIcon } from '../components/icons';
import { cn } from './utils';

export type RefKind = 'tag' | 'head' | 'branch' | 'remote' | 'stash' | 'other';

export interface ParsedRef {
  kind: RefKind;
  /** Clean display label — "v2.0", "main", "origin/dev". */
  label: string;
  /** Raw string as received from git %D (tooltip). */
  raw: string;
}

export function parseDecoratedRef(ref: string): ParsedRef {
  const raw = ref.trim();
  // HEAD pointer: "HEAD -> refs/heads/main" / "HEAD -> main"
  const headArrow = raw.match(/^HEAD\s*->\s*(.+)$/);
  if (headArrow) {
    const target = parseDecoratedRef(headArrow[1]);
    return { kind: 'head', label: target.label, raw };
  }
  if (raw === 'HEAD') return { kind: 'head', label: 'HEAD', raw };

  // Tag: "tag: refs/tags/v2.0" (decorate=full) or "tag: v2.0" (short)
  const tagMark = raw.match(/^tag:\s*(.+)$/);
  if (tagMark) {
    const inner = tagMark[1].replace(/^refs\/tags\//, '');
    return { kind: 'tag', label: inner, raw };
  }
  if (raw.startsWith('refs/tags/')) return { kind: 'tag', label: raw.slice('refs/tags/'.length), raw };

  // Stash
  if (raw === 'refs/stash' || raw === 'stash') return { kind: 'stash', label: 'stash', raw };

  // Branches and remotes (full form)
  if (raw.startsWith('refs/heads/')) return { kind: 'branch', label: raw.slice('refs/heads/'.length), raw };
  if (raw.startsWith('refs/remotes/')) return { kind: 'remote', label: raw.slice('refs/remotes/'.length), raw };

  // Short forms: "origin/dev" (remote — has a slash) vs "feature" (local branch)
  if (raw.includes('/')) return { kind: 'remote', label: raw, raw };
  return { kind: 'branch', label: raw, raw };
}

/** Parse + sort a %D list: tags first, then HEAD, branches, remotes. */
export function parseDecoratedRefs(refs: string[]): ParsedRef[] {
  const order: Record<RefKind, number> = { tag: 0, head: 1, branch: 2, remote: 3, stash: 4, other: 5 };
  return refs
    .map(parseDecoratedRef)
    .sort((a, b) => order[a.kind] - order[b.kind]);
}

/** Badge styles per ref kind (matches the app's existing decoration palette). */
const badgeClass: Record<RefKind, string> = {
  tag: 'border-tag-border bg-tag-bg text-tag-text',
  head: 'border-accent bg-accent-muted text-accent',
  branch: 'border-status-added/30 bg-status-added/10 text-status-added',
  remote: 'border-status-renamed/30 bg-status-renamed/10 text-status-renamed',
  stash: 'border-border-strong bg-bg-hover text-text-secondary',
  other: 'border-border-strong bg-bg-hover text-text-secondary',
};

export function RefBadge({ ref: parsed, size = 8 }: { ref: ParsedRef; size?: number }) {
  return (
    <span
      className={cn('text-2xs px-1.5 py-0.5 rounded border whitespace-nowrap', badgeClass[parsed.kind])}
      title={parsed.raw}
    >
      {parsed.kind === 'tag' && <TagIcon size={size} className="inline mr-0.5" />}
      {parsed.kind === 'head' && '▸ '}
      {parsed.label}
    </span>
  );
}

/**
 * Row of ref badges for a commit. Tags first (SmartGit order), optional cap —
 * graph rows cap at 3 to stay compact; the detail panel shows all.
 */
export const RefBadges = memo(function RefBadges({
  refs,
  max,
  size = 8,
  className,
}: {
  refs: string[];
  max?: number;
  size?: number;
  className?: string;
}) {
  const parsed = parseDecoratedRefs(refs);
  if (parsed.length === 0) return null;
  const visible = max != null ? parsed.slice(0, max) : parsed;
  const hidden = parsed.length - visible.length;
  return (
    <div className={cn('flex items-center gap-1 flex-shrink-0', className)}>
      {visible.map((r, i) => (
        <RefBadge key={`${r.raw}-${i}`} ref={r} size={size} />
      ))}
      {hidden > 0 && (
        <span className="text-2xs text-text-tertiary" title={parsed.map((r) => r.label).join(', ')}>
          +{hidden}
        </span>
      )}
    </div>
  );
});
