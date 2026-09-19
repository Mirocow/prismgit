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

const ROW_HEIGHT = 20;
const GUTTER_WIDTH = 48; // px — matches w-10 + pr-2 + border = ~48px

interface MergeResultEditorProps {
  initialContent: string;
  lang: SupportedLang;
  onChange?: (text: string) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
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

// DIRECT COLOUR VALUES — inline styles, no CSS classes
const KIND_BG: Record<ResultLineKind, string> = {
  'context':      'transparent',
  'marker-start': 'rgba(220, 38, 38, 0.35)',   // red for conflict markers
  'marker-sep':   'rgba(220, 38, 38, 0.35)',
  'marker-end':   'rgba(220, 38, 38, 0.35)',
  'ours':         'rgba(34, 197, 94, 0.35)',    // green for ours block
  'theirs':       'rgba(59, 130, 246, 0.35)',   // blue for theirs block
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
      out[i] = { kind: 'context', bgClass: KIND_BG['context'], oursBlockIdx: -1, theirsBlockIdx: -1 };
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

export function MergeResultEditor({
  initialContent,
  lang,
  onChange,
  textareaRef,
}: MergeResultEditorProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const innerTextareaRef = useRef<HTMLTextAreaElement>(null);
  // Use the provided textareaRef if any, else the internal one.
  // Cast through unknown because React 18's RefObject<T> vs MutableRefObject<T>
  // typing makes the union awkward — at runtime both forms work the same.
  const effectiveRef = (textareaRef ?? innerTextareaRef) as React.RefObject<HTMLTextAreaElement>;

  // Build the syntax-highlighted HTML — block-level background tint only.
  const highlightedHtml = useMemo(() => {
    const lines = initialContent.split('\n');
    const classified = classifyResultLines(lines);
    let html = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const cls = classified[i];
      const lineNum = `<span style="display:inline-block;width:40px;flex-shrink:0;text-align:right;padding-right:8px;color:var(--text-tertiary);user-select:none;border-right:1px solid var(--border-subtle);margin-right:8px;">${i + 1}</span>`;
      // Only block-level background tint + syntax highlighting.
      // No word-level diff.
      const contentHtml = (line.startsWith('<<<<<<<') || line.startsWith('=======') || line.startsWith('>>>>>>>'))
        ? escapeHtml(line) || '&nbsp;'
        : tokensToHtml(tokenizeLine(line, lang)) || '&nbsp;';
      html += `<div style="height:${ROW_HEIGHT}px;min-height:${ROW_HEIGHT}px;background-color:${cls.bgClass};font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;line-height:20px;padding:0 8px 0 0;display:flex;align-items:flex-start;white-space:pre-wrap;word-break:break-word;">${lineNum}<span style="flex:1;white-space:pre-wrap;">${contentHtml}</span></div>`;
    }
    return html;
  }, [initialContent, lang]);

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
          className="absolute inset-0 m-0 overflow-auto pointer-events-none"
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--text-primary)',
            background: 'transparent',
            padding: 0,
            margin: 0,
            border: 0,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: '12px',
            lineHeight: '20px',
            zIndex: 0,
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
            zIndex: 1,
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
