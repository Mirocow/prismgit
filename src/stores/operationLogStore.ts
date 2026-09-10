import { create } from 'zustand';

/**
 * Operation Log Store
 * ===================
 *
 * Tracks every Git command executed by the app — push, pull, commit, fetch,
 * checkout, merge, etc. Each operation is recorded with:
 *   - timestamp
 *   - action name (human-readable)
 *   - underlying git command (shown when expanded)
 *   - status: 'running' | 'success' | 'error'
 *   - repoPath (which repo the command ran in)
 *   - duration (ms, set on completion)
 *
 * The StatusBar reads `runningOps` to show a progress indicator.
 * The CommandLogPanel reads `ops` to show the timestamped history.
 *
 * Operations older than 100 entries are automatically pruned.
 */

export type OpStatus = 'running' | 'success' | 'error';

export interface OperationLog {
  /** Unique ID (used as React key). */
  id: string;
  /** Timestamp when the operation started. */
  timestamp: number;
  /** Human-readable action name, e.g. "Pull (Merge)", "Push", "Commit". */
  action: string;
  /** The actual git command that was run, e.g. "git pull origin main --rebase". */
  command?: string;
  /** Status: running, success, or error. */
  status: OpStatus;
  /** Repo path where the command ran. */
  repoPath: string;
  /** Duration in milliseconds (set on completion). */
  duration?: number;
  /** Error message if status === 'error'. */
  error?: string;
  /** Output/result summary (e.g. "3 files changed, 10 insertions"). */
  result?: string;
}

interface OperationLogState {
  /** All operations, newest first. Capped at 100 entries. */
  ops: OperationLog[];
  /** Operations currently running (subset of ops where status === 'running'). */
  runningIds: Set<string>;

  /** Start tracking a new operation. Returns the ID for later completion. */
  startOp: (action: string, repoPath: string, command?: string) => string;
  /** Mark an operation as succeeded. */
  finishOp: (id: string, result?: string) => void;
  /** Mark an operation as failed. */
  failOp: (id: string, error: string) => void;
  /** Clear all operations from the log. */
  clearLog: () => void;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `op-${Date.now()}-${idCounter}`;
}

function pruneOldOps(ops: OperationLog[]): OperationLog[] {
  // Keep the 100 most recent entries (ops are newest-first)
  if (ops.length <= 100) return ops;
  return ops.slice(0, 100);
}

export const useOperationLogStore = create<OperationLogState>((set, get) => ({
  ops: [],
  runningIds: new Set(),

  startOp: (action, repoPath, command) => {
    const id = nextId();
    const entry: OperationLog = {
      id,
      timestamp: Date.now(),
      action,
      command,
      status: 'running',
      repoPath,
    };
    set((state) => ({
      ops: pruneOldOps([entry, ...state.ops]),
      runningIds: new Set([...state.runningIds, id]),
    }));
    return id;
  },

  finishOp: (id, result) => {
    const startTime = get().ops.find((o) => o.id === id)?.timestamp;
    const duration = startTime ? Date.now() - startTime : undefined;
    set((state) => ({
      ops: state.ops.map((o) =>
        o.id === id
          ? { ...o, status: 'success' as OpStatus, duration, result }
          : o
      ),
      runningIds: (() => {
        const next = new Set(state.runningIds);
        next.delete(id);
        return next;
      })(),
    }));
  },

  failOp: (id, error) => {
    const startTime = get().ops.find((o) => o.id === id)?.timestamp;
    const duration = startTime ? Date.now() - startTime : undefined;
    set((state) => ({
      ops: state.ops.map((o) =>
        o.id === id
          ? { ...o, status: 'error' as OpStatus, duration, error }
          : o
      ),
      runningIds: (() => {
        const next = new Set(state.runningIds);
        next.delete(id);
        return next;
      })(),
    }));
  },

  clearLog: () => set({ ops: [], runningIds: new Set() }),
}));
