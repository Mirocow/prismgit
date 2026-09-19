/**
 * MergeEditor3Way — main 3-way merge view.
 *
 * Layout (Meld / KDiff3 / VS Code style):
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  MergeToolbar (top) — file, conflicts counter, actions            │  32px
 *   ├──────────────────┬──────────────────────────┬─────────────────────┤
 *   │  Ours (HEAD)     │  Working Tree (Result)   │  Theirs             │
 *   │  read-only       │  editable (textarea+pre) │  read-only          │
 *   │  (syntax highlight)│  (syntax highlight pre) │  (syntax highlight) │
 *   │  ghost rows pad  │                          │  ghost rows pad     │
 *   │  for alignment   │  ConflictRegionBar[]     │  for alignment      │
 *   │                  │  (floating per-hunk      │                     │
 *   │                  │   action buttons)         │                     │
 *   ├──────────────────┴──────────────────────────┴─────────────────────┤
 *   │  Status bar (bottom) — hints                                      │  24px
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Optionally: a "Base" peek pane appears below the toolbar when toggled
 * (collapsible — saves screen space on small displays).
 *
 * All 3 panes share ONE scroll container (useMergeViewport). Rows are
 * aligned via the AlignedRow[] model — ghost rows pad shorter sides.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AlertCircle, Loader } from '../icons';
import { useRepositoryStore } from '../../stores/repositoryStore';
import { useGitStore } from '../../stores/gitStore';
import { useToastActions } from '../../stores/toastStore';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { detectLang, type SupportedLang } from '../../lib/syntaxHighlight';
import { diff3 } from '../../lib/merge/diff3';
import { alignRows, findConflictRowRange } from '../../lib/merge/alignRows';
import {
  buildAutoMergeResult,
  resolveHunk,
  findConflictMarkers,
  isResultClean,
} from '../../lib/merge/resolveConflicts';
import { useMergeViewport } from '../../lib/merge/useMergeViewport';
import type { ConflictResolution, ConflictRegion } from '../../lib/merge/mergeTypes';
import { MergeToolbar } from './MergeToolbar';
import { MergePane } from './MergePane';
import { MergeResultEditor } from './MergeResultEditor';
import { ConflictRegionBar } from './ConflictRegionBar';

export interface MergeEditor3WayProps {
  filePath: string;
  /** Called after a file is successfully resolved & staged. */
  onResolved?: (resolvedFile: string) => void;
}

