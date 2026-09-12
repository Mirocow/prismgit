import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from './icons';
import { cn } from '../lib/utils';

/**
 * Resizable + sortable DataGrid.
 *
 * User-requested: "add ability to resize columns AND sort columns in ALL
 * grids of the project". This component provides both — wrap any tabular
 * data in <DataGrid> and get:
 *
 *   - Drag-to-resize column widths (persisted to localStorage by gridId).
 *   - Click header to sort by that column ascending; click again to
 *     toggle to descending; click a third time to clear sort.
 *   - Optional per-column `sortAccessor` for custom sort keys (e.g.
 *     sort by commit date but display the hash).
 *   - Optional per-column `width` initial width (overridden by saved
 *     localStorage widths if present).
 *   - Optional per-column `resizable: false` to lock the width.
 *
 * Usage:
 *   <DataGrid
 *     gridId="branches-page"
 *     columns={[
 *       { key: 'name', header: 'Name', width: 200, sortAccessor: (b) => b.name.toLowerCase() },
 *       { key: 'tracking', header: 'Tracking', width: 120, resizable: false },
 *       { key: 'date', header: 'Date', width: 100, sortAccessor: (b) => new Date(b.date).getTime() },
 *     ]}
 *     rows={branches}
 *     getCell={(row, col) => row[col.key]}
 *     onRowClick={(b) => navigate(`/branches/${b.name}`)}
 *   />
 *
 * The component persists column widths to:
 *   localStorage[prismgrid-widths:<gridId>] = JSON.stringify({name: 220, ...})
 */

export interface DataGridColumn<R> {
  /** Unique key for the column (used as persistence key). */
  key: string;
  /** Header label. */
  header: string;
  /** Initial width in px (default 120). */
  width?: number;
  /** Min width in px (default 60). */
  minWidth?: number;
  /** Max width in px (default 600). */
  maxWidth?: number;
  /** Whether the column is resizable (default true). */
  resizable?: boolean;
  /** Whether the column is sortable (default true if sortAccessor given). */
  sortable?: boolean;
  /**
   * Sort accessor — returns a comparable value for sorting.
   * If omitted, the cell's string value is used.
   */
  sortAccessor?: (row: R) => string | number | Date;
  /** Optional className to apply to all cells in this column. */
  cellClassName?: string;
  /** Optional alignment: 'left' (default), 'right', 'center'. */
  align?: 'left' | 'right' | 'center';
}

export interface DataGridProps<R> {
  /** Unique id for this grid (used to persist column widths). */
  gridId: string;
  /** Column definitions. */
  columns: DataGridColumn<R>[];
  /** Row data. */
  rows: R[];
  /** Render a cell's content. */
  getCell: (row: R, column: DataGridColumn<R>) => React.ReactNode;
  /** Optional: render the row element wrapper (rare; default uses <tr>-like div). */
  renderRow?: (row: R, index: number, children: React.ReactNode) => React.ReactNode;
  /** Click handler for a row. */
  onRowClick?: (row: R, index: number) => void;
  /** Initial sort column key + direction (default: no sort). */
  initialSort?: { columnKey: string; direction: 'asc' | 'desc' };
  /** Empty-state message when rows is empty. */
  emptyState?: React.ReactNode;
  /** Optional className for the grid container. */
  className?: string;
  /** Sticky header (default true). */
  stickyHeader?: boolean;
}

