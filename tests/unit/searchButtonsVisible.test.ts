import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * v2.3.3 pin — the Search tool (InvestigatePage) action buttons must be
 * ALWAYS VISIBLE.
 *
 * The user found by accident that the Search tool's row buttons (commit-row
 * browser/copy, file-row Changes/Diff/Blame/History, content-group header
 * Diff/Blame/History) only appeared on hover (`opacity-0 group-hover:opacity-100`).
 * v2.3.2 had converted only «Коммит»/«Changes» + the per-match rows; this pin
 * guards the WHOLE page against a hover-only regression.
 */
const src = readFileSync(resolve(__dirname, '../../src/pages/InvestigatePage.tsx'), 'utf8');

describe('v2.3.3 — Search tool buttons are always visible (not hover-only)', () => {
  it('contains no opacity-0 (hover-reveal) button in InvestigatePage', () => {
    // every action button must rest at opacity-60 and brighten on hover
    expect(src).not.toContain('opacity-0');
  });

  it('keeps at least 15 always-visible action buttons (commit rows, file rows, group headers, match rows)', () => {
    const visible = (src.match(/opacity-60 (?:group-hover|hover):opacity-100/g) ?? []).length;
    expect(visible).toBeGreaterThanOrEqual(15);
  });

  it('the «Коммит» blame-lookup buttons stay accent-colored', () => {
    expect(src).toContain('opacity-60 hover:opacity-100 icon-btn !w-5 !h-5 shrink-0 text-accent');
  });
});
