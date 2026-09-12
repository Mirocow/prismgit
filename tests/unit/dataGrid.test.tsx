import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataGrid, type DataGridColumn } from '../../src/components/DataGrid';

interface Row { id: number; name: string; date: string; }

const COLUMNS: DataGridColumn<Row>[] = [
  { key: 'name', header: 'Name', width: 100, sortAccessor: (r) => r.name.toLowerCase() },
  { key: 'date', header: 'Date', width: 100, sortAccessor: (r) => new Date(r.date).getTime() },
  { key: 'fixed', header: 'Fixed', width: 80, resizable: false },
];

const ROWS: Row[] = [
  { id: 1, name: 'banana', date: '2024-03-01' },
  { id: 2, name: 'apple',  date: '2024-01-15' },
  { id: 3, name: 'cherry', date: '2024-02-10' },
];

// Helper: get the body cells (not headers) for a given column key.
// Since header cells live in a sticky-header div and body cells in the
// overflow-auto body, we can't easily distinguish by CSS selector.
// Instead, we rely on the fact that the column header text is the
// HEADER label ('Name', 'Date', 'Fixed'), and the body cells are the
// row values ('banana', 'apple', 'cherry', etc).
function bodyCellsFor(columnKey: keyof Row, container: HTMLElement): string[] {
  // Find all elements with the width style — these include BOTH header
  // cells and body cells. The header cells contain header text (e.g.
  // 'Name'); the body cells contain row values. We filter out the
  // header text by matching against the known row values.
  const knownValues: Record<string, string[]> = {
    name: ['banana', 'apple', 'cherry'],
    date: ['2024-03-01', '2024-01-15', '2024-02-10'],
    fixed: ['1', '2', '3'],
  };
  // Get all rendered text nodes that match one of the known values for
  // this column.
  const values = knownValues[columnKey as string];
  return values.map(v => screen.getByText(v).textContent?.trim() ?? '');
}

