/**
 * refBadge render — REGRESSION test for the ChangesPage crash.
 *
 * The old RefBadge destructured its prop as `ref` — a React special prop
 * that never reaches function components, so `parsed` was undefined and
 * every page rendering badges crashed with
 * "Cannot read properties of undefined (reading 'kind')".
 *
 * Also covers the defensive parsing: null/undefined/blank entries inside
 * the refs array must be dropped silently, never crash the render.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const apiContextMenuMock = vi.hoisted(() => ({
  show: vi.fn().mockResolvedValue(undefined),
  onClick: vi.fn(() => () => {}),
}));
vi.mock('../../src/lib/api', () => ({
  api: { git: {}, app: {}, contextMenu: apiContextMenuMock },
}));

import { RefBadge, RefBadges, parseDecoratedRefs } from '../../src/lib/refBadge';
import { parseDecoratedRef } from '../../src/lib/refBadge';

describe('RefBadge — crash regression', () => {
  it('renders a valid badge (prop is NOT named `ref`)', () => {
    const parsed = parseDecoratedRef('tag: refs/tags/v2.0');
    render(<RefBadge parsed={parsed} />);
    expect(screen.getByText('v2.0')).toBeTruthy();
  });

  it('renders branch / remote / HEAD badges with clean labels', () => {
    render(
      <div>
        <RefBadge parsed={parseDecoratedRef('refs/heads/feature')} />
        <RefBadge parsed={parseDecoratedRef('refs/remotes/origin/dev')} />
        <RefBadge parsed={parseDecoratedRef('HEAD -> refs/heads/main')} />
      </div>,
    );
    expect(screen.getByText('feature')).toBeTruthy();
    expect(screen.getByText('origin/dev')).toBeTruthy();
    // HEAD badge renders "▸ main" as two text nodes inside one span
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '▸ main')).toBeTruthy();
  });
});

describe('RefBadges — defensive against broken refs arrays', () => {
  it('drops null/undefined/blank entries without crashing', () => {
    const refs = [
      undefined as unknown as string,
      'tag: refs/tags/v1.0',
      null as unknown as string,
      '   ',
      '' as string,
    ];
    render(<RefBadges refs={refs} />);
    expect(screen.getByText('v1.0')).toBeTruthy();
  });

  it('renders nothing for an empty / garbage-only array', () => {
    const { container: c1 } = render(<RefBadges refs={[]} />);
    expect(c1.textContent).toBe('');
    const { container: c2 } = render(<RefBadges refs={[undefined as unknown as string]} />);
    expect(c2.textContent).toBe('');
  });

  it('caps visible badges and shows the +N overflow', () => {
    render(
      <RefBadges
        refs={['tag: refs/tags/v1.0', 'tag: refs/tags/v2.0', 'refs/heads/main', 'refs/remotes/origin/dev']}
        max={2}
      />,
    );
    expect(screen.getByText('v1.0')).toBeTruthy();
    expect(screen.getByText('v2.0')).toBeTruthy();
    expect(screen.queryByText('main')).toBeNull();
    expect(screen.getByText('+2')).toBeTruthy();
  });

  it('parseDecoratedRefs survives a non-array input', () => {
    expect(parseDecoratedRefs(undefined as unknown as string[])).toEqual([]);
    expect(parseDecoratedRefs(null as unknown as string[])).toEqual([]);
  });
});
