/**
 * v2.3.4 pins — the user's second UX batch:
 *   1) Settings row spacing widened (panels space-y-8, reorder lists 2.5)
 *   2) InfoHint «!» hitboxes actually SHOW the tooltip content (the stacked
 *      group-hover:group-focus variant made it never appear)
 *   3) Toolbar corner collapse toggles (left sidebar + right detail panel),
 *      placed right after the «Customize toolbar» button, via uiLayoutStore
 *   6) LFS file rows: history/lock buttons always visible (not hover-only)
 *   7) AI tools cover ALL 18 sidebar tools (10 new engines registered)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

// ── 1. Settings spacing ────────────────────────────────────────────────────
describe('v2.3.4 — Settings row spacing', () => {
  const src = read('src/pages/SettingsPage.tsx');

  it('main panels use space-y-8 (32px between setting rows)', () => {
    expect((src.match(/p-5 space-y-8/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('no cramped panel-level lists remain (space-y-1.5 / p-5 space-y-3 gone)', () => {
    expect(src).not.toContain('p-4 space-y-1.5');
    expect(src).not.toContain('p-5 space-y-3');
    expect(src).not.toContain('p-5 space-y-4');
  });

  it('the sidebar-nav/favorites reorder block got the wider 2.5 gap', () => {
    expect(src).toContain('p-4 space-y-2.5');
  });
});

// ── 2. InfoHint — the tooltip content must actually display ────────────────
describe('v2.3.4 — InfoHint «!» hitboxes display their content', () => {
  const src = read('src/components/InfoHint.tsx');

  it('no stacked group-hover:group-focus variant (never matched → tooltip never shown)', () => {
    expect(src).not.toContain('group-hover:group-focus:block');
  });

  it('tooltip shows on hover OR keyboard focus (group-hover:block + group-focus-within:block)', () => {
    expect(src).toContain('group-hover:block');
    expect(src).toContain('group-focus-within:block');
  });

  it('renders the text content (not an empty popover)', () => {
    expect(src).toContain('{text}');
  });
});

// ── 3. Toolbar corner collapse toggles ─────────────────────────────────────
describe('v2.3.4 — Toolbar collapse toggles in the header corner', () => {
  const src = read('src/components/Toolbar.tsx');

  it('both toggles render right AFTER the «Customize toolbar» button', () => {
    const customize = src.indexOf('shell.customizeToolbar');
    const leftToggle = src.indexOf('shell.collapseSidebar');
    const rightToggle = src.indexOf('shell.collapseDetailPanel');
    expect(customize).toBeGreaterThan(-1);
    expect(leftToggle).toBeGreaterThan(customize);
    expect(rightToggle).toBeGreaterThan(leftToggle);
  });

  it('uses the shared uiLayoutStore (works with the sidebar rail + History pane)', () => {
    expect(src).toContain('useUiLayoutStore');
    // v2.3.7: the toggles switched from lucide-style PanelLeft/RightClose
    // (with fold arrows) to the VS Code codicon layout toggles.
    expect(src).toContain('LayoutSidebarLeft');
    expect(src).toContain('LayoutSidebarRight');
  });
});

// ── 3b. uiLayoutStore semantics ────────────────────────────────────────────
import { useUiLayoutStore } from '../../src/stores/uiLayoutStore';

describe('v2.3.4 — uiLayoutStore (shared collapse flags)', () => {
  it('toggles flip the flags and persist to the legacy localStorage keys', () => {
    const st = useUiLayoutStore.getState();
    const beforeSidebar = st.sidebarCollapsed;
    st.toggleSidebar();
    expect(useUiLayoutStore.getState().sidebarCollapsed).toBe(!beforeSidebar);
    st.toggleSidebar(); // restore
    expect(useUiLayoutStore.getState().sidebarCollapsed).toBe(beforeSidebar);
    const beforeDetail = st.detailCollapsed;
    st.toggleDetail();
    expect(useUiLayoutStore.getState().detailCollapsed).toBe(!beforeDetail);
    st.toggleDetail(); // restore
    expect(useUiLayoutStore.getState().detailCollapsed).toBe(beforeDetail);
  });
});

// ── 6. LFS buttons always visible ──────────────────────────────────────────
describe('v2.3.4 — LFS file-row buttons are always visible', () => {
  const src = read('src/pages/LfsPage.tsx');

  it('no hover-only action buttons left on LFS file rows', () => {
    expect(src).not.toContain('opacity-0');
  });
});

// ── 7. AI covers every sidebar tool ────────────────────────────────────────
import { AI_TOOLS, getTool } from '../../src/lib/aiTools';

describe('v2.3.4 — AI tools cover ALL 18 sidebar tools', () => {
  const NEW_TOOLS = [
    'get_reflog',        // Reflog
    'list_submodules',   // Submodules (read)
    'submodule_update',  // Submodules (action)
    'lfs_overview',      // LFS (read)
    'lfs_sync',          // LFS (action)
    'bisect',            // Bisect (whole state machine)
    'gitflow_overview',  // GitFlow
    'recyclable_commits',// Recyclable
    'list_reviews',      // Reviews
    'list_pull_requests',// Pull Requests
  ];

  it('all 10 new tools are registered', () => {
    for (const name of NEW_TOOLS) {
      expect(getTool(name), `tool ${name} must be registered`).toBeDefined();
    }
  });

  it('bisect exposes the full action set incl. reset', () => {
    const bisect = getTool('bisect')!;
    const props = (bisect.parameters as { properties?: Record<string, { enum?: string[] }> }).properties ?? {};
    expect(props.action?.enum).toEqual(
      expect.arrayContaining(['status', 'start', 'good', 'bad', 'skip', 'reset', 'log'])
    );
  });

  it('total registry grew to 41 tools (31 + 10)', () => {
    expect(AI_TOOLS.length).toBe(41);
    // no duplicate registrations
    const names = AI_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('the system prompt teaches the model WHEN to use the new tools (rules 24-27)', () => {
    const src = read('src/lib/aiChat.ts');
    for (const name of NEW_TOOLS) {
      expect(src).toContain(name);
    }
  });
});
