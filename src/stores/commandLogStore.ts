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
 */

const MAX_ENTRIES = 500;

interface CommandLogState {
  entries: CommandLogEntry[];
  /** Initial list pulled from the main process. */
  load: () => Promise<void>;
  /** Append a live entry coming from the command-log:entry broadcast. */
  append: (entry: CommandLogEntry) => void;
  /** Forget all entries (main process + this mirror). */
  clear: () => Promise<void>;
}

export const useCommandLogStore = create<CommandLogState>((set) => ({
  entries: [],

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
      return { entries: next };
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
