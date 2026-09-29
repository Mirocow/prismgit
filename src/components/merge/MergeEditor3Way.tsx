/**
 * MergeEditor3Way — main 3-way merge view.
 *
 * Layout v3 (Meld / KDiff3 style):
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  MergeToolbar (top) — file, conflicts counter, actions            │  32px
 *   ├──────────────────┬──────────────────────────┬─────────────────────┤
 *   │  Ours (HEAD)     │  Working Tree (Result)   │  Theirs             │ headers (fixed)
 *   ├──────────────────┼──────────────────────────┼─────────────────────┤
 *   │                  │                          │                     │
 *   │   ONE shared vertical scroller (rows 20px)                        │
 *   │   Ours column    │  Result column           │  Theirs column      │
 *   │   read-only      │  EDITABLE textarea+pre   │  read-only          │
 *   │   (windowed)     │  (windowed highlight)    │  (windowed)         │
 *   │                  │  ConflictRegionBar[]     │                     │
 *   ├──────────────────┴──────────────────────────┴─────────────────────┤
 *   │  Status bar (bottom) — hints                                      │  24px
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * All 3 panes live inside ONE scroll container and are tall columns
 * (height = rows × 20px). v2 kept the side panes in clipped wrappers whose
 * content was translated by -scrollTop, while the shared container had NO
 * overflowing content of its own — so the container could never scroll,
 * the side panes were frozen at the top of the file, and only the middle
 * pane scrolled (internally, alone). v3 makes every pane a real column in
 * the scroller: one scrollbar moves all three panes together, and the
 * middle textarea (full content height, no internal vertical scroll)
 * participates — the browser scrolls the shared container to keep the
 * caret visible, exactly like the read-only panes.
 *
 * The Result pane is EDITABLE (typing, native undo, Tab-inserts-spaces);
 * its highlight layer re-renders live while typing (see MergeResultEditor).
 *
 * Optionally: a "Base" peek pane appears below the toolbar when toggled
 * (collapsible — saves screen space on small displays).
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CheckCircle, Loader } from '../icons';
import { useRepositoryStore } from '../../stores/repositoryStore';
import { useGitStore } from '../../stores/gitStore';
import { useToastActions } from '../../stores/toastStore';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { detectLang, type SupportedLang } from '../../lib/syntaxHighlight';
import { diff3 } from '../../lib/merge/diff3';
import { alignRows } from '../../lib/merge/alignRows';
import {
  buildAutoMergeResult,
  resolveHunk,
  findConflictMarkers,
  isResultClean,
} from '../../lib/merge/resolveConflicts';
import { useMergeViewport, MERGE_ROW_HEIGHT, MERGE_OVERSCAN } from '../../lib/merge/useMergeViewport';
import type { ConflictResolution, ConflictRegion } from '../../lib/merge/mergeTypes';
import { MergeToolbar } from './MergeToolbar';
import { MergePane } from './MergePane';
import { MergeResultEditor } from './MergeResultEditor';
import { ConflictRegionBar } from './ConflictRegionBar';
import { ResizableSplitter } from '../ResizableSplitter';

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
  // Result content: `currentResult` is the LIVE text (updated on every
  // keystroke — drives the column height, conflict-marker positions and
  // the highlight layer). The textarea is uncontrolled; its mount value is
  // the initial `currentResult`.
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
      // Verify file is actually in conflict state. Guard the return: some
      // IPC transports resolve to undefined on early failure — every
      // string consumer below must see a real string.
      const lsOutput = (await api.git.raw(repo.path, ['ls-files', '-u', '--', filePath]).catch(() => '')) ?? '';
      if (!lsOutput.trim()) {
        // ── No unmerged stages in the index ──
        // Covers: the conflict was already resolved (stages collapsed to
        // stage 0), a conflicted path that no longer has stages, or a file
        // in a repo with NO COMMITS (unborn HEAD — `show :1:` / `:2:` / `:3:`
        // all fail). The OLD behavior bailed out to a dead "No conflict
        // markers found" placeholder. The requested behavior: show the
        // BODY OF THE CHANGE itself — ours = HEAD version (empty when
        // there are no commits), theirs/result = working tree content,
        // fully editable in the center pane.
        const [headRes, wtRes] = await Promise.all([
          api.git.raw(repo.path, ['show', `HEAD:${filePath}`]).catch(() => ''),
          api.fs.readFile(`${repo.path}/${filePath}`.replace(/\+/g, '/')).catch(() => ''),
        ]);
        // readFile may resolve to a plain string (docs contract) or an
        // { text } object (IndexEditorDialog convention) — accept both.
        const asText = (v: unknown): string => {
          if (typeof v === 'string') return v;
          if (v && typeof v === 'object' && 'text' in (v as Record<string, unknown>)) {
            return String((v as { text?: unknown }).text ?? '');
          }
          return '';
        };
        const headContent = asText(headRes);
        const wtContent = asText(wtRes);
        setBaseContent(headContent);
        setOursContent(headContent);
        setTheirsContent(wtContent);
        langRef.current = detectLang(filePath);
        // diff3(HEAD, HEAD, worktree) classifies every edit as
        // changed-theirs → auto-merge result == the working tree body.
        const headLines = headContent.split('\n');
        const wtLines = wtContent.split('\n');
        const regions = diff3(headLines, headLines, wtLines);
        const autoResult = buildAutoMergeResult(headLines, headLines, wtLines, regions);
        const resultText = autoResult.join('\n');
        setCurrentResult(resultText);
        resultRef.current = resultText;
        setConflicts([]);
        setCurrentConflictIdx(0);
        setLoading(false);
        return;
      }
      const [base, ours, theirs] = await Promise.all([
        api.git.raw(repo.path, ['show', `:1:${filePath}`]).catch(() => ''),
        api.git.raw(repo.path, ['show', `:2:${filePath}`]).catch(() => ''),
        api.git.raw(repo.path, ['show', `:3:${filePath}`]).catch(() => ''),
      ]);
      // Guard against undefined/null returns
      const baseContent = base ?? '';
      const oursContentRaw = ours ?? '';
      const theirsContentRaw = theirs ?? '';
      setBaseContent(baseContent);
      setOursContent(oursContentRaw);
      setTheirsContent(theirsContentRaw);
      langRef.current = detectLang(filePath);

      // Run diff3 + auto-merge to build the initial Result.
      const baseLines = baseContent.split('\n');
      const oursLines = oursContentRaw.split('\n');
      const theirsLines = theirsContentRaw.split('\n');
      const regions = diff3(baseLines, oursLines, theirsLines);
      const autoResult = buildAutoMergeResult(baseLines, oursLines, theirsLines, regions);
      const resultText = autoResult.join('\n');
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

  // Stable line arrays for the memoized side panes (split identity must not
  // change on every render — else memo(MergePane) re-renders all rows on
  // every keystroke in the Result pane).
  const baseLines = useMemo(() => baseContent.split('\n'), [baseContent]);
  const oursLines = useMemo(() => oursContent.split('\n'), [oursContent]);
  const theirsLines = useMemo(() => theirsContent.split('\n'), [theirsContent]);
  // Result line count (live) — drives the Result column's height.
  const resultLines = useMemo(() => currentResult.split('\n'), [currentResult]);

  // ============ Viewport (single scroll container) ============

  const viewport = useMergeViewport({ totalRows: alignedRows.length, enabled: !loading });

  // ============ Resizable panes (perf round: «В инструменте 3-way
  //  нехватает вертикальных сплиттеров для изменения размера левой и
  //  правой панели») ============
  // Ours/Theirs pane widths as a % of the editor row; the middle (Result)
  // pane takes the remainder. The splitters live INSIDE the shared
  // scroller (the panes are tall columns there); they are sticky +
  // viewport-high so they stay grabbable at any scroll offset.
  const [leftPct, setLeftPct] = useState(33.3);
  const [rightPct, setRightPct] = useState(33.3);
  const clampPct = (n: number): number => Math.max(15, Math.min(60, n));
  const handleLeftResize = useCallback((deltaPx: number) => {
    // `|| 1000` (not ??): jsdom and degenerate 0-width layouts report
    // clientWidth = 0 — fall back to a sane default instead of Infinity.
    const w = viewport.scrollRef.current?.clientWidth || 1000;
    setLeftPct((p) => clampPct(p + (deltaPx / w) * 100));
  }, [viewport.scrollRef]);
  // Panel is RIGHT of its splitter → dragging right SHRINKS it (see the
  // ResizableSplitter sign convention).
  const handleRightResize = useCallback((deltaPx: number) => {
    const w = viewport.scrollRef.current?.clientWidth || 1000;
    setRightPct((p) => clampPct(p - (deltaPx / w) * 100));
  }, [viewport.scrollRef]);
  // The middle pane's line space is the RESULT's (markers add rows vs the
  // aligned side model) — compute its own visible window from the same
  // scrollTop/viewportHeight the side panes use.
  const midVisibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(viewport.scrollTop / MERGE_ROW_HEIGHT) - MERGE_OVERSCAN);
    const end = Math.min(
      resultLines.length,
      Math.ceil((viewport.scrollTop + viewport.viewportHeight) / MERGE_ROW_HEIGHT) + MERGE_OVERSCAN,
    );
    return { start, end: Math.max(start + 1, end) };
  }, [viewport.scrollTop, viewport.viewportHeight, resultLines.length]);

  const midTotalHeight = resultLines.length * MERGE_ROW_HEIGHT;

  // ============ Conflict marker positions in Result (for floating bars) ============

  const conflictMarkersInResult = useMemo(
    () => findConflictMarkers(currentResult.split('\n')),
    [currentResult],
  );

  // Auto-scroll the shared scroller to the current conflict when it moves
  // (toolbar prev/next, F7, auto-advance after a resolution). v2 never
  // scrolled at all — navigating conflicts past the first screenful was
  // impossible.
  useEffect(() => {
    if (conflictMarkersInResult.length === 0) return;
    const idx = Math.min(currentConflictIdx, conflictMarkersInResult.length - 1);
    const line = conflictMarkersInResult[idx];
    const el = viewport.scrollRef.current;
    if (line == null || !el) return;
    el.scrollTop = Math.max(0, line * MERGE_ROW_HEIGHT - el.clientHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentConflictIdx, filePath]);

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
    setDirty(true);
    setConflicts((prev) => prev.map((c, i) =>
      i === conflictIdx ? { ...c, resolved: false, resolution: undefined } : c
    ));
  }, [baseContent, oursContent, theirsContent]);

  // Undo last resolution — pop the undo stack and revert that conflict
  // to its previous state (or to unresolved if there was no previous).
  const [canUndo, setCanUndo] = useState(false);
  const handleUndo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const last = stack.pop();
    if (!last) return;
    setCanUndo(stack.length > 0);
    // Re-resolve the conflict with the PREVIOUS resolution (or Reset it
    // if there was none — i.e. the previous state was "unresolved with
    // conflict markers").
    if (last.prevResolution) {
      handleResolve(last.conflictIdx, last.prevResolution);
    } else {
      handleReset(last.conflictIdx);
    }
  }, [handleResolve, handleReset]);

  // Reset ALL conflicts to their original state — re-runs buildAutoMergeResult
  // and restores all conflict markers. Useful when the user has made a mess.
  const handleResetAll = useCallback(() => {
    const baseLines = baseContent.split('\n');
    const oursLines = oursContent.split('\n');
    const theirsLines = theirsContent.split('\n');
    const regions = diff3(baseLines, oursLines, theirsLines);
    const autoResult = buildAutoMergeResult(baseLines, oursLines, theirsLines, regions);
    const newText = autoResult.join('\n');
    if (textareaRef.current) {
      textareaRef.current.value = newText;
    }
    resultRef.current = newText;
    setCurrentResult(newText);
    setDirty(true);
    setConflicts((prev) => prev.map((c) => ({ ...c, resolved: false, resolution: undefined })));
    undoStackRef.current = [];
    setCanUndo(false);
  }, [baseContent, oursContent, theirsContent]);

  // Update canUndo whenever the undo stack changes (e.g. after a resolve).
  useEffect(() => {
    setCanUndo(undoStackRef.current.length > 0);
  });


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
      // While the user is TYPING in the Result editor, Ctrl+Z must stay
      // NATIVE (undo the last keystroke — the expectation in any editor).
      // The app-level resolution-undo hijacked it globally (capture phase),
      // which made typing mistakes unrecoverable and reinforced the
      // "middle pane is not editable" feel. Resolution-undo still works
      // whenever the caret is NOT inside the textarea.
      if ((e.key === 'z' || e.key === 'Z') && document.activeElement === textareaRef.current) {
        return;
      }
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        handleUndo();
      }
      else if (e.key === '1') { e.preventDefault(); handleResolve(currentConflictIdx, 'ours'); }
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
  }, [conflicts.length, currentConflictIdx, handleResolve, handleUndo, saving, handleSave]);

  // ============ Render ============

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="merge-editor-loading">
        <div className="text-text-tertiary text-sm flex items-center gap-2">
          <Loader size={16} className="spin" />
          {t('changes.loadingConflict')}
        </div>
      </div>
    );

  }

  // NOTE: there is deliberately NO early-return "no conflicts" placeholder.
  // Even when diff3 produced zero conflict regions — or the file has no
  // unmerged stages at all (e.g. a repo with no commits) — the user still
  // gets the FULL 3-pane editor with the BODY OF THE CHANGE in the editable
  // center pane (user-reported: the dead-end "Маркеры конфликта не найдены"
  // placeholder must never replace the content). The banner below is
  // informational only; `merge-editor-noconflicts` stays as a state probe
  // for the e2e waitForMergeEditor() helper (textarea is checked first).

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <MergeToolbar
        filePath={filePath}
        totalConflicts={conflicts.length}
        currentConflictIdx={currentConflictIdx}
        dirty={dirty}
        saving={saving}
        showBase={showBase}
        canUndo={canUndo}
        onPrevConflict={() => setCurrentConflictIdx((i) => Math.max(0, i - 1))}
        onNextConflict={() => setCurrentConflictIdx((i) => Math.min(conflicts.length - 1, i + 1))}
        onToggleBase={() => setShowBase((s) => !s)}
        onUndo={handleUndo}
        onResetAll={handleResetAll}
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

      {/* Informational banner (NOT a dead end): zero conflict regions were
          found, or the file has no unmerged stages — the change body below
          is still shown and editable. Hidden once the user edits (dirty). */}
      {conflicts.length === 0 && !dirty && (
        <div
          data-testid="merge-editor-noconflicts"
          className="flex items-center gap-2 px-3 py-1.5 bg-status-added/10 border-b border-status-added/30 text-xs text-text-secondary shrink-0"
        >
          <CheckCircle size={14} className="text-status-added shrink-0" />
          <span className="font-medium">{t('changes.noConflictMarkers')}</span>
          <span className="text-text-tertiary truncate">{t('changes.noConflictsEditable')}</span>
        </div>
      )}

      {/* Optional Base peek pane (collapsible) */}
      {showBase && (
        <div className="border-b border-border-default bg-bg-tertiary px-3 py-1 text-2xs max-h-32 overflow-auto">
          <div className="text-text-tertiary font-medium mb-1">{t('conflict.basePaneLabel')}</div>
          <pre className="text-2xs font-mono whitespace-pre-wrap text-text-secondary">{baseContent || '(empty)'}</pre>
        </div>
      )}

      {/* Fixed pane headers — OUTSIDE the scroller so they don't scroll away.
          v3.9: widths MIRROR the body columns (leftPct/rightPct) — with the
          resizable panes the old equal thirds desynced from the body as soon
          as the user dragged a splitter, and the header borders then landed
          mid-text (part of the «отображение/полоса» report). The splitter
          columns below are 6px wide each — headers add the same so the
          borders line up exactly: left header = leftPct% (same as the body
          pane), a 6px placeholder per splitter, middle flex, right =
          rightPct%. */}
      <div className="flex shrink-0 h-8 border-b border-border-default bg-bg-tertiary text-xs font-medium">
        <div className="min-w-0 flex items-center px-3 border-r border-border-default shrink-0" style={{ width: `${leftPct}%` }}>
          <span className="truncate text-status-added">{t('conflict.oursPaneTitle')}</span>
          <span className="ml-2 text-2xs text-text-tertiary font-normal shrink-0">
            ({oursLines.length} {t('common.lines')})
          </span>
        </div>
        <div className="w-[6px] shrink-0" />
        <div className="flex-1 min-w-0 flex items-center px-3">
          <span className="truncate">{t('conflict.resultPaneTitle')}</span>
          <span className="ml-2 text-2xs text-text-tertiary font-normal shrink-0">
            ({resultLines.length} {t('common.lines')})
          </span>
        </div>
        <div className="w-[6px] shrink-0" />
        <div className="min-w-0 flex items-center px-3 border-l border-border-default shrink-0" style={{ width: `${rightPct}%` }}>
          <span className="truncate" style={{ color: 'var(--status-info)' }}>
            {t('conflict.theirsPaneTitle')}
          </span>
          <span className="ml-2 text-2xs text-text-tertiary font-normal shrink-0">
            ({theirsLines.length} {t('common.lines')})
          </span>
        </div>
      </div>

      {/* The ONE shared vertical scroller — all 3 panes are tall columns
          inside it; scrolling moves them together. The middle textarea is
          full-height with no internal vertical scroll, so caret movement
          (typing at the screen edge) scrolls THIS container. */}
      <div ref={viewport.scrollRef} className="flex-1 overflow-auto flex" data-testid="merge-scroll-container">
        {/* Left: Ours (read-only, windowed) — width controlled by the splitter */}
        <div className="min-w-0 shrink-0" style={{ width: `${leftPct}%`, height: viewport.totalHeight }}>
          <MergePane
            side="ours"
            alignedRows={alignedRows}
            visibleRange={viewport.visibleRange}
            totalHeight={viewport.totalHeight}
            lang={langRef.current}
            lines={oursLines}
          />
        </div>
        {/* Vertical splitter — Ours | Result. v3.9: the wrapper is a FLEX
            row so the splitter STRETCHES to the wrapper height (the old plain
            div left it height 0 — invisible and ungrabbable: mousedown landed
            on the neighbouring pane; that was «полоса, которую нельзя
            перетащить»). Sticky keeps it grabbable at any scroll offset. */}
        <div style={{ position: 'sticky', top: 0, height: viewport.viewportHeight }} className="flex shrink-0 items-stretch">
          <ResizableSplitter direction="horizontal" onResize={handleLeftResize} wide />
        </div>

        {/* Middle: Result (editable) + floating per-conflict action bars */}
        <div className="flex-1 min-w-0 relative">
          <MergeResultEditor
            content={currentResult}
            lang={langRef.current}
            totalHeight={midTotalHeight}
            visibleRange={midVisibleRange}
            onChange={(text) => {
              resultRef.current = text;
              setCurrentResult(text);
              setDirty(true);
            }}
            textareaRef={textareaRef}
          />
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

        {/* Vertical splitter — Result | Theirs (sticky + flex, see above). */}
        <div style={{ position: 'sticky', top: 0, height: viewport.viewportHeight }} className="flex shrink-0 items-stretch">
          <ResizableSplitter direction="horizontal" onResize={handleRightResize} wide />
        </div>

        {/* Right: Theirs (read-only, windowed) — width controlled by the splitter */}
        <div className="min-w-0 shrink-0" style={{ width: `${rightPct}%`, height: viewport.totalHeight }}>
          <MergePane
            side="theirs"
            alignedRows={alignedRows}
            visibleRange={viewport.visibleRange}
            totalHeight={viewport.totalHeight}
            lang={langRef.current}
            lines={theirsLines}
          />
        </div>
      </div>

      {/* Bottom status bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-bg-secondary border-t border-border-default text-2xs text-text-tertiary shrink-0 h-6">
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