type SortState = { columnKey: string; direction: 'asc' | 'desc' } | null;

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function DataGrid<R>({
  gridId,
  columns,
  rows,
  getCell,
  renderRow,
  onRowClick,
  initialSort,
  emptyState,
  className,
  stickyHeader = true,
}: DataGridProps<R>) {
  // --- Column widths (persisted to localStorage) ---
  const STORAGE_KEY = `prismgrid-widths:${gridId}`;
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    const init: Record<string, number> = {};
    for (const c of columns) init[c.key] = c.width ?? 120;
    return init;
  });
  // Persist on change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
    } catch { /* quota */ }
  }, [STORAGE_KEY, widths]);

  // --- Resize drag state ---
  const dragRef = useRef<{ colKey: string; startX: number; startWidth: number } | null>(null);
  const onResizeStart = useCallback((e: React.MouseEvent, col: DataGridColumn<R>) => {
    if (col.resizable === false) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      colKey: col.key,
      startX: e.clientX,
      startWidth: widths[col.key] ?? col.width ?? 120,
    };
    // Add listeners on document so we catch drag outside the header.
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  }, [widths]);
  const onResizeMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current) return;
    const { colKey, startX, startWidth } = dragRef.current;
    const col = columns.find(c => c.key === colKey);
    if (!col) return;
    const min = col.minWidth ?? 60;
    const max = col.maxWidth ?? 600;
    const delta = e.clientX - startX;
    const next = Math.max(min, Math.min(max, startWidth + delta));
    setWidths(prev => ({ ...prev, [colKey]: next }));
  }, [columns]);
  const onResizeEnd = useCallback(() => {
    dragRef.current = null;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
  }, []);
  // Clean up listeners on unmount.
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', onResizeMove);
      document.removeEventListener('mouseup', onResizeEnd);
    };
  }, [onResizeMove, onResizeEnd]);

  // --- Sort state ---
  const [sort, setSort] = useState<SortState>(initialSort ?? null);
  const onHeaderClick = useCallback((col: DataGridColumn<R>) => {
    if (col.sortable === false || !col.sortAccessor) return;
    setSort(prev => {
      if (prev?.columnKey !== col.key) return { columnKey: col.key, direction: 'asc' };
      if (prev.direction === 'asc') return { columnKey: col.key, direction: 'desc' };
      return null; // third click clears
    });
  }, []);

  // --- Sorted rows (memoized) ---
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.columnKey);
    if (!col || !col.sortAccessor) return rows;
    const accessor = col.sortAccessor;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      const cmp = compare(av, bv);
      return sort.direction === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort, columns]);

  // --- Render ---
  return (
    <div className={cn('flex flex-col flex-1 overflow-hidden', className)}>
      {/* Header */}
      <div
        className={cn(
          'flex items-stretch border-b border-border-default bg-bg-tertiary text-2xs font-semibold uppercase tracking-wide text-text-secondary',
          stickyHeader && 'sticky top-0 z-10',
        )}
      >
        {columns.map(col => {
          const isSorted = sort?.columnKey === col.key;
          const isSortable = col.sortable !== false && !!col.sortAccessor;
          const isResizable = col.resizable !== false;
          return (
            <div
              key={col.key}
              className={cn(
                'relative flex items-center px-2 py-1 select-none',
                isSortable && 'cursor-pointer hover:bg-bg-hover',
                col.align === 'right' && 'justify-end',
                col.align === 'center' && 'justify-center',
              )}
              style={{ width: widths[col.key] ?? col.width ?? 120, flexShrink: 0 }}
              onClick={() => onHeaderClick(col)}
              role={isSortable ? 'button' : undefined}
              tabIndex={isSortable ? 0 : undefined}
              title={col.header}
            >
              <span className="truncate">{col.header}</span>
              {isSortable && (
                <span className="ml-1 flex-shrink-0 opacity-60">
                  {!isSorted ? <ChevronsUpDown size={10} />
                    : sort?.direction === 'asc' ? <ChevronUp size={10} />
                    : <ChevronDown size={10} />}
                </span>
              )}
              {isResizable && (
                <span
                  className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/50 transition-colors"
                  onMouseDown={(e) => onResizeStart(e, col)}
                  onClick={(e) => { e.stopPropagation(); }}
                />
              )}
            </div>
          );
        })}
      </div>
      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {sortedRows.length === 0 ? (
          emptyState ?? <div className="p-4 text-center text-text-tertiary text-xs">No rows</div>
        ) : (
          sortedRows.map((row, idx) => {
            const cells = (
              <>
                {columns.map(col => (
                  <div
                    key={col.key}
                    className={cn(
                      'flex items-center px-2 py-1 border-b border-border-subtle text-xs',
                      col.align === 'right' && 'justify-end',
                      col.align === 'center' && 'justify-center',
                      col.cellClassName,
                    )}
                    style={{ width: widths[col.key] ?? col.width ?? 120, flexShrink: 0 }}
                  >
                    {getCell(row, col)}
                  </div>
                ))}
              </>
            );
            if (renderRow) {
              return (
                <div key={idx} onClick={() => onRowClick?.(row, idx)}>
                  {renderRow(row, idx, cells)}
                </div>
              );
            }
            return (
              <div
                key={idx}
                className="flex items-stretch cursor-pointer hover:bg-bg-hover transition-colors"
                onClick={() => onRowClick?.(row, idx)}
              >
                {cells}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Memoized export for hot-path consumers.
export const MemoDataGrid = memo(DataGrid) as typeof DataGrid;
