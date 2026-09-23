/**
 * MergeRow — a single row of the 3-way merge panes.
 *
 * Contract:
 *  - renders the line number gutter and the (syntax-highlighted) content;
 *  - ours/theirs rows get their block-level background tint + the 3px side
 *    border (the "which side am I" affordance);
 *  - ghost rows (alignment padding) render invisible: near-transparent bg
 *    and no content;
 *  - file content is HTML-ESCAPED before dangerouslySetInnerHTML — repo
 *    file bodies are untrusted input (a file containing "<img onerror…"
 *    must never inject markup into the merge view).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { MergeRow } from '../../src/components/merge/MergeRow';

const OURS_BG = 'rgba(34, 197, 94, 0.35)';
const THEIRS_BG = 'rgba(59, 130, 246, 0.35)';

function rowEl(props: Parameters<typeof MergeRow>[0]) {
  const { container } = render(<MergeRow {...props} />);
  return container.firstElementChild as HTMLElement;
}

describe('MergeRow', () => {
  it('renders the line number gutter and the text content', () => {
    const { container } = render(
      <MergeRow text="const x = 1;" lineNum={42} regionKind="stable" isGhost={false} lang="typescript" />,
    );
    expect(screen.getByText('42')).toBeTruthy();
    expect(container.textContent).toContain('const x = 1;');
  });

  it('null lineNum renders an empty gutter (no "null" text)', () => {
    const { container } = render(
      <MergeRow text="text" lineNum={null} regionKind="stable" isGhost={false} lang="typescript" />,
    );
    expect(container.textContent).not.toContain('null');
  });

  it('ours side → green tint + 3px left border', () => {
    const row = rowEl({ text: 'ours line', lineNum: 1, regionKind: 'ours', isGhost: false, lang: 'typescript', side: 'ours' });
    expect(row.style.backgroundColor).toBe(OURS_BG);
    expect(row.style.borderLeft).toContain('3px');
    expect(row.style.borderRight).toBe('');
  });

  it('theirs side → blue tint + 3px right border', () => {
    const row = rowEl({ text: 'theirs line', lineNum: 1, regionKind: 'theirs', isGhost: false, lang: 'typescript', side: 'theirs' });
    expect(row.style.backgroundColor).toBe(THEIRS_BG);
    expect(row.style.borderRight).toContain('3px');
    expect(row.style.borderLeft).toBe('');
  });

  it('base side → transparent background, no side borders', () => {
    const row = rowEl({ text: 'base line', lineNum: 1, regionKind: 'stable', isGhost: false, lang: 'typescript', side: 'base' });
    expect(row.style.backgroundColor).toBe('transparent');
    expect(row.style.borderLeft).toBe('');
    expect(row.style.borderRight).toBe('');
  });

  it('ghost rows render no content', () => {
    const { container } = render(
      <MergeRow text="ignored" lineNum={null} regionKind="ghost" isGhost={true} lang="typescript" />,
    );
    expect(container.textContent).not.toContain('ignored');
  });

  it('SECURITY: markup-looking file content is escaped, not injected', () => {
    const { container } = render(
      <MergeRow
        text='<img src=x onerror="alert(1)"><script>alert(2)</script>'
        lineNum={1}
        regionKind="stable"
        isGhost={false}
        lang="typescript"
      />,
    );
    // The rendered HTML must not contain a live <img>/<script> ELEMENT —
    // only their escaped text forms.
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    // The text itself is still visible (as text).
    expect(container.textContent).toContain('<img src=x');
    expect(container.textContent).toContain('<script>');
  });
});
