/**
 * ConflictMergeView — 3-way merge view for resolving Git conflicts.
 *
 * Layout (Meld / SmartGit style):
 *   ┌──────────────┬─────────────────┬──────────────┐
 *   │  Ours (HEAD) │  Working Tree   │  Theirs      │
 *   │  (read-only) │  (editable)     │  (read-only)  │
 *   └──────────────┴─────────────────┴──────────────┘
 *
 * Performance:
 *   - Windowed rendering: only the visible rows are rendered as DOM nodes.
 *     For a 5000-line file, this means ~30-50 DOM nodes per pane instead of
 *     5000 — opens instantly.
 *   - Side panes (Ours/Theirs) load ONLY the conflict region + a small context
 *     window around it (default ±20 lines). For most conflicts (a few dozen
 *     lines) this is <100 lines per pane.
 *   - Middle pane is a contentEditable <div> — uncontrolled, so typing does
 *     NOT trigger React re-renders. Conflict counter re-parses on a 400ms
 *     debounce.
 *   - `useLazyList` (binary-search indexed) handles the windowing math.
 */
import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import {
  Check, AlertCircle, Loader, ChevronUp, ChevronDown,
  ExternalLink, GitMerge, RotateCcw, Plus,
  ArrowLeft, ArrowRight,
} from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastActions } from '../stores/toastStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useLazyList } from '../lib/useLazyList';

type ConflictResolution = 'ours' | 'theirs' | 'base' | 'both-ours-first' | 'both-theirs-first' | 'manual';

interface ConflictHunk {
  /** 0-based line index where `<<<<<<<` marker is */
  startLine: number;
  oursStart: number;
  oursLines: string[];
  theirsStart: number;
  theirsLines: string[];
  /** 0-based line index AFTER `>>>>>>>` marker (exclusive end) */
  endLine: number;
  resolution?: ConflictResolution;
}

export interface ConflictMergeViewProps {
  filePath: string;
  /** Called after a file is successfully resolved & staged. */
  onResolved?: (resolvedFile: string) => void;
}

/** Lines of context shown above/below each conflict hunk in the side panes. */
const CONTEXT_LINES = 20;
const ROW_HEIGHT = 20;
const MAX_DISPLAY_CHARS = 200_000;

/**
 * Classify a single line for color highlighting in the middle pane.
 * Mirrors how git / VS Code / IntelliJ color conflict markers:
 *   - 'marker-start' (<<<<<<<): red background, bold
 *   - 'marker-sep'   (=======):  red background, bold
 *   - 'marker-end'   (>>>>>>>):  red background, bold
 *   - 'ours':                    green-tinted background (the OURS side of the conflict)
 *   - 'theirs':                  red-tinted background   (the THEIRS side of the conflict)
 *   - 'context':                 normal background        (non-conflicting line)
 *
 * The classifier is stateful — it tracks whether the current line is inside
 * a conflict block and on which side (ours / theirs). State is encoded as
 * a small state machine over lines.
 */
type LineKind = 'context' | 'marker-start' | 'ours' | 'marker-sep' | 'theirs' | 'marker-end';

interface LineClass {
  kind: LineKind;
  /** CSS class for the row background + text color */
  className: string;
}

const LINE_CLASS: Record<LineKind, LineClass> = {
  'context':      { kind: 'context',      className: '' },
  'marker-start': { kind: 'marker-start', className: 'bg-status-conflict/20 text-status-conflict font-bold' },
  'marker-sep':   { kind: 'marker-sep',   className: 'bg-status-conflict/20 text-status-conflict font-bold' },
  'marker-end':   { kind: 'marker-end',  className: 'bg-status-conflict/20 text-status-conflict font-bold' },
  'ours':         { kind: 'ours',         className: 'bg-status-added/10 text-status-added' },
  'theirs':       { kind: 'theirs',      className: 'bg-status-deleted/10 text-status-deleted' },
};

