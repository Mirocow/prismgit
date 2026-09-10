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
import { useContextMenu } from './useContextMenu';
import { buildRefMenu, runRefMenuAction } from './commitMenu';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSelectionStore } from '../stores/selectionStore';

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

/** Parse + sort a %D list: tags first, then HEAD, branches, remotes.
 *  Defensive: silently drops null/undefined/non-string/blank entries — git
 *  decorations arrive from several parsers and a bad entry must never crash
 *  the whole page (see RefBadge crash: undefined 'kind'). */
export function parseDecoratedRefs(refs: string[]): ParsedRef[] {
  const order: Record<RefKind, number> = { tag: 0, head: 1, branch: 2, remote: 3, stash: 4, other: 5 };
  return (Array.isArray(refs) ? refs : [])
    .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
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

// NOTE: the prop MUST NOT be named `ref` — that is a React special prop, it
// never reaches function components (React 18) and silently becomes undefined,
// which used to crash every page rendering badges (`reading 'kind' of undefined`).
export interface RefBadgeProps {
  parsed: ParsedRef;
  size?: number;
  /** Commit the badge points at — enables "View Commit in History". */
  hash?: string;
  /** Refresh callback after a menu mutation (delete tag/branch, checkout). */
  onChanged?: () => void;
}

export function RefBadge({ parsed, size = 8, hash, onChanged }: RefBadgeProps) {
  const showContextMenu = useContextMenu();
  const repoPath = useRepositoryStore((s) => s.currentRepo?.path ?? null);
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ctx = { parsed, hash, repoPath: repoPath ?? undefined, onChanged };
    showContextMenu(buildRefMenu(ctx), (id) => runRefMenuAction(id, ctx));
  };
  // Left click: the badge feeds the GLOBAL selection so the branch/tag shows
  // up in the Toolbar chip, Branches/Tags pages and the History filter —
  // same linkage as selecting it in its own tool.
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!parsed) return;
    const selection = useSelectionStore.getState();
    if (parsed.kind === 'tag') selection.selectTag(parsed.label);
    else if (parsed.kind === 'branch' || parsed.kind === 'head') {
      selection.selectBranch(parsed.label);
      if (hash) selection.selectCommit(hash);
    } else if (parsed.kind === 'remote') {
      if (hash) selection.selectCommit(hash);
    }
  };
  const selectable = parsed?.kind === 'tag' || parsed?.kind === 'branch' || parsed?.kind === 'head' || parsed?.kind === 'remote';
  return (
    <span
      className={cn('text-2xs px-1.5 py-0.5 rounded border whitespace-nowrap', selectable ? 'cursor-pointer hover:brightness-125' : 'cursor-default', badgeClass[parsed?.kind ?? 'other'])}
      title={selectable ? `${parsed?.raw} — click: select in all tools · right-click: actions` : parsed?.raw}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
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
 * Every badge has a right-click menu (Copy, Checkout/Delete, View Commit).
 */
export const RefBadges = memo(function RefBadges({
  refs,
  max,
  size = 8,
  className,
  hash,
  onChanged,
}: {
  refs: string[];
  max?: number;
  size?: number;
  className?: string;
  /** Commit the badges point at — enables "View Commit in History". */
  hash?: string;
  /** Refresh after a menu mutation (delete tag/branch, checkout). */
  onChanged?: () => void;
}) {
  const parsed = parseDecoratedRefs(Array.isArray(refs) ? refs : []);
  if (parsed.length === 0) return null;
  const visible = max != null ? parsed.slice(0, max) : parsed;
  const hidden = parsed.length - visible.length;
  return (
    <div className={cn('flex items-center gap-1 flex-shrink-0', className)}>
      {visible.map((r, i) => (
        <RefBadge key={`${r.raw}-${i}`} parsed={r} size={size} hash={hash} onChanged={onChanged} />
      ))}
      {hidden > 0 && (
        <span className="text-2xs text-text-tertiary" title={parsed.map((r) => r.label).join(', ')}>
          +{hidden}
        </span>
      )}
    </div>
  );
});
