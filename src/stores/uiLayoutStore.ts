import { create } from 'zustand';

/**
 * UI LAYOUT store (v2.3.4) — the VS Code-style collapse toggles.
 *
 * The Sidebar's 48px rail collapse and the History commit-details pane
 * collapse used to be LOCAL useState + localStorage inside their components.
 * The user asked for both toggles to live in the toolbar header, to the
 * right of the «Customize toolbar» button («Кнопки сворачивания левого
 * сайдбара и правого должны быть в header справа от кнопки Customize
 * toolbar») — a component can't reach another component's useState, so the
 * flags moved here.
 *
 * The SAME localStorage keys are kept, so a user's saved collapse state
 * survives the migration untouched.
 */
interface UiLayoutState {
  /** Left sidebar collapsed to the 48px icon rail. */
  sidebarCollapsed: boolean;
  /** History commit-details (right) pane collapsed to the 24px strip. */
  detailCollapsed: boolean;
  toggleSidebar: () => void;
  toggleDetail: () => void;
}

const SIDEBAR_KEY = 'prismgit-sidebar-collapsed';
const DETAIL_KEY = 'prismgit-history-detail-collapsed';

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
}));
