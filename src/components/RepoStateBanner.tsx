import type { StatusResult } from '../lib/api';
import { getRepoInProgressState } from '../lib/repoState';
import { shortHash } from '../lib/utils';
import { AlertTriangle, Check, X, Undo } from './icons';

/**
 * Per-state resolution actions. Every group is optional so callers can wire
 * only the states they support — the banner renders buttons for the ACTIVE
 * state only.
 *
 * Button set per state (strict — NO other buttons are rendered):
 *   cherry-picking  → Continue, Abort
 *   reverting        → Continue, Abort
 *   merging          → Abort
 *   rebasing         → Continue, Abort
 *   bisecting        → Mark HEAD as Bad, Mark HEAD as Good, Abort
 *
 * (bisect-multi, cherry-pick-empty, multi-conflict, rebase-multi-step are
 *  variations of the same underlying git state and surface the SAME button
 *  set as their base state.)
 */
export interface RepoStateHandlers {
  cherryPick?: {
    onContinue: () => void;
    onSkip?: () => void;
    /** Finalize the empty pick as an empty commit (git commit --allow-empty). */
    onCommitEmpty?: () => void;
    onAbort: () => void;
  };
  revert?: { onContinue: () => void; onSkip?: () => void; onAbort: () => void };
  merge?: { onAbort: () => void };
  rebase?: { onContinue: () => void; onSkip?: () => void; onAbort: () => void };
  bisect?: {
    onGood: () => void;
    onBad: () => void;
    onSkip?: () => void;
    /** End the bisect session — wired to the "Abort" button (git bisect reset). */
    onReset: () => void;
  };
}

export interface RepoStateBannerProps {
  status: StatusResult | null;
  busy?: boolean;
  handlers: RepoStateHandlers;
}

const FOOTERS: Record<string, string> = {
  'cherry-picking':
    'Only Continue / Abort are allowed — Pull, Checkout and Commit would lead to loss of the picked commit. Fetch is still available.',
  'reverting':
    'Only Continue / Abort are allowed — Pull, Checkout and Commit would lead to loss of the revert. Fetch is still available.',
  'merging':
    'Resolve conflicts and Commit to complete the merge, or Abort — Pull, Checkout and Reset would discard the merge. Fetch is still available.',
  'rebasing':
    'Only Continue / Abort are allowed — Pull, Checkout and Commit would discard the rebase. Fetch is still available.',
  'bisecting':
    'HEAD is detached at the bisect candidate — mark it Good / Bad or Abort the bisect. Pull, Checkout and Commit would interfere with the search. Fetch is still available.',
};

/**
 * SmartGit Manual (Log / Working tree states): while a sequencer operation is
 * in progress the working tree is in an explicit state — "The working tree is
 * in cherry-picking-state." / "merging-state." / "rebasing-state." /
 * "reverting-state." / "bisecting-state." — shown as a banner with ONLY the
 * state-resolving actions enabled. Everything else (Pull, Checkout, Merge,
 * Reset) is blocked until the state resolves, because those operations would
 * discard the unfinished work.
 *
 * Button set is STRICT per the spec:
 *   cherry-picking / reverting / rebasing → Continue, Abort
 *   merging → Abort
 *   bisecting → Mark HEAD as Bad, Mark HEAD as Good, Abort
 * No other buttons (no Skip, no Commit Empty, no Reset, no Stash All) are
 * rendered — those handlers exist in the interface for caller convenience
 * but are intentionally not surfaced in the banner.
 */
