/**
 * pushRejectionStore — the remote-conflict half of the conflict-reaction
 * matrix. Local conflicts (pull/merge/rebase/cherry-pick/stash/gitflow)
 * react via surfaceConflictedState → Changes resolver. A REJECTED PUSH is
 * a different shape: the repo is CLEAN, nothing is mid-sequence — the
 * conflict is between the local and the REMOTE branch state, and the
 * reaction must offer the user a choice (pull / rebase / force / create
 * MR) rather than navigate anywhere.
 *
 * offerPushRejection() is the one-liner every push catch site calls:
 *   catch (e) {
 *     if (!(await offerPushRejection(e, { repoPath }))) toast.error(...);
 *   }
 * It opens this store (→ PushRejectionDialog, mounted once in App.tsx)
 * for every RECOVERABLE kind and returns false for everything else so the
 * caller keeps its generic error toast.
 */
import { create } from 'zustand';
import { classifyPushFailure, type PushFailureInfo } from '../lib/pushFailures';

export interface PushRejectionCtx {
  repoPath: string;
  failure: PushFailureInfo;
  /** Original push parameters — the recovery actions RETRY the same push. */
  remote?: string;
  branch?: string;
  /** Remote-side branch (Push To…: branch:target). Used for MR URL + policy. */
  targetBranch?: string;
  force?: boolean;
  forceMode?: 'lease' | 'force';
}

interface PushRejectionState {
  ctx: PushRejectionCtx | null;
  open: (ctx: PushRejectionCtx) => void;
  close: () => void;
}

export const usePushRejectionStore = create<PushRejectionState>((set) => ({
  ctx: null,
  open: (ctx) => set({ ctx }),
  close: () => set({ ctx: null }),
}));

/**
 * Offer the reactive PushRejectionDialog for a caught push error.
 * Returns true when the dialog took over the reaction (caller stays
 * silent); false when the error is not a recoverable remote conflict
 * (caller shows its usual error toast).
 */
export function offerPushRejection(
  err: unknown,
  info: Omit<PushRejectionCtx, 'failure'>,
): boolean {
  const failure = classifyPushFailure(err);
  if (failure.kind === 'unknown') return false;
  usePushRejectionStore.getState().open({ ...info, failure });
  return true;
}
