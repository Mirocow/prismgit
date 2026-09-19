/**
 * MergeResultEditor — the editable middle pane.
 *
 * Architecture: textarea overlay + syntax-highlighted <pre> behind it.
 *
 *   ┌────────────────────────────┐
 *   │  <div style="position:relative">
 *   │    <pre class="highlight-layer" />  ← absolute, pointer-events:none,
 *   │                                       syntax-highlighted HTML
 *   │                                       + conflict region bg tints
 *   │                                       + word-level diff highlights
 *   │    <textarea class="input-layer" />  ← relative, color:transparent,
 *   │                                       caret-color:black, uncontrolled
 *   │  </div>
 *   └────────────────────────────┘
 *
 * Why this pattern?
 *
 * The previous implementation used `contentEditable` + `dangerouslySetInnerHTML`.
 * React owns innerHTML — on every state update React reconciles this attribute
 * → the browser re-parses the HTML → DOM is fully recreated → the user's
 * cursor position is lost, undo history is wiped, and any in-progress typing
 * is discarded. This was the root cause of the "can't edit middle pane" bug.
 *
 * The textarea+pre pattern avoids this entirely:
 *   - textarea is UNCONTROLLED (we set defaultValue on mount, never value).
 *     React does NOT manage its text content, so re-renders leave the user's
 *     input alone. Cursor stays where the user put it. Undo works.
 *   - pre is a SEPARATE element that just displays the highlighted version.
 *     It's `pointer-events: none` so the textarea receives all input.
 *     React can update the pre as much as it wants — it doesn't affect
 *     the textarea's cursor.
 *   - scroll is synced: textarea.onScroll → pre.scrollTop = textarea.scrollTop.
 *
 * Font metrics MUST be identical between textarea and pre:
 *   font-family: ui-monospace, font-size: 12px, line-height: 20px,
 *   padding-left: 48px (line-number gutter), padding-right: 8px.
 *
 * The textarea's text is transparent (so only the caret is visible).
 * The pre shows the syntax-highlighted version of the same text in full color.
 *
 * Highlighting in the <pre> layer (added v2):
 *   The pre now classifies each line by its position relative to conflict
 *   markers (ours-block / theirs-block / marker / context) and applies the
 *   matching background tint. Inside conflict regions, word-level diffs
 *   against the OPPOSITE side highlight which specific words differ — same
 *   visual language as the side panes (MergeRow.tsx).
 *
 *   For ours lines, diffAgainst = the corresponding theirs line (matched by
 *   index within the conflict block). For theirs lines, the mirror.
 *   Words unique to the current side get .word-diff-added (bold green).
 */

import { useEffect, useRef, useMemo, useCallback } from 'react';
import { tokenizeLine, tokensToHtml, type SupportedLang } from '../../lib/syntaxHighlight';
import { wordDiff, type WordSegment } from '../../lib/wordDiff';

const ROW_HEIGHT = 20;
const GUTTER_WIDTH = 48; // px — matches w-10 + pr-2 + border = ~48px

interface MergeResultEditorProps {
  /** Initial content (used as defaultValue — uncontrolled). */
  initialContent: string;
  /** Detected language for syntax highlighting. */
  lang: SupportedLang;
  /** Called on every input (debounced externally). */
  onChange?: (text: string) => void;
  /** Ref forwarded to the underlying textarea — for parent to read content
      when saving. */
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  /** OURS content — for word-diff inside conflict regions.
   *  Optional: when omitted, no word-diff is computed (only bg tints). */
  oursContent?: string;
  /** THEIRS content — for word-diff inside conflict regions. */
  theirsContent?: string;
}

/** Line classification (state machine) within the Result editor. */
type ResultLineKind = 'context' | 'marker-start' | 'ours' | 'marker-sep' | 'theirs' | 'marker-end';

interface ClassifiedLine {
  kind: ResultLineKind;
  /** Background CSS class — empty string for context lines. */
  bgClass: string;
  /** Index into the ours-block (0-based) when kind === 'ours', else -1.
   *  Used to pick the corresponding theirs line for word-diff. */
  oursBlockIdx: number;
  /** Index into the theirs-block (0-based) when kind === 'theirs', else -1. */
  theirsBlockIdx: number;
}

const KIND_BG: Record<ResultLineKind, string> = {
  'context':      '',
  'marker-start': 'conflict-bg-marker',
  'marker-sep':   'conflict-bg-marker',
  'marker-end':   'conflict-bg-marker',
  'ours':         'conflict-bg-ours',
  'theirs':       'conflict-bg-theirs',
};

