/**
 * authBypassStore — the HTTP-authentication reaction surface (the fourth
 * pillar of the failure-reaction matrix, alongside surfaceConflictedState
 * for local conflicts, pushRejectionStore for remote-side push rejections
 * and sslBypassStore for rejected TLS certificates).
 *
 * A pull/push/fetch/clone to a server that REQUIRES login+password (the
 * internal corporate Git case, right after the certificate story) used to
 * end as a dead-end error toast:
 *   fatal: could not read Username for
 *   'https://git.nbgi.cloud.rt-dc.ru': terminal prompts disabled
 *
 * offerAuthBypass() is the one-liner every network catch site calls:
 *   catch (e) {
 *     if (offerSslBypass(e, { repoPath, retry })) return;   // TLS first
 *     if (offerAuthBypass(e, { repoPath, retry })) return;  // then auth
 *     toast.error(...);  // neither — keep the generic reaction
 *   }
 * It opens this store (→ RemoteAuthDialog, mounted once in App.tsx) for
 * every HTTP(S) authentication failure and returns false for everything
 * else so the caller keeps its generic error toast — exactly the
 * offerSslBypass()/offerPushRejection() contract, so catch sites can chain
 * all three.
 *
 * The dialog's primary action asks the user for Username + Password/token,
 * SAVES them per repo+remote (remoteAuth settings map — password in the
 * encrypted vault, never in .git/config or the remote URL), drops the
 * main-process credential cache and RETRIES the original operation via the
 * `retry` closure. The retry closure may receive the credential so CLONE
 * contexts (repo does not exist yet) can carry them on the command line.
 */
import { create } from 'zustand';
import { classifyAuthFailure, type AuthFailureInfo } from '../lib/authErrors';
import type { RemoteCredential } from '../../electron/types/settings-api';

export interface AuthBypassCtx {
  repoPath: string;
  /**
   * Best-known remote name for the failed operation. The dialog preselects
   * it in its remote picker; when omitted (most pull/push call sites use
   * the default remote) the remote is matched by the failing URL's host.
   */
  remoteName?: string;
  /** Classified auth failure (kind drives the dialog's explanation). */
  failure: AuthFailureInfo;
  /**
   * Re-runs the ORIGINAL failed operation after the credentials are saved.
   * Receives the just-saved credential: regular repo operations IGNORE it
   * (the main process re-reads remoteAuth itself), CLONE contexts pass it
   * into the clone command line (the repo does not exist yet, so the retry
   * must carry the credentials with it). Optional — when omitted the dialog
   * only saves the credentials.
   */
  retry?: (cred?: RemoteCredential) => Promise<void>;
}

interface AuthBypassState {
  ctx: AuthBypassCtx | null;
  open: (ctx: AuthBypassCtx) => void;
  close: () => void;
}

export const useAuthBypassStore = create<AuthBypassState>((set) => ({
  ctx: null,
  open: (ctx) => set({ ctx }),
  close: () => set({ ctx: null }),
}));

/**
 * Offer the reactive RemoteAuthDialog for a caught network error.
 * Returns true when the dialog took over the reaction (caller stays
 * silent); false when the error is not an HTTP(S) authentication problem
 * (caller shows its usual error toast).
 */
export function offerAuthBypass(
  err: unknown,
  info: Omit<AuthBypassCtx, 'failure'>
): boolean {
  const failure = classifyAuthFailure(err);
  if (!failure) return false;
  useAuthBypassStore.getState().open({ ...info, failure });
  return true;
}
