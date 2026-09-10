import { AlertTriangle, SkipForward, Check, X } from './icons';
import { shortHash } from '../lib/utils';

/**
 * SmartGit Manual (Log / Working tree state): while a cherry-pick is in
 * progress the working tree is in "cherry-picking-state" — shown explicitly,
 * with ONLY Abort / Continue (and Skip / Commit Empty for an empty pick)
 * available. Everything else (Pull, Checkout, Push, Commit) is blocked until
 * the state resolves, because those operations would discard the pick.
 */
export interface CherryPickBannerProps {
  commit: string;
  subject: string;
  /** The pick has nothing to commit ("previous cherry-pick is now empty"). */
  empty: boolean;
  busy?: boolean;
  onContinue: () => void;
  onSkip: () => void;
  /** Finalize the empty pick as an empty commit (git commit --allow-empty). */
  onCommitEmpty: () => void;
  onAbort: () => void;
}

export function CherryPickStateBanner({
  commit,
  subject,
  empty,
  busy,
  onContinue,
  onSkip,
  onCommitEmpty,
  onAbort,
}: CherryPickBannerProps) {
  return (
    <div
      data-testid="cherry-pick-banner"
      className="flex items-center gap-2 px-3 py-1.5 border-b border-status-conflict/40 bg-status-conflict/10 text-xs"
    >
      <AlertTriangle size={13} className="text-status-conflict flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-status-conflict">
            The working tree is in cherry-picking-state.
          </span>
          <span className="text-text-secondary truncate" data-testid="cherry-pick-commit">
            Picking <code className="font-mono">{shortHash(commit)}</code>
            {subject ? <> — “{subject}”</> : null}
          </span>
          {empty && (
            <span className="text-2xs text-status-modified" data-testid="cherry-pick-empty-hint">
              The previous cherry-pick is now empty (nothing to commit) — use Skip or Commit Empty.
            </span>
          )}
        </div>
        <div className="text-2xs text-text-tertiary mt-0.5">
          Only Abort / Continue are allowed — Pull, Checkout and Commit would lead to loss of the picked commit.
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          className="btn btn-primary text-2xs !py-0.5 !px-2"
          onClick={onContinue}
          disabled={busy}
          title="Finish the cherry-pick: commit the picked changes into the current branch"
        >
          <Check size={9} /> Continue
        </button>
        {empty && (
          <button
            className="btn btn-secondary text-2xs !py-0.5 !px-2"
            onClick={onCommitEmpty}
            disabled={busy}
            title="Commit the pick as an EMPTY commit (git commit --allow-empty)"
          >
            Commit Empty
          </button>
        )}
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={onSkip}
          disabled={busy}
          title="Skip this commit and continue with the next one in the sequence (git cherry-pick --skip)"
        >
          <SkipForward size={9} /> Skip
        </button>
        <button
          className="btn btn-danger text-2xs !py-0.5 !px-2"
          onClick={onAbort}
          disabled={busy}
          title="Cancel the cherry-pick and restore the previous state (git cherry-pick --abort)"
        >
          <X size={9} /> Abort
        </button>
      </div>
    </div>
  );
}