export function RepoStateBanner({ status, busy, handlers }: RepoStateBannerProps) {
  const state = getRepoInProgressState(status);
  // If status is null or no in-progress state is active, render nothing.
  // After this guard, status is guaranteed non-null because getRepoInProgressState
  // returns null for null status.
  if (!state || !status) return null;

  const detail = (() => {
    switch (state.key) {
      case 'cherry-picking':
        return status.cherryPick ? (
          <span className="text-text-secondary truncate" data-testid="cherry-pick-commit">
            Picking <code className="font-mono">{shortHash(status.cherryPick.commit)}</code>
            {status.cherryPick.subject ? <> — “{status.cherryPick.subject}”</> : null}
          </span>
        ) : null;
      case 'reverting':
        return status.revert ? (
          <span className="text-text-secondary truncate" data-testid="revert-commit">
            Reverting <code className="font-mono">{shortHash(status.revert.commit)}</code>
            {status.revert.subject ? <> — “{status.revert.subject}”</> : null}
          </span>
        ) : null;
      case 'merging':
        return status.merge?.message ? (
          <span className="text-text-secondary truncate" data-testid="merge-message">
            {status.merge.message}
          </span>
        ) : null;
      case 'rebasing':
        return (
          <span className="text-text-secondary truncate" data-testid="rebase-progress">
            {status.rebase?.step != null && status.rebase?.total != null
              ? `Step ${status.rebase.step} of ${status.rebase.total}`
              : 'Rebase in progress'}
          </span>
        );
      case 'bisecting':
        return status.bisect?.rev ? (
          <span className="text-text-secondary truncate" data-testid="bisect-rev">
            Testing <code className="font-mono">{shortHash(status.bisect.rev)}</code>
          </span>
        ) : null;
    }
  })();

  const cp = handlers.cherryPick;
  const rv = handlers.revert;
  const mg = handlers.merge;
  const rb = handlers.rebase;
  const bs = handlers.bisect;

  return (
    <div
      data-testid="repo-state-banner"
      className="flex items-center gap-2 px-3 py-1.5 border-b border-status-conflict/40 bg-status-conflict/10 text-xs"
    >
      <AlertTriangle size={13} className="text-status-conflict flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-status-conflict" data-testid="repo-state-text">
            {state.bannerText}
          </span>
          {detail}
        </div>
        <div className="text-2xs text-text-tertiary mt-0.5">{FOOTERS[state.key]}</div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* cherry-picking (incl. empty & conflict): Continue, Abort */}
        {state.key === 'cherry-picking' && cp && (
          <>
            <button
              className="btn btn-primary text-2xs !py-0.5 !px-2"
              onClick={cp.onContinue}
              disabled={busy}
              title="Finish the cherry-pick: commit the picked changes into the current branch"
            >
              <Check size={9} /> Continue
            </button>
            <button
              className="btn btn-danger text-2xs !py-0.5 !px-2"
              onClick={cp.onAbort}
              disabled={busy}
              title="Cancel the cherry-pick and restore the previous state (git cherry-pick --abort)"
            >
              <X size={9} /> Abort
            </button>
          </>
        )}
        {/* reverting: Continue, Abort */}
        {state.key === 'reverting' && rv && (
          <>
            <button
              className="btn btn-primary text-2xs !py-0.5 !px-2"
              onClick={rv.onContinue}
              disabled={busy}
              title="Finish the revert: commit the reverted changes into the current branch"
            >
              <Check size={9} /> Continue
            </button>
            <button
              className="btn btn-danger text-2xs !py-0.5 !px-2"
              onClick={rv.onAbort}
              disabled={busy}
              title="Cancel the revert and restore the previous state (git revert --abort)"
            >
              <X size={9} /> Abort
            </button>
          </>
        )}
        {/* merging (incl. multi-conflict): Abort */}
        {state.key === 'merging' && mg && (
          <button
            className="btn btn-danger text-2xs !py-0.5 !px-2"
            onClick={mg.onAbort}
            disabled={busy}
            title="Cancel the merge and restore the pre-merge state (git merge --abort)"
          >
            <X size={9} /> Abort
          </button>
        )}
        {/* rebasing (incl. multi-step): Continue, Abort */}
        {state.key === 'rebasing' && rb && (
          <>
            <button
              className="btn btn-primary text-2xs !py-0.5 !px-2"
              onClick={rb.onContinue}
              disabled={busy}
              title="Continue the rebase with the resolved conflicts (git rebase --continue)"
            >
              <Check size={9} /> Continue
            </button>
            <button
              className="btn btn-danger text-2xs !py-0.5 !px-2"
              onClick={rb.onAbort}
              disabled={busy}
              title="Cancel the rebase and restore the original branch (git rebase --abort)"
            >
              <X size={9} /> Abort
            </button>
          </>
        )}
        {/* bisecting (incl. multi): Mark HEAD as Bad, Mark HEAD as Good, Abort */}
        {state.key === 'bisecting' && bs && (
          <>
            <button
              className="btn btn-secondary text-2xs !py-0.5 !px-2"
              onClick={bs.onBad}
              disabled={busy}
              title="Mark HEAD as bad — the current revision is broken (git bisect bad)"
            >
              <X size={9} /> Mark HEAD as Bad
            </button>
            <button
              className="btn btn-primary text-2xs !py-0.5 !px-2"
              onClick={bs.onGood}
              disabled={busy}
              title="Mark HEAD as good — the current revision works correctly (git bisect good)"
            >
              <Check size={9} /> Mark HEAD as Good
            </button>
            <button
              className="btn btn-danger text-2xs !py-0.5 !px-2"
              onClick={bs.onReset}
              disabled={busy}
              title="End the bisect session and return to the original branch (git bisect reset)"
            >
              <Undo size={9} /> Abort
            </button>
          </>
        )}
      </div>
    </div>
  );
}