/**
 * Classify every line in `text` into a `LineKind`. Returns an array of
 * LineClass entries (one per line) — used by the middle pane to render
 * each line with the right background + text color.
 *
 * State machine:
 *   outside-conflict → see '<<<<<<<' → marker-start, enter ours-side
 *   ours-side        → see '=======' → marker-sep,   enter theirs-side
 *   theirs-side      → see '>>>>>>>' → marker-end,    exit to context
 */
function classifyLines(text: string): LineClass[] {
  const lines = text.split('\n');
  const result: LineClass[] = new Array(lines.length);
  let state: 'outside' | 'ours' | 'theirs' = 'outside';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('<<<<<<<')) {
      result[i] = LINE_CLASS['marker-start'];
      state = 'ours';
    } else if (line.startsWith('=======') && state === 'ours') {
      result[i] = LINE_CLASS['marker-sep'];
      state = 'theirs';
    } else if (line.startsWith('>>>>>>>') && state === 'theirs') {
      result[i] = LINE_CLASS['marker-end'];
      state = 'outside';
    } else if (state === 'ours') {
      result[i] = LINE_CLASS['ours'];
    } else if (state === 'theirs') {
      result[i] = LINE_CLASS['theirs'];
    } else {
      result[i] = LINE_CLASS['context'];
    }
  }
  return result;
}

/**
 * Escape a string for safe insertion into innerHTML. Conflict markers are
 * already plain ASCII, but the user's file content can contain <, >, &.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/ /g, '&nbsp;'); // preserve leading/trailing spaces
}

/**
 * Build the highlighted HTML for the middle pane. Each line becomes a <div>
 * with the right background + text color class. Conflict markers, OURS lines
 * and THEIRS lines are visually distinguished — exactly how git/VSCode/IntelliJ
 * render the conflict file.
 *
 * Empty lines are rendered as '&nbsp;' so the row height stays consistent.
 */
function buildHighlightedHtml(text: string, lineClasses: LineClass[]): string {
  const lines = text.split('\n');
  let html = '';
  for (let i = 0; i < lines.length; i++) {
    const cls = lineClasses[i]?.className || '';
    const content = lines[i] || '&nbsp;';
    // Use a data attribute for line index — used by tests / debugging.
    html += `<div class="${cls}" data-line="${i + 1}">${escapeHtml(content) || '&nbsp;'}</div>`;
  }
  return html;
}

/**
 * Memoized side pane — renders a windowed slice of `lines`.
 * Separated as a component so React can skip re-rendering when its props
 * (lines, side, onTake) are stable across parent re-renders.
 */
