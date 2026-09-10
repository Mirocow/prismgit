import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffViewer } from '../../src/components/DiffViewer';
import type { DiffResult } from '../../src/lib/api';

const createMockDiff = (overrides: Partial<DiffResult> = {}): DiffResult => ({
  oldContent: '',
  newContent: '',
  oldPath: 'test.ts',
  newPath: 'test.ts',
  hunks: [
    {
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
      header: '@@ -1,3 +1,3 @@',
      lines: [
        { type: 'context', content: 'line1', oldLineNumber: 1, newLineNumber: 1 },
        { type: 'del', content: 'old line', oldLineNumber: 2, newLineNumber: null },
        { type: 'add', content: 'new line', oldLineNumber: null, newLineNumber: 2 },
      ],
    },
  ],
  binary: false,
  newFile: false,
  deletedFile: false,
  renamedFile: false,
  ...overrides,
});

describe('DiffViewer', () => {
  it('shows loading state', () => {
    render(<DiffViewer diff={null} loading={true} />);
    expect(screen.getByText(/Loading diff/i)).toBeInTheDocument();
  });

  it('shows placeholder when no diff selected', () => {
    render(<DiffViewer diff={null} loading={false} />);
    expect(screen.getByText(/Select a file to view its diff/i)).toBeInTheDocument();
  });

  it('shows binary file message', () => {
    const binaryDiff = createMockDiff({ binary: true });
    render(<DiffViewer diff={binaryDiff} />);
    expect(screen.getByText(/Binary file/i)).toBeInTheDocument();
  });

  it('renders file path and badges', () => {
    const diff = createMockDiff({ newFile: true });
    render(<DiffViewer diff={diff} />);
    expect(screen.getByText('test.ts')).toBeInTheDocument();
    expect(screen.getByText('NEW')).toBeInTheDocument();
  });

  it('shows DELETED badge for deleted files', () => {
    const diff = createMockDiff({ deletedFile: true });
    render(<DiffViewer diff={diff} />);
    expect(screen.getByText('DELETED')).toBeInTheDocument();
  });

  it('shows RENAMED badge for renamed files', () => {
    const diff = createMockDiff({ renamedFile: true });
    render(<DiffViewer diff={diff} />);
    expect(screen.getByText('RENAMED')).toBeInTheDocument();
  });

  it('shows added/removed line counts', () => {
    const diff = createMockDiff();
    render(<DiffViewer diff={diff} />);
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });

  it('renders diff content with line numbers', () => {
    const diff = createMockDiff();
    render(<DiffViewer diff={diff} />);
    expect(screen.getByText('line1')).toBeInTheDocument();
    // With word-diff enabled (default), "old line" / "new line" are split into word segments.
    // "old" is removed (paired with "new" on the add line), "line" is equal.
    expect(screen.getByText('old')).toBeInTheDocument();
    expect(screen.getByText('new')).toBeInTheDocument();
    expect(screen.getAllByText('line').length).toBeGreaterThanOrEqual(2);
  });

  it('shows no changes message for empty hunks', () => {
    const diff = createMockDiff({ hunks: [] });
    render(<DiffViewer diff={diff} />);
    expect(screen.getByText(/No changes/i)).toBeInTheDocument();
  });

  it('switches to split view mode', () => {
    const diff = createMockDiff();
    render(<DiffViewer diff={diff} />);
    const splitButton = screen.getByText('Split');
    fireEvent.click(splitButton);
    // In split mode, content should still be visible (multiple instances)
    expect(screen.getAllByText('line1').length).toBeGreaterThan(0);
  });

  it('changes whitespace mode', () => {
    const diff = createMockDiff();
    render(<DiffViewer diff={diff} />);
    const select = screen.getByTitle('Whitespace mode');
    fireEvent.change(select, { target: { value: 'ignore-all' } });
    // Should not crash
    expect(screen.getByText('line1')).toBeInTheDocument();
  });

  it('collapses and expands hunks', () => {
    const diff = createMockDiff();
    render(<DiffViewer diff={diff} />);
    const hunkHeader = screen.getByText(/@@ -1,3 \+1,3 @@/);
    fireEvent.click(hunkHeader);
    // After collapse, content should be hidden
    expect(screen.queryByText('line1')).not.toBeInTheDocument();
    // Click again to expand
    fireEvent.click(hunkHeader);
    expect(screen.getByText('line1')).toBeInTheDocument();
  });
});
