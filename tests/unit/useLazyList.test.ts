import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLazyList } from '../../src/lib/useLazyList';

describe('useLazyList', () => {
  it('returns empty range for empty list', () => {
    const { result } = renderHook(() => useLazyList({
      itemCount: 0,
      estimateRowHeight: 28,
    }));
    expect(result.current.visibleRange.start).toBe(0);
    expect(result.current.visibleRange.end).toBe(0);
    expect(result.current.totalHeight).toBe(0);
  });

  it('computes total height from estimated row height', () => {
    const { result } = renderHook(() => useLazyList({
      itemCount: 100,
      estimateRowHeight: 28,
    }));
    expect(result.current.totalHeight).toBe(100 * 28);
  });

  it('renders the first window when scrollTop is 0', () => {
    const { result } = renderHook(() => useLazyList({
      itemCount: 1000,
      estimateRowHeight: 28,
      overscan: 4,
    }));
    // With scrollTop=0 and viewportHeight=600 (default), should render first ~21 + overscan rows
    expect(result.current.visibleRange.start).toBe(0);
    expect(result.current.visibleRange.end).toBeGreaterThan(0);
    expect(result.current.visibleRange.end).toBeLessThan(100);
  });

  it('offsetY is 0 at the top', () => {
    const { result } = renderHook(() => useLazyList({
      itemCount: 100,
      estimateRowHeight: 28,
    }));
    expect(result.current.offsetY).toBe(0);
  });

  it('exposes scrollToIndex function', () => {
    const { result } = renderHook(() => useLazyList({
      itemCount: 100,
      estimateRowHeight: 28,
    }));
    expect(typeof result.current.scrollToIndex).toBe('function');
    // Should not throw
    expect(() => result.current.scrollToIndex(50)).not.toThrow();
  });

  it('exposes measureItem function', () => {
    const { result } = renderHook(() => useLazyList({
      itemCount: 100,
      estimateRowHeight: 28,
    }));
    expect(typeof result.current.measureItem).toBe('function');
    // Should not throw
    expect(() => result.current.measureItem(0, 35)).not.toThrow();
  });
});
