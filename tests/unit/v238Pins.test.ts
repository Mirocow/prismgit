/**
 * v2.3.8 pins — the user asked for the third button of the VS Code hero row:
 * «кнопку для нижнего сайдбар?» — the layout-panel toggle for the BOTTOM
 * Command Log panel. v2.3.7 wired only layout-sidebar-left / -right; the
 * hero's middle icon (layout-panel) is now live too, BETWEEN the two
 * sidebar toggles, with the same codicon state semantics (panel open →
 * bottom strip filled, hidden → hollow divider-only variant).
 *
 * The panel's visibility used to be an App-level useState — unreachable
 * from the Toolbar — so it moved into uiLayoutStore (the same migration
 * v2.3.4 did for the sidebar rail + History detail pane). All existing
 * entry points (Terminal button, native menu Ctrl+Shift+U, StatusBar chip,
 * panel ✕, error auto-open) now drive the store flag.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

// v2.3.10 — the ff9e761 refactor reformatted Toolbar.tsx/shell.ts (double
// quotes + multi-line JSX). Normalize before structural matching.
const flat = (s: string) => s.replace(/\s+/g, '').replace(/"/g, "'");

// Exact path data of microsoft/vscode-codicons (16×16, fill-based).
const PATHS: Record<string, string> = {
  'layout-panel': 'M15 12.5C15 13.881 13.881 15 12.5 15H3.5C2.119 15 1 13.881 1 12.5V3.5C1 2.119 2.119 1 3.5 1H12.5C13.881 1 15 2.119 15 3.5V12.5ZM2 10H14V3.5C14 2.672 13.328 2 12.5 2H3.5C2.672 2 2 2.672 2 3.5V10Z',
  'layout-panel-off': 'M12.5 1H3.5C2.122 1 1 2.121 1 3.5V12.5C1 13.879 2.122 15 3.5 15H12.5C13.878 15 15 13.879 15 12.5V3.5C15 2.121 13.878 1 12.5 1ZM14 12.5C14 13.327 13.327 14 12.5 14H3.5C2.673 14 2 13.327 2 12.5V11H14V12.5ZM14 10H2V3.5C2 2.673 2.673 2 3.5 2H12.5C13.327 2 14 2.673 14 3.5V10Z',
};

describe('v2.3.8 — the bottom-panel (Command Log) layout toggle', () => {
  const icons = read('src/components/icons.tsx');
  const toolbar = read('src/components/Toolbar.tsx');
  const app = read('src/App.tsx');

  it('both codicons exist with the EXACT upstream path data', () => {
    for (const [name, d] of Object.entries(PATHS)) {
      expect(icons).toContain(d);
    }
    expect(icons).toContain('export const LayoutPanel');
    expect(icons).toContain('export const LayoutPanelOff');
  });

  it('the panel toggle renders BETWEEN the sidebar toggles (hero order: left / panel / right)', () => {
    const tb = flat(toolbar);
    const customize = tb.indexOf('shell.customizeToolbar');
    const left = tb.indexOf('LayoutSidebarLeftOff:LayoutSidebarLeft');
    const panel = tb.indexOf('commandLogOpen?LayoutPanel:LayoutPanelOff');
    const right = tb.indexOf('LayoutSidebarRightOff:LayoutSidebarRight');
    expect(customize).toBeGreaterThan(-1);
    expect(left).toBeGreaterThan(customize);
    expect(panel).toBeGreaterThan(left);
    expect(right).toBeGreaterThan(panel);
  });

  it('VS Code state semantics: panel open → FILLED bottom strip, hidden → hollow off-variant', () => {
    const tb = flat(toolbar);
    expect(tb).toContain('icon={commandLogOpen?LayoutPanel:LayoutPanelOff}');
    expect(toolbar).toContain('iconSize={16}');
  });

  it('App no longer owns the panel visibility — uiLayoutStore drives it', () => {
    expect(app).not.toContain('const [showCommandLog, setShowCommandLog] = useState');
    expect(app).toContain("useUiLayoutStore((s) => s.commandLogOpen)");
    // Every legacy entry point still routes somewhere real:
    // - error auto-open keeps opening the panel
    expect(app).toContain('setCommandLogOpen(true)');
    // - the panel's ✕ close button still closes it
    expect(app).toContain('setCommandLogOpen(false)');
  });

  it('i18n: the two titles exist in all four locales', () => {
    const i18n = read('src/i18n/locales/domains/shell.ts');
    for (const key of ['shell.showCommandLog', 'shell.hideCommandLog']) {
      // v2.3.10: shell.ts was reformatted to double quotes — match either.
      expect((i18n.match(new RegExp(`['"]${key}['"]:`, 'g')) ?? []).length).toBe(4);
    }
  });
});

// ── store behavior ───────────────────────────────────────────────────────
import { useUiLayoutStore } from '../../src/stores/uiLayoutStore';

describe('v2.3.8 — uiLayoutStore commandLogOpen semantics', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiLayoutStore.setState({ commandLogOpen: false });
  });

  it('toggleCommandLog flips the flag and persists to localStorage', () => {
    useUiLayoutStore.getState().toggleCommandLog();
    expect(useUiLayoutStore.getState().commandLogOpen).toBe(true);
    expect(localStorage.getItem('prismgit-command-log-open')).toBe('1');
    useUiLayoutStore.getState().toggleCommandLog();
    expect(useUiLayoutStore.getState().commandLogOpen).toBe(false);
    expect(localStorage.getItem('prismgit-command-log-open')).toBe('0');
  });

  it('setCommandLogOpen sets an explicit state (auto-open / ✕ close paths)', () => {
    useUiLayoutStore.getState().setCommandLogOpen(true);
    expect(useUiLayoutStore.getState().commandLogOpen).toBe(true);
    useUiLayoutStore.getState().setCommandLogOpen(false);
    expect(useUiLayoutStore.getState().commandLogOpen).toBe(false);
    expect(localStorage.getItem('prismgit-command-log-open')).toBe('0');
  });

  it('the command-log flag is independent of the sidebar/detail flags', () => {
    const before = useUiLayoutStore.getState().commandLogOpen;
    useUiLayoutStore.getState().toggleSidebar();
    useUiLayoutStore.getState().toggleDetail();
    expect(useUiLayoutStore.getState().commandLogOpen).toBe(before);
    // restore the flags we disturbed
    useUiLayoutStore.getState().toggleSidebar();
    useUiLayoutStore.getState().toggleDetail();
  });
});
