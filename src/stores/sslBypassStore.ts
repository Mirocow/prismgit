/**
 * sslBypassStore — the TLS-certificate reaction surface (the third pillar of
 * the failure-reaction matrix, alongside surfaceConflictedState for local
 * conflicts and pushRejectionStore for remote-side push rejections).
 *
 * A pull/push/fetch to a server whose certificate git rejects (expired,
 * self-signed, unknown CA — typical for internal corporate Git servers)
 * used to end as a dead-end error toast:
 *   fatal: unable to access 'https://git.nbgi.cloud.rt-dc.ru/…':
 *   SSL certificate problem: certificate has expired
 *
 * offerSslBypass() is the one-liner every network catch site calls:
 *   catch (e) {
 *     if (offerSslBypass(e, { repoPath, retry: () => doItAgain() })) return;
 *     toast.error(...);  // not an SSL problem — keep the generic reaction
 *   }
 * It opens this store (→ SslBypassDialog, mounted once in App.tsx) for every
 * TLS certificate failure and returns false for everything else so the
 * caller keeps its generic error toast — exactly the offerPushRejection()
 * contract, so catch sites can chain both.
 *
 * The dialog's primary action writes `http.sslVerify=false` into the ONE
 * repository's local config (the sanctioned SmartGit/GitKraken workaround —
 * traffic stays TLS-encrypted, only the trust check is dropped for that
 * repo), registers the host for API-level bypass (insecureSslHosts), and
 * RETRIES the original operation via the `retry` closure.
 */
import { create } from 'zustand';
import { classifySslFailure, type SslFailureInfo } from '../lib/sslErrors';

export interface SslBypassCtx {
  repoPath: string;
  /** Classified TLS failure (kind drives the dialog's explanation). */
  failure: SslFailureInfo;
  /**
   * Re-runs the ORIGINAL failed operation after the bypass is applied.
   * The closure owns its own success toasts; the dialog handles failure
   * toasts. Optional — when omitted the dialog only applies the bypass.
   */
  retry?: () => Promise<void>;
  /**
   * CLONE contexts: the repository does not exist yet, so there is no local
   * config to write — the retried clone carries its own
   * `-c http.sslVerify=false` (which git also persists into the new repo's
   * config via `clone --config`). The dialog then only registers the host
   * (provider API calls) and retries.
   */
  skipConfigWrite?: boolean;
}

interface SslBypassState {
  ctx: SslBypassCtx | null;
  open: (ctx: SslBypassCtx) => void;
  close: () => void;
}

export const useSslBypassStore = create<SslBypassState>((set) => ({
  ctx: null,
  open: (ctx) => set({ ctx }),
  close: () => set({ ctx: null }),
}));

/**
 * Offer the reactive SslBypassDialog for a caught network error.
 * Returns true when the dialog took over the reaction (caller stays
 * silent); false when the error is not a TLS certificate problem (caller
 * shows its usual error toast).
 */
export function offerSslBypass(
  err: unknown,
  info: Omit<SslBypassCtx, 'failure'>,
): boolean {
  const failure = classifySslFailure(err);
  if (!failure) return false;
  useSslBypassStore.getState().open({ ...info, failure });
  return true;
}
