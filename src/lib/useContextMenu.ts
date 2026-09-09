import { useEffect, useCallback } from 'react';
import { api } from './api';

export interface ContextMenuItem {
  label?: string;
  type?: 'separator' | 'normal' | 'checkbox' | 'radio';
  checked?: boolean;
  enabled?: boolean;
  accelerator?: string;
  clickId?: string;
}

/**
 * Hook for showing native context menus.
 * Usage:
 *   const showContextMenu = useContextMenu();
 *   <div onContextMenu={(e) => {
 *     e.preventDefault();
 *     showContextMenu([
 *       { label: 'Stage', clickId: 'stage' },
 *       { type: 'separator' },
 *       { label: 'Delete', clickId: 'delete' },
 *     ], (clickId) => {
 *       if (clickId === 'stage') handleStage();
 *     });
 *   }} />
 */
export function useContextMenu() {
  // Keep a global listener alive
  useEffect(() => {
    const cleanup = api.contextMenu.onClick(() => {
      // Clicks are handled per-invocation via callback
    });
    return () => { cleanup(); };
  }, []);

  return useCallback(async (
    items: ContextMenuItem[],
    onAction?: (clickId: string) => void
  ) => {
    if (onAction) {
      const cleanup = api.contextMenu.onClick((clickId: string) => {
        if (clickId) {
          onAction(clickId);
        }
        cleanup();
      });
    }
    await api.contextMenu.show(items);
  }, []);
}
