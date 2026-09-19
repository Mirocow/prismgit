/**
 * MergeToolbar — top + bottom bars for the 3-way merge view.
 *
 * Layout (rewritten v2 — fixes all display issues):
 *
 *   ┌─ Top bar (h-10, 40px) ─────────────────────────────────────────────┐
 *   │ [⚠] Solver · path/to/file.ts · 3/7 conflicts                        │
 *   │   [↑ Prev] [3/7] [↓ Next]   [⟲ Undo] [⤺ Reset All]                 │
 *   │   ...spacer...                                                       │
 *   │   [Base ⇕] [External ↗] [VS Code ↗] [mergetool ⚡] [Save ✓]         │
 *   └────────────────────────────────────────────────────────────────────┘
 *   ┌─ Bottom bar (h-6, 24px) ──────────────────────────────────────────┐
 *   │ ✓ Editable center pane          ⌘1 ours · ⌘2 theirs · F7 next · ⌘⏎ save │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Visual groups are separated by thin vertical dividers. Each group has
 * a consistent visual identity:
 *
 *   1. File-info group:    static text, no buttons, truncate-able
 *   2. Navigation group:   prev / counter / next — primary navigation
 *   3. Edit-action group:  undo / reset-all — modify state
 *   4. External group:     external editor / VS Code / mergetool
 *   5. Save group:         primary action, right-aligned, always visible
 *
 * Responsive behavior:
 *   - On narrow viewports (<800px), the External group collapses into a
 *     "More ⋯" dropdown menu.
 *   - The Save button NEVER collapses — it's the primary action.
 *   - File path truncates with ellipsis when too long.
 *
 * Button styling:
 *   - Uses semantic Tailwind classes (no `!important` overrides).
 *   - icon-btn for icon-only buttons (24×24px).
 *   - btn-secondary for text+icon buttons (compact, h-7).
 *   - btn-primary for the Save button (filled accent).
 *   - Proper disabled styles (opacity-50, cursor-not-allowed).
 *   - All buttons have whitespace-nowrap (text never wraps).
 *   - All buttons have title attributes for tooltips.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  AlertCircle, Check, ChevronUp, ChevronDown, Loader,
  ExternalLink, GitMerge, RotateCcw, Undo, Eye, EyeOff,
  Save, MoreHorizontal,
} from '../icons';
import { useI18n } from '../../lib/i18n';

interface MergeToolbarProps {
  filePath: string;
  totalConflicts: number;
  currentConflictIdx: number;
  dirty: boolean;
  saving: boolean;
  showBase: boolean;
  canUndo: boolean;
  onPrevConflict: () => void;
  onNextConflict: () => void;
  onToggleBase: () => void;
  onUndo: () => void;
  onResetAll: () => void;
  onOpenExternal: () => void;
  onOpenVscodeMerge: () => void;
  onRunMergetool: () => void;
  onSave: () => void;
}

/** Detect narrow viewport for collapsing the External group into a menu. */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 900);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return narrow;
}

