/**
 * Command Log API — raw git command history captured in the main process.
 *
 * Every actual `git <args>` child process spawned by the app (simple-git and
 * custom spawn helpers alike) is recorded with its full output, so the user
 * can review exactly what was executed and what git answered — including
 * ref statuses git writes to stderr on success (push/fetch/pull).
 */

export interface CommandLogEntry {
  /** Monotonic id (unique per app session). */
  id: number;
  /** Epoch ms when the process was spawned. */
  timestamp: number;
  /** Working directory the command ran in (repo path). */
  repo: string;
  /** Sanitized git arguments (without the leading 'git'), e.g. ['push', 'origin', 'main']. */
  args: string[];
  /** Process exit code, or null if git could not be spawned at all. */
  exitCode: number | null;
  /** Termination signal, if the process was killed instead of exiting. */
  signal: string | null;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Captured stdout (truncated). */
  stdout: string;
  /** Captured stderr (truncated). Git writes ref status lines here even on success. */
  stderr: string;
}

export interface CommandLogApi {
  /** All captured entries (most recent first), capped by the ring buffer. */
  list: () => Promise<CommandLogEntry[]>;
  /** Forget all captured entries. */
  clear: () => Promise<void>;
  /** Live feed of new entries. Returns an unsubscribe function. */
  onEntry: (cb: (entry: CommandLogEntry) => void) => () => void;
}
