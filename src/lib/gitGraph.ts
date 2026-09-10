/**
 * Lane assignment algorithm for git history graph — v2.
 *
 * Adapted from AngKorGit's `packages/core/src/graph/layout.ts` (Tauri + libgit2 client).
 * Key idea: each `GraphRow` is self-contained and knows how to draw itself, including
 * "passing" lanes that cross through it on the way to a parent several rows below.
 *
 * This solves the "broken line" problem: if commit C is on row 0 and its parent P
 * is on row 5, the lane stays alive in the `lanes` array (expects: P), and each
 * intermediate row gets `passing: [{ lane: L, color }]` so it draws a vertical line
 * through the whole row.
 *
 * Per-node flags:
 *   - `hasIncoming`: draw line from top (y=0) to node center (y=CY) — first parent continues into this node
 *   - `continues`:   draw line from node center (y=CY) to bottom (y=ROW_HEIGHT) — node has a first parent further down
 *   - `closing`:     list of {lane, color} that merge INTO this node (curves from top)
 *   - `merges`:      list of {lane, color} that this node creates for non-first parents (curves from bottom)
 *   - `truncated`:   node has parents but none resolve to a visible commit (lane ends here)
 *
 * Per-row:
 *   - `passing`: list of {lane, color} that pass straight through (vertical line top→bottom)
 *   - connections may have `dashed: true` if the link was rewired to a nearest visible ancestor
 *     (i.e., the true parent was hidden by a filter)
 */

import type { LogEntry } from '../../electron/types/git-api';
import type { ResolvedAncestry } from './graphAncestry';

/** Color palette inspired by GitKraken / SourceTree — accessible on both light & dark themes. */
export const BRANCH_COLORS = [
  '#399ee6', // blue
  '#86b300', // green
  '#f07171', // red
  '#a37acc', // purple
  '#4cbf99', // teal
  '#f2ae49', // orange
  '#55b4d4', // cyan
  '#e07b7b', // pink
  '#7eb852', // lime
  '#d4a05a', // amber
];

/**
 * Deterministic color from branch name (SmartGit 22.1 feature).
 * The same branch name always gets the same color on every machine.
 * Local and remote branches with the same name get the same color.
 *
 * Uses a simple hash: sum of char codes mod palette length.
 * This is stable, fast, and distributes colors evenly across the palette.
 */
