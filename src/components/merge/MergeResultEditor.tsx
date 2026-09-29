/**
 * MergeResultEditor — the editable middle pane (Result / Working Tree).
 *
 * Architecture v3 (overlay editor inside the SHARED scroll container):
 *
 *   ┌──────────────────────────────────────────┐
 *   │  column (position:relative, height:      │  ← one row per RESULT line
 *   │            totalHeight = lines × 20px)   │     inside the 3-pane
 *   │    <pre class="highlight-layer" />       │     scroller shared with
 *   │      absolute inset-0, pointer-events:   │     Ours/Theirs panes.
 *   │      none, windowed rows at top:i×20,    │
 *   │      syntax-highlight + conflict tints   │
 *   │    <textarea class="input-layer" />      │
 *   │      absolute, FULL content height,      │
 *   │      overflow-y:hidden (the ancestor     │
 *   │      scroller scrolls), overflow-x:auto, │
 *   │      color:transparent, uncontrolled     │
 *   └──────────────────────────────────────────┘
 *
 * Why the overlay (textarea + pre) pattern?
 *
 *   The previous implementation used `contentEditable` +
 *   `dangerouslySetInnerHTML`. React owns innerHTML — on every state update
 *   React reconciles this attribute → the browser re-parses the HTML → DOM
 *   is fully recreated → the user's cursor position is lost, undo history is
 *   wiped, and any in-progress typing is discarded. This was the root cause
 *   of the original "can't edit middle pane" bug.
 *
 *   The textarea+pre pattern avoids this entirely:
 *   - textarea is UNCONTROLLED (defaultValue on mount; React never sets
 *     value). Cursor stays where the user puts it. Native undo works.
 *   - pre is a SEPARATE display layer, pointer-events:none.
 *
 * v3 fixes (user report: «средняя панель недоступна для редактирования»):
 *   1. LIVE re-highlight — the pre used to rebuild only when the
 *      `initialContent` prop changed (resolve/reset actions), NEVER while
 *      typing: the user typed into the transparent textarea, the value
 *      changed, but the VISIBLE layer stayed frozen → editing looked
 *      impossible. The highlight now follows the live content (90ms
 *      debounce; per-line tokenization is cached, so only edited lines
 *      re-tokenize).
 *   2. Shared scrolling — the column is now a TALL element inside the 3-pane
 *      scroller (height = lines×20). The textarea has NO internal vertical
 *      scroll; wheel/caret movement scrolls the shared container, so
 *      Ours/Theirs/Result stay aligned (previously only the middle pane
 *      scrolled internally — the side panes were frozen at the top because
 *      the shared container had no overflowing content).
 *   3. Pixel alignment — the gutter spans total exactly 48px and the
 *      textarea's padding-left is 48px (was 57 vs 48 — a 9px caret/text
 *      offset); BOTH layers render nowrap (`white-space:pre`) so a wrapped
 *      pre vs unwrapped textarea can never desync line positions.
 *
 * Horizontal scrolling (long lines): textarea overflow-x:auto drives a
 * translateX on the pre's inner wrapper (synced in onScroll).
 */

import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { tokenizeLineCached, tokensToHtml, type SupportedLang } from '../../lib/syntaxHighlight';

const ROW_HEIGHT = 20;
/** Total advance of the line-number gutter in the <pre> rows — MUST equal
 *  the textarea's padding-left so the caret sits exactly on its glyph. */
const GUTTER_WIDTH = 48;
/** Debounce for re-highlighting while typing (ms). Per-line tokenization is
 *  cached; the debounce bounds full-document HTML rebuilds to ~11/s. */
const HIGHLIGHT_DEBOUNCE_MS = 90;

