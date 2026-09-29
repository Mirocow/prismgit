/**
 * v2.3.7 pins — the user showed the VS Code reference
 * (code.visualstudio.com/assets/docs/editing/userinterface/hero.png):
 * «вот посмотри как должны выглядеть кнопки сворачивания сайдбаров справа
 * на картике». Forensic pixel analysis of the hero proved its top-right row
 * is the VS Code title-bar LAYOUT TOGGLES: codicon-style rounded boxes
 * (layout-sidebar-left / layout-panel / layout-sidebar-right-off / layout)
 * whose panel strip is FILLED while the panel is open and a hollow
 * divider-only variant while it is collapsed — followed by the window
 * controls. The old PrismGit toggles (lucide-style panels with fold
 * arrows) did not match; these pins lock the new codicon look.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

// Exact path data of microsoft/vscode-codicons (16×16, fill-based).
const PATHS: Record<string, string> = {
  'layout-sidebar-left': 'M12.5 1C13.881 1 15 2.119 15 3.5V12.5C15 13.881 13.881 15 12.5 15H3.5C2.119 15 1 13.881 1 12.5V3.5C1 2.119 2.119 1 3.5 1H12.5ZM12.5 14C13.328 14 14 13.328 14 12.5V3.5C14 2.672 13.328 2 12.5 2H7V14H12.5Z',
  'layout-sidebar-left-off': 'M1 3.5V12.5C1 13.879 2.122 15 3.5 15H12.5C13.878 15 15 13.879 15 12.5V3.5C15 2.122 13.878 1 12.5 1H3.5C2.122 1 1 2.122 1 3.5ZM12.5 14H7V2H12.5C13.327 2 14 2.673 14 3.5V12.5C14 13.327 13.327 14 12.5 14ZM2 3.5C2 2.673 2.673 2 3.5 2H6V14H3.5C2.673 14 2 13.327 2 12.5V3.5Z',
  'layout-sidebar-right': 'M12.5 1C13.881 1 15 2.119 15 3.5V12.5C15 13.881 13.881 15 12.5 15H3.5C2.119 15 1 13.881 1 12.5V3.5C1 2.119 2.119 1 3.5 1H12.5ZM9 14V2H3.5C2.672 2 2 2.672 2 3.5V12.5C2 13.328 2.672 14 3.5 14H9Z',
  'layout-sidebar-right-off': 'M12.5 1H3.5C2.122 1 1 2.122 1 3.5V12.5C1 13.879 2.122 15 3.5 15H12.5C13.878 15 15 13.879 15 12.5V3.5C15 2.122 13.878 1 12.5 1ZM2 12.5V3.5C2 2.673 2.673 2 3.5 2H9V14H3.5C2.673 14 2 13.327 2 12.5ZM14 12.5C14 13.327 13.327 14 12.5 14H10V2H12.5C13.327 2 14 2.673 14 3.5V12.5Z',
};

describe('v2.3.7 — sidebar collapse toggles look like the VS Code hero', () => {
  const icons = read('src/components/icons.tsx');
  const toolbar = read('src/components/Toolbar.tsx');

  it('all four codicon layout icons exist with the EXACT upstream path data', () => {
    const exportNames = ['LayoutSidebarLeft', 'LayoutSidebarLeftOff', 'LayoutSidebarRight', 'LayoutSidebarRightOff'];
    for (const [name, d] of Object.entries(PATHS)) {
      expect(icons).toContain(d);
    }
    for (const n of exportNames) {
      expect(icons).toContain(`export const ${n}`);
    }
  });

  it('the icons are fill-based 16×16 codicons, not the 24×24 stroke set', () => {
    expect(icons).toContain('viewBox="0 0 16 16"');
    expect(icons).toContain('fill="currentColor"');
    expect(icons).toContain('function FillIcon');
  });

  it('VS Code state semantics: open panel → FILLED strip, collapsed → hollow off-variant', () => {
    expect(toolbar).toContain('icon={sidebarCollapsed ? LayoutSidebarLeftOff : LayoutSidebarLeft}');
    expect(toolbar).toContain('icon={detailCollapsed ? LayoutSidebarRightOff : LayoutSidebarRight}');
  });

  it('toggles render at the VS Code codicon size (16px), still right of «Customize toolbar»', () => {
    expect(toolbar).toContain('iconSize={16}');
    const customize = toolbar.indexOf('shell.customizeToolbar');
    const left = toolbar.indexOf('LayoutSidebarLeftOff : LayoutSidebarLeft');
    const right = toolbar.indexOf('LayoutSidebarRightOff : LayoutSidebarRight');
    expect(customize).toBeGreaterThan(-1);
    expect(left).toBeGreaterThan(customize);
    expect(right).toBeGreaterThan(left);
  });

  it('the old arrow-fold panel icons are gone from the header toggles', () => {
    // PanelLeft*/PanelRight* stay available for the in-panel chevrons
    // (Sidebar rail, HistoryPage) — but the header must not use them.
    expect(toolbar).not.toContain('icon={sidebarCollapsed ? PanelLeft');
    expect(toolbar).not.toContain('icon={detailCollapsed ? PanelRight');
  });
});