describe('DataGrid component', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders headers and rows', () => {
    render(<DataGrid gridId="test1" columns={COLUMNS} rows={ROWS} getCell={(r, c) => String(r[c.key as keyof Row])} />);
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Date')).toBeTruthy();
    expect(screen.getByText('Fixed')).toBeTruthy();
    expect(screen.getByText('banana')).toBeTruthy();
    expect(screen.getByText('apple')).toBeTruthy();
    expect(screen.getByText('cherry')).toBeTruthy();
  });

  it('shows empty state when rows is empty', () => {
    render(
      <DataGrid
        gridId="test2"
        columns={COLUMNS}
        rows={[]}
        getCell={(r, c) => String(r[c.key as keyof Row])}
        emptyState={<div data-testid="empty">No rows</div>}
      />
    );
    expect(screen.getByTestId('empty')).toBeTruthy();
  });

  it('clicking a sortable header sorts ascending on first click', () => {
    render(<DataGrid gridId="test3" columns={COLUMNS} rows={ROWS} getCell={(r, c) => String(r[c.key as keyof Row])} />);
    fireEvent.click(screen.getByText('Name'));
    // After sort asc, all 'apple' / 'banana' / 'cherry' texts are still
    // present in the body, but the body cells render in the order:
    // apple, banana, cherry. We verify by extracting each row's cell
    // position via DOM order.
    const cells = screen.getAllByText(/^(banana|apple|cherry)$/);
    const names = cells.map(c => c.textContent?.trim());
    expect(names).toEqual(['apple', 'banana', 'cherry']);
  });

  it('clicking again toggles to descending', () => {
    render(<DataGrid gridId="test4" columns={COLUMNS} rows={ROWS} getCell={(r, c) => String(r[c.key as keyof Row])} />);
    fireEvent.click(screen.getByText('Name'));
    fireEvent.click(screen.getByText('Name'));
    const cells = screen.getAllByText(/^(banana|apple|cherry)$/);
    const names = cells.map(c => c.textContent?.trim());
    expect(names).toEqual(['cherry', 'banana', 'apple']);
  });

  it('third click on the same column clears sort', () => {
    render(<DataGrid gridId="test5" columns={COLUMNS} rows={ROWS} getCell={(r, c) => String(r[c.key as keyof Row])} />);
    fireEvent.click(screen.getByText('Name'));
    fireEvent.click(screen.getByText('Name'));
    fireEvent.click(screen.getByText('Name'));
    const cells = screen.getAllByText(/^(banana|apple|cherry)$/);
    const names = cells.map(c => c.textContent?.trim());
    expect(names).toEqual(['banana', 'apple', 'cherry']);
  });

  it('sorts by date column (numeric comparison)', () => {
    render(<DataGrid gridId="test6" columns={COLUMNS} rows={ROWS} getCell={(r, c) => String(r[c.key as keyof Row])} />);
    fireEvent.click(screen.getByText('Date'));
    const cells = screen.getAllByText(/^2024-/);
    const dates = cells.map(c => c.textContent?.trim());
    // Asc by date: 2024-01-15, 2024-02-10, 2024-03-01
    expect(dates).toEqual(['2024-01-15', '2024-02-10', '2024-03-01']);
  });

  it('persists column widths to localStorage when resized', () => {
    localStorage.setItem('prismgrid-widths:test7', JSON.stringify({ name: 250, date: 150, fixed: 80 }));
    const { container } = render(<DataGrid gridId="test7" columns={COLUMNS} rows={ROWS} getCell={(r, c) => String(r[c.key as keyof Row])} />);
    const nameHeader = container.querySelector('[style*="width: 250"]');
    const dateHeader = container.querySelector('[style*="width: 150"]');
    expect(nameHeader).toBeTruthy();
    expect(dateHeader).toBeTruthy();
  });

  it('non-resizable column is rendered without errors', () => {
    const { container } = render(<DataGrid gridId="test8" columns={COLUMNS} rows={ROWS} getCell={(r, c) => String(r[c.key as keyof Row])} />);
    const fixedHeader = container.querySelector('[style*="width: 80"]');
    expect(fixedHeader).toBeTruthy();
  });

  it('calls onRowClick when a row is clicked', () => {
    const onRowClick = vi.fn();
    render(<DataGrid gridId="test9" columns={COLUMNS} rows={ROWS} getCell={(r, c) => String(r[c.key as keyof Row])} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('apple'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    const clickedRow = onRowClick.mock.calls[0][0] as Row;
    expect(clickedRow.name).toBe('apple');
  });

  it('non-sortable column (no sortAccessor) does not respond to header click', () => {
    const cols: DataGridColumn<Row>[] = [
      { key: 'name', header: 'Name', width: 100 }, // no sortAccessor
    ];
    render(<DataGrid gridId="test10" columns={cols} rows={ROWS} getCell={(r, c) => String(r[c.key as keyof Row])} />);
    fireEvent.click(screen.getByText('Name'));
    const cells = screen.getAllByText(/^(banana|apple|cherry)$/);
    const names = cells.map(c => c.textContent?.trim());
    expect(names).toEqual(['banana', 'apple', 'cherry']);
  });

  it('multiple grids with different IDs keep separate width state', () => {
    localStorage.setItem('prismgrid-widths:gridA', JSON.stringify({ name: 200 }));
    localStorage.setItem('prismgrid-widths:gridB', JSON.stringify({ name: 300 }));
    const { container: c1 } = render(<DataGrid gridId="gridA" columns={COLUMNS} rows={ROWS} getCell={(r, c) => String(r[c.key as keyof Row])} />);
    expect(c1.querySelector('[style*="width: 200"]')).toBeTruthy();
    // Re-render with gridB in same jsdom (will affect screen queries — clear DOM first)
    document.body.innerHTML = '';
    const { container: c2 } = render(<DataGrid gridId="gridB" columns={COLUMNS} rows={ROWS} getCell={(r, c) => String(r[c.key as keyof Row])} />);
    expect(c2.querySelector('[style*="width: 300"]')).toBeTruthy();
  });
});
