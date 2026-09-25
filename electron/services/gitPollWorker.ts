import { runPollJob } from './gitPollCore.js';
import type { PollJobRequest } from './gitPollCore.js';

/**
 * GIT POLL WORKER — the entry file of the DEDICATED Electron utilityProcess
 * that owns the repository-list remote check (gitPollProcess.fork() loads
 * the compiled `dist-electron/gitPollWorker.js`).
 *
 * The status fetch ("проверка удалённых репозиториев") runs here — in its
 * own OS process, with its own event loop — instead of the Electron main
 * process. The main process stays free to broker renderer IPC, which is
 * what keeps the UI responsive while a poll against slow/hung remotes is
 * in flight (and while `status --porcelain` / `rev-list` walks chew through
 * big repositories).
 *
 * Protocol (see electron/services/gitPollProcess.ts — the main-side peer):
 *   main  → worker : { kind: 'poll', id: number, request: PollJobRequest }
 *   worker → main  : { kind: 'ready' }                       (once, at startup)
 *                    { kind: 'poll-result', id, result: PollJobResult }
 *                    { kind: 'poll-error',  id, message: string }
 *
 * Everything is plain JSON-serializable data. The worker holds no settings,
 * no secrets, no Electron imports — the main process resolves which remotes
 * to fetch, the SSH env and the HTTP auth args and passes them per request.
 *
 * NOTE: in a utility process `process.parentPort` is the MessagePort-like
 * channel to the main process (undefined everywhere else — importing this
 * module outside a utility process is a harmless no-op, which is exactly
 * what the vitest protocol tests rely on). Messages FROM main arrive as
 * MessageEvent-shaped objects (`event.data`); messages TO main are posted
 * with plain `postMessage(payload)` and arrive in main as the payload
 * itself.
 */

interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

interface PollMessage {
  kind: 'poll';
  id: number;
  request: PollJobRequest;
}

function isPollMessage(data: unknown): data is PollMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as { kind?: unknown; id?: unknown; request?: unknown };
  return (
    msg.kind === 'poll' &&
    typeof msg.id === 'number' &&
    !!msg.request &&
    typeof (msg.request as { repoPath?: unknown }).repoPath === 'string'
  );
}

const port: ParentPort | undefined = (process as { parentPort?: ParentPort }).parentPort;

if (port) {
  port.on('message', (event) => {
    const data = (event as { data?: unknown } | undefined)?.data;
    if (!isPollMessage(data)) return; // malformed/unknown messages are ignored, never crash the worker
    const { id, request } = data;
    runPollJob(request)
      .then((result) => {
        port.postMessage({ kind: 'poll-result', id, result });
      })
      .catch((e: unknown) => {
        // runPollJob is designed not to throw (fetch errors land in
        // result.error); this is the belt-and-braces protocol branch.
        port.postMessage({
          kind: 'poll-error',
          id,
          message: e instanceof Error ? e.message : String(e),
        });
      });
  });

  // Tell the main process the listener is registered. Main buffers poll
  // requests until 'ready' arrives (plus a ready-timeout escape hatch), so
  // no request posted immediately after fork can be lost while this module
  // is still being required.
  port.postMessage({ kind: 'ready' });
}
