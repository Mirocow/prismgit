import { useRef, useCallback } from 'react';
import { api } from './api';

export interface ContextMenuItem {
  label?: string;
  type?: 'separator' | 'normal' | 'checkbox' | 'radio';
  checked?: boolean;
  enabled?: boolean;
  accelerator?: string;
  clickId?: string;
  /** Tooltip shown on hover (Electron only). */
  title?: string;
  /** Nested submenu (SmartGit-style Resolve → Take Ours / Take Theirs / ...). */
  submenu?: ContextMenuItem[];
}

// Global singleton: only ONE listener for 'context-menu:click' across the
// entire app. Previous implementation registered a new listener on every
// showContextMenu() call, causing MaxListenersExceededWarning after 10+ menus.
let globalClickHandler: ((clickId: string) => void) | null = null;
let globalCleanup: (() => void) | null = null;

function ensureGlobalListener() {
  if (globalCleanup) return; // already installed
  globalCleanup = api.contextMenu.onClick((clickId: string) => {
    if (globalClickHandler) {
      globalClickHandler(clickId);
      globalClickHandler = null; // one-shot: consume and clear
    }
  });
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
  // Ensure the global listener is installed once
  ensureGlobalListener();

  return useCallback(async (
    items: ContextMenuItem[],
    onAction?: (clickId: string) => void
  ) => {
    if (onAction) {
      // Set the one-shot handler — will be called when the menu item is clicked
      // and automatically cleared after invocation
      globalClickHandler = (clickId: string) => {
        if (clickId) {
          onAction(clickId);
        }
      };
    }
    await api.contextMenu.show(items);
  }, []);
}
