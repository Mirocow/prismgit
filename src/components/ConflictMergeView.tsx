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
import {
  tokenizeLine, tokensToHtml, detectLang, type SupportedLang,
} from '../lib/syntaxHighlight';

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
 * Classify a single line for BACKGROUND highlighting in the middle pane.
 *
 * Background colors show WHICH SIDE the line came from (the conflict-side
 * indication), while the TEXT color is reserved for syntax highlighting
 * (Python / Go / JSON / etc.). This keeps the two concerns separate:
 *
 *   - background = "where does this line come from?"
 *      - .conflict-bg-ours   : green tint  (left side / current branch / HEAD)
 *      - .conflict-bg-theirs  : red tint    (right side / incoming branch)
 *      - .conflict-bg-marker  : strong pink (for <<<<<<< ======= >>>>>>>)
 *      - (no class)           : context line (outside any conflict)
 *   - text color = syntax tokens (tok-keyword, tok-string, etc.)
 *
 * State machine:
 *   outside-conflict → see '<<<<<<<' → marker, enter ours-side
 *   ours-side        → see '=======' → marker, enter theirs-side
 *   theirs-side      → see '>>>>>>>' → marker, exit to context
 */
type LineKind = 'context' | 'marker-start' | 'ours' | 'marker-sep' | 'theirs' | 'marker-end';

interface LineClass {
  kind: LineKind;
  /** Background-only CSS class — text color comes from syntax highlighting */
  bgClass: string;
  /** Whether the line is part of a conflict region (for side panes alignment) */
  inConflict: boolean;
}

const LINE_CLASS: Record<LineKind, LineClass> = {
  'context':      { kind: 'context',      bgClass: '',                  inConflict: false },
  'marker-start': { kind: 'marker-start', bgClass: 'conflict-bg-marker', inConflict: true  },
  'marker-sep':   { kind: 'marker-sep',   bgClass: 'conflict-bg-marker', inConflict: true  },
  'marker-end':   { kind: 'marker-end',   bgClass: 'conflict-bg-marker', inConflict: true  },
  'ours':         { kind: 'ours',         bgClass: 'conflict-bg-ours',   inConflict: true  },
  'theirs':       { kind: 'theirs',       bgClass: 'conflict-bg-theirs', inConflict: true  },
};

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
 * Build the highlighted HTML for the middle pane. Each line becomes a <div>
 * with:
 *   - A line-number gutter on the left (grey, fixed width)
 *   - The background class for conflict-side indication (green/red/pink)
 *   - The line content with SYNTAX HIGHLIGHTING (tok-* spans)
 *
 * The language is detected from `filePath` (Python / Go / JSON / etc.).
 * If the language is unknown, the line is rendered as plain text.
 *
 * Empty lines render as &nbsp; so the row height stays consistent.
 */
function buildHighlightedHtml(text: string, lineClasses: LineClass[], lang: SupportedLang): string {
  const lines = text.split('\n');
  let html = '';
  for (let i = 0; i < lines.length; i++) {
    const lineCls = lineClasses[i];
    const bgClass = lineCls?.bgClass || '';
    const lineContent = lines[i] || '';
    // Line number gutter (fixed width, right-aligned, grey, non-selectable)
    // IMPORTANT: line height + height must match SidePane exactly (ROW_HEIGHT = 20px)
    // so that lines align across all three panes.
    const lineNum = `<span class="inline-block w-10 flex-shrink-0 text-right pr-2 text-text-tertiary select-none border-r border-border-subtle mr-2" style="color: var(--text-tertiary)">${i + 1}</span>`;
    // Tokenize the line content for syntax highlighting.
    // Conflict markers (<<<<<<< ======= >>>>>>>) are rendered as plain text —
    // they don't follow language syntax and shouldn't be tokenized.
    let contentHtml: string;
    if (lineContent.startsWith('<<<<<<<') || lineContent.startsWith('=======') || lineContent.startsWith('>>>>>>>')) {
      contentHtml = escapeHtml(lineContent) || '&nbsp;';
    } else {
      const tokens = tokenizeLine(lineContent, lang);
      contentHtml = tokensToHtml(tokens) || '&nbsp;';
    }
    // Fixed ROW_HEIGHT (20px) + leading-5 — EXACTLY matches SidePane so
    // line N in the middle pane aligns visually with line N in left/right panes.
    html += `<div class="${bgClass} flex items-start font-mono text-xs leading-5 px-1" style="height: ${ROW_HEIGHT}px" data-line="${i + 1}">${lineNum}<span class="flex-1 whitespace-pre-wrap">${contentHtml}</span></div>`;
  }
  return html;
}

