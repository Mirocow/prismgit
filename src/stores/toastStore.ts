import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  detail?: string;
  duration?: number;
  /**
   * Optional object hash (commit/tag). Rendered by ToastContainer as a
   * monospace chip with a copy button instead of burying it in the detail
   * text — the user asked for the commit hash to be VISIBLE in the
   * «Коммит создан» toast (Task 29).
   */
  hash?: string;
  /** Wall-clock ms when the toast entered the queue — dedupe window key. */
  shownAt: number;
}

interface ToastState {
  toasts: Toast[];
  show: (type: ToastType, message: string, detail?: string, duration?: number, hash?: string) => void;
  dismiss: (id: number) => void;
  success: (message: string, detail?: string) => void;
  /** Success toast with a hash chip (copies the FULL hash on click). */
  successCommit: (message: string, hash: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
  info: (message: string, detail?: string) => void;
  warning: (message: string, detail?: string) => void;
}

let nextId = 1;

/**
 * MAX_TOASTS — hard cap on concurrently visible toasts. Beyond this the
 * OLDEST toast is dropped (the newest is the one the user just acted on).
 * Without a cap, a render-loop bug (e.g. a toast fired from a component's
 * render body — BranchesPage's disabled={fnThatToasts()} used to do exactly
 * that) could stack 10+ identical boxes in seconds: "выдало более 10
 * сообщений на 1 экране".
 */
const MAX_TOASTS = 5;

/**
 * Identical (type+message+detail) toasts shown within this window REPLACE
 * the previous one instead of stacking a duplicate copy. Guards the same
 * render-loop class of bugs even after the render-time emission sites are
 * fixed — a repeating background warning shows ONE toast, not N.
 */
const TOAST_DEDUPE_MS = 2_000;

/**
 * Humanize error details before showing them.
 *
 * Callers pass `String(e)`, which for an Error object renders as
 * "Error: message" — and for IPC failures often embeds long prefixes like
 * "Error: Error: ...". Humans should just see the sentence. This also
 * strips node-style stack/paths when an IPC layer attaches them.
 */
function humanizeDetail(detail?: string): string | undefined {
  if (!detail) return detail;
  let d = detail.trim();
  // Strip repeated leading "Error:" prefixes ("Error: Error: push failed").
  while (/^error:\s*/i.test(d)) d = d.replace(/^error:\s*/i, '');
  // Drop everything after a first line that looks like an internal frame.
  const nl = d.indexOf('\n');
  if (nl > 0 && /^\s+at\s/.test(d.slice(nl + 1))) d = d.slice(0, nl);
  d = d.trim();
  // Collapse "at ..." stack lines entirely.
  d = d.split('\n').filter((l) => !/^\s*at\s/.test(l)).join('\n').trim();
  // Uppercase the first letter for a sentence-like read.
  if (d && d[0] === d[0].toLowerCase() && /[a-z]/.test(d[0])) {
    d = d[0].toUpperCase() + d.slice(1);
  }
  return d || undefined;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  show: (type, message, detail, duration = 4000, hash) => {
    const id = nextId++;
    const toast: Toast = { id, type, message, detail: humanizeDetail(detail), duration, hash, shownAt: Date.now() };

    let nextToasts = get().toasts;

    // ── Dedupe: identical toast(s) (same type+message+detail) shown within
    //    TOAST_DEDUPE_MS are replaced by this one instead of stacking. The
    //    replacement gets a fresh timer, so a repeating warning stays alive
    //    while it keeps firing and disappears `duration` after the LAST
    //    occurrence. (User report: >10 identical "Merge in progress" boxes
    //    on one screen after switching Diff → Branches mid-merge.)
    const isRecentDup = (t: Toast): boolean =>
      t.type === type &&
      t.message === message &&
      t.detail === toast.detail &&
      Date.now() - t.shownAt < TOAST_DEDUPE_MS;
    if (nextToasts.some(isRecentDup)) {
      nextToasts = nextToasts.filter((t) => !isRecentDup(t));
    }

    // ── Cap: at most MAX_TOASTS visible at once; drop the OLDEST.
    if (nextToasts.length >= MAX_TOASTS) {
      nextToasts = nextToasts.slice(nextToasts.length - (MAX_TOASTS - 1));
    }

    set({ toasts: [...nextToasts, toast] });
    if (duration > 0) {
      setTimeout(() => get().dismiss(id), duration);
    }
  },

  dismiss: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  success: (m, d) => get().show('success', m, d),
  // 8s instead of the default 4s: the hash is the one thing the user may
  // still be typing into a terminal or a PR description — give them time
  // to click-copy it.
  successCommit: (m, hash, d) => get().show('success', m, d, 8000, hash),
  error: (m, d) => get().show('error', m, d, 6000),
  info: (m, d) => get().show('info', m, d),
  warning: (m, d) => get().show('warning', m, d, 5000),
}));

/**
 * Stable selector for the action methods only.
 *
 * Components that ONLY call toast.success/error/info/warning don't need to
 * re-render when a new toast is shown or dismissed — the action functions
 * themselves are stable references defined once in the store. Using
 * useShallow on the actions object lets the selector return the same
 * reference on every state change, eliminating cascading re-renders
 * across the ~44 components that consume toast actions.
 *
 * Previously `const toast = useToastStore()` subscribed to the ENTIRE
 * state, so every toast shown triggered re-renders of 44 component trees.
 */
export function useToastActions() {
  return useToastStore(useShallow((s) => ({
    success: s.success,
    successCommit: s.successCommit,
    error: s.error,
    info: s.info,
    warning: s.warning,
    show: s.show,
    dismiss: s.dismiss,
  })));
}
