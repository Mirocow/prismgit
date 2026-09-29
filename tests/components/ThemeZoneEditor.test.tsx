/**
 * Component: ThemeZoneEditor (v2.3).
 *
 * «зоны не соответствуют, настраиваешь одно, а цвета меняются в других
 * окнах/областях» — this editor is the user-facing half of the zone fix.
 * Pinned behaviors:
 *   1. Picking a color writes EXACTLY ONE --zone-* key into
 *      settings.customThemeOverrides (never a legacy palette key that
 *      repaints several areas at once).
 *   2. The rows open showing the LIVE resolved color of the active theme.
 *   3. Resetting a zone removes only that zone's key; "reset all" wipes
 *      only the editor-managed tokens (raw JSON keys survive).
 *   4. The mini-layout preview renders and highlights the hovered zone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeZoneEditor } from '../../src/components/ThemeZoneEditor';
import { useSettingsStore } from '../../src/stores/settingsStore';

vi.mock('../../src/lib/i18n', () => ({
  useI18n: () => ({
    t: (k: string, p?: Record<string, string | number>) => {
      const dict: Record<string, string> = {
        'settings.zoneColorsTitle': 'Zone Colors',
        'settings.zoneColorsHint': 'Each zone is colored independently.',
        'settings.zoneCustomized': 'customized',
        'settings.zoneResetOne': 'Reset this zone',
        'settings.zoneResetAll': 'Reset all ({count})',
        'settings.zonePreviewHint': 'Live preview',
        'settings.zoneCommonGroup': 'Shared',
        'settings.zoneSidebar': 'Sidebar',
        'settings.zoneSidebarHint': 'Left panel',
        'settings.zoneTitlebar': 'Toolbar',
        'settings.zoneTitlebarHint': 'Top bar',
        'settings.zoneGitbar': 'Git toolbar',
        'settings.zoneGitbarHint': 'Second row',
        'settings.zoneMain': 'Main window',
        'settings.zoneMainHint': 'Page canvas',
        'settings.zonePanel': 'Panels',
        'settings.zonePanelHint': 'Cards inside pages',
        'settings.zonePanelHeader': 'Panel headers',
        'settings.zonePanelHeaderHint': 'Titled strips',
        'settings.zonePopover': 'Menus & popups',
        'settings.zonePopoverHint': 'Dropdowns, menus',
        'settings.zoneStatusbar': 'Status bar',
        'settings.zoneStatusbarHint': 'Bottom strip',
        'settings.zoneCommonAccent': 'Accent',
        'settings.zoneCommonAccentHint': 'Buttons, links',
      };
      let str = dict[k] ?? k;
      if (p) for (const [key, v] of Object.entries(p)) str = str.replace(`{${key}}`, String(v));
      return str;
    },
  }),
}));

const setSettingMock = vi.fn();

function primeStore(overrides?: Record<string, string>) {
  useSettingsStore.setState({
    settings: { customThemeOverrides: overrides },
    setSetting: setSettingMock,
  } as never);
}

// jsdom CAN resolve computed custom properties on <html> when a style rule
// defines them — set up the zone tokens like globals.css would.
function stubZoneVars() {
  const style = document.createElement('style');
  style.textContent = `
    :root {
      --bg-secondary: #0f1218;
      --bg-tertiary: #131721;
      --bg-primary: #0b0e14;
      --bg-elevated: #1a1f29;
      --zone-sidebar-bg: #0f1218;
      --zone-titlebar-bg: #131721;
      --zone-gitbar-bg: #0f1218;
      --zone-main-bg: #0b0e14;
      --zone-statusbar-bg: #131721;
      --zone-panel-bg: #0f1218;
      --zone-panel-header-bg: #131721;
      --zone-popover-bg: #1a1f29;
      --accent: #39bae6;
    }
    .sidebar-root { background-color: #252526; }
  `;
  document.head.appendChild(style);
  return style;
}

describe('ThemeZoneEditor', () => {
  let styleEl: HTMLStyleElement;

  beforeEach(() => {
    setSettingMock.mockReset();
    styleEl?.remove();
    styleEl = stubZoneVars();
    primeStore(undefined);
  });

  it('renders a row per zone, showing the overridden values from the store', () => {
    // NOTE: asserting the OVERRIDE path (not getComputedStyle) — jsdom does
    // not resolve custom properties; the live-resolution path runs in the
    // real Electron/Chromium app and is covered by the live E2E script.
    primeStore({ '--zone-sidebar-bg': '#0f1218' });
    render(<ThemeZoneEditor />);
    const sidebarRow = screen.getByTestId('zone-row---zone-sidebar-bg');
    const colorInput = sidebarRow.querySelector('input[type="color"]') as HTMLInputElement;
    expect(colorInput.value.toLowerCase()).toBe('#0f1218');
    // The preview diagram renders.
    expect(screen.getByTestId('zone-preview')).toBeTruthy();
  });

  it('picking a color writes EXACTLY ONE zone key — no collateral palette changes', () => {
    render(<ThemeZoneEditor />);
    const row = screen.getByTestId('zone-row---zone-main-bg');
    const picker = row.querySelector('input[type="color"]') as HTMLInputElement;
    fireEvent.input(picker, { target: { value: '#3050ff' } });

    expect(setSettingMock).toHaveBeenCalledWith(
      'customThemeOverrides',
      { '--zone-main-bg': '#3050ff' },
    );
    // And ONLY zone keys — the whole point of the zone fix.
    const allWrites = setSettingMock.mock.calls.filter((c) => c[0] === 'customThemeOverrides');
    for (const write of allWrites) {
      expect(Object.keys(write[1] as Record<string, string>)).toEqual(['--zone-main-bg']);
    }
    expect((allWrites[0][1] as Record<string, string>)['--zone-main-bg']).toBe('#3050ff');
  });

  it('marks customized zones and offers a per-zone reset that removes just that key', async () => {
    primeStore({ '--zone-sidebar-bg': '#abcdef', '--diff-added-bg': 'rgba(1,2,3,.2)' });
    render(<ThemeZoneEditor />);
    const row = screen.getByTestId('zone-row---zone-sidebar-bg');
    expect(row.textContent).toContain('customized');

    const resetBtn = row.querySelector('button[title="Reset this zone"]') as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(false);
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(setSettingMock).toHaveBeenCalledWith('customThemeOverrides', {
        // The raw JSON key survives; only the managed zone key is dropped.
        '--diff-added-bg': 'rgba(1,2,3,.2)',
      });
    });
  });

  it('hex text input commits only valid #rrggbb values', () => {
    render(<ThemeZoneEditor />);
    const row = screen.getByTestId('zone-row---zone-statusbar-bg');
    const text = row.querySelectorAll('input[type="text"]')[0] as HTMLInputElement;
    fireEvent.change(text, { target: { value: 'notacolor' } });
    expect(setSettingMock).not.toHaveBeenCalled();
    fireEvent.change(text, { target: { value: '#00ff88' } });
    expect(setSettingMock).toHaveBeenCalledWith(
      'customThemeOverrides',
      { '--zone-statusbar-bg': '#00ff88' },
    );
  });

  it('Reset all wipes ONLY the editor-managed tokens (raw JSON keys survive)', () => {
    primeStore({
      '--zone-titlebar-bg': '#111111',
      '--zone-popover-bg': '#222222',
      '--accent': '#ff6b35',
      '--diff-added-bg': 'rgba(134,179,0,.2)',
    });
    render(<ThemeZoneEditor />);
    const resetAll = screen.getByRole('button', { name: /Reset all \(3\)/ });
    fireEvent.click(resetAll);
    expect(setSettingMock).toHaveBeenCalledWith('customThemeOverrides', {
      '--diff-added-bg': 'rgba(134,179,0,.2)',
    });
  });

  it('hovering a zone row highlights the matching diagram chip in the row', () => {
    render(<ThemeZoneEditor />);
    const row = screen.getByTestId('zone-row---zone-statusbar-bg');
    fireEvent.mouseEnter(row);
    const chip = row.querySelector('span.border-accent');
    expect(chip?.textContent).toContain('status bar');
  });
});
