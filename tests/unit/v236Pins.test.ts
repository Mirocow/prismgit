/**
 * v2.3.6 pins — the user's follow-up 3-way report:
 *   «полоса появляется при клике на среднюю панель или при фокусе ее»
 *
 * Root cause (proven live, computed-style + pixel-diff): the Result pane is
 * a PANE-SIZED textarea; the global focus rules painted a 2px accent ring
 * around it on every click (Chromium matches :focus-visible for text inputs
 * even on MOUSE click) → accent stripes down the pane edges. Worse, the
 * `*:focus-visible { position: relative }` hijack flipped the absolute
 * overlay textarea to relative → it collapsed to intrinsic `cols` width
 * (385→201px measured), so the caret landed on the wrong character.
 *
 * Fix: the caret is the focus indicator in a code editor (VS Code shows no
 * ring either) — ring/border/shadow suppressed via the `merge-editor-input`
 * class (specificity (0,2,0) beats `textarea:focus-visible` (0,1,1)) PLUS
 * inline outline/position (inline beats everything, future-rule-proof).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('v2.3.6 — 3-way: no focus stripe on the middle pane', () => {
  const src = read('src/components/merge/MergeResultEditor.tsx');

  it('the Result textarea carries the merge-editor-input opt-out class', () => {
    expect(src).toMatch(/className="merge-editor-input[ "]/);
  });

  it('inline outline/position/box-shadow immunity on the overlay textarea', () => {
    // Inline styles beat any stylesheet rule regardless of specificity —
    // no future global focus rule can reintroduce the stripe or the
    // absolute→relative hijack (the width-collapse + caret misalign).
    expect(src).toContain("outline: 'none'");
    expect(src).toContain("position: 'absolute'");
    expect(src).toContain("boxShadow: 'none'");
  });

  it('globals.css suppresses the focus ring for full-pane code editors', () => {
    const css = read('src/styles/globals.css');
    // The opt-out rule itself…
    expect(css).toContain('.merge-editor-input:focus');
    expect(css).toContain('.merge-editor-input:focus-visible');
    // …declared AFTER the global rules it overrides (cascade order within
    // the shared @layer utilities block matters for equal-specificity ties).
    const globalIdx = css.indexOf('textarea:focus-visible');
    const optOutIdx = css.indexOf('.merge-editor-input:focus-visible');
    expect(globalIdx).toBeGreaterThan(0);
    expect(optOutIdx).toBeGreaterThan(globalIdx);
  });

  it('the global keyboard-focus rings survive everywhere else (a11y)', () => {
    const css = read('src/styles/globals.css');
    expect(css).toContain('*:focus-visible');
    expect(css).toMatch(/textarea:focus-visible[\s\S]{0,120}outline: 2px solid var\(--accent\)/);
  });

  it('only the 3-way overlay editor is opted out — no blanket textarea exemption', () => {
    const css = read('src/styles/globals.css');
    // Form fields (commit message, search, dialogs) keep their focus ring.
    expect(css).not.toMatch(/textarea:focus-visible[\s\S]{0,80}outline:\s*none/);
  });
});
