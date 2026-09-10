/**
 * Unit tests for ConflictList — the scalable conflict list component that
 * handles DOZENS of conflicted files with filter, group-by-dir, mass actions,
 * collapse, and virtualized scroll.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConflictList } from '../../src/components/ConflictList';

function renderList(props: Partial<Parameters<typeof ConflictList>[0]> = {}) {
  const onResolveAction = vi.fn();
  const onOpenSolver = vi.fn();
  const onResolveAll = vi.fn();
  const defaults: Parameters<typeof ConflictList>[0] = {
    conflicts: [],
    finishAction: 'Commit',
    finishLabel: 'merge',
    onResolveAction,
    onOpenSolver,
    onResolveAll,
  };
  const merged = { ...defaults, ...props };
  return {
    ...render(<ConflictList {...merged} />),
    onResolveAction,
    onOpenSolver,
    onResolveAll,
  };
}

const MANY_CONFLICTS = Array.from({ length: 50 }, (_, i) => `src/module${Math.floor(i / 10)}/file${i}.ts`);

describe('ConflictList — scalable conflict UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders conflict count in header', () => {
    renderList({ conflicts: ['a.ts', 'b.ts', 'c.ts'] });
    expect(screen.getByText(/Conflicts \(3\)/)).toBeInTheDocument();
  });

  it('shows mass action buttons (Take All Ours / Take All Theirs)', () => {
    renderList({ conflicts: ['a.ts'] });
    expect(screen.getByText('Take All Ours')).toBeInTheDocument();
    expect(screen.getByText('Take All Theirs')).toBeInTheDocument();
  });

  it('collapses by default when >20 conflicts', () => {
    renderList({ conflicts: MANY_CONFLICTS });
    // 50 conflicts → collapsed by default. The filter input should NOT be visible.
    expect(screen.queryByPlaceholderText(/Filter.*conflicts/)).not.toBeInTheDocument();
  });

  it('expands when collapse toggle clicked', () => {
    renderList({ conflicts: MANY_CONFLICTS });
    const toggle = screen.getByTitle('Expand conflict list');
    fireEvent.click(toggle);
    // After expand, filter input should appear
    expect(screen.getByPlaceholderText(/Filter.*conflicts/)).toBeInTheDocument();
  });

  it('shows filter box when >5 conflicts and expanded', () => {
    renderList({ conflicts: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'] });
    expect(screen.getByPlaceholderText(/Filter.*conflicts/)).toBeInTheDocument();
  });

  it('filters conflicts by path substring', () => {
    // Filter box only shows when >5 conflicts
    renderList({ conflicts: ['src/foo/bar.ts', 'src/baz/qux.ts', 'README.md', 'a.ts', 'b.ts', 'c.ts'] });
    const input = screen.getByPlaceholderText(/Filter.*conflicts/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'src' } });
    expect(screen.getByText('src/foo/bar.ts')).toBeInTheDocument();
    expect(screen.getByText('src/baz/qux.ts')).toBeInTheDocument();
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();
  });

  it('shows "N/N shown" count when filtering', () => {
    renderList({ conflicts: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'] });
    const input = screen.getByPlaceholderText(/Filter.*conflicts/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'a' } });
    expect(screen.getByText('1/6 shown')).toBeInTheDocument();
  });

  it('groups by directory when Group toggle clicked', () => {
    renderList({ conflicts: ['src/foo/bar.ts', 'src/baz/qux.ts', 'README.md', 'a.ts', 'b.ts', 'c.ts'] });
    fireEvent.click(screen.getByText('Group'));
    // Directory headers should appear
    expect(screen.getByText('src/foo (1)')).toBeInTheDocument();
    expect(screen.getByText('src/baz (1)')).toBeInTheDocument();
    expect(screen.getByText('(root) (4)')).toBeInTheDocument();
  });

  it('clicking "Take All Ours" triggers confirm dialog then onResolveAll', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onResolveAll } = renderList({ conflicts: ['a.ts', 'b.ts'] });
    fireEvent.click(screen.getByText('Take All Ours'));
    await waitFor(() => {
      expect(onResolveAll).toHaveBeenCalledWith('ours');
    });
    confirmSpy.mockRestore();
  });

  it('per-file Take Ours button calls onResolveAction with file + mode', () => {
    const { onResolveAction } = renderList({ conflicts: ['src/foo.ts'] });
    fireEvent.click(screen.getByText('Ours'));
    expect(onResolveAction).toHaveBeenCalledWith('src/foo.ts', 'ours');
  });

  it('per-file Solver button calls onOpenSolver', () => {
    const { onOpenSolver } = renderList({ conflicts: ['src/foo.ts'] });
    fireEvent.click(screen.getByText('Solver'));
    expect(onOpenSolver).toHaveBeenCalledWith('src/foo.ts');
  });

  it('shows empty-state message when filter matches nothing', () => {
    renderList({ conflicts: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'] });
    const input = screen.getByPlaceholderText(/Filter.*conflicts/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'xyz' } });
    expect(screen.getByText(/No conflicts match/)).toBeInTheDocument();
  });
});
