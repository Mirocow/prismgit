/**
 * v3.9 — ResizableSplitter wide variant (the 3-way merge panes divider).
 * The default 1px hairline is kept for sidebar/console; `wide` renders the
 * 6px grabbable divider with a visible center grip.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResizableSplitter } from '../../src/components/ResizableSplitter';

describe('ResizableSplitter wide (v3.9)', () => {
  it('renders split-divider-wide only with wide=true', () => {
    const { container, rerender } = render(
      <ResizableSplitter direction="horizontal" onResize={() => {}} />,
    );
    expect(container.firstElementChild!.className).toContain('split-divider');
    expect(container.firstElementChild!.className).not.toContain('split-divider-wide');
    rerender(<ResizableSplitter direction="horizontal" onResize={() => {}} wide />);
    expect(container.firstElementChild!.className).toContain('split-divider-wide');
  });

  it('reports drag deltas to onResize (mousedown → mousemove → mouseup)', () => {
    const onResize = vi.fn();
    const { container } = render(
      <ResizableSplitter direction="horizontal" onResize={onResize} wide />,
    );
    const divider = container.firstElementChild as HTMLElement;
    fireEvent.mouseDown(divider);
    fireEvent.mouseMove(document, { clientX: 125 });
    fireEvent.mouseMove(document, { clientX: 150 });
    fireEvent.mouseUp(document);
    // deltas are incremental: 125 then +25 (start pos = 100 from mousedown)
    expect(onResize).toHaveBeenCalledTimes(2);
    expect(onResize).toHaveBeenLastCalledWith(25);
  });
});
