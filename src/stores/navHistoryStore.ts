import { create } from 'zustand';

/**
 * NAV HISTORY — in-app Back/Forward navigation (browser-style) between tools
 * and views. The user's request: «в инструментах не хватает кнопок назад,
 * вперёд как в браузере, чтоб легко выполнять навигацию при анализе истории
 * коммитов, файлов, различий».
 *
 * DESIGN: a plain stack of locations (pathname + search). React-router's own
 * history is NOT used because the app performs many *automatic* navigations
 * (repo open → /changes, window-state change → /changes, conflict redirect)
 * which pollute the browser stack and would make Back mostly useless — it
 * would step through app-internal jumps instead of the user's trail. This
 * store records only what the user actually visited, one entry per location.
 *
 * Cooperation contract with App.tsx: the location-effect pushes every change
 * UNLESS the change came from back()/forward() (they set a one-shot
 * suppression flag that the effect consumes). So the stack only grows on
 * real user-driven navigation.
 */
interface NavHistoryState {
  /** Seen locations, oldest first. Capped (oldest evicted) to bound memory. */
  stack: string[];
  /** Index of the CURRENT location inside stack, -1 until first push. */
  index: number;
  back: () => string | null;
  forward: () => string | null;
  /** Record a user-driven location change. Returns false for no-ops. */
  push: (location: string) => boolean;
  /** One-shot suppression consumed by the App location effect. */
  consumeSuppressed: () => boolean;
  /** Wipe (repo switch / app reset). */
  reset: () => void;
}

const MAX_STACK = 60;
let suppressed = false;

export const useNavHistoryStore = create<NavHistoryState>((set, get) => ({
  stack: [],
  index: -1,

  push: (location) => {
    const { stack, index } = get();
    if (index >= 0 && stack[index] === location) return false;
    // Truncate any forward tail (we branched off).
    const kept = stack.slice(0, index + 1);
    kept.push(location);
    if (kept.length > MAX_STACK) kept.shift();
    set({ stack: kept, index: kept.length - 1 });
    return true;
  },

  back: () => {
    const { stack, index } = get();
    if (index <= 0) return null;
    const target = index - 1;
    suppressed = true;
    set({ index: target });
    return stack[target];
  },

  forward: () => {
    const { stack, index } = get();
    if (index < 0 || index >= stack.length - 1) return null;
    const target = index + 1;
    suppressed = true;
    set({ index: target });
    return stack[target];
  },

  consumeSuppressed: () => {
    const was = suppressed;
    suppressed = false;
    return was;
  },

  reset: () => set({ stack: [], index: -1 }),
}));

/** Selectors for the toolbar buttons (disabled states). */
export const navCanGoBack = (s: NavHistoryState) => s.index > 0;
export const navCanGoForward = (s: NavHistoryState) => s.index >= 0 && s.index < s.stack.length - 1;
