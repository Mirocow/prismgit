import { create } from 'zustand';
import { useSelectionStore } from './selectionStore';

/**
 * NAV HISTORY — in-app Back/Forward navigation (browser-style) between tools
 * and views. The user's request: «в инструментах не хватает кнопок назад,
 * вперёд как в браузере» + v3.9: «кнопки должны не просто переключать на
 * инструмент, но и ПОМНИТЬ ЕГО СОСТОЯНИЕ».
 *
 * DESIGN: a plain stack of entries (location + tool-state snapshot). React
 * router's own history is NOT used because the app performs many
 * *automatic* navigations (repo open → /changes, window-state change →
 * /changes, conflict redirect) which pollute the browser stack and would
 * make Back mostly useless. This store records only what the user actually
 * visited, one entry per location.
 *
 * STATE MEMORY (v3.9): each entry carries a NavSnapshot of the global
 * selection store (selected commit / file / branch / tag / path filter).
 * The snapshot of the CURRENT entry is refreshed on every push (i.e. when
 * the user LEAVES a tool, what they had selected there is saved into that
 * entry). back()/forward() restore the target entry's snapshot BEFORE the
 * router navigates, so the target tool mounts with the remembered state —
 * History re-selects the commit, Blame re-opens the file, Diff re-filters.
 *
 * Cooperation contract with App.tsx: the location-effect pushes every change
 * UNLESS the change came from back()/forward() (they set a one-shot
 * suppression flag that the effect consumes). So the stack only grows on
 * real user-driven navigation.
 */

/** Tool state captured per entry — the fields the target tools read on
 *  mount. Blame/Diff/History/Changes all subscribe to these. */
export interface NavSnapshot {
  selectedCommitHash: string | null;
  selectedFilePath: string | null;
  selectedBranch: string | null;
  selectedTag: string | null;
  pathFilter: string | null;
}

function captureSnapshot(): NavSnapshot {
  const s = useSelectionStore.getState();
  return {
    selectedCommitHash: s.selectedCommitHash,
    selectedFilePath: s.selectedFilePath,
    selectedBranch: s.selectedBranch,
    selectedTag: s.selectedTag,
    pathFilter: s.pathFilter,
  };
}

function restoreSnapshot(snap: NavSnapshot | null): void {
  if (!snap) return;
  useSelectionStore.setState({
    selectedCommitHash: snap.selectedCommitHash,
    selectedFilePath: snap.selectedFilePath,
    selectedBranch: snap.selectedBranch,
    selectedTag: snap.selectedTag,
    pathFilter: snap.pathFilter,
  });
}

interface NavEntry {
  loc: string;
  snap: NavSnapshot | null;
}

interface NavHistoryState {
  /** Seen locations (oldest first) with their tool-state snapshots. */
  stack: NavEntry[];
  /** Index of the CURRENT location inside stack, -1 until first push. */
  index: number;
  back: () => string | null;
  forward: () => string | null;
  /** Record a user-driven location change. Returns false for no-ops. */
  push: (location: string) => boolean;
  /** v3.9 — declare that the NEXT selection changes + push belong to the
   *  NEW entry (cross-tool jump helpers call this BEFORE setting the
   *  selection, so the outgoing entry's snapshot is not polluted with the
   *  incoming tool's state). */
  markCrossToolJump: () => void;
  /** One-shot suppression consumed by the App location effect. */
  consumeSuppressed: () => boolean;
  /** Wipe (repo switch / app reset). */
  reset: () => void;
  /** Test hook: the current entry's snapshot. */
  __currentSnapshotForTests: () => NavSnapshot | null;
}

const MAX_STACK = 60;
let suppressed = false;
/** Set by cross-tool jump helpers: the next push() treats the current
 *  selection as the NEW entry's state (no refresh of the outgoing entry). */
let pendingCrossToolJump = false;

export const useNavHistoryStore = create<NavHistoryState>((set, get) => ({
  stack: [],
  index: -1,

  markCrossToolJump: () => {
    pendingCrossToolJump = true;
  },

  push: (location) => {
    const { stack, index } = get();
    // v3.9 state memory: refresh the CURRENT entry's snapshot with what the
    // user had selected when leaving that tool — EXCEPT when a cross-tool
    // jump just set the selection FOR THE NEW TOOL (then the outgoing
    // entry keeps its own last-known snapshot, and the new entry adopts
    // the freshly set state).
    if (index >= 0) {
      const cur = stack[index];
      if (cur && cur.loc === location) return false; // same-location no-op
      if (!pendingCrossToolJump) {
        stack[index] = { ...cur, snap: captureSnapshot() };
      }
    }
    pendingCrossToolJump = false;
    // Truncate any forward tail (we branched off). The NEW entry starts with
    // a snapshot of the CURRENT selection too (cross-tool jumps that set the
    // selection BEFORE navigating — e.g. a Search hit → Blame — arrive with
    // the file already selected; that state belongs to the new entry).
    const kept = stack.slice(0, index + 1);
    kept.push({ loc: location, snap: captureSnapshot() });
    if (kept.length > MAX_STACK) kept.shift();
    set({ stack: kept, index: kept.length - 1 });
    return true;
  },

  back: () => {
    const { stack, index } = get();
    if (index <= 0) return null;
    const target = index - 1;
    suppressed = true;
    // Save the state the user leaves behind (so Forward can return to it)…
    stack[index] = { ...stack[index], snap: captureSnapshot() };
    // …and restore the state the target entry remembers.
    restoreSnapshot(stack[target]?.snap ?? null);
    set({ index: target, stack: [...stack] });
    return stack[target].loc;
  },

  forward: () => {
    const { stack, index } = get();
    if (index < 0 || index >= stack.length - 1) return null;
    const target = index + 1;
    suppressed = true;
    stack[index] = { ...stack[index], snap: captureSnapshot() };
    restoreSnapshot(stack[target]?.snap ?? null);
    set({ index: target, stack: [...stack] });
    return stack[target].loc;
  },

  consumeSuppressed: () => {
    const was = suppressed;
    suppressed = false;
    return was;
  },

  reset: () => {
    pendingCrossToolJump = false;
    set({ stack: [], index: -1 });
  },

  __currentSnapshotForTests: () => {
    const { stack, index } = get();
    return stack[index]?.snap ?? null;
  },
}));

/** Selectors for the toolbar buttons (disabled states). */
export const navCanGoBack = (s: NavHistoryState) => s.index > 0;
export const navCanGoForward = (s: NavHistoryState) => s.index >= 0 && s.index < s.stack.length - 1;
