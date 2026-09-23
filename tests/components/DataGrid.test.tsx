/**
 * DataGrid progressive row rendering (A8 virtualization).
 *
 * Contract:
 *  - only the first ROW_BATCH (100) rows render initially, no matter how
 *    many rows the grid holds (RecyclablePage can carry thousands);
 *  - a sentinel row appears while rows remain undrendered;
 *  - the sentinel's IntersectionObserver callback appends the next batch;
 *  - changing the sort order resets the window back to the first batch;
 *  - ≤ ROW_BATCH rows render NO sentinel (nothing more to load).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DataGrid } from '../../src/components/DataGrid';

// jsdom has no real IntersectionObserver — capture the callback the
// component registers so tests can trigger "sentinel scrolled into view".
class MockIntersectionObserver {
  static last: MockIntersectionObserver | null = null;
  callback: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
    MockIntersectionObserver.last = this;
  }
  observe() { /* noop */ }
  disconnect() { /* noop */ }
  unobserve() { /* noop */ }
  takeRecords(): IntersectionObserverEntry[] { return []; }
  get root(): Element | null { return null; }
  get rootMargin(): string { return ''; }
  get thresholds(): number[] { return []; }
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

interface Row { name: string; n: number }

const columns = [
  { key: 'name', header: 'Name', width: 100, sortAccessor: (r: Row) => r.name },
  { key: 'n', header: 'N', width: 60, sortAccessor: (r: Row) => r.n },
];

const many: Row[] = Array.from({ length: 1000 }, (_, i) => ({ name: `row-${i}`, n: i }));

function fireIntersecting() {
  const io = MockIntersectionObserver.last;
  expect(io).toBeTruthy();
  io!.callback([{ isIntersecting: true } as unknown as IntersectionObserverEntry], io! as unknown as IntersectionObserver);
}

describe('DataGrid — progressive row rendering (A8)', () => {
  it('renders only the first 100 rows of 1000 and shows the "N / M" sentinel', () => {
    render(
      <DataGrid<Row>
        gridId="test-progressive"
        columns={columns}
        rows={many}
        getCell={(r, c) => (c.key === 'name' ? r.name : String(r.n))}
      />,
    );
    // First batch is in the DOM…
    expect(screen.getByText('row-0')).toBeTruthy();
    expect(screen.getByText('row-99')).toBeTruthy();
    // …the second batch is NOT (1000 rows up-front would freeze jsdom too)…
    expect(screen.queryByText('row-100')).toBeNull();
    // …and the sentinel reports progress.
    expect(screen.getByText('100 / 1000')).toBeTruthy();
  });

  it('the sentinel observer appends the next batch', async () => {
    render(
      <DataGrid<Row>
        gridId="test-progressive"
        columns={columns}
        rows={many}
        getCell={(r, c) => (c.key === 'name' ? r.name : String(r.n))}
      />,
    );
    fireIntersecting();
    await waitFor(() => {
      expect(screen.getByText('row-100')).toBeTruthy();
      expect(screen.getByText('row-199')).toBeTruthy();
      expect(screen.queryByText('row-200')).toBeNull();
      expect(screen.getByText('200 / 1000')).toBeTruthy();
    });
  });

  it('sorting resets the window to the first batch of the NEW order', async () => {
    render(
      <DataGrid<Row>
        gridId="test-progressive"
        columns={columns}
        rows={many}
        getCell={(r, c) => (c.key === 'name' ? r.name : String(r.n))}
      />,
    );
    // Grow the window first (simulating a scrolled-down user).
    fireIntersecting();
    await waitFor(() => expect(screen.getByText('200 / 1000')).toBeTruthy());

    // Sort by Name ascending — the effect must reset to the first 100 rows.
    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    await waitFor(() => {
      expect(screen.getByText('row-0')).toBeTruthy();
      expect(screen.queryByText('row-199')).toBeNull();
      expect(screen.getByText('100 / 1000')).toBeTruthy();
    });
  });

  it('no sentinel when all rows fit in one batch', () => {
    const few: Row[] = Array.from({ length: 50 }, (_, i) => ({ name: `s-${i}`, n: i }));
    const { container } = render(
      <DataGrid<Row>
        gridId="test-small"
        columns={columns}
        rows={few}
        getCell={(r, c) => (c.key === 'name' ? r.name : String(r.n))}
      />,
    );
    expect(screen.getByText('s-49')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d+ \/ 50/);
  });
});