export function MergeEditor3Way({ filePath, onResolved }: MergeEditor3WayProps) {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastActions();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showBase, setShowBase] = useState(false);

  // The 3 source contents (loaded once per file)
  const [baseContent, setBaseContent] = useState('');
  const [oursContent, setOursContent] = useState('');
  const [theirsContent, setTheirsContent] = useState('');
  // Initial Result content (auto-merged). Stored once; the textarea is
  // uncontrolled so subsequent edits don't trigger React re-renders.
  const [initialResult, setInitialResult] = useState('');
  // Current Result content (updated by textarea onInput — used to track
  // conflicts and dirty state, NOT fed back to the textarea as `value`).
  const [currentResult, setCurrentResult] = useState('');
  // Conflict state: array of ConflictRegion (resolved / pending).
  const [conflicts, setConflicts] = useState<ConflictRegion[]>([]);
  // Currently-focused conflict (for prev/next navigation).
  const [currentConflictIdx, setCurrentConflictIdx] = useState(0);

  const langRef = useRef<SupportedLang>('text');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Use a ref to always read the latest textarea value when saving.
  const resultRef = useRef<string>('');
  // Per-conflict-resolution undo stack: array of { conflictIdx, prevResolution }.
  const undoStackRef = useRef<Array<{ conflictIdx: number; prevResolution: ConflictResolution | undefined }>>([]);

  // ============ Load file + 3 stages ============

  const loadFile = useCallback(async () => {
    setLoading(true);
    setDirty(false);
    try {
      // Verify file is actually in conflict state.
      const lsOutput = await api.git.raw(repo.path, ['ls-files', '-u', '--', filePath]).catch(() => '');
      if (!lsOutput.trim()) {
        toast.warning(t('toast.conflict.notConflicted'), 'This file may have been resolved already.');
        setLoading(false);
        return;
      }
      const [base, ours, theirs] = await Promise.all([
        api.git.raw(repo.path, ['show', `:1:${filePath}`]).catch(() => ''),
        api.git.raw(repo.path, ['show', `:2:${filePath}`]).catch(() => ''),
        api.git.raw(repo.path, ['show', `:3:${filePath}`]).catch(() => ''),
      ]);
      setBaseContent(base);
      setOursContent(ours);
      setTheirsContent(theirs);
      langRef.current = detectLang(filePath);

      // Run diff3 + auto-merge to build the initial Result.
      const baseLines = base.split('\n');
      const oursLines = ours.split('\n');
      const theirsLines = theirs.split('\n');
      const regions = diff3(baseLines, oursLines, theirsLines);
      const autoResult = buildAutoMergeResult(baseLines, oursLines, theirsLines, regions);
      const resultText = autoResult.join('\n');
      setInitialResult(resultText);
      setCurrentResult(resultText);
      resultRef.current = resultText;
      // Build conflict metadata.
      const conflictRegions: ConflictRegion[] = [];
      const conflictMarkersInResult = findConflictMarkers(autoResult);
      const regions_ = regions;
      let alignedRowCursor = 0;
      for (let ri = 0; ri < regions_.length; ri++) {
        const r = regions_[ri];
        if (r.kind === 'conflict') {
          // The alignedRows[] for this conflict span some range — we
          // only need the range bounds for navigation.
          // For now: conflict's alignedRowStart = current cursor;
          // alignedRowEnd = cursor + oursLen + theirsLen (approx).
          const approx = r.oursLen + r.theirsLen + 3; // +3 for markers
          conflictRegions.push({
            id: conflictRegions.length,
            alignedRowStart: alignedRowCursor,
            alignedRowEnd: alignedRowCursor + approx,
            resolved: false,
          });
          alignedRowCursor += approx;
        } else {
          alignedRowCursor += Math.max(r.baseLen, r.oursLen, r.theirsLen);
        }
      }
      // Override with the actual markers in Result for navigation.
      // (conflictMarkersInResult has the exact line numbers — use those
      // for the floating ConflictRegionBar positions.)
      setConflicts(conflictRegions.map((c, i) => ({
        ...c,
        alignedRowStart: conflictMarkersInResult[i] ?? 0,
        alignedRowEnd: conflictMarkersInResult[i] ?? 0,
      })));
      setCurrentConflictIdx(0);
      setLoading(false);
    } catch (e) {
      toast.error(t('changes.conflictLoadFailed'), String(e));
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.path, filePath]);

  useEffect(() => { loadFile(); }, [loadFile]);

  // ============ AlignedRow[] model ============

  const alignedRows = useMemo(() => {
    const baseLines = baseContent.split('\n');
    const oursLines = oursContent.split('\n');
    const theirsLines = theirsContent.split('\n');
    const regions = diff3(baseLines, oursLines, theirsLines);
    return alignRows(baseLines, oursLines, theirsLines, regions);
  }, [baseContent, oursContent, theirsContent]);

  // ============ Viewport (single scroll container) ============

  const viewport = useMergeViewport({ totalRows: alignedRows.length });

  // ============ Conflict marker positions in Result (for floating bars) ============

  const conflictMarkersInResult = useMemo(
    () => findConflictMarkers(currentResult.split('\n')),
    [currentResult],
  );

  // ============ Resolution actions ============

  const handleResolve = useCallback((conflictIdx: number, resolution: ConflictResolution) => {
    const baseLines = baseContent.split('\n');
    const oursLines = oursContent.split('\n');
    const theirsLines = theirsContent.split('\n');
    // Re-run diff3 to get regions (could cache but resolution is rare).
    const regions = diff3(baseLines, oursLines, theirsLines);
    const currentLines = resultRef.current.split('\n');
    const markers = findConflictMarkers(currentLines);
    const newLines = resolveHunk(
      currentLines,
      markers,
      conflictIdx,
      resolution,
      oursLines,
      theirsLines,
      baseLines,
      regions,
    );
    const newText = newLines.join('\n');
    // Push undo entry.
    undoStackRef.current.push({
      conflictIdx,
      prevResolution: conflicts[conflictIdx]?.resolution,
    });
    // Update state — but DON'T set textarea.value (it's uncontrolled).
    // Instead, we need to reload the textarea with new content.
    // This is a trade-off: applying a resolution WILL reset the user's
    // cursor position in the textarea. To minimize disruption, we update
    // the textarea's value directly (bypassing React) and refresh the
    // syntax-highlight <pre>.
    if (textareaRef.current) {
      // Save current selection so we can restore it after the value swap.
      const selStart = textareaRef.current.selectionStart;
      const selEnd = textareaRef.current.selectionEnd;
      textareaRef.current.value = newText;
      // Try to keep the cursor in the same vicinity — clamp to new length.
      const newLen = newText.length;
      textareaRef.current.selectionStart = Math.min(selStart, newLen);
      textareaRef.current.selectionEnd = Math.min(selEnd, newLen);
    }
    resultRef.current = newText;
    setCurrentResult(newText);
    setInitialResult(newText); // re-render the <pre> highlight layer
    setDirty(true);
    // Mark conflict as resolved.
    setConflicts((prev) => prev.map((c, i) =>
      i === conflictIdx ? { ...c, resolved: true, resolution } : c
    ));
    // Auto-advance to next unresolved conflict.
    const nextIdx = conflicts.findIndex((c, i) => i > conflictIdx && !c.resolved);
    if (nextIdx !== -1) setCurrentConflictIdx(nextIdx);
  }, [baseContent, oursContent, theirsContent, conflicts]);

  const handleReset = useCallback((conflictIdx: number) => {
    // Reset = put the original <<<<<<< ======= >>>>>>> markers back.
    // We do this by re-applying buildAutoMergeResult (which always emits
    // conflict markers for conflict regions).
    const baseLines = baseContent.split('\n');
    const oursLines = oursContent.split('\n');
    const theirsLines = theirsContent.split('\n');
    const regions = diff3(baseLines, oursLines, theirsLines);
    const autoResult = buildAutoMergeResult(baseLines, oursLines, theirsLines, regions);
    // The autoResult has ALL conflict markers — but the user may have
    // already resolved some conflicts manually. For simplicity, just
    // restore the entire autoResult.
    const newText = autoResult.join('\n');
    if (textareaRef.current) {
      textareaRef.current.value = newText;
    }
    resultRef.current = newText;
    setCurrentResult(newText);
    setInitialResult(newText);
    setDirty(true);
    setConflicts((prev) => prev.map((c, i) =>
      i === conflictIdx ? { ...c, resolved: false, resolution: undefined } : c
    ));
  }, [baseContent, oursContent, theirsContent]);

  // ============ Save & Stage ============

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const resolved = textareaRef.current?.value ?? resultRef.current;
      if (!isResultClean(resolved.split('\n'))) {
        toast.warning(t('toast.conflict.markersRemain'), 'File will be staged but not resolvable.');
      }
      const fullPath = `${repo.path}/${filePath}`.replace(/\/+/g, '/');
      await api.fs.writeFile(fullPath, resolved);
      await api.git.add(repo.path, [filePath]);
      toast.success(t('changes.conflictResolvedStaged'));
      await refreshStatus(repo.path);
      setDirty(false);
      onResolved?.(filePath);
    } catch (e) {
      toast.error(t('changes.saveFailed'), String(e));
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.path, filePath]);

  // ============ Keyboard shortcuts ============

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'F7') {
        e.preventDefault();
        if (e.shiftKey) {
          setCurrentConflictIdx((i) => Math.max(0, i - 1));
        } else {
          setCurrentConflictIdx((i) => Math.min(conflicts.length - 1, i + 1));
        }
        return;
      }
      if (!mod) return;
      if (e.key === '1') { e.preventDefault(); handleResolve(currentConflictIdx, 'ours'); }
      else if (e.key === '2') { e.preventDefault(); handleResolve(currentConflictIdx, 'theirs'); }
      else if (e.key === '3') { e.preventDefault(); handleResolve(currentConflictIdx, 'both-ours-first'); }
      else if (e.key === '4') { e.preventDefault(); handleResolve(currentConflictIdx, 'both-theirs-first'); }
      else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!saving) void handleSave();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [conflicts.length, currentConflictIdx, handleResolve, saving, handleSave]);

  // ============ Render ============

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-tertiary text-sm flex items-center gap-2">
          <Loader size={16} className="spin" />
          {t('changes.loadingConflict')}
        </div>
      </div>
    );
  }

  if (conflicts.length === 0 && !dirty) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-status-modified" />
          <div className="text-sm font-medium mb-1">{t('changes.noConflictMarkers')}</div>
          <div className="text-xs text-text-tertiary">{t('changes.noConflictHint')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <MergeToolbar
        filePath={filePath}
        totalConflicts={conflicts.length}
        currentConflictIdx={currentConflictIdx}
        dirty={dirty}
        saving={saving}
        showBase={showBase}
        onPrevConflict={() => setCurrentConflictIdx((i) => Math.max(0, i - 1))}
        onNextConflict={() => setCurrentConflictIdx((i) => Math.min(conflicts.length - 1, i + 1))}
        onToggleBase={() => setShowBase((s) => !s)}
        onOpenExternal={() => {
          const fullPath = `${repo.path}/${filePath}`.replace(/\/+/g, '/');
          api.git.openFile(fullPath);
        }}
        onOpenVscodeMerge={async () => {
          try {
            const res = await api.vscode.openMerge(repo.path, filePath);
            if (res.ok) toast.success(t('toast.vscode.mergeEditorOpened'));
            else toast.error(t('toast.vscode.notFound'), res.detail || 'Install VS Code or configure path');
          } catch (e) { toast.error(t('toast.vscode.mergeFailed'), String(e)); }
        }}
        onRunMergetool={async () => {
          try {
            await api.git.raw(repo.path, ['mergetool', '--', filePath]);
            toast.success(t('toast.vscode.mergeToolCompleted'), t('conflict.reloadingFile'));
            await loadFile();
            await refreshStatus(repo.path);
          } catch (e) { toast.error(t('toast.vscode.mergeToolFailed'), String(e)); }
        }}
        onSave={handleSave}
      />

      {/* Optional Base peek pane (collapsible) */}
      {showBase && (
        <div className="border-b border-border-default bg-bg-tertiary px-3 py-1 text-2xs max-h-32 overflow-auto">
          <div className="text-text-tertiary font-medium mb-1">Base (common ancestor):</div>
          <pre className="text-2xs font-mono whitespace-pre-wrap text-text-secondary">{baseContent || '(empty)'}</pre>
        </div>
      )}

      {/* 3-pane layout — single scroll container */}
      <div ref={viewport.scrollRef} className="flex-1 overflow-auto flex">
        {/* Left: Ours */}
        <div className="flex-1 min-w-0 flex flex-col">
          <MergePane
            title={t('conflict.oursPaneTitle')}
            side="ours"
            alignedRows={alignedRows}
            visibleRange={viewport.visibleRange}
            totalHeight={viewport.totalHeight}
            scrollTop={viewport.scrollTop}
            lang={langRef.current}
            lines={oursContent.split('\n')}
          />
        </div>

        {/* Middle: Result (editable) */}
        <div className="flex-1 min-w-0 flex flex-col relative">
          <MergeResultEditor
            initialContent={initialResult}
            lang={langRef.current}
            onChange={(text) => {
              resultRef.current = text;
              setCurrentResult(text);
              setDirty(true);
            }}
            textareaRef={textareaRef}
          />
          {/* Floating per-conflict action bars */}
          {conflictMarkersInResult.map((startLine, i) => (
            <ConflictRegionBar
              key={i}
              conflictIdx={i}
              startLine={startLine}
              resolved={conflicts[i]?.resolved ?? false}
              onResolve={handleResolve}
              onReset={handleReset}
            />
          ))}
        </div>

        {/* Right: Theirs */}
        <div className="flex-1 min-w-0 flex flex-col">
          <MergePane
            title={t('conflict.theirsPaneTitle')}
            side="theirs"
            alignedRows={alignedRows}
            visibleRange={viewport.visibleRange}
            totalHeight={viewport.totalHeight}
            scrollTop={viewport.scrollTop}
            lang={langRef.current}
            lines={theirsContent.split('\n')}
          />
        </div>
      </div>

      {/* Bottom status bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-bg-secondary border-t border-border-default text-2xs text-text-tertiary flex-shrink-0 h-6">
        <span className="flex items-center gap-1">
          {dirty ? '● ' : '✓ '}
          {t('conflict.editableCenterHint')}
        </span>
        <span className="font-mono">
          {t('conflict.shortcutsHint')}
        </span>
      </div>
    </div>
  );
}
