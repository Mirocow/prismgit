import { create } from 'zustand';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  detail?: string;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  show: (type: ToastType, message: string, detail?: string, duration?: number) => void;
  dismiss: (id: number) => void;
  success: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
  info: (message: string, detail?: string) => void;
  warning: (message: string, detail?: string) => void;
}

let nextId = 1;

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

  show: (type, message, detail, duration = 4000) => {
    const id = nextId++;
    const toast: Toast = { id, type, message, detail: humanizeDetail(detail), duration };
    set({ toasts: [...get().toasts, toast] });
    if (duration > 0) {
      setTimeout(() => get().dismiss(id), duration);
    }
  },

  dismiss: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  success: (m, d) => get().show('success', m, d),
  error: (m, d) => get().show('error', m, d, 6000),
  info: (m, d) => get().show('info', m, d),
  warning: (m, d) => get().show('warning', m, d, 5000),
}));