interface MergeResultEditorProps {
  /** LIVE content of the Result pane (follows typing immediately — the
   *  parent's currentResult). The highlight layer follows it debounced. */
  content: string;
  lang: SupportedLang;
  /** Total column height in px (result lines × 20). The textarea fills it. */
  totalHeight: number;
  /** [start, end) range of RESULT lines to render in the highlight layer
   *  (windowing — derived from the shared scroller's scrollTop). */
  visibleRange: { start: number; end: number };
  onChange?: (text: string) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

/** Line classification (state machine) within the Result editor. */
type ResultLineKind = 'context' | 'marker-start' | 'ours' | 'marker-sep' | 'theirs' | 'marker-end';

interface ClassifiedLine {
  kind: ResultLineKind;
  /** Background CSS class — empty string for context lines. */
  bgClass: string;
}

// DIRECT COLOUR VALUES — inline styles, no CSS classes
// v2.3.5: the marker lines (<<<<<<< / ======= / >>>>>>>) used to carry a
// full-width RED 35% band — at a mid-file conflict that reads as «полоса
// по центру центральной панели» (the user's report; the red also looks like
// an ERROR stripe). Markers are structural noise, not content: neutral
// tertiary background + dimmed text now. The ours/theirs CONTENT bands
// stay colored (the signal) but softer (0.35 → 0.20) so the whole block
// reads as one highlighted region instead of aggressive stripes.
const KIND_BG: Record<ResultLineKind, string> = {
  'context':      'transparent',
  'marker-start': 'var(--bg-tertiary)',       // neutral — markers are noise
  'marker-sep':   'var(--bg-tertiary)',
  'marker-end':   'var(--bg-tertiary)',
  'ours':         'rgba(34, 197, 94, 0.20)',    // green for ours block (softer)
  'theirs':       'rgba(59, 130, 246, 0.20)',   // blue for theirs block (softer)
};

/** Classify each line of the Result content by its position relative to
 * conflict markers. Walks the lines once, tracking state. */
function classifyResultLines(lines: string[]): ClassifiedLine[] {
  const out: ClassifiedLine[] = new Array(lines.length);
  let state: 'outside' | 'ours' | 'theirs' = 'outside';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('<<<<<<<')) {
      out[i] = { kind: 'marker-start', bgClass: KIND_BG['marker-start'] };
      state = 'ours';
    } else if (line.startsWith('=======') && state === 'ours') {
      out[i] = { kind: 'marker-sep', bgClass: KIND_BG['marker-sep'] };
      state = 'theirs';
    } else if (line.startsWith('>>>>>>>') && state === 'theirs') {
      out[i] = { kind: 'marker-end', bgClass: KIND_BG['marker-end'] };
      state = 'outside';
    } else if (state === 'ours') {
      out[i] = { kind: 'ours', bgClass: KIND_BG['ours'] };
    } else if (state === 'theirs') {
      out[i] = { kind: 'theirs', bgClass: KIND_BG['theirs'] };
    } else {
      out[i] = { kind: 'context', bgClass: KIND_BG['context'] };
    }
  }
  return out;
}