const branchColorCache = new Map<string, number>();
export function branchColorIndex(branchName: string): number {
  // Strip remote prefix (origin/main → main) so local and remote match
  const name = branchName.replace(/^[^/]+\//, '');
  const cached = branchColorCache.get(name);
  if (cached !== undefined) return cached;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % BRANCH_COLORS.length;
  branchColorCache.set(name, idx);
  return idx;
}

interface ActiveLane {
  /** OID of the parent this lane is currently waiting for. */
  expects: string;
  /** Stable color index (one per unique OID). */
  color: number;
  /** True if the link to this lane's target is "rewired" (parent was hidden, dashed line). */
  dashed: boolean;
}

export interface LaneRef {
  lane: number;
  color: number;
  /** Dashed line — the connection was rewired past hidden commits. */
  dashed?: boolean;
}

export interface GraphNode {
  entry: LogEntry;
  row: number;
  lane: number;
  color: number;
  isMerge: boolean;
  /** Line from top of row into node center (first parent arrives here). */
  hasIncoming: boolean;
  /** Line from node center to bottom of row (node continues to its first parent). */
  continues: boolean;
  /** Lanes that merge INTO this node — drawn as bezier curves from top. */
  closing: LaneRef[];
  /** Lanes created for non-first parents — drawn as bezier curves from bottom. */
  merges: LaneRef[];
  /** True parents are out of the visible window — lane ends here. */
  truncated: boolean;
  /** Connection to first parent is dashed (rewired past hidden commits). */
  firstParentDashed: boolean;
}

export interface GraphRow {
  node: GraphNode | null;
  /** Lanes that pass vertically through this row (top to bottom, no node here). */
  passing: LaneRef[];
}

export interface GraphLayout {
  rows: GraphRow[];
  maxLane: number;
}

export interface LayoutOptions {
  /**
   * Optional ancestry resolver. If provided, hidden parents are rewired to their
   * nearest visible ancestor — the lane is drawn as a dashed line.
   * If not provided, the layout uses the entry's own `parents[]` directly.
   */
  ancestry?: ResolvedAncestry;
}

export class GraphLayoutBuilder {
  private lanes: (ActiveLane | null)[] = [];
  private rows: GraphRow[] = [];
  private nextColor = 0;
  /** Per-OID color assignment — guarantees same OID always has same color. */
  private colorMap = new Map<string, number>();
  private maxLane = 0;
  private ancestry: ResolvedAncestry | undefined;

  constructor(options: LayoutOptions = {}) {
    this.ancestry = options.ancestry;
  }

  /** Allocate (or reuse) a color index for a given OID. */
  private allocColor(oid: string): number {
    let c = this.colorMap.get(oid);
    if (c === undefined) {
      c = this.nextColor++;
      this.colorMap.set(oid, c);
    }
    return c;
  }

  /** Find the first free (null) lane, or append a new one. */
  private firstFreeLane(): number {
    for (let i = 0; i < this.lanes.length; i++) {
      if (this.lanes[i] === null) return i;
    }
    const idx = this.lanes.length;
    this.lanes.push(null);
    return idx;
  }

  /** Resolve the (visible) parents for a commit, using ancestry resolver if available. */
  private resolveParents(entry: LogEntry): { oids: string[]; dashedFlags: boolean[]; truncated: boolean } {
    if (this.ancestry) {
      const resolved = this.ancestry.resolve(entry.hash);
      const truncated = this.ancestry.isTruncated(entry.hash);
      // If truncated (no visible ancestors found), fall back to original parents so the lane
      // at least shows something — but mark as truncated so UI knows.
      if (resolved.length === 0) {
        return {
          oids: entry.parents,
          dashedFlags: entry.parents.map(() => true),
          truncated: true,
        };
      }
      return {
        oids: resolved.map(r => r.oid),
        dashedFlags: resolved.map(r => r.elided),
        truncated,
      };
    }
    return {
      oids: entry.parents,
      dashedFlags: entry.parents.map(() => false),
      truncated: false,
    };
  }

  /** Add one commit to the layout. */
  addOne(entry: LogEntry): void {
    const row = this.rows.length;
    // 1. Find lanes waiting for this commit's OID
    const waiting: number[] = [];
    for (let i = 0; i < this.lanes.length; i++) {
      if (this.lanes[i]?.expects === entry.hash) waiting.push(i);
    }

    let lane: number;
    const closing: LaneRef[] = [];

    if (waiting.length === 0) {
      // Nobody is waiting for this commit — allocate a free lane and a new color
      lane = this.firstFreeLane();
      const color = this.allocColor(entry.hash);
      this.lanes[lane] = { expects: entry.hash, color, dashed: false };
    } else {
      // Use the first waiting lane as our lane (keeps color continuity)
      lane = waiting[0];
      // Other waiting lanes "close" into this node
      for (let i = 1; i < waiting.length; i++) {
        const l = waiting[i];
        const wl = this.lanes[l]!;
        closing.push({ lane: l, color: wl.color, dashed: wl.dashed });
        this.lanes[l] = null;
      }
    }

    const myColor = this.lanes[lane]!.color;
    this.maxLane = Math.max(this.maxLane, lane);

    // Determine passing lanes (all lanes except `lane` and those in `closing` that
    // are not null and not waiting for our hash)
    const passing: LaneRef[] = [];
    for (let i = 0; i < this.lanes.length; i++) {
      if (i === lane) continue;
      const l = this.lanes[i];
      if (l === null) continue;
      // Skip lanes that are about to close into this node
      if (closing.some(c => c.lane === i)) continue;
      passing.push({ lane: i, color: l.color, dashed: l.dashed });
    }

    // Now process parents (with ancestry rewriting if enabled)
    const { oids: parents, dashedFlags, truncated } = this.resolveParents(entry);
    const merges: LaneRef[] = [];
    let continues = false;
    let firstParentDashed = false;
    // hasIncoming: was this commit waited for by an existing lane above?
    // If yes, the lane draws a vertical line from top of row into node center.
    let hasIncoming = waiting.length > 0;

    if (parents.length === 0 || truncated) {
      // Root commit or truncated — lane ends here.
      this.lanes[lane] = null;
      continues = false;
    } else {
      const firstParent = parents[0];
      const firstDashed = dashedFlags[0] || false;
      // Check if first parent already has a lane elsewhere
      const firstParentLane = this.lanes.findIndex(l => l?.expects === firstParent);

      if (firstParentLane === -1 || firstParentLane === lane) {
        // First parent continues on our lane
        this.lanes[lane] = { expects: firstParent, color: myColor, dashed: firstDashed };
        continues = true;
        firstParentDashed = firstDashed;
      } else {
        // First parent already has a different lane — close our lane
        closing.push({ lane: lane, color: myColor, dashed: firstDashed });
        this.lanes[lane] = null;
        continues = false;
      }

      // Process non-first parents (merge parents)
      for (let pi = 1; pi < parents.length; pi++) {
        const parent = parents[pi];
        const dashed = dashedFlags[pi] || false;
        const existing = this.lanes.findIndex(l => l?.expects === parent);
        if (existing >= 0) {
          // Parent already has a lane — draw a curve to it
          merges.push({ lane: existing, color: this.lanes[existing]!.color, dashed });
        } else {
          // Allocate a new lane for this parent
          const newLane = this.firstFreeLane();
          const newColor = this.allocColor(parent);
          this.lanes[newLane] = { expects: parent, color: newColor, dashed };
          this.maxLane = Math.max(this.maxLane, newLane);
          merges.push({ lane: newLane, color: newColor, dashed });
        }
      }
    }

    // For the very first commit (row 0), there is no "incoming" from above
    if (row === 0) hasIncoming = false;

    // isMerge: based on the number of TRUE parents (entry.parents), not resolved ones.
    // A commit with 2 hidden parents that both rewire to the same visible ancestor
    // is still visually a merge node.
    const isMerge = entry.parents.length > 1;

    const node: GraphNode = {
      entry,
      row,
      lane,
      color: myColor,
      isMerge,
      hasIncoming,
      continues,
      closing,
      merges,
      truncated,
      firstParentDashed,
    };

    this.rows.push({ node, passing });
  }

  add(entries: LogEntry[]): void {
    for (const e of entries) this.addOne(e);
  }

  build(): GraphLayout {
    return { rows: this.rows, maxLane: this.maxLane };
  }
}

/**
 * Compute the lane assignment for a list of commits.
 *
 * Commits MUST be ordered newest-first (i.e. as `git log` returns them).
 * Topological order is assumed.
 *
 * @param entries  The visible (possibly filtered) list of commits
 * @param options  Optional layout options (e.g., ancestry resolver for filtered views)
 */
export function computeGraph(entries: LogEntry[], options?: LayoutOptions): GraphLayout {
  const builder = new GraphLayoutBuilder(options);
  builder.add(entries);
  return builder.build();
}

/** Render an SVG path string for a vertical line segment. */
export function verticalLine(
  x: number,
  fromY: number,
  toY: number,
): string {
  return `M ${x} ${fromY} L ${x} ${toY}`;
}

/** Render an SVG path string for a bezier curve from one point to another. */
export function bezierPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): string {
  if (fromX === toX) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  const midY = (fromY + toY) / 2;
  return `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
}

/** Color for a given lane index (wraps around palette). */
export function laneColor(colorIndex: number): string {
  return BRANCH_COLORS[colorIndex % BRANCH_COLORS.length];
}
