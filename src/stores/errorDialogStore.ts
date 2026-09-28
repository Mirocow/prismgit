import { create } from 'zustand';

/**
 * errorDialogStore — store-driven CENTERED error dialog for failed git
 * operations (the PushRejectionDialog pattern, generalized).
 *
 * User report: «При переключении на Remote ветку словил сообщение а не
 * диалоговое окно: Error: Не удалось переключить ветку...» — failures of
 * user-initiated actions surfaced as a small bottom-right toast with a raw
 * "Error invoking remote method 'git:checkout'" detail. Errors of explicit
 * user actions now open a proper modal in the middle of the app window,
 * in the same visual style as every other dialog (canonical
 * bg-black/30 dark:bg-black/55 centered overlay).
 *
 * Toasts remain for transient/background notifications — this dialog is for
 * ACTION failures the user needs to read and acknowledge.
 */
export interface ErrorDialogState {
  open: boolean;
  title: string;
  /** Short human message (already localized by the caller). */
  message: string;
  /** Raw error detail (stack-ish text) — shown in a collapsible block. */
  detail: string;
  /** Show the dialog. Flattens "Error: Error:" chains like toastStore does. */
  show: (opts: { title: string; message?: string; detail?: string }) => void;
  close: () => void;
}

function humanize(detail: string): string {
  let d = detail.trim();
  while (/^error:\s*/i.test(d)) d = d.replace(/^error:\s*/i, '');
  // Strip the Electron IPC boilerplate prefix — the user cares about the
  // git-level message, not the transport.
  d = d.replace(/^Error invoking remote method '[^']*':\s*/i, '');
  const nl = d.indexOf('\n');
  if (nl > 0 && /^\s+at\s/.test(d.slice(nl + 1))) d = d.slice(0, nl);
  d = d.split('\n').filter((l) => !/^\s*at\s/.test(l)).join('\n').trim();
  if (d && d[0] === d[0].toLowerCase() && /[a-zа-я]/.test(d[0])) {
    d = d[0].toUpperCase() + d.slice(1);
  }
  return d;
}

export const useErrorDialogStore = create<ErrorDialogState>((set) => ({
  open: false,
  title: '',
  message: '',
  detail: '',
  show: (opts) => {
    set({
      open: true,
      title: opts.title,
      message: opts.message ?? '',
      detail: opts.detail ? humanize(opts.detail) : '',
    });
  },
  close: () => set({ open: false }),
}));

/** Imperative helper for non-React callers (stores, lib). */
export function showErrorDialog(opts: { title: string; message?: string; detail?: string }): void {
  useErrorDialogStore.getState().show(opts);
}
