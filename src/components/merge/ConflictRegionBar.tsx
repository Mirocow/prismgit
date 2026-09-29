/**
 * ConflictRegionBar — floating inline toolbar that appears above each
 * conflict region in the Result editor. Renders 5 resolution actions
 * + Reset, scoped to a single conflict.
 *
 * Position: absolute overlay inside the Result editor's relative container.
 * Y offset is computed from the conflict's start line × ROW_HEIGHT.
 *
 * Actions:
 *   Take Ours  |  Take Theirs  |  Both (O→T)  |  Both (T→O)  |  Manual  |  Reset
 *
 * "Manual" clears the conflict block (replaces with a single empty line)
 * so the user can type freely.
 */

import { memo } from 'react';
import { ArrowLeft, ArrowRight, Plus, RotateCcw } from '../icons';
import { useI18n } from '../../lib/i18n';
import type { ConflictResolution } from '../../lib/merge/mergeTypes';

const ROW_HEIGHT = 20;
const BAR_HEIGHT = 26; // height of the floating toolbar

interface ConflictRegionBarProps {
  /** Conflict index (0-based). */
  conflictIdx: number;
  /** 0-based line in the Result where <<<<<<< starts. */
  startLine: number;
  /** Whether this conflict has been resolved (affects button highlight). */
  resolved: boolean;
  /** Apply a resolution to this conflict. */
  onResolve: (conflictIdx: number, resolution: ConflictResolution) => void;
  /** Reset this conflict back to original markers. */
  onReset: (conflictIdx: number) => void;
}

function ConflictRegionBarImpl({
  conflictIdx,
  startLine,
  resolved,
  onResolve,
  onReset,
}: ConflictRegionBarProps) {
  const { t } = useI18n();
  // Position the bar ABOVE the conflict start line.
  const top = Math.max(0, startLine * ROW_HEIGHT - BAR_HEIGHT);
  return (
    <div
      className="absolute left-0 right-0 z-10 flex items-center gap-1 px-2 bg-bg-secondary border border-border-default rounded shadow-sm text-2xs"
      style={{ top, height: BAR_HEIGHT }}
      data-conflict-idx={conflictIdx}
    >
      <span className={`font-mono px-1 rounded ${resolved ? 'text-status-added bg-status-added/10' : 'text-status-conflict bg-status-conflict/10'}`}>
        #{conflictIdx + 1}
      </span>
      <button
        className="btn btn-secondary text-2xs !py-0.5 !px-2"
        onClick={() => onResolve(conflictIdx, 'ours')}
        title={t('conflict.takeLeftTitle')}
      >
        <ArrowLeft size={10} className="inline -mt-0.5" /> {t('conflict.takeLeft')}
      </button>
      <button
        className="btn btn-secondary text-2xs !py-0.5 !px-2"
        onClick={() => onResolve(conflictIdx, 'theirs')}
        title={t('conflict.takeRightTitle')}
      >
        {t('conflict.takeRight')} <ArrowRight size={10} className="inline -mt-0.5" />
      </button>
      <button
        className="btn btn-secondary text-2xs !py-0.5 !px-2"
        onClick={() => onResolve(conflictIdx, 'both-ours-first')}
        title={t('conflict.takeLeftRightTitle')}
      >
        <Plus size={10} className="inline -mt-0.5" /> {t('conflict.takeLR')}
      </button>
      <button
        className="btn btn-secondary text-2xs !py-0.5 !px-2"
        onClick={() => onResolve(conflictIdx, 'both-theirs-first')}
        title={t('conflict.takeRightLeftTitle')}
      >
        {t('conflict.takeRL')} <Plus size={10} className="inline -mt-0.5" />
      </button>
      <button
        className="btn btn-secondary text-2xs !py-0.5 !px-2"
        onClick={() => onResolve(conflictIdx, 'manual')}
        title={t('conflict.clearBlockAndEdit')}
      >
        Manual
      </button>
      <div className="w-px h-4 bg-border-default mx-1" />
      <button
        className="btn btn-secondary text-2xs !py-0.5 !px-2"
        onClick={() => onReset(conflictIdx)}
        title={t('action.title.resetHunk')}
      >
        <RotateCcw size={10} className="inline -mt-0.5" /> Reset
      </button>
    </div>
  );
}

export const ConflictRegionBar = memo(ConflictRegionBarImpl);
