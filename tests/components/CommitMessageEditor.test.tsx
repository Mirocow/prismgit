/**
 * CommitMessageEditor — RENDER-PERF regression pins.
 *
 * The component exists so that typing in the commit box does NOT re-render
 * the host page (ChangesPage, ~3k lines). These tests pin the contract that
 * makes that isolation work:
 *
 *  1. onEmptyChange fires ONLY on empty <-> non-empty transitions — never
 *     per keystroke (the host uses it solely for the Commit buttons'
 *     disabled state; a per-keystroke fire would re-render the whole page).
 *  2. The imperative ref API (getText/setText) works without any state
 *     subscription on the host side — the commit handlers and the AI token
 *     stream drive the draft through it.
 *  3. Ctrl/Cmd+Enter submits; plain Enter does not.
 *  4. The AI-suggestion banner fills the draft and consumes the suggestion.
 *  5. Line guides render for the 50+72 setting and not for 'none'.
 */
import { fireEvent, render, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import {
  CommitMessageEditor,
  type CommitMessageEditorHandle,
} from '../../src/components/CommitMessageEditor';

function Harness(props?: Partial<Parameters<typeof CommitMessageEditor>[0]>) {
  const ref = useRef<CommitMessageEditorHandle>(null);
  return (
    <CommitMessageEditor
      ref={ref}
      aiSuggestion={null}
      aiSuggesting={false}
      onSuggestionConsumed={() => {}}
      onSubmit={() => {}}
      onEmptyChange={() => {}}
      showMarkdownPreview={false}
      lineGuides="none"
      {...props}
    />
  );
}

/** The textarea keeps its stable DOM id — same hook the e2e specs use. */
const getTa = () => document.getElementById('commit-message-input') as HTMLTextAreaElement;

describe('CommitMessageEditor (render-perf isolation)', () => {
  it('onEmptyChange fires only on empty<->non-empty transitions, not per keystroke', () => {
    const onEmptyChange = vi.fn();
    render(<Harness onEmptyChange={onEmptyChange} />);
    const ta = getTa();

    // 4 keystrokes: '' -> 'f' -> 'fe' -> 'fea' -> 'feat' — exactly ONE
    // transition (empty -> non-empty) must be reported.
    fireEvent.change(ta, { target: { value: 'f' } });
    fireEvent.change(ta, { target: { value: 'fe' } });
    fireEvent.change(ta, { target: { value: 'fea' } });
    fireEvent.change(ta, { target: { value: 'feat' } });
    expect(onEmptyChange).toHaveBeenCalledTimes(1);
    expect(onEmptyChange).toHaveBeenLastCalledWith(false);

    // Back to empty — one more transition.
    fireEvent.change(ta, { target: { value: '' } });
    expect(onEmptyChange).toHaveBeenCalledTimes(2);
    expect(onEmptyChange).toHaveBeenLastCalledWith(true);

    // Still empty (no-op edit) — no additional notifications.
    fireEvent.change(ta, { target: { value: '' } });
    expect(onEmptyChange).toHaveBeenCalledTimes(2);
  });

  it('imperative API: getText/setText drive the draft without host state', () => {
    // Capture the ref OBJECT (not .current — useImperativeHandle populates
    // it only after mount, so reading .current during render yields null).
    let handleRef: { current: CommitMessageEditorHandle | null } | null = null;
    const Grabber = () => {
      const ref = useRef<CommitMessageEditorHandle>(null);
      handleRef = ref;
      return (
        <CommitMessageEditor
          ref={ref}
          aiSuggestion={null}
          aiSuggesting={false}
          onSuggestionConsumed={() => {}}
          onSubmit={() => {}}
          onEmptyChange={() => {}}
          showMarkdownPreview={false}
          lineGuides="none"
        />
      );
    };
    render(<Grabber />);
    const handle = () => handleRef?.current ?? null;
    act(() => { handle()?.setText('feat: streamed token'); });
    const ta = getTa();
    expect(ta.value).toBe('feat: streamed token');
    expect(handle()?.getText()).toBe('feat: streamed token');
    act(() => { handle()?.setText(''); });
    expect(handle()?.getText()).toBe('');
  });

  it('Ctrl+Enter triggers onSubmit exactly once', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const ta = getTa();
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(ta, { key: 'Enter', metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    // Plain Enter must NOT submit.
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('AI suggestion banner fills the draft and consumes the suggestion', () => {
    const onSuggestionConsumed = vi.fn();
    render(<Harness aiSuggestion="feat: auto suggestion" onSuggestionConsumed={onSuggestionConsumed} />);
    const ta = getTa();
    // Banner is a <button> containing the suggestion's first line.
    const banner = Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('feat: auto suggestion'));
    expect(banner).toBeTruthy();
    fireEvent.click(banner!);
    expect(ta.value).toBe('feat: auto suggestion');
    expect(onSuggestionConsumed).toHaveBeenCalledTimes(1);
  });

  it('line guides render for the 50+72 setting and not for none', () => {
    const { rerender } = render(<Harness lineGuides="none" />);
    expect(document.querySelectorAll('[aria-hidden="true"].absolute').length).toBe(0);
    rerender(<Harness lineGuides="50+72" />);
    expect(document.querySelectorAll('[aria-hidden="true"].absolute').length).toBe(2);
  });
});