/** Escape a string for safe insertion into innerHTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export function MergeResultEditor({
  content,
  lang,
  totalHeight,
  visibleRange,
  onChange,
  textareaRef,
}: MergeResultEditorProps) {
  const preInnerRef = useRef<HTMLDivElement>(null);
  const innerTextareaRef = useRef<HTMLTextAreaElement>(null);
  // Use the provided textareaRef if any, else the internal one.
  // Cast through unknown because React's RefObject<T> vs MutableRefObject<T>
  // typing makes the union awkward — at runtime both forms work the same.
  const effectiveRef = (textareaRef ?? innerTextareaRef) as React.RefObject<HTMLTextAreaElement>;

  // ── LIVE highlight content — debounced copy of `content` ────────────────
  // THE v3 fix: the highlight layer used to be built from the static
  // initialContent prop; typing changed the hidden value but the visible
  // layer never re-rendered. Now every content change (typing, resolve,
  // reset) flows into `content` and the highlight follows (debounced).
  const [highlightContent, setHighlightContent] = useState(content);
  useEffect(() => {
    const t = setTimeout(() => setHighlightContent(content), HIGHLIGHT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [content]);

  // ── Windowed, highlighted rows ──────────────────────────────────────────
  const rowsHtml = useMemo(() => {
    const lines = (highlightContent ?? '').split('\n');
    const classified = classifyResultLines(lines);
    const start = Math.max(0, visibleRange.start);
    const end = Math.min(lines.length, visibleRange.end);
    let html = '';
    for (let i = start; i < end; i++) {
      const line = lines[i] || '';
      const cls = classified[i];
      const isMarker = cls.kind === 'marker-start' || cls.kind === 'marker-sep' || cls.kind === 'marker-end';
      const lineNum = `<span style="display:inline-block;width:${GUTTER_WIDTH}px;flex-shrink:0;box-sizing:border-box;text-align:right;padding-right:7px;border-right:1px solid var(--border-subtle);color:var(--text-tertiary);user-select:none;">${i + 1}</span>`;
      const contentHtml = (line.startsWith('<<<<<<<') || line.startsWith('=======') || line.startsWith('>>>>>>>'))
        ? escapeHtml(line) || '&nbsp;'
        : tokensToHtml(tokenizeLineCached(line, lang)) || '&nbsp;';
      html += `<div style="position:absolute;top:${i * ROW_HEIGHT}px;left:0;height:${ROW_HEIGHT}px;min-height:${ROW_HEIGHT}px;background-color:${cls.bgClass};${isMarker ? 'color:var(--text-tertiary);' : ''}font-family:${FONT_STACK};font-size:12px;line-height:20px;display:flex;align-items:flex-start;white-space:pre;padding-right:8px;">${lineNum}<span style="white-space:pre;">${contentHtml}</span></div>`;
    }
    return html;
  }, [highlightContent, lang, visibleRange.start, visibleRange.end]);

  // ── Horizontal scroll sync: textarea.scrollLeft → pre translateX ────────
  const handleScroll = useCallback(() => {
    const ta = effectiveRef.current;
    const inner = preInnerRef.current;
    if (ta && inner) {
      inner.style.transform = `translateX(${-ta.scrollLeft}px)`;
    }
  }, [effectiveRef]);

  // Notify parent of changes for dirty-tracking (fires on every input —
  // the parent keeps its own immediate copy for height/conflict-markers).
  const handleInput = useCallback(() => {
    if (effectiveRef.current) {
      onChange?.(effectiveRef.current.value);
    }
  }, [effectiveRef, onChange]);

  // Tab key — insert 2 spaces instead of moving focus.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = effectiveRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const insert = '  ';
      ta.value = ta.value.slice(0, start) + insert + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + insert.length;
      handleInput();
    }
  }, [effectiveRef, handleInput]);

  return (
    <div
      className="flex-1 min-w-0 relative overflow-hidden"
      style={{ height: totalHeight }}
      data-testid="merge-result-column"
    >
      {/* Highlight layer — absolute, pointer-events:none, windowed rows.
          The inner wrapper is translateX-synced with the textarea's
          horizontal scroll so long lines stay caret-aligned. */}
      <pre
        aria-hidden="true"
        className="absolute inset-0 m-0 overflow-hidden pointer-events-none"
        style={{
          color: 'var(--text-primary)',
          background: 'transparent',
          padding: 0,
          margin: 0,
          border: 0,
          fontFamily: FONT_STACK,
          fontSize: '12px',
          lineHeight: '20px',
          zIndex: 0,
        }}
      >
        <div ref={preInnerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          <div dangerouslySetInnerHTML={{ __html: rowsHtml }} />
        </div>
      </pre>
      {/* Input layer — transparent text, visible caret, on top.
          FULL content height (no internal vertical scrolling — the shared
          3-pane scroller owns vertical scrolling, so the caret follows the
          same scroll position as Ours/Theirs). */}
      <textarea
        ref={effectiveRef}
        defaultValue={content}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
        spellCheck={false}
        wrap="off"
        className="absolute top-0 left-0 right-0 resize-none bg-transparent outline-none font-mono text-xs leading-5"
        style={{
          color: 'transparent',
          caretColor: 'var(--text-primary)',
          background: 'transparent',
          border: 0,
          padding: 0,
          margin: 0,
          height: totalHeight,
          whiteSpace: 'pre',
          overflowY: 'hidden',
          overflowX: 'auto',
          zIndex: 1,
          // Match the pre layer's font metrics EXACTLY:
          fontFamily: FONT_STACK,
          fontSize: '12px',
          lineHeight: '20px',
          paddingLeft: `${GUTTER_WIDTH}px`,
          paddingRight: '8px',
          paddingTop: '0',
          paddingBottom: '0',
          tabSize: 2,
        }}
        data-testid="merge-result-textarea"
      />
    </div>
  );
}
