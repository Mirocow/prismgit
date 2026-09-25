/**
 * CommitMessageEditor — the commit-message textarea, ISOLATED into its own
 * component so typing does NOT re-render the host page.
 *
 * WHY this exists (RENDER-PERF): the draft text used to live in ChangesPage
 * state (a ~3k-line component hosting the file tree, three file lists, the
 * journal and the DiffViewer). Every keystroke re-rendered ALL of it —
 * the classic "typing in the commit box lags the whole UI" report.
 * Now the draft lives HERE: a keystroke re-renders only this small
 * component. The host page re-renders at most TWICE per message — when the
 * text crosses the empty <-> non-empty boundary (the Commit buttons' enabled
 * state) — via `onEmptyChange`, which fires on transitions only.
 *
 * AI streaming integration: the host streams generated tokens by calling
 * `ref.setText(token-so-far)` per token. Previously each token re-rendered
 * the whole page (20-50 full-page renders/s during generation); now each
 * token re-renders only this component.
 *
 * Imperative API (ref):
 *   - setText(text) — programmatic replace (AI stream, history pick, prefix
 *     picker, post-commit clear, AI-suggestion accept inside this component).
 *   - getText() — live draft for the commit handlers (reads a ref, so no
 *     state subscription is needed).
 *   - focus() / focusEnd() — after programmatic edits.
 */
import { memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Sparkles, Loader } from './icons';
import { CommitMarkdownPreview } from './CommitMarkdownPreview';
import { useI18n } from '../lib/i18n';

export interface CommitMessageEditorHandle {
  setText(text: string): void;
  getText(): string;
  focus(): void;
  /** Focus + move the caret to the end (after a programmatic edit). */
  focusEnd(): void;
}

interface CommitMessageEditorProps {
  ref?: React.Ref<CommitMessageEditorHandle>;
  /** Pending AI auto-suggestion (banner). Shown only while the draft is empty. */
  aiSuggestion: string | null;
  /** True while an AI suggestion is being generated. */
  aiSuggesting: boolean;
  /** Fired when the suggestion is consumed (accepted or superseded). */
  onSuggestionConsumed: () => void;
  /** Ctrl/Cmd+Enter in the textarea. */
  onSubmit: () => void;
  /** Fired ONLY on empty <-> non-empty transitions of the draft. */
  onEmptyChange: (empty: boolean) => void;
  /** Render the markdown preview pane next to the textarea. */
  showMarkdownPreview: boolean;
  /** Line-length guides ('none' | '50' | '72' | '50+72'). */
  lineGuides: string;
}

/** Guide columns derived from the setting — computed inside the component so
 * the prop is a primitive string (stable identity → memo-friendly). */
function guideColsFor(setting: string): number[] {
  if (setting === '50') return [50];
  if (setting === '72') return [72];
  if (setting === '50+72') return [50, 72];
  return [];
}

export const CommitMessageEditor = memo(function CommitMessageEditor({
  ref,
  aiSuggestion,
  aiSuggesting,
  onSuggestionConsumed,
  onSubmit,
  onEmptyChange,
  showMarkdownPreview,
  lineGuides,
}: CommitMessageEditorProps) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const textRef = useRef('');
  const lastEmptyRef = useRef(true);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Single write path: keep the ref (read synchronously by the commit
  // handlers through the imperative handle) and the state (render) in sync.
  const applyText = useCallback((v: string) => {
    textRef.current = v;
    setText(v);
  }, []);

  useImperativeHandle(ref, () => ({
    setText: applyText,
    getText: () => textRef.current,
    focus: () => { taRef.current?.focus(); },
    focusEnd: () => {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    },
  }), [applyText]);

  // Notify the host ONLY on empty <-> non-empty transitions — the Commit
  // buttons need exactly this signal, nothing else, per keystroke.
  useEffect(() => {
    const empty = !text.trim();
    if (empty !== lastEmptyRef.current) {
      lastEmptyRef.current = empty;
      onEmptyChange(empty);
    }
  }, [text, onEmptyChange]);

  const guideCols = guideColsFor(lineGuides);

  return (
    <div className="flex-1 flex overflow-hidden flex-col">
      {/* AI auto-suggestion hint — appears above the textarea when the AI
          has generated a suggestion in the background. Click to fill the
          textarea. Non-intrusive: subtle styling, dismissable by just
          typing in the textarea (which makes the banner condition flip). */}
      {aiSuggestion && !text.trim() && (
        <button
          className="flex items-center gap-1.5 px-2 py-1 bg-accent-muted/50 border-b border-accent/20 text-2xs text-accent hover:bg-accent-muted transition-colors text-left"
          onClick={() => {
            applyText(aiSuggestion);
            onSuggestionConsumed();
          }}
          title={t('changes.aiSuggestionTitle')}
        >
          <Sparkles size={9} className="shrink-0" />
          <span className="truncate flex-1 font-mono">{aiSuggestion.split('\n')[0]}</span>
          <span className="text-3xs text-text-tertiary shrink-0">{t('changes.aiSuggestionClickToUse')}</span>
        </button>
      )}
      {aiSuggesting && !aiSuggestion && !text.trim() && (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-bg-tertiary border-b border-border-subtle text-2xs text-text-tertiary">
          <Loader size={9} className="animate-spin" />
          <span>{t('changes.aiSuggesting')}</span>
        </div>
      )}
      <div className="flex-1 flex overflow-hidden">
        <div className="relative flex-1 flex overflow-hidden">
          {/* 1.4 — Line length guides (50/72, SmartGit "Show line length guides").
              Decorative overlay: pointer-events none, positioned at N·ch —
              ch resolves against the SAME font-mono text-sm metrics as the
              textarea, so the line lands exactly on column N (0.5rem = p-2). */}
          {guideCols.map(col => (
            <div
              key={col}
              aria-hidden
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-border-strong/40 font-mono text-sm"
              style={{ left: `calc(0.5rem + ${col}ch)` }}
            />
          ))}
          <textarea
            id="commit-message-input"
            ref={taRef}
            className="flex-1 text-sm font-mono resize-none p-2 bg-bg-primary border-r border-border-subtle"
            placeholder={t('changes.commitMessage')}
            value={text}
            onChange={(e) => applyText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                onSubmit();
              }
            }}
            style={{ minHeight: 0 }}
          />
        </div>
        {showMarkdownPreview && (
          <div className="flex-1 overflow-y-auto p-2 text-xs">
            <CommitMarkdownPreview content={text} />
          </div>
        )}
      </div>
    </div>
  );
});
