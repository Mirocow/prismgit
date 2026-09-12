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
  /**
   * Wrap any async function with automatic logging. This is the recommended
   * way to call git operations — it logs start, success, and failure
   * automatically, so callers don't need to manually call startOp/finishOp.
   *
   * Example:
   *   const result = await logOperation('Push', repo.path, 'git push origin main',
   *     () => api.git.push(repo.path, 'origin', 'main'));
   */
  logOperation: <T>(action: string, repoPath: string, command: string, fn: () => Promise<T>) => Promise<T>;
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

  logOperation: async (action, repoPath, command, fn) => {
    const { startOp, finishOp, failOp } = get();
    const opId = startOp(action, repoPath, command);
    try {
      const result = await fn();
      finishOp(opId, result !== undefined
        ? (typeof result === 'string'
          ? result.substring(0, 200)
          : typeof result === 'object' && result !== null
            ? JSON.stringify(result).substring(0, 200)
            : String(result).substring(0, 200))
        : undefined);
      return result;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      failOp(opId, errMsg);
      throw e;
    }
  },
}));

/**
 * IPC bridge: listen for operation-log events from the main process.
 *
 * The main process (electron/services/git.ts) wraps mutating git operations
 * (checkout, merge, cherry-pick, revert, rebase, stash, tag, clone, etc.)
 * with withOperationLog(), which broadcasts start/finish/error events to
 * all renderer windows. This listener feeds those events into the store
 * so the Operations tab shows ALL user-initiated git commands — not just
 * the ones manually instrumented in the UI layer.
 *
 * Called once from App.tsx on mount.
 */
export function initOperationLogIpcListener(): () => void {
  // Guard: window.smartgit may not exist in test environments
  if (typeof window === 'undefined' || !(window as any).smartgit) {
    return () => {}; // no-op cleanup
  }
  // Use the preload bridge instead of require('electron') — the latter
  // breaks under Vite ESM in the browser (require is not defined).
  // Preload exposes operationLog.onStart / onFinish which subscribe to
  // the same IPC channels ('operation-log:start' / 'operation-log:finish').
  const api = (window as any).smartgit;
  if (!api.operationLog) {
    return () => {}; // preload bridge missing — silent no-op
  }

  const startListener = (entry: { id: string; timestamp: number; action: string; command?: string; repoPath: string; status: 'running' }) => {
    const store = useOperationLogStore.getState();
    const op: OperationLog = {
      id: entry.id,
      timestamp: entry.timestamp,
      action: entry.action,
      command: entry.command,
      repoPath: entry.repoPath,
      status: 'running',
    };
    useOperationLogStore.setState((state) => ({
      ops: pruneOldOps([op, ...state.ops.filter(o => o.id !== entry.id)]),
      runningIds: new Set([...state.runningIds, entry.id]),
    }));
  };

  const finishListener = (entry: { id: string; status: 'success' | 'error'; result?: string; error?: string }) => {
    const startTime = useOperationLogStore.getState().ops.find((o) => o.id === entry.id)?.timestamp;
    const duration = startTime ? Date.now() - startTime : undefined;
    useOperationLogStore.setState((state) => ({
      ops: state.ops.map((o) =>
        o.id === entry.id
          ? { ...o, status: entry.status, duration, result: entry.result, error: entry.error }
          : o
      ),
      runningIds: (() => {
        const next = new Set(state.runningIds);
        next.delete(entry.id);
        return next;
      })(),
    }));
  };

  const unsubStart = api.operationLog.onStart(startListener);
  const unsubFinish = api.operationLog.onFinish(finishListener);

  return () => {
    unsubStart();
    unsubFinish();
  };
}
