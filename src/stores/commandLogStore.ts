import { create } from 'zustand';
import type { CommandLogEntry } from '../lib/api';
import { api } from '../lib/api';

/**
 * Command Log Store (raw git commands)
 * ====================================
 *
 * Mirrors the main-process ring buffer of actual `git <args>` child processes
 * (captured by the spawn interceptor in electron/services/commandLog.ts) into
 * the renderer for the Output panel's "Commands" tab.
 *
 * Unlike the operation log (operationLogStore, manual per-call instrumentation)
 * this log is complete: every git invocation the app ever makes appears here,
 * with its real command line, raw stdout/stderr, exit code and duration.
 *
 * Newest first, capped at 500 entries (same cap as the main-process buffer).
 *
 * Auto-open-on-error: when a new entry arrives with exitCode !== 0 AND the
 * panel is currently closed, `errorPulse` is bumped. App.tsx watches
 * `errorPulse` and opens the panel + sets the errorsOnly filter so the
 * user immediately sees what went wrong. The user can then dismiss the
 * panel and continue — the pulse only triggers on transitions from
 * "no recent errors" to "an error just happened".
 */

const MAX_ENTRIES = 500;

interface CommandLogState {
  entries: CommandLogEntry[];
  /**
   * Counter that increments whenever a NEW failed entry arrives while the
   * panel is closed. App.tsx watches this value and opens the panel when
   * it changes. The user manually dismissing the panel does NOT reset this
   * — only the next failed entry while closed bumps it again.
   */
  errorPulse: number;
  /** Initial list pulled from the main process. */
  load: () => Promise<void>;
  /** Append a live entry coming from the command-log:entry broadcast. */
  append: (entry: CommandLogEntry) => void;
  /** Forget all entries (main process + this mirror). */
  clear: () => Promise<void>;
}

export const useCommandLogStore = create<CommandLogState>((set) => ({
  entries: [],
  errorPulse: 0,

  load: async () => {
    try {
      const list = await api.commandLog.list();
      set({ entries: list });
    } catch {
      // Main process unavailable (e.g. tests) — keep whatever we have.
    }
  },

  append: (entry) => {
    set((state) => {
      const next = [entry, ...state.entries];
      if (next.length > MAX_ENTRIES) next.length = MAX_ENTRIES;
      // Bump errorPulse when a failed entry arrives — App.tsx opens the
      // panel + filters to errors-only. Threshold: panel must be closed
      // (we can't see it from here, but App.tsx only reacts when closed).
      return {
        entries: next,
        errorPulse: entry.exitCode !== 0 ? state.errorPulse + 1 : state.errorPulse,
      };
    });
  },

  clear: async () => {
    set({ entries: [] });
    try {
      await api.commandLog.clear();
    } catch {
      // Buffer already cleared locally; main-process clear is best-effort.
    }
  },
}));
