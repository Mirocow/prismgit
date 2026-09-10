import type { StatusResult } from '../lib/api';
import { getRepoInProgressState } from '../lib/repoState';
import { shortHash } from '../lib/utils';
import { AlertTriangle, Check, X, SkipForward, Undo } from './icons';

/**
 * Per-state resolution actions. Every group is optional so callers can wire
 * only the states they support — the banner renders buttons for the ACTIVE
 * state only.
 */
export interface RepoStateHandlers {
  cherryPick?: {
    onContinue: () => void;
    onSkip: () => void;
    /** Finalize the empty pick as an empty commit (git commit --allow-empty). */
    onCommitEmpty: () => void;
    onAbort: () => void;
  };
  revert?: { onContinue: () => void; onSkip: () => void; onAbort: () => void };
  merge?: { onAbort: () => void };
  rebase?: { onContinue: () => void; onSkip: () => void; onAbort: () => void };
  bisect?: { onGood: () => void; onBad: () => void; onSkip: () => void; onReset: () => void };
}

export interface RepoStateBannerProps {
  status: StatusResult;
  busy?: boolean;
  handlers: RepoStateHandlers;
}

const FOOTERS: Record<string, string> = {
  'cherry-picking':
    'Only Abort / Continue are allowed — Pull, Checkout and Commit would lead to loss of the picked commit. Fetch is still available.',
  'reverting':
    'Only Abort / Continue are allowed — Pull, Checkout and Commit would lead to loss of the revert. Fetch is still available.',
  'merging':
    'Resolve conflicts and Commit to complete the merge, or Abort Merge — Pull, Checkout and Reset would discard the merge. Fetch is still available.',
  'rebasing':
    'Only Continue / Skip / Abort are allowed — Pull, Checkout and Commit would discard the rebase. Fetch is still available.',
  'bisecting':
    'HEAD is detached at the bisect candidate — mark it Good / Bad or Reset the bisect. Pull, Checkout and Commit would interfere with the search. Fetch is still available.',
};

/**
 * SmartGit Manual (Log / Working tree states): while a sequencer operation is
 * in progress the working tree is in an explicit state — "The working tree is
 * in cherry-picking-state." / "merging-state." / "rebasing-state." /
 * "reverting-state." / "bisecting-state." — shown as a banner with ONLY the
 * state-resolving actions enabled. Everything else (Pull, Checkout, Merge,
 * Reset) is blocked until the state resolves, because those operations would
 * discard the unfinished work.
 */
export function RepoStateBanner({ status, busy, handlers }: RepoStateBannerProps) {
  const state = getRepoInProgressState(status);
  if (!state) return null;

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

  const emptyHint =
    state.key === 'cherry-picking' && status.cherryPick?.empty ? (
      <span className="text-2xs text-status-modified" data-testid="cherry-pick-empty-hint">
        The previous cherry-pick is now empty (nothing to commit) — use Skip or Commit Empty.
      </span>
    ) : null;

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
          {emptyHint}
        </div>
        <div className="text-2xs text-text-tertiary mt-0.5">{FOOTERS[state.key]}</div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* cherry-picking: Continue / Commit Empty / Skip / Abort */}
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
            {status.cherryPick?.empty && (
              <button
                className="btn btn-secondary text-2xs !py-0.5 !px-2"
                onClick={cp.onCommitEmpty}
                disabled={busy}
                title="Commit the pick as an EMPTY commit (git commit --allow-empty)"
              >
                Commit Empty
              </button>
            )}
            <button
              className="btn btn-secondary text-2xs !py-0.5 !px-2"
              onClick={cp.onSkip}
              disabled={busy}
              title="Skip this commit and continue with the next one in the sequence (git cherry-pick --skip)"
            >
              <SkipForward size={9} /> Skip
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
        {/* reverting: Continue / Skip / Abort */}
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
              className="btn btn-secondary text-2xs !py-0.5 !px-2"
              onClick={rv.onSkip}
              disabled={busy}
              title="Skip this commit and continue with the next one in the sequence (git revert --skip)"
            >
              <SkipForward size={9} /> Skip
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
        {/* merging: Abort Merge (commit completes the merge — stays available) */}
        {state.key === 'merging' && mg && (
          <button
            className="btn btn-danger text-2xs !py-0.5 !px-2"
            onClick={mg.onAbort}
            disabled={busy}
            title="Cancel the merge and restore the pre-merge state (git merge --abort)"
          >
            <X size={9} /> Abort Merge
          </button>
        )}
        {/* rebasing: Continue / Skip / Abort */}
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
              className="btn btn-secondary text-2xs !py-0.5 !px-2"
              onClick={rb.onSkip}
              disabled={busy}
              title="Skip this commit and continue with the next one (git rebase --skip)"
            >
              <SkipForward size={9} /> Skip
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
        {/* bisecting: Mark Good / Mark Bad / Skip / Reset */}
        {state.key === 'bisecting' && bs && (
          <>
            <button
              className="btn btn-primary text-2xs !py-0.5 !px-2"
              onClick={bs.onGood}
              disabled={busy}
              title="The current revision works correctly (git bisect good)"
            >
              <Check size={9} /> Mark Good
            </button>
            <button
              className="btn btn-secondary text-2xs !py-0.5 !px-2"
              onClick={bs.onBad}
              disabled={busy}
              title="The current revision is broken (git bisect bad)"
            >
              <X size={9} /> Mark Bad
            </button>
            <button
              className="btn btn-secondary text-2xs !py-0.5 !px-2"
              onClick={bs.onSkip}
              disabled={busy}
              title="This revision cannot be tested (git bisect skip)"
            >
              <SkipForward size={9} /> Skip
            </button>
            <button
              className="btn btn-danger text-2xs !py-0.5 !px-2"
              onClick={bs.onReset}
              disabled={busy}
              title="End the bisect session and return to the original branch (git bisect reset)"
            >
              <Undo size={9} /> Reset
            </button>
          </>
        )}
      </div>
    </div>
  );
}
