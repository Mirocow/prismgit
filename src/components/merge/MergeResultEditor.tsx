/**
 * MergeResultEditor — the editable middle pane.
 *
 * Architecture: textarea overlay + syntax-highlighted <pre> behind it.
 *
 *   ┌────────────────────────────┐
 *   │  <div style="position:relative">
 *   │    <pre class="highlight-layer" />  ← absolute, pointer-events:none,
 *   │                                       syntax-highlighted HTML
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
 */

import { useEffect, useRef, useMemo, useCallback } from 'react';
import { tokenizeLine, tokensToHtml, type SupportedLang } from '../../lib/syntaxHighlight';

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
  /** Optional conflict-marker positions — for inline floating buttons. */
  conflictMarkersPositions?: number[];
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

  // Build the syntax-highlighted HTML for the entire content.
  // Memoized on `initialContent` (which only changes when the file is
  // reloaded — not on every keystroke, since the textarea is uncontrolled).
  const highlightedHtml = useMemo(() => {
    const lines = initialContent.split('\n');
    let html = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const lineNum = `<span class="inline-block w-10 flex-shrink-0 text-right pr-2 text-text-tertiary select-none border-r border-border-subtle mr-2" style="color: var(--text-tertiary)">${i + 1}</span>`;
      let contentHtml: string;
      if (line.startsWith('<<<<<<<') || line.startsWith('=======') || line.startsWith('>>>>>>>')) {
        // Conflict marker — plain text, no syntax highlight
        contentHtml = escapeHtml(line) || '&nbsp;';
      } else {
        contentHtml = tokensToHtml(tokenizeLine(line, lang)) || '&nbsp;';
      }
      html += `<div class="flex items-start font-mono text-xs leading-5 px-1" style="height: ${ROW_HEIGHT}px; min-height: ${ROW_HEIGHT}px;">${lineNum}<span class="flex-1 whitespace-pre-wrap">${contentHtml}</span></div>`;
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
