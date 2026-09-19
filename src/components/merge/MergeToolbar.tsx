/**
 * MergeToolbar — top toolbar + bottom status bar for the merge view.
 *
 * Top bar (32px):
 *   [⚠] Conflict Solver | path/to/file | 3 of 7 conflicts
 *   [↑ Prev] [3/7] [↓ Next]
 *   [Show Base] [Open External] [VS Code Merge] [Run mergetool]
 *   [Save & Stage ●]
 *
 * Bottom bar (24px):
 *   ✓ Editable center pane — cursor in Result     | F7 next · ⌘1 ours · ⌘2 theirs · ⌘⏎ save
 */

import {
  AlertCircle, Check, ChevronUp, ChevronDown, Loader,
  ExternalLink, GitMerge, RotateCcw,
} from '../icons';
import { useI18n } from '../../lib/i18n';

interface MergeToolbarProps {
  filePath: string;
  totalConflicts: number;
  currentConflictIdx: number;
  dirty: boolean;
  saving: boolean;
  showBase: boolean;
  onPrevConflict: () => void;
  onNextConflict: () => void;
  onToggleBase: () => void;
  onOpenExternal: () => void;
  onOpenVscodeMerge: () => void;
  onRunMergetool: () => void;
  onSave: () => void;
}

export function MergeToolbar({
  filePath,
  totalConflicts,
  currentConflictIdx,
  dirty,
  saving,
  showBase,
  onPrevConflict,
  onNextConflict,
  onToggleBase,
  onOpenExternal,
  onOpenVscodeMerge,
  onRunMergetool,
  onSave,
}: MergeToolbarProps) {
  const { t } = useI18n();
  const hasConflicts = totalConflicts > 0;
  return (
    <>
      {/* Top toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 bg-bg-secondary border-b border-border-default flex-shrink-0 overflow-x-auto h-8">
        <AlertCircle size={14} className={`flex-shrink-0 ${hasConflicts ? 'text-status-conflict' : 'text-text-tertiary'}`} />
        <span className="text-xs font-medium truncate">{t('changes.conflictSolverTitle')}</span>
        <code className="text-2xs font-mono text-text-tertiary truncate">{filePath}</code>
        <span className="text-2xs text-text-secondary tabular-nums ml-2">
          <span className={hasConflicts ? 'text-status-conflict font-medium' : 'text-text-tertiary'}>
            {currentConflictIdx + 1}
          </span>
          {' / '}
          <span className={hasConflicts ? 'text-status-conflict font-medium' : 'text-text-tertiary'}>
            {totalConflicts}
          </span>
          {' '}
          {t('conflict.conflictsLabel')}
        </span>
        <div className="w-px h-4 bg-border-default mx-1" />
        <button
          className="icon-btn"
          title={t('conflict.prevConflictTitle')}
          onClick={onPrevConflict}
          disabled={currentConflictIdx === 0}
        >
          <ChevronUp size={14} />
        </button>
        <button
          className="icon-btn"
          title={t('conflict.nextConflictTitle')}
          onClick={onNextConflict}
          disabled={currentConflictIdx >= totalConflicts - 1}
        >
          <ChevronDown size={14} />
        </button>
        <div className="w-px h-4 bg-border-default mx-1" />
        <button
          className={`btn btn-secondary text-2xs !py-0.5 !px-2 ${showBase ? 'bg-accent text-text-inverse' : ''}`}
          onClick={onToggleBase}
          title="Show / hide the base (common ancestor) pane"
        >
          {showBase ? '✓ ' : ''}Base
        </button>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={onOpenExternal}
          title={t('action.title.openExternalEditor')}
        >
          <ExternalLink size={10} className="inline -mt-0.5" /> {t('changes.external')}
        </button>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={onRunMergetool}
          title={t('action.title.runGitMergetool')}
        >
          <GitMerge size={10} className="inline -mt-0.5" /> {t('conflict.mergeTool')}
        </button>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={onOpenVscodeMerge}
          title={t('conflict.vsCodeTitle')}
        >
          <ExternalLink size={10} className="inline -mt-0.5" /> {t('conflict.vsCode')}
        </button>
        <div className="flex-1" />
        <button
          className="btn btn-primary text-2xs !py-0.5 !px-2"
          onClick={onSave}
          disabled={saving}
          title={t('conflict.saveStageTitle')}
        >
          {saving ? <Loader size={11} className="spin" /> : <Check size={11} />}
          {t('changes.saveStage')}
          {dirty && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-status-modified inline-block" />}
        </button>
      </div>

      {/* Bottom status bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-bg-secondary border-t border-border-default text-2xs text-text-tertiary flex-shrink-0 h-6">
        <span className="flex items-center gap-1">
          <Check size={9} className="text-status-added" />
          {t('conflict.editableCenterHint')}
        </span>
        <span className="font-mono">
          {t('conflict.shortcutsHint')}
        </span>
      </div>
    </>
  );
}