export function MergeToolbar({
  filePath,
  totalConflicts,
  currentConflictIdx,
  dirty,
  saving,
  showBase,
  canUndo,
  onPrevConflict,
  onNextConflict,
  onToggleBase,
  onUndo,
  onResetAll,
  onOpenExternal,
  onOpenVscodeMerge,
  onRunMergetool,
  onSave,
}: MergeToolbarProps) {
  const { t } = useI18n();
  const hasConflicts = totalConflicts > 0;
  const narrow = useNarrowViewport();
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Close the "More" menu when clicking outside.
  useEffect(() => {
    if (!moreMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [moreMenuOpen]);

  // Common button class — compact secondary buttons.
  const btnCls = 'btn btn-secondary h-7 px-2 text-xs whitespace-nowrap inline-flex items-center gap-1.5';
  const iconBtnCls = 'icon-btn h-7 w-7 flex-shrink-0';

  // Run a "More" menu action and close the menu.
  const runMoreAction = useCallback((action: () => void) => {
    setMoreMenuOpen(false);
    action();
  }, []);

  return (
    <>
      {/* ============ Top toolbar — h-10 (40px) ============ */}
      <div className="flex items-center gap-2 px-3 h-10 bg-bg-secondary border-b border-border-default flex-shrink-0">
        {/* ─── Group 1: File info ─── */}
        <AlertCircle
          size={16}
          className={`flex-shrink-0 ${hasConflicts ? 'text-status-conflict' : 'text-text-tertiary'}`}
        />
        <span className="text-xs font-semibold whitespace-nowrap flex-shrink-0">
          {t('changes.conflictSolverTitle')}
        </span>
        <code className="text-2xs font-mono text-text-tertiary truncate max-w-[200px]" title={filePath}>
          {filePath}
        </code>

        {/* Vertical divider */}
        <div className="w-px h-5 bg-border-default flex-shrink-0" />

        {/* ─── Group 2: Conflict navigation ─── */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            className={iconBtnCls}
            title={t('conflict.prevConflictTitle')}
            onClick={onPrevConflict}
            disabled={currentConflictIdx === 0 || !hasConflicts}
          >
            <ChevronUp size={14} />
          </button>
          <div
            className="flex items-center gap-1 px-2 h-7 rounded text-xs tabular-nums font-mono"
            title={
              hasConflicts
                ? `${currentConflictIdx + 1} of ${totalConflicts} conflicts`
                : 'No conflicts'
            }
          >
            <span className={hasConflicts ? 'text-status-conflict font-semibold' : 'text-text-tertiary'}>
              {hasConflicts ? currentConflictIdx + 1 : '0'}
            </span>
            <span className="text-text-tertiary">/</span>
            <span className={hasConflicts ? 'text-status-conflict font-semibold' : 'text-text-tertiary'}>
              {totalConflicts}
            </span>
          </div>
          <button
            className={iconBtnCls}
            title={t('conflict.nextConflictTitle')}
            onClick={onNextConflict}
            disabled={!hasConflicts || currentConflictIdx >= totalConflicts - 1}
          >
            <ChevronDown size={14} />
          </button>
        </div>

        {/* Vertical divider */}
        <div className="w-px h-5 bg-border-default flex-shrink-0" />

        {/* ─── Group 3: Edit actions ─── */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            className={iconBtnCls}
            title="Undo last resolution (⌘Z)"
            onClick={onUndo}
            disabled={!canUndo}
          >
            <Undo size={14} />
          </button>
          <button
            className={btnCls}
            title={t('action.title.resetHunk')}
            onClick={onResetAll}
            disabled={saving}
          >
            <RotateCcw size={12} />
            <span className="hidden sm:inline">Reset all</span>
          </button>
          <button
            className={`${btnCls} ${showBase ? 'bg-accent text-text-inverse hover:bg-accent' : ''}`}
            title="Show / hide the base (common ancestor) pane"
            onClick={onToggleBase}
          >
            {showBase ? <EyeOff size={12} /> : <Eye size={12} />}
            <span className="hidden sm:inline">Base</span>
          </button>
        </div>

        {/* Spacer — pushes right groups to the right */}
        <div className="flex-1" />

        {/* ─── Group 4: External tools (collapses to "More ⋯" on narrow viewports) ─── */}
        {narrow ? (
          <div className="relative flex-shrink-0" ref={moreMenuRef}>
            <button
              className={iconBtnCls}
              title="More actions"
              onClick={() => setMoreMenuOpen((o) => !o)}
              aria-label="More actions"
            >
              <MoreHorizontal size={14} />
            </button>
            {moreMenuOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-50 min-w-[180px] bg-bg-primary border border-border-default rounded-md shadow-lg py-1"
                role="menu"
              >
                <button
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-hover text-left"
                  onClick={() => runMoreAction(onOpenExternal)}
                  title={t('action.title.openExternalEditor')}
                >
                  <ExternalLink size={12} />
                  <span>{t('changes.external')}</span>
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-hover text-left"
                  onClick={() => runMoreAction(onOpenVscodeMerge)}
                  title={t('conflict.vsCodeTitle')}
                >
                  <ExternalLink size={12} />
                  <span>{t('conflict.vsCode')}</span>
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-hover text-left"
                  onClick={() => runMoreAction(onRunMergetool)}
                  title={t('action.title.runGitMergetool')}
                >
                  <GitMerge size={12} />
                  <span>{t('conflict.mergeTool')}</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              className={btnCls}
              onClick={onOpenExternal}
              title={t('action.title.openExternalEditor')}
            >
              <ExternalLink size={12} />
              <span className="hidden md:inline">{t('changes.external')}</span>
            </button>
            <button
              className={btnCls}
              onClick={onOpenVscodeMerge}
              title={t('conflict.vsCodeTitle')}
            >
              <ExternalLink size={12} />
              <span className="hidden md:inline">{t('conflict.vsCode')}</span>
            </button>
            <button
              className={btnCls}
              onClick={onRunMergetool}
              title={t('action.title.runGitMergetool')}
            >
              <GitMerge size={12} />
              <span className="hidden md:inline">{t('conflict.mergeTool')}</span>
            </button>
          </div>
        )}

        {/* Vertical divider before Save */}
        <div className="w-px h-5 bg-border-default flex-shrink-0 mx-1" />

        {/* ─── Group 5: Save & Stage (always visible, primary) ─── */}
        <button
          className="btn btn-primary h-7 px-3 text-xs whitespace-nowrap inline-flex items-center gap-1.5 flex-shrink-0"
          onClick={onSave}
          disabled={saving}
          title={t('conflict.saveStageTitle')}
        >
          {saving ? (
            <Loader size={12} className="spin" />
          ) : dirty ? (
            <Save size={12} />
          ) : (
            <Check size={12} />
          )}
          <span>{t('changes.saveStage')}</span>
          {dirty && !saving && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-status-modified inline-block"
              aria-label="Unsaved changes"
            />
          )}
        </button>
      </div>

      {/* ============ Bottom status bar — h-6 (24px) ============ */}
      <div className="flex items-center justify-between px-3 h-6 bg-bg-secondary border-t border-border-default text-2xs text-text-tertiary flex-shrink-0">
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          {dirty ? (
            <span className="w-1.5 h-1.5 rounded-full bg-status-modified" aria-label="Dirty" />
          ) : (
            <Check size={9} className="text-status-added" />
          )}
          <span>{t('conflict.editableCenterHint')}</span>
        </span>
        <span className="font-mono whitespace-nowrap hidden sm:inline">
          {t('conflict.shortcutsHint')}
        </span>
      </div>
    </>
  );
}
