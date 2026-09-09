import { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '../lib/utils';

interface ResizableSplitterProps {
  direction?: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
}

/**
 * Draggable splitter for resizing panels.
 * horizontal = vertical line, drag left/right (col-resize)
 * vertical = horizontal line, drag up/down (row-resize)
 */
export function ResizableSplitter({
  direction = 'horizontal',
  onResize,
  onResizeEnd,
}: ResizableSplitterProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startPos = useRef(0);
  const lastPos = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
    lastPos.current = startPos.current;
  }, [direction]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = currentPos - lastPos.current;
      lastPos.current = currentPos;
      onResize(delta);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onResizeEnd?.();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, direction, onResize, onResizeEnd]);

  return (
    <div
      className={cn(
        direction === 'horizontal' ? 'split-divider' : 'split-divider-horizontal',
        isDragging && 'dragging'
      )}
      onMouseDown={handleMouseDown}
      style={{
        userSelect: isDragging ? 'none' : 'auto',
      }}
    />
  );
}

/**
 * Hook for managing resizable panel width.
 * Returns current width and resize handler.
 */
export function useResizableWidth(initialWidth: number, min: number = 200, max: number = 600) {
  const [width, setWidth] = useState(initialWidth);

  const handleResize = useCallback((delta: number) => {
    setWidth(prev => {
      const next = prev + delta;
      return Math.max(min, Math.min(max, next));
    });
  }, [min, max]);

  return { width, setWidth, handleResize };
}

/**
 * Hook for managing resizable panel height.
 */
export function useResizableHeight(initialHeight: number, min: number = 100, max: number = 600) {
  const [height, setHeight] = useState(initialHeight);

  const handleResize = useCallback((delta: number) => {
    setHeight(prev => {
      const next = prev - delta; // negative because dragging down = smaller height for top panel
      return Math.max(min, Math.min(max, next));
    });
  }, [min, max]);

  return { height, setHeight, handleResize };
}
