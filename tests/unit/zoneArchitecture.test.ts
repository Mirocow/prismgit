/**
 * Unit: the v2.3 zone architecture.
 *
 * User report (pixel-diff of 2 extreme themes across 8 themes):
 *   «зоны не соответствуют, настраиваешь одно, а цвета меняются в других
 *    окнах/областях».
 *
 * Root cause: the elevation palette (--bg-secondary/tertiary) was shared
 * by unrelated regions (sidebar+panels; toolbar+panel headers+statusbar),
 * so ONE variable painted MANY zones. The fix:
 *   1. globals.css defines 8 zone tokens (--zone-*), each = exactly one
 *      UI region, defaulting to the legacy palette (all 28 themes inherit).
 *   2. Consumers (panel/statusbar/titlebar/sidebar/popovers) read the zone
 *      tokens.
 *   3. App.tsx injects user overrides with selectors that beat every
 *      theme block.
 *
 * These tests pin all three layers so a refactor cannot silently re-merge
 * the zones.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildThemeOverrideCss } from '../../src/lib/themeOverrideCss';

const CSS = fs.readFileSync(
  path.join(__dirname, '../../src/styles/globals.css'),
  'utf8',
);

const ZONE_TOKENS = [
  '--zone-sidebar-bg',
  '--zone-titlebar-bg',
  '--zone-gitbar-bg',
  '--zone-main-bg',
  '--zone-statusbar-bg',
  '--zone-panel-bg',
  '--zone-panel-header-bg',
  '--zone-popover-bg',
];

describe('zone architecture — globals.css', () => {
  it('defines all 8 zone tokens in :root (one zone = one token)', () => {
    // Slice out the :root block (before .dark) and assert each token.
    const rootBlock = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('/* Ollama-code Dark'));
    for (const token of ZONE_TOKENS) {
      expect(rootBlock, `:root must define ${token}`).toContain(`${token}:`);
    }
  });

  it('zone tokens DEFAULT to the legacy palette so every theme keeps working', () => {
    const rootBlock = CSS.slice(CSS.indexOf('--zone-sidebar-bg:'), CSS.indexOf('--zone-popover-bg:') + 60);
    expect(rootBlock).toContain('--zone-sidebar-bg: var(--bg-secondary)');
    expect(rootBlock).toContain('--zone-titlebar-bg: var(--bg-tertiary)');
    expect(rootBlock).toContain('--zone-main-bg: var(--bg-primary)');
    expect(rootBlock).toContain('--zone-popover-bg: var(--bg-elevated)');
  });

  it('the app canvas (html/body/#root) reads the MAIN zone token', () => {
    expect(CSS).toMatch(/html,\s*body,\s*#root\s*{[^}]*background-color:\s*var\(--zone-main-bg\)/s);
  });

  it('.panel reads the PANEL zone token (no longer shares the sidebar palette)', () => {
    expect(CSS).toMatch(/\.panel\s*{[^}]*background-color:\s*var\(--zone-panel-bg\)/s);
  });

  it('.panel-header reads the PANEL-HEADER zone token (no longer shares the toolbar palette)', () => {
    expect(CSS).toMatch(/\.panel-header\s*{[^}]*background-color:\s*var\(--zone-panel-header-bg\)/s);
  });

  it('dim-sidebar theme defines --zone-sidebar-bg on <aside> (scoped dark sidebar)', () => {
    // Upstream v2.3.10 curated the registry to 6 themes — light-dim-sidebar
    // is the one dim-sidebar theme left (github-light-dim was removed).
    const dimBlocks = CSS.match(/\[data-theme='light-dim-sidebar'\]\s*aside[^{]*{[^}]*}/g) ?? [];
    expect(dimBlocks.length).toBeGreaterThanOrEqual(1);
    for (const block of dimBlocks) {
      expect(block).toContain('--zone-sidebar-bg:');
    }
  });

  it('Tailwind @theme maps zone color utilities (bg-zone-*)', () => {
    const themeBlock = CSS.slice(CSS.indexOf('@theme'), CSS.indexOf('border-'));
    expect(themeBlock).toContain('--color-zone-sidebar: var(--zone-sidebar-bg)');
    expect(themeBlock).toContain('--color-zone-titlebar: var(--zone-titlebar-bg)');
    expect(themeBlock).toContain('--color-zone-statusbar: var(--zone-statusbar-bg)');
    expect(themeBlock).toContain('--color-zone-popover: var(--zone-popover-bg)');
  });
});

describe('zone architecture — consumers', () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8');

  it('Sidebar paints with the zone utility, not the shared palette', () => {
    const sidebar = read('components/Sidebar.tsx');
    expect(sidebar).toContain('bg-zone-sidebar');
    expect(sidebar).not.toMatch(/className="sidebar-root[^"]*bg-bg-secondary/);
  });

  it('Toolbar titlebar + GitToolbar use their own zone tokens', () => {
    const toolbar = read('components/Toolbar.tsx');
    expect(toolbar).toContain('bg-zone-titlebar');
    expect(toolbar).toContain('bg-zone-gitbar');
  });

  it('StatusBar footers use the statusbar zone token', () => {
    const statusbar = read('components/StatusBar.tsx');
    expect(statusbar).toContain('bg-zone-statusbar');
  });

  it('popovers/dropdowns/floating panels use the popover zone token', () => {
    const popoverSites = [
      'components/Toolbar.tsx',
      'components/AiAssistant.tsx',
      'components/CommitTypeDropdown.tsx',
      'components/MergePanel.tsx',
      'pages/ChangesPage.tsx',
    ];
    for (const rel of popoverSites) {
      expect(read(rel), `${rel} must use bg-zone-popover`).toContain('bg-zone-popover');
    }
    // And NOBODY still hardcodes the shared palette for a floating surface.
    for (const rel of popoverSites) {
      expect(read(rel), `${rel} must not use bg-bg-elevated anymore`).not.toContain('bg-bg-elevated');
    }
  });
});

describe('buildThemeOverrideCss — injection strategy', () => {
  it('returns empty string for empty/absent overrides (style tag removed)', () => {
    expect(buildThemeOverrideCss(undefined)).toBe('');
    expect(buildThemeOverrideCss(null)).toBe('');
    expect(buildThemeOverrideCss({})).toBe('');
  });

  it('emits a root rule that beats [data-theme] blocks (html[data-theme] = 0,1,1)', () => {
    const css = buildThemeOverrideCss({ '--zone-main-bg': '#123456' });
    expect(css).toContain(':root, html[data-theme] {');
    expect(css).toContain('--zone-main-bg: #123456;');
  });

  it('routes --zone-sidebar-bg through an element-scoped rule that beats dim-sidebar <aside>', () => {
    const css = buildThemeOverrideCss({ '--zone-sidebar-bg': '#abcdef' });
    // Root rule AND the sidebar-scoped rule both present.
    expect(css).toContain('html .sidebar-root {');
    expect(css.match(/--zone-sidebar-bg: #abcdef;/g)).toHaveLength(2);
  });

  it('does NOT emit element rules when only non-sidebar tokens are set', () => {
    const css = buildThemeOverrideCss({ '--zone-titlebar-bg': '#000000' });
    expect(css).not.toContain('html .sidebar-root');
  });

  it('emits every raw JSON key verbatim (power users keep diff/status colors)', () => {
    const css = buildThemeOverrideCss({ '--diff-added-bg': 'rgba(1,2,3,.2)', '--accent': '#ff6b35' });
    expect(css).toContain('--diff-added-bg: rgba(1,2,3,.2);');
    expect(css).toContain('--accent: #ff6b35;');
  });
});
