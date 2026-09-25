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
  /**
   * QW-5 — timestamp (ms since epoch) of the most recent time the user
   * manually closed the Command Log panel. App.tsx checks this before
   * auto-opening on the next errorPulse: if less than 30s have elapsed,
   * the auto-open is suppressed (so a user who just dismissed the panel
   * does not have it pop right back open on the next failed git call).
   * 0 means 'never manually closed'.
   */
  lastManualCloseAt: number;
  /** Initial list pulled from the main process. */
  load: () => Promise<void>;
  /** Append a live entry coming from the command-log:entry broadcast. */
  append: (entry: CommandLogEntry) => void;
  /** Append a whole 100 ms main-process batch in ONE set() — one array
   *  copy, one re-render, one errorPulse evaluation. Prefer over per-entry
   *  append(): during a "Check all repositories" burst the per-entry path
   *  fires N back-to-back set()s, each copying the 500-entry array — enough
   *  back-to-back JS work to freeze the renderer's main thread for the
   *  duration of the burst. */
  appendBatch: (entries: CommandLogEntry[]) => void;
  /** Forget all entries (main process + this mirror). */
  clear: () => Promise<void>;
  /** QW-5 — mark that the user just manually closed the panel. */
  markManualClose: () => void;
}

export const useCommandLogStore = create<CommandLogState>((set) => ({
  entries: [],
  errorPulse: 0,
  lastManualCloseAt: 0,

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

  appendBatch: (batch) => {
    if (!Array.isArray(batch) || batch.length === 0) return;
    set((state) => {
      // Batch arrives oldest→newest from main; the mirror is newest-first —
      // reverse once, then ONE prepend of the whole block.
      const block = batch.slice().reverse();
      const next = [...block, ...state.entries];
      if (next.length > MAX_ENTRIES) next.length = MAX_ENTRIES;
      // errorPulse semantics identical to append(): a transition to "an
      // error just happened" — bumped ONCE per batch if any entry failed
      // (App.tsx's auto-open already coalesces rapid pulses; per-entry
      // bumping just burned renders).
      const anyFailed = batch.some((e) => e.exitCode !== 0);
      return {
        entries: next,
        errorPulse: anyFailed ? state.errorPulse + 1 : state.errorPulse,
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

  markManualClose: () => set({ lastManualCloseAt: Date.now() }),
}));