/** Escape a string for safe insertion into innerHTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Memoized side pane — renders a windowed slice of `lines`.
 * Separated as a component so React can skip re-rendering when its props
 * (lines, side, onTake, conflictMask, lang) are stable across parent re-renders.
 *
 * `conflictMask` is a boolean array (one entry per line) — true means the
 * line is inside a conflict region in the middle pane and gets the side
 * background (green for ours / red for theirs).
 *
 * `sideBgClass` is the CSS class applied to conflict-region lines —
 * 'conflict-bg-ours' for the left pane, 'conflict-bg-theirs' for the right.
 *
 * `lang` is the detected programming language — used for syntax highlighting
 * of code (tok-keyword, tok-string, etc.).
 */
const SidePane = memo(function SidePane({
  title,
  lines,
  side,
  conflictMask,
  sideBgClass,
  lang,
  onTake,
  takeLabel,
}: {
  title: string;
  lines: string[];
  side: 'ours' | 'theirs';
  /** Per-line boolean: true = inside conflict region */
  conflictMask: boolean[];
  /** Background CSS class to apply to conflict-region lines */
  sideBgClass: string;
  /** Programming language for syntax highlighting */
  lang: SupportedLang;
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
      {/* Pane content — windowed, with syntax highlighting */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            {visibleLines.map((line, i) => {
              const lineNum = visibleRange.start + i + 1;
              const inConflict = conflictMask[visibleRange.start + i] === true;
              const bgClass = inConflict ? sideBgClass : '';
              // Tokenize the line for syntax highlighting (tok-keyword, etc.)
              const tokens = tokenizeLine(line || '', lang);
              const contentHtml = tokensToHtml(tokens);
              return (
                <div
                  key={lineNum}
                  className={cn(
                    'flex font-mono text-xs leading-5 px-1',
                    bgClass,
                  )}
                  style={{ height: ROW_HEIGHT }}
                >
                  <span className="w-10 flex-shrink-0 text-right pr-2 text-text-tertiary select-none border-r border-border-subtle">
                    {lineNum}
                  </span>
                  <span
                    className="flex-1 pl-2 whitespace-pre-wrap break-all"
                    dangerouslySetInnerHTML={{ __html: contentHtml || '&nbsp;' }}
                  />
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
  /**
   * Detected programming language for syntax highlighting. Set once on
   * file load from the file extension (Python, Go, JSON, etc.). Stored in a
   * ref so applyResolution / resetHunk can access it without re-creating
   * their callbacks on every render.
   */
  const langRef = useRef<SupportedLang>('text');

  /** Rebuild highlighted HTML from the given text — shared by loadFile,
   *  applyResolution and resetHunk so they all produce consistent output. */
  const rebuildHighlight = useCallback((text: string): string => {
    const lineClasses = classifyLines(text);
    return buildHighlightedHtml(text, lineClasses, langRef.current);
  }, []);

  // ===== Load file content + stage versions ================================

  const loadFile = useCallback(async () => {
    setLoading(true);
    setDirty(false);
    try {
      // FIRST: check if the file is actually in conflict state.
      // `git ls-files -u <file>` lists unmerged entries with their stages.
      // If the output is empty, the file is NOT conflicted (it was either
      // already resolved, or the status is stale, or the path doesn't match).
      // Without this check, `git show :1:file.ts` / `:2:` / `:3:` would each
      // throw "fatal: path 'file.ts' does not exist (neither on disk nor in
      // the index)" — flooding the main-process console with error logs.
      const lsOutput = await api.git.raw(repo.path, ['ls-files', '-u', '--', filePath]).catch(() => '');
      if (!lsOutput.trim()) {
        // File is not in conflict state — show a friendly message instead
        // of trying to load non-existent stage versions.
        toast.warning('File is not conflicted', 'This file may have been resolved already, or it is not in a conflict state.');
        setLoading(false);
        return;
      }

      // The file IS conflicted — safe to load the 3 stage versions:
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
      // Detect language for syntax highlighting (Python / Go / JSON / etc.).
      // Stored in a ref so applyResolution / resetHunk can reuse it without
      // re-creating their callbacks on every render.
      langRef.current = detectLang(filePath);
      // Build the highlighted HTML once for the whole file. The middle pane
      // renders this via `dangerouslySetInnerHTML` so React owns the
      // innerHTML attribute — re-renders won't clobber our highlighting.
      const finish = () => setLoading(false);
      setTimeout(() => {
        if (fileContent.length > MAX_DISPLAY_CHARS) {
          // Truncate display — full content still in `content` state for save.
          const truncated = fileContent.slice(0, MAX_DISPLAY_CHARS) +
            '\n\n... [file truncated for display — full content preserved for save] ...';
          setHighlightedHtml(rebuildHighlight(truncated));
          finish();
        } else {
          setHighlightedHtml(rebuildHighlight(fileContent));
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

  // Classify middle pane lines once — reused for both the middle pane HTML
  // (buildHighlightedHtml) and the side pane conflict masks.
  const lineClasses = useMemo(() => classifyLines(content), [content]);

  // Per-line "is this line inside a conflict region?" boolean arrays for the
  // side panes. The side panes show the FULL ours/theirs file content, and
  // lines that fall inside a conflict region in the middle pane get the pink
  // background — visually correlating which lines are in conflict.
  const conflictMask = useMemo(() => lineClasses.map((c) => c.inConflict), [lineClasses]);

  // ===== Side pane content: full OURS / THEIRS file content ================
  // The side panes show the FULL ours/theirs file content (not just the
  // conflict region), matching the reference UI: line1, MAIN-BRANCH-CHANGE,
  // line3, line4, line5 in the left pane; line1, FEATURE-CHANGE-HERE, line3
  // in the right pane. Lines inside a conflict region get the pink background;
  // context lines (line1, line3-5) get no highlight.
  const currentH = hunks[currentHunkIdx];
  const oursLines = useMemo(() => oursContent.split('\n'), [oursContent]);
  const theirsLines = useMemo(() => theirsContent.split('\n'), [theirsContent]);

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
    setHighlightedHtml(rebuildHighlight(newText));
    setContent(newText);
    setDirty(true);
    toast.success(`Hunk ${currentHunkIdx + 1}: ${resolution.replace(/-/g, ' ')}`);
    if (currentHunkIdx < hunks.length - 1) {
      setCurrentHunk(currentHunkIdx + 1);
    } else {
      setCurrentHunk(0);
    }
  }, [hunks, currentHunkIdx, baseContent, toast, rebuildHighlight]);

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
    setHighlightedHtml(rebuildHighlight(newText));
    setContent(newText);
    setDirty(true);
  }, [hunks, currentHunkIdx, content, rebuildHighlight]);

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
      {/* Top toolbar — file path, conflict counter, navigation, save
          All merge actions live here (matches the reference UI layout:
          one horizontal toolbar with all buttons). */}
      <div className="flex items-center gap-1 px-3 py-1.5 bg-bg-secondary border-b border-border-default flex-shrink-0 overflow-x-auto">
        {/* Left side: file info + conflict counter */}
        <AlertCircle size={14} className="text-status-conflict flex-shrink-0" />
        <span className="text-xs font-medium truncate">
          {t('changes.conflictSolverTitle')}
        </span>
        <code className="text-2xs font-mono text-text-tertiary truncate">{filePath}</code>
        <span className="text-2xs text-text-secondary tabular-nums ml-2">
          <span className="text-status-conflict font-medium">{unresolvedCount}</span> conflicts
        </span>
        <div className="w-px h-4 bg-border-default mx-1" />
        {/* Prev / Next conflict navigation */}
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
        <div className="w-px h-4 bg-border-default mx-1" />
        {/* Resolution actions — Take Left / Both (L→R) / Both (R→L) / Take Right
            Matches the reference UI: "Take Left, Right" / "Take Left" / "Take Right" / "Take Right, Left" */}
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={() => applyResolution('both-ours-first')}
          title="Take Left, Right — ours first then theirs (concatenate)"
        >
          <Plus size={10} className="inline -mt-0.5" /> Take L,R
        </button>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={() => applyResolution('ours')}
          title="Take Left — use OURS for this hunk (Ctrl+1)"
        >
          <ArrowLeft size={10} className="inline -mt-0.5" /> Take Left
        </button>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={() => applyResolution('theirs')}
          title="Take Right — use THEIRS for this hunk (Ctrl+2)"
        >
          Take Right <ArrowRight size={10} className="inline -mt-0.5" />
        </button>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={() => applyResolution('both-theirs-first')}
          title="Take Right, Left — theirs first then ours"
        >
          Take R,L <Plus size={10} className="inline -mt-0.5" />
        </button>
        <div className="w-px h-4 bg-border-default mx-1" />
        {/* Reset / External / Merge Tool */}
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={resetHunk}
          title="Reset this hunk to raw conflict markers"
        >
          <RotateCcw size={10} className="inline -mt-0.5" /> Reset
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
        <div className="w-px h-4 bg-border-default mx-1" />
        {/* VS Code integration */}
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          title="Open in VS Code 3-way merge editor"
          onClick={async () => {
            try {
              const res = await api.vscode.openMerge(repo.path, filePath);
              if (res.ok) toast.success('Opened in VS Code merge editor');
              else toast.error('VS Code not found', res.detail || 'Install VS Code or configure path');
            } catch (e) { toast.error('VS Code merge failed', String(e)); }
          }}
        >
          <ExternalLink size={10} className="inline -mt-0.5" /> VS Code
        </button>
        {/* Save & Stage (right-aligned) */}
        <div className="flex-1" />
        <button
          className="btn btn-primary text-2xs !py-0.5 !px-2"
          onClick={handleSave}
          disabled={saving}
          title="Save resolved content and stage the file (Ctrl+Enter)"
        >
          {saving ? <Loader size={11} className="spin" /> : <Check size={11} />}
          {t('changes.saveStage')}
          {dirty && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-status-modified inline-block" />}
        </button>
      </div>

      {/* 3-pane layout */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left: Ours (HEAD) — windowed, syntax highlighted, green bg for conflicts */}
        <SidePane
          title={`ours ("HEAD")`}
          lines={oursLines}
          side="ours"
          conflictMask={conflictMask}
          sideBgClass="conflict-bg-ours"
          lang={langRef.current}
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
            // Padding 0 — each line is a <div> with its own padding (px-1)
            // to match SidePane exactly. break-all removed — line wraps should
            // use whitespace-pre-wrap (preserve all spaces, wrap on overflow).
            className="flex-1 overflow-auto p-0 font-mono text-xs leading-5 outline-none focus:bg-bg-hover/20"
            style={{ minHeight: 0 }}
            data-testid="conflict-editor"
            dangerouslySetInnerHTML={highlightedHtml ? { __html: highlightedHtml } : undefined}
          />
        </div>

        {/* Right: Theirs — windowed, syntax highlighted, red bg for conflicts */}
        <SidePane
          title="theirs"
          lines={theirsLines}
          side="theirs"
          conflictMask={conflictMask}
          sideBgClass="conflict-bg-theirs"
          lang={langRef.current}
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
