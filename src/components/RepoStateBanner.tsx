import type { StatusResult } from '../lib/api';
import { getRepoInProgressState } from '../lib/repoState';
import { shortHash } from '../lib/utils';
import { useI18n } from '../lib/i18n';
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
  'cherry-picking': 'banner.cherryPickingFooter',
  'reverting': 'banner.revertingFooter',
  'merging': 'banner.mergingFooter',
  'rebasing': 'banner.rebasingFooter',
  'bisecting': 'banner.bisectingFooter',
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
  const { t } = useI18n();
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
            {t('banner.picking')} <code className="font-mono">{shortHash(status.cherryPick.commit)}</code>
            {status.cherryPick.subject ? <> — “{status.cherryPick.subject}”</> : null}
          </span>
        ) : null;
      case 'reverting':
        return status.revert ? (
          <span className="text-text-secondary truncate" data-testid="revert-commit">
            {t('banner.revertingLabel')} <code className="font-mono">{shortHash(status.revert.commit)}</code>
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
              ? t('banner.stepXOfY', { step: status.rebase.step, total: status.rebase.total })
              : t('banner.rebaseInProgress')}
          </span>
        );
      case 'bisecting':
        return status.bisect?.rev ? (
          <span className="text-text-secondary truncate" data-testid="bisect-rev">
            {t('banner.testing')} <code className="font-mono">{shortHash(status.bisect.rev)}</code>
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
        <div className="text-2xs text-text-tertiary mt-0.5">{t(FOOTERS[state.key])}</div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* cherry-picking (incl. empty & conflict): Continue, Abort */}
        {state.key === 'cherry-picking' && cp && (
          <>
            <button
              className="btn btn-primary text-2xs !py-0.5 !px-2"
              onClick={cp.onContinue}
              disabled={busy}
              title={t('banner.cherryPick.continueTitle')}
            >
              <Check size={9} /> {t('banner.continue')}
            </button>
            <button
              className="btn btn-danger text-2xs !py-0.5 !px-2"
              onClick={cp.onAbort}
              disabled={busy}
              title={t('banner.cherryPick.abortTitle')}
            >
              <X size={9} /> {t('banner.abort')}
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
              title={t('banner.revert.continueTitle')}
            >
              <Check size={9} /> {t('banner.continue')}
            </button>
            <button
              className="btn btn-danger text-2xs !py-0.5 !px-2"
              onClick={rv.onAbort}
              disabled={busy}
              title={t('banner.revert.abortTitle')}
            >
              <X size={9} /> {t('banner.abort')}
            </button>
          </>
        )}
        {/* merging (incl. multi-conflict): Abort */}
        {state.key === 'merging' && mg && (
          <button
            className="btn btn-danger text-2xs !py-0.5 !px-2"
            onClick={mg.onAbort}
            disabled={busy}
            title={t('banner.merge.abortTitle')}
          >
            <X size={9} /> {t('banner.abort')}
          </button>
        )}
        {/* rebasing (incl. multi-step): Continue, Abort */}
        {state.key === 'rebasing' && rb && (
          <>
            <button
              className="btn btn-primary text-2xs !py-0.5 !px-2"
              onClick={rb.onContinue}
              disabled={busy}
              title={t('banner.rebase.continueTitle')}
            >
              <Check size={9} /> {t('banner.continue')}
            </button>
            <button
              className="btn btn-danger text-2xs !py-0.5 !px-2"
              onClick={rb.onAbort}
              disabled={busy}
              title={t('banner.rebase.abortTitle')}
            >
              <X size={9} /> {t('banner.abort')}
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
              title={t('banner.bisect.badTitle')}
            >
              <X size={9} /> {t('banner.markHeadBad')}
            </button>
            <button
              className="btn btn-primary text-2xs !py-0.5 !px-2"
              onClick={bs.onGood}
              disabled={busy}
              title={t('banner.bisect.goodTitle')}
            >
              <Check size={9} /> {t('banner.markHeadGood')}
            </button>
            <button
              className="btn btn-danger text-2xs !py-0.5 !px-2"
              onClick={bs.onReset}
              disabled={busy}
              title={t('banner.bisect.abortTitle')}
            >
              <Undo size={9} /> {t('banner.abort')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