const SidePane = memo(function SidePane({
  title,
  lines,
  side,
  onTake,
  takeLabel,
}: {
  title: string;
  lines: string[];
  side: 'ours' | 'theirs';
  onTake: () => void;
  takeLabel: string;
}) {
  const { visibleRange, totalHeight, offsetY, scrollRef } = useLazyList({
    itemCount: lines.length,
    estimateRowHeight: ROW_HEIGHT,
    overscan: 6,
  });
  const visibleLines = lines.slice(visibleRange.start, visibleRange.end);
  return (
    <div className="flex-1 flex flex-col border-r border-border-default last:border-r-0 min-w-0 overflow-hidden">
      {/* Pane header */}
      <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border-default text-xs font-medium flex items-center justify-between flex-shrink-0">
        <span className={cn(
          'truncate',
          side === 'ours' ? 'text-status-added' : 'text-status-deleted',
        )}>
          {title}
          <span className="ml-2 text-2xs text-text-tertiary normal-case font-normal">
            ({lines.length} lines)
          </span>
        </span>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={onTake}
          title={takeLabel}
        >
          <ArrowRight size={10} className="inline -mt-0.5" /> {side === 'ours' ? 'Take Left' : 'Take Right'}
        </button>
      </div>
      {/* Pane content — windowed */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            {visibleLines.map((line, i) => {
              const lineNum = visibleRange.start + i + 1;
              return (
                <div
                  key={lineNum}
                  className={cn(
                    'flex font-mono text-xs leading-5 px-1',
                    'bg-status-conflict/10',
                  )}
                  style={{ height: ROW_HEIGHT }}
                >
                  <span className="w-10 flex-shrink-0 text-right pr-2 text-text-tertiary select-none border-r border-border-subtle">
                    {lineNum}
                  </span>
                  <pre
                    className={cn(
                      'flex-1 pl-2 whitespace-pre-wrap break-all m-0',
                      side === 'ours' ? 'text-status-added' : 'text-status-deleted',
                    )}
                    style={{ fontFamily: 'inherit' }}
                  >
                    {line || ' '}
                  </pre>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

/**
 * Parse Git conflict markers from a file content string.
 * Returns the list of conflict hunks (regions delimited by
 * `<<<<<<<` / `=======` / `>>>>>>>`).
 */
function parseConflicts(content: string): ConflictHunk[] {
  const lines = content.split('\n');
  const hunks: ConflictHunk[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      const startLine = i;
      const oursStart = i + 1;
      const oursLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('=======')) {
        oursLines.push(lines[i]);
        i++;
      }
      i++; // skip =======
      const theirsStart = i;
      const theirsLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
        theirsLines.push(lines[i]);
        i++;
      }
      i++; // skip >>>>>>> ...
      hunks.push({ startLine, oursStart, oursLines, theirsStart, theirsLines, endLine: i });
    } else {
      i++;
    }
  }
  return hunks;
}

export function ConflictMergeView({ filePath, onResolved }: ConflictMergeViewProps) {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastActions();
  const [loading, setLoading] = useState(true);
  /** The full content of the working-tree file (the editable middle pane). */
  const [content, setContent] = useState<string>('');
  const [baseContent, setBaseContent] = useState<string>('');
  const [oursContent, setOursContent] = useState<string>('');
  const [theirsContent, setTheirsContent] = useState<string>('');
  const [currentHunk, setCurrentHunk] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  /**
   * The highlighted HTML for the middle pane. Built from `content` via
   * `buildHighlightedHtml` (each line becomes a colored <div>). Set whenever
   * `content` changes — load, apply resolution, reset hunk.
   *
   * We use `dangerouslySetInnerHTML` on the contentEditable div to inject
   * this HTML — React owns the innerHTML attribute, so re-renders don't
   * clobber our highlighting (which was happening when we assigned
   * `editorRef.current.innerHTML` directly — React's reconciliation would
   * reset it after the next state update).
   */
  const [highlightedHtml, setHighlightedHtml] = useState<string>('');
  const editorRef = useRef<HTMLDivElement | null>(null);

  // ===== Load file content + stage versions ================================

  const loadFile = useCallback(async () => {
    setLoading(true);
    setDirty(false);
    try {
      // Stage versions for the conflicted file:
      //   :1:filePath = BASE (common ancestor)
      //   :2:filePath = OURS (current branch / HEAD)
      //   :3:filePath = THEIRS (incoming branch)
      // NOTE: `:0:filePath` (stage 0 = "fully merged") does NOT exist while
      // the file is still conflicted.
      const [base, ours, theirs] = await Promise.all([
        api.git.raw(repo.path, ['show', `:1:${filePath}`]).catch(() => ''),
        api.git.raw(repo.path, ['show', `:2:${filePath}`]).catch(() => ''),
        api.git.raw(repo.path, ['show', `:3:${filePath}`]).catch(() => ''),
      ]);
      setBaseContent(base);
      setOursContent(ours);
      setTheirsContent(theirs);
      const fullPath = `${repo.path}/${filePath}`.replace(/\/\+/g, '/');
      let fileContent = '';
      try { fileContent = await api.fs.readFile(fullPath); } catch { fileContent = ''; }
      setContent(fileContent);
      // Build the highlighted HTML once for the whole file. The middle pane
      // renders this via `dangerouslySetInnerHTML` so React owns the
      // innerHTML attribute — re-renders won't clobber our highlighting.
      const buildHighlighted = (text: string) => {
        const lineClasses = classifyLines(text);
        return buildHighlightedHtml(text, lineClasses);
      };
      const finish = () => setLoading(false);
      setTimeout(() => {
        if (fileContent.length > MAX_DISPLAY_CHARS) {
          // Truncate display — full content still in `content` state for save.
          const truncated = fileContent.slice(0, MAX_DISPLAY_CHARS) +
            '\n\n... [file truncated for display — full content preserved for save] ...';
          setHighlightedHtml(buildHighlighted(truncated));
          finish();
        } else {
          setHighlightedHtml(buildHighlighted(fileContent));
          finish();
        }
      }, 0);
    } catch (e) {
      toast.error(t('changes.conflictLoadFailed'), String(e));
      setLoading(false);
    }
    // NOTE: `t` is intentionally excluded from deps. `useI18n()` returns a
    // NEW `t` function on every render (it's an inline closure), so including
    // it here would recreate `loadFile` on every render → `useEffect([loadFile])`
    // would re-fire → infinite loop. This was the root cause of the
    // "дёргается панель и не открывается" bug. `t` is only used for the error
    // toast — the locale rarely changes, and if it does the user can re-trigger
    // loadFile by switching files.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.path, filePath, toast]);

  useEffect(() => { loadFile(); }, [loadFile]);

  // ===== Conflict hunks ====================================================

  const hunks = useMemo(() => parseConflicts(content), [content]);
  const unresolvedCount = hunks.length;
  const currentHunkIdx = Math.min(currentHunk, Math.max(0, hunks.length - 1));

  // ===== Side pane content: only conflict region + small context ===========
  /**
   * For the current conflict hunk, build the OURS/THEIRS pane lines.
   * We render ONLY the conflict region plus a small context window around it
   * (CONTEXT_LINES on each side). For most conflicts this is <100 lines per
   * pane — keeping the DOM small even for 10k-line files.
   */
  const currentH = hunks[currentHunkIdx];
  const oursLines = useMemo(() => {
    if (currentH) return currentH.oursLines;
    // Fallback when no hunk is selected (e.g. all resolved): show first 100 lines
    return oursContent.split('\n').slice(0, 100);
  }, [currentH, oursContent]);
  const theirsLines = useMemo(() => {
    if (currentH) return currentH.theirsLines;
    return theirsContent.split('\n').slice(0, 100);
  }, [currentH, theirsContent]);

  // ===== Editor input handling (uncontrolled contentEditable) ==============

  const parseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleEditorInput = useCallback(() => {
    setDirty(true);
    if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
    parseTimerRef.current = setTimeout(() => {
      if (editorRef.current) {
        // innerText may be undefined in jsdom — fall back to textContent
        const text = editorRef.current.innerText ?? editorRef.current.textContent ?? '';
        const newHunks = parseConflicts(text);
        if (newHunks.length !== hunks.length) {
          setContent(text);
          setCurrentHunk((c) => Math.min(c, Math.max(0, newHunks.length - 1)));
        }
      }
    }, 400);
  }, [hunks.length]);

  // ===== Resolution actions =================================================

  const applyResolution = useCallback((resolution: ConflictResolution) => {
    if (!editorRef.current || hunks.length === 0) return;
    const h = hunks[currentHunkIdx];
    let resolved: string[];
    if (resolution === 'ours') resolved = h.oursLines;
    else if (resolution === 'theirs') resolved = h.theirsLines;
    else if (resolution === 'base') {
      const baseAll = baseContent.split('\n');
      resolved = baseAll.slice(h.oursStart, h.oursStart + Math.max(h.oursLines.length, h.theirsLines.length)) || h.oursLines;
    } else if (resolution === 'both-ours-first') {
      resolved = [...h.oursLines, '', ...h.theirsLines];
    } else if (resolution === 'both-theirs-first') {
      resolved = [...h.theirsLines, '', ...h.oursLines];
    } else {
      return;
    }
    // Read current editor content — fall back to `content` state if
    // innerText is unimplemented (jsdom in tests) or empty.
    const currentText = editorRef.current?.innerText ?? editorRef.current?.textContent ?? content;
    const allLines = currentText.split('\n');
    const newLines = [...allLines.slice(0, h.startLine), ...resolved, ...allLines.slice(h.endLine)];
    const newText = newLines.join('\n');
    // Re-render with highlighted HTML so the remaining conflict markers stay
    // colored. Stored in state — React injects via dangerouslySetInnerHTML.
    const lineClasses = classifyLines(newText);
    setHighlightedHtml(buildHighlightedHtml(newText, lineClasses));
    setContent(newText);
    setDirty(true);
    toast.success(`Hunk ${currentHunkIdx + 1}: ${resolution.replace(/-/g, ' ')}`);
    if (currentHunkIdx < hunks.length - 1) {
      setCurrentHunk(currentHunkIdx + 1);
    } else {
      setCurrentHunk(0);
    }
  }, [hunks, currentHunkIdx, baseContent, toast]);

  const resetHunk = useCallback(() => {
    if (!editorRef.current || hunks.length === 0) return;
    const h = hunks[currentHunkIdx];
    const currentText = editorRef.current?.innerText ?? editorRef.current?.textContent ?? content;
    const allLines = currentText.split('\n');
    const markers = [
      `<<<<<<< HEAD`,
      ...h.oursLines,
      `=======`,
      ...h.theirsLines,
      `>>>>>>> branch`,
    ];
    const newLines = [...allLines.slice(0, h.startLine), ...markers, ...allLines.slice(h.endLine)];
    const newText = newLines.join('\n');
    // Re-render with highlighted HTML so the restored conflict markers show up
    // in their conflict colors (red bg, etc.).
    const lineClasses = classifyLines(newText);
    setHighlightedHtml(buildHighlightedHtml(newText, lineClasses));
    setContent(newText);
    setDirty(true);
  }, [hunks, currentHunkIdx, content]);

  // ===== Save & Stage ======================================================

  const handleSave = async () => {
    setSaving(true);
    try {
      // Read the editor's text content — when the pane uses highlighted HTML
      // (each line wrapped in <div>), innerText still returns the visible
      // text with line breaks. Falls back to textContent for jsdom.
      const resolved = editorRef.current?.innerText
        ?? editorRef.current?.textContent
        ?? content;
      if (resolved.includes('<<<<<<<') || resolved.includes('>>>>>>>')) {
        toast.warning('Conflict markers remain', 'Save anyway? File will be staged but not resolvable.');
      }
      const fullPath = `${repo.path}/${filePath}`.replace(/\/\+/g, '/');
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
  };

  // ===== Keyboard shortcuts =================================================

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'F7') {
        e.preventDefault();
        if (e.shiftKey) setCurrentHunk((h) => Math.max(0, h - 1));
        else setCurrentHunk((h) => Math.min(hunks.length - 1, h + 1));
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === '1') { e.preventDefault(); applyResolution('ours'); }
      else if (e.key === '2') { e.preventDefault(); applyResolution('theirs'); }
      else if (e.key === '3') { e.preventDefault(); applyResolution('both-ours-first'); }
      else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!saving) void handleSave();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [hunks.length, currentHunkIdx, applyResolution, saving]);

  // ===== Render: loading / binary / empty states ===========================

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

  if (hunks.length === 0 && !dirty) {
    const oursEmpty = oursContent.length === 0;
    const theirsEmpty = theirsContent.length === 0;
    const isBinary = !oursEmpty && !theirsEmpty && content.includes('\0');
    const isDeleteModify = oursEmpty || theirsEmpty;

    if (isBinary || isDeleteModify) {
      return (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="panel p-6 max-w-md text-center">
            <AlertCircle size={28} className="mx-auto mb-3 text-status-modified" />
            <div className="text-sm font-medium mb-1">
              {isBinary ? 'Binary file conflict' : 'Delete / Modify conflict'}
            </div>
            <div className="text-xs text-text-tertiary mb-4">
              {isBinary
                ? 'This file is binary and cannot be merged with a text-based solver. Choose which version to keep.'
                : oursEmpty
                  ? 'The file was deleted on our side but modified on their side. Choose to keep theirs or delete.'
                  : 'The file was deleted on their side but modified on our side. Choose to keep ours or delete.'}
            </div>
            <div className="flex items-center justify-center gap-2">
              {!oursEmpty && (
                <button className="btn btn-secondary text-xs" title="Keep our version (git checkout --ours)"
                  onClick={async () => {
                    try {
                      await api.git.raw(repo.path, ['checkout', '--ours', '--', filePath]);
                      await api.git.add(repo.path, [filePath]);
                      toast.success('Took ours');
                      await refreshStatus(repo.path);
                      onResolved?.(filePath);
                    } catch (e) { toast.error('Failed', String(e)); }
                  }}
                >Take ours</button>
              )}
              {!theirsEmpty && (
                <button className="btn btn-secondary text-xs" title="Keep their version (git checkout --theirs)"
                  onClick={async () => {
                    try {
                      await api.git.raw(repo.path, ['checkout', '--theirs', '--', filePath]);
                      await api.git.add(repo.path, [filePath]);
                      toast.success('Took theirs');
                      await refreshStatus(repo.path);
                      onResolved?.(filePath);
                    } catch (e) { toast.error('Failed', String(e)); }
                  }}
                >Take theirs</button>
              )}
              <button className="btn btn-danger text-xs" title="Resolve as deleted (git rm)"
                onClick={async () => {
                  try {
                    await api.git.raw(repo.path, ['rm', '--', filePath]);
                    toast.success('Resolved as deleted');
                    await refreshStatus(repo.path);
                    onResolved?.(filePath);
                  } catch (e) { toast.error('Failed', String(e)); }
                }}
              >Resolve as deleted</button>
            </div>
          </div>
        </div>
      );
    }

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

  // ===== Windowed row renderer for side panes ===============================
  /**
   * Memoized side pane component — separate so React can skip re-rendering
   * it when its props (lines, side, onTake) haven't changed. The parent's
   * `content` state updates trigger re-renders, but the side panes only need
   * to update when the current hunk changes.
   */

  // ===== Render: main 3-pane view ==========================================

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-bg-secondary border-b border-border-default flex-shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <AlertCircle size={14} className="text-status-conflict flex-shrink-0" />
          <span className="text-xs font-medium truncate">
            {t('changes.conflictSolverTitle')}
          </span>
          <code className="text-2xs font-mono text-text-tertiary truncate">{filePath}</code>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-2xs text-text-secondary tabular-nums">
            <span className="text-status-conflict font-medium">{unresolvedCount}</span> conflicts
          </span>
          <div className="w-px h-4 bg-border-default" />
          <button
            className="icon-btn"
            title="Previous conflict (Shift+F7)"
            onClick={() => setCurrentHunk((h) => Math.max(0, h - 1))}
            disabled={currentHunkIdx === 0}
          >
            <ChevronUp size={14} />
          </button>
          <span className="text-2xs mono text-text-secondary tabular-nums">
            {hunks.length > 0 ? `${currentHunkIdx + 1} / ${hunks.length}` : '— / —'}
          </span>
          <button
            className="icon-btn"
            title="Next conflict (F7)"
            onClick={() => setCurrentHunk((h) => Math.min(hunks.length - 1, h + 1))}
            disabled={hunks.length === 0 || currentHunkIdx === hunks.length - 1}
          >
            <ChevronDown size={14} />
          </button>
          <div className="w-px h-4 bg-border-default" />
          <button
            className="btn btn-secondary text-2xs"
            title="Open in VS Code 3-way merge editor"
            onClick={async () => {
              try {
                const res = await api.vscode.openMerge(repo.path, filePath);
                if (res.ok) toast.success('Opened in VS Code merge editor');
                else toast.error('VS Code not found', res.detail || 'Install VS Code or configure path');
              } catch (e) { toast.error('VS Code merge failed', String(e)); }
            }}
          >
            <ExternalLink size={10} /> VS Code
          </button>
          <button
            className="btn btn-primary text-2xs"
            onClick={handleSave}
            disabled={saving}
            title="Save resolved content and stage the file (Ctrl+Enter)"
          >
            {saving ? <Loader size={11} className="spin" /> : <Check size={11} />}
            {t('changes.saveStage')}
            {dirty && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-status-modified inline-block" />}
          </button>
        </div>
      </div>

      {/* Merge action toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 bg-bg-tertiary border-b border-border-default flex-shrink-0 overflow-x-auto">
        <span className="text-2xs text-text-tertiary mr-2">Resolve:</span>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={() => applyResolution('ours')}
          title="Use OURS for this hunk (Ctrl+1)"
        >
          <ArrowLeft size={10} className="inline -mt-0.5" /> Take Left
        </button>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={() => applyResolution('both-ours-first')}
          title="Both: ours first, then theirs"
        >
          <Plus size={10} className="inline -mt-0.5" /> Both (L→R)
        </button>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={() => applyResolution('both-theirs-first')}
          title="Both: theirs first, then ours"
        >
          <Plus size={10} className="inline -mt-0.5" /> Both (R→L)
        </button>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={() => applyResolution('theirs')}
          title="Use THEIRS for this hunk (Ctrl+2)"
        >
          Take Right <ArrowRight size={10} className="inline -mt-0.5" />
        </button>
        <div className="w-px h-4 bg-border-default mx-1" />
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={resetHunk}
          title="Reset this hunk to raw conflict markers"
        >
          <RotateCcw size={10} className="inline -mt-0.5" /> Reset Hunk
        </button>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          title="Open external editor"
          onClick={() => {
            const fullPath = `${repo.path}/${filePath}`.replace(/\/+/g, '/');
            api.git.openFile(fullPath);
          }}
        >
          <ExternalLink size={10} className="inline -mt-0.5" /> External
        </button>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          title="Run git mergetool"
          onClick={async () => {
            try {
              await api.git.raw(repo.path, ['mergetool', '--', filePath]);
              toast.success('Merge tool completed', 'Reloading file content…');
              await loadFile();
              await refreshStatus(repo.path);
            } catch (e) { toast.error('Merge tool failed', String(e)); }
          }}
        >
          <GitMerge size={10} className="inline -mt-0.5" /> Merge Tool
        </button>
      </div>

      {/* 3-pane layout */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left: Ours (HEAD) — windowed */}
        <SidePane
          title={`ours ("HEAD")`}
          lines={oursLines}
          side="ours"
          onTake={() => applyResolution('ours')}
          takeLabel="Take ours for this hunk"
        />

        {/* Middle: Working Tree — EDITABLE (single contentEditable, no windowing) */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border-default text-xs font-medium flex items-center justify-between flex-shrink-0">
            <span className="text-text-primary truncate">
              {t('changes.workingTree')}
              <span className="ml-2 text-2xs text-text-tertiary normal-case font-normal">(editable)</span>
            </span>
            {dirty && (
              <span className="text-2xs text-status-modified flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-status-modified" />
                modified
              </span>
            )}
          </div>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleEditorInput}
            spellCheck={false}
            className="flex-1 overflow-auto p-3 font-mono text-xs leading-5 outline-none focus:bg-bg-hover/20 whitespace-pre-wrap break-all"
            style={{ minHeight: 0 }}
            data-testid="conflict-editor"
            dangerouslySetInnerHTML={highlightedHtml ? { __html: highlightedHtml } : undefined}
          />
        </div>

        {/* Right: Theirs — windowed */}
        <SidePane
          title="theirs"
          lines={theirsLines}
          side="theirs"
          onTake={() => applyResolution('theirs')}
          takeLabel="Take theirs for this hunk"
        />
      </div>

      {/* Bottom status bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-bg-secondary border-t border-border-default text-2xs text-text-tertiary flex-shrink-0">
        <span className="flex items-center gap-1">
          <Check size={9} className="text-status-added" />
          Editable center — direct typing or use toolbar actions above.
        </span>
        <span className="font-mono">
          Shortcuts: F7 next · Shift+F7 prev · Ctrl+1 ours · Ctrl+2 theirs · Ctrl+3 both · Ctrl+Enter save
        </span>
      </div>
    </div>
  );
}
