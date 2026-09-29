import { create } from 'zustand';

/**
 * UI LAYOUT store (v2.3.4) — the VS Code-style collapse toggles.
 *
 * The Sidebar's 48px rail collapse and the History commit-details pane
 * collapse used to be LOCAL useState + localStorage inside their components.
 * The user asked for both toggles to live in the toolbar header, to the
 * right of the «Customize toolbar» button («Кнопки сворачивания левого
 * сайдбара и правой должны быть в header справа от кнопки Customize
 * toolbar») — a component can't reach another component's useState, so the
 * flags moved here.
 *
 * The SAME localStorage keys are kept, so a user's saved collapse state
 * survives the migration untouched.
 *
 * v2.3.8 — the bottom Command Log panel got the same treatment: its
 * showCommandLog used to be an App-level useState, unreachable from the
 * Toolbar. The flag moved here so the header-corner layout-panel toggle
 * (the middle button of the VS Code hero row: sidebar-left / panel /
 * sidebar-right) can drive it. A separate setter (not just a toggle) is
 * needed for the auto-open-on-error path in App.tsx.
 */
interface UiLayoutState {
  /** Left sidebar collapsed to the 48px icon rail. */
  sidebarCollapsed: boolean;
  /** History commit-details (right) pane collapsed to the 24px strip. */
  detailCollapsed: boolean;
  /** Bottom Command Log panel visible (v2.3.8). */
  commandLogOpen: boolean;
  toggleSidebar: () => void;
  toggleDetail: () => void;
  toggleCommandLog: () => void;
  /** Explicit open/close — used by the panel's ✕ close button, the app
   * menu and the error auto-open (these know the target state). */
  setCommandLogOpen: (open: boolean) => void;
}

const SIDEBAR_KEY = 'prismgit-sidebar-collapsed';
const DETAIL_KEY = 'prismgit-history-detail-collapsed';
const COMMAND_LOG_KEY = 'prismgit-command-log-open';

const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

const writeFlag = (key: string, value: boolean) => {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch { /* private mode / test env — persistence is best-effort */ }
};

export const useUiLayoutStore = create<UiLayoutState>((set, get) => ({
  sidebarCollapsed: readFlag(SIDEBAR_KEY),
  detailCollapsed: readFlag(DETAIL_KEY),
  commandLogOpen: readFlag(COMMAND_LOG_KEY),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    writeFlag(SIDEBAR_KEY, next);
    set({ sidebarCollapsed: next });
  },
  toggleDetail: () => {
    const next = !get().detailCollapsed;
    writeFlag(DETAIL_KEY, next);
    set({ detailCollapsed: next });
  },
  toggleCommandLog: () => {
    const next = !get().commandLogOpen;
    writeFlag(COMMAND_LOG_KEY, next);
    set({ commandLogOpen: next });
  },
  setCommandLogOpen: (open) => {
    writeFlag(COMMAND_LOG_KEY, open);
    set({ commandLogOpen: open });
  },
}));