/** Classify each line of the Result content by its position relative to
 *  conflict markers. Walks the lines once, tracking state. */
function classifyResultLines(lines: string[]): ClassifiedLine[] {
  const out: ClassifiedLine[] = new Array(lines.length);
  let state: 'outside' | 'ours' | 'theirs' = 'outside';
  let oursIdx = 0;
  let theirsIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('<<<<<<<')) {
      out[i] = { kind: 'marker-start', bgClass: KIND_BG['marker-start'], oursBlockIdx: -1, theirsBlockIdx: -1 };
      state = 'ours';
      oursIdx = 0;
      theirsIdx = 0;
    } else if (line.startsWith('=======') && state === 'ours') {
      out[i] = { kind: 'marker-sep', bgClass: KIND_BG['marker-sep'], oursBlockIdx: -1, theirsBlockIdx: -1 };
      state = 'theirs';
    } else if (line.startsWith('>>>>>>>') && state === 'theirs') {
      out[i] = { kind: 'marker-end', bgClass: KIND_BG['marker-end'], oursBlockIdx: -1, theirsBlockIdx: -1 };
      state = 'outside';
    } else if (state === 'ours') {
      out[i] = { kind: 'ours', bgClass: KIND_BG['ours'], oursBlockIdx: oursIdx++, theirsBlockIdx: -1 };
    } else if (state === 'theirs') {
      out[i] = { kind: 'theirs', bgClass: KIND_BG['theirs'], oursBlockIdx: -1, theirsBlockIdx: theirsIdx++ };
    } else {
      out[i] = { kind: 'context', bgClass: '', oursBlockIdx: -1, theirsBlockIdx: -1 };
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

/** Render word-diff segments as HTML, highlighting words unique to THIS side.
 *  Same visual language as MergeRow.tsx — words unique to this side get a
 *  SIDE-SPECIFIC highlight:
 *    - .word-diff-ours   (green)  for OURS rows
 *    - .word-diff-theirs (red)    for THEIRS rows
 *  Shared words get plain syntax highlighting. */
function renderWordDiffHtml(
  segments: WordSegment[],
  lang: SupportedLang,
  side: 'ours' | 'theirs',
): string {
  let html = '';
  for (const seg of segments) {
    if (seg.text === '') continue;
    if (seg.kind === 'equal') {
      html += tokensToHtml(tokenizeLine(seg.text, lang)) || escapeHtml(seg.text);
    } else {
      // 'removed' = word present on OURS side (in wordDiff(ours, theirs).old)
      // 'added'   = word present on THEIRS side (in wordDiff(ours, theirs).new)
      // For OURS pane: 'removed' segments are unique to ours.
      // For THEIRS pane: 'added' segments are unique to theirs.
      const isUnique = (side === 'ours' && seg.kind === 'removed')
                    || (side === 'theirs' && seg.kind === 'added');
      if (isUnique) {
        const cls = side === 'ours' ? 'word-diff-ours' : 'word-diff-theirs';
        html += `<span class="${cls}">${escapeHtml(seg.text)}</span>`;
      } else {
        html += escapeHtml(seg.text);
      }
    }
  }
  return html || '&nbsp;';
}

export function MergeResultEditor({
  initialContent,
  lang,
  onChange,
  textareaRef,
  oursContent,
  theirsContent,
}: MergeResultEditorProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const innerTextareaRef = useRef<HTMLTextAreaElement>(null);
  // Use the provided textareaRef if any, else the internal one.
  // Cast through unknown because React 18's RefObject<T> vs MutableRefObject<T>
  // typing makes the union awkward — at runtime both forms work the same.
  const effectiveRef = (textareaRef ?? innerTextareaRef) as React.RefObject<HTMLTextAreaElement>;

  // Pre-split ours / theirs lines for word-diff lookup.
  const oursLines = useMemo(() => (oursContent ?? '').split('\n'), [oursContent]);
  const theirsLines = useMemo(() => (theirsContent ?? '').split('\n'), [theirsContent]);

  // Build the syntax-highlighted HTML for the entire content.
  // Includes:
  //   - per-line background tint based on conflict-marker classification
  //   - word-level diff highlighting inside conflict regions (when oursContent
  //     and theirsContent are provided)
  // Memoized on `initialContent` (which only changes when the file is
  // reloaded — not on every keystroke, since the textarea is uncontrolled).
  const highlightedHtml = useMemo(() => {
    const lines = initialContent.split('\n');
    const classified = classifyResultLines(lines);
    let html = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const cls = classified[i];
      const lineNum = `<span class="inline-block w-10 flex-shrink-0 text-right pr-2 text-text-tertiary select-none border-r border-border-subtle mr-2" style="color: var(--text-tertiary)">${i + 1}</span>`;
      let contentHtml: string;
      if (line.startsWith('<<<<<<<') || line.startsWith('=======') || line.startsWith('>>>>>>>')) {
        // Conflict marker line — plain text (no syntax highlight).
        contentHtml = escapeHtml(line) || '&nbsp;';
      } else if (cls.kind === 'ours' && oursContent != null) {
        // Inside the OURS block of a conflict — word-diff against the
        // corresponding THEIRS line (matched by index within the block).
        const theirsLine = cls.oursBlockIdx >= 0 && cls.oursBlockIdx < theirsLines.length
          ? theirsLines[cls.oursBlockIdx]
          : null;
        if (theirsLine != null && theirsLine !== line) {
          const result = wordDiff(line, theirsLine);
          contentHtml = renderWordDiffHtml(result.old, lang, 'ours') || '&nbsp;';
        } else {
          contentHtml = tokensToHtml(tokenizeLine(line, lang)) || '&nbsp;';
        }
      } else if (cls.kind === 'theirs' && theirsContent != null) {
        // Inside the THEIRS block of a conflict — word-diff against the
        // corresponding OURS line.
        const oursLine = cls.theirsBlockIdx >= 0 && cls.theirsBlockIdx < oursLines.length
          ? oursLines[cls.theirsBlockIdx]
          : null;
        if (oursLine != null && oursLine !== line) {
          const result = wordDiff(oursLine, line);
          contentHtml = renderWordDiffHtml(result.new, lang, 'theirs') || '&nbsp;';
        } else {
          contentHtml = tokensToHtml(tokenizeLine(line, lang)) || '&nbsp;';
        }
      } else {
        // Context line or no word-diff data — plain syntax highlight.
        contentHtml = tokensToHtml(tokenizeLine(line, lang)) || '&nbsp;';
      }
      html += `<div class="flex items-start font-mono text-xs leading-5 px-1 ${cls.bgClass}" style="height: ${ROW_HEIGHT}px; min-height: ${ROW_HEIGHT}px;">${lineNum}<span class="flex-1 whitespace-pre-wrap">${contentHtml}</span></div>`;
    }
    return html;
  }, [initialContent, lang, oursContent, theirsContent, oursLines, theirsLines]);

  // Sync scroll: textarea → pre
  const handleScroll = useCallback(() => {
    if (preRef.current && effectiveRef.current) {
      preRef.current.scrollTop = effectiveRef.current.scrollTop;
      preRef.current.scrollLeft = effectiveRef.current.scrollLeft;
    }
  }, [effectiveRef]);

  // On mount, set the textarea's initial value (uncontrolled).
  // We do this via defaultValue in JSX — no programmatic manipulation.
  // Notify parent of changes for dirty-tracking.
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

  useEffect(() => {
    // Sync pre scroll position to match textarea on mount.
    handleScroll();
  }, [handleScroll]);

  return (
    <div
      className="flex-1 flex flex-col min-w-0 overflow-hidden relative"
      style={{ minHeight: 0 }}
    >
      {/* Header */}
      <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border-default text-xs font-medium flex items-center justify-between flex-shrink-0 h-8">
        <span className="text-text-primary truncate">Working Tree (Result)</span>
      </div>
      {/* Editor area — relative container with pre + textarea overlay */}
      <div className="flex-1 relative overflow-hidden" style={{ minHeight: 0 }}>
        {/* Highlight layer — absolute, pointer-events:none */}
        <pre
          ref={preRef}
          aria-hidden="true"
          className="absolute inset-0 m-0 overflow-auto pointer-events-none font-mono text-xs leading-5 px-0 py-0"
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--text-primary)',
            background: 'transparent',
            padding: 0,
            margin: 0,
            border: 0,
          }}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
        {/* Input layer — transparent text, visible caret, on top */}
        <textarea
          ref={effectiveRef}
          defaultValue={initialContent}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          spellCheck={false}
          wrap="off"
          className="absolute inset-0 w-full h-full resize-none bg-transparent outline-none font-mono text-xs leading-5"
          style={{
            color: 'transparent',
            caretColor: 'var(--text-primary)',
            background: 'transparent',
            border: 0,
            padding: 0,
            margin: 0,
            whiteSpace: 'pre',
            overflow: 'auto',
            // Match the pre's font metrics EXACTLY:
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
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
    </div>
  );
}
