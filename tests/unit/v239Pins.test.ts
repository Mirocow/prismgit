import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { customThemeCss } from '../../src/lib/customThemeCss';
import type { CustomThemeEntry } from '../../src/lib/themes';

/**
 * v2.3.10 — «темы: ад в настройках» pins.
 *
 * The theme system drifted in three directions that made settings lie to
 * the user:
 *   1. The light-dim-sidebar DARK SIDEBAR block was lost in the Tailwind v4
 *      migration — the orphaned selector glued itself to [data-theme='simple-light'],
 *      so the "VS Code dark sidebar" theme rendered a WHITE sidebar and
 *      simple-light tokens leaked into it.
 *   2. Built-in themes defined partial token sets — hover/active/focus and
 *      status synonyms fell through to the Ayu base (a Material indigo
 *      button hovers to AYU BLUE; Discord shows Ayu cyan info / gold
 *      warnings; syntax .text-function/.tok-function referenced the
 *      NON-EXISTENT --accent-blue and rendered uncolored).
 *   3. Whole UI regions never read theme tokens at all: status badges
 *      (hardcoded Ayu rgba), conflict washes (fixed VS Code palette),
 *      .btn-primary's blue box-shadow halo, ghost rows, text-white on
 *      accent chips.
 *
 * These pins keep every regression from coming back.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(ROOT, 'src/styles/globals.css'), 'utf8');

/** Extract a single CSS rule body by selector. */
function rule(selector: string): string {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = re.exec(css);
  return m ? m[1] : '';
}

/** Extract every custom-property token name defined in a rule body. */
function tokens(body: string): Set<string> {
  const out = new Set<string>();
  for (const line of body.split('\n')) {
    const t = line.match(/^\s*(--[\w-]+)\s*:/);
    if (t) out.add(t[1]);
  }
  return out;
}

// ── 1. The restored dark sidebar ───────────────────────────────────────────

describe('v2.3.10: light-dim-sidebar dark sidebar restored', () => {
  it('the aside override block exists and is DARK (VS Code palette)', () => {
    const body = rule("[data-theme='light-dim-sidebar'] aside");
    expect(body, 'aside block missing').not.toBe('');
    expect(body).toContain('--bg-primary: #1e1e1e');
    expect(body).toContain('--text-primary: #cccccc');
    // v2.3 zones: the aside paints via the ZONE token (defined in the same
    // block) instead of a hardcoded literal — same dark VS Code sidebar,
    // but a --zone-sidebar-bg override can now recolor it per-zone.
    expect(body).toContain('--zone-sidebar-bg: #1e1e1e');
    expect(body).toContain('background-color: var(--zone-sidebar-bg)');
  });

  it('no orphaned selector glued to another block (the migration bug)', () => {
    // The broken shape was: `[data-theme='light-dim-sidebar'] aside,` followed
    // by a comment and a different block's selector — a comma-leftover that
    // merges two unrelated rules.
    expect(css).not.toMatch(/\[data-theme='light-dim-sidebar'\]\s*aside\s*,\s*\n\s*\/\*/);
    expect(css).not.toMatch(/aside\s*,\s*\n\s*\/\*[^*]*\*\/\s*\n\s*\[data-theme='simple-light'\]/);
  });

  it('the aside block is self-contained (ends with its own declarations)', () => {
    const body = rule("[data-theme='light-dim-sidebar'] aside");
    // The last declaration must be a real one — not a dangling open selector.
    expect(body.trim().endsWith('color: #cccccc;')).toBe(true);
  });
});

// ── 2. Theme-blind regions now read tokens ─────────────────────────────────

describe('v2.3.10: previously theme-blind regions follow the theme', () => {
  it('status badges derive their tint from var(--status-*) via color-mix', () => {
    for (const cls of ['added', 'modified', 'deleted', 'renamed', 'untracked', 'conflict']) {
      const body = rule(`.badge-${cls}`);
      expect(body, `.badge-${cls} rule missing`).not.toBe('');
      expect(body).toContain(`color-mix(in srgb, var(--status-${cls})`);
      expect(body).not.toMatch(/rgba\(\d+, \d+, \d+/);
    }
  });

  it('conflict washes derive from status tokens (ours=added, theirs=info, marker=conflict)', () => {
    expect(rule('.conflict-bg-ours')).toContain('var(--status-added)');
    expect(rule('.conflict-bg-theirs')).toContain('var(--status-info)');
    expect(rule('.conflict-bg-marker')).toContain('var(--status-conflict)');
    expect(rule('.conflict-bg-conflict')).toContain('var(--status-conflict)');
  });

  it('ghost rows derive from --text-secondary (no fixed grey rgba)', () => {
    for (const cls of ['.bg-ghost-row', '.bg-bg-ghost-row']) {
      const body = rule(cls);
      expect(body).toContain('var(--text-secondary)');
      expect(body).not.toMatch(/rgba\(128, 128, 128/);
    }
  });

  it('.btn-primary shadow follows the accent (no hardcoded blue halo)', () => {
    expect(rule('.btn-primary')).toContain('color-mix(in srgb, var(--accent) 25%');
    expect(css).not.toContain('rgba(57, 158, 230, 0.2)');
  });

  it('.btn-danger hover derives from --status-deleted', () => {
    expect(rule('.btn-danger:hover')).toContain('var(--status-deleted)');
    // the old fixed hover color must not appear in any rule body
    for (const m of css.matchAll(/[^/]+\{([^}]*)\}/g)) {
      expect(m[1]).not.toContain('#ff7a85');
    }
  });

  it('no reference to the non-existent --accent-blue token remains', () => {
    expect(css).not.toContain('var(--accent-blue)');
    expect(rule('.text-function')).toContain('var(--accent-light-blue, var(--accent))');
    expect(rule('.tok-function')).toContain('var(--accent-light-blue, var(--accent))');
  });
});

// ── 3. Complete token sets per built-in theme ───────────────────────────────

const CANONICAL = [
  '--bg-primary','--bg-secondary','--bg-tertiary','--bg-elevated','--bg-hover','--bg-active','--bg-selected','--bg-sidebar-selected',
  '--border-default','--border-subtle','--border-strong','--border-focused',
  '--text-primary','--text-secondary','--text-tertiary','--text-inverse','--text-link',
  '--accent','--accent-hover','--accent-active','--accent-muted','--accent-light-blue','--accent-purple','--accent-cyan','--accent-green','--accent-yellow','--accent-red',
  '--status-added','--status-modified','--status-deleted','--status-renamed','--status-untracked','--status-conflict','--status-success','--status-warning','--status-error','--status-info',
  '--diff-added-bg','--diff-removed-bg','--diff-added-line','--diff-removed-line','--diff-added-word','--diff-removed-word',
  '--tag-bg','--tag-border','--tag-text',
  '--warning-bg','--warning-icon','--warning-border',
  '--comment','--graph-line','--graph-node-fill','--graph-node-border','--graph-node-selected',
  '--scrollbar-thumb','--scrollbar-thumb-hover','--splitter-color-hover',
];

function extractBlocks(source: string): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  const re = /((?:\.dark)|(?:\[data-theme=["'][^"']+["']\])|(?::root))\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const sel = m[1];
    const name = sel === ':root' ? 'root' : sel.startsWith('[data-theme=') ? sel.slice(13, -2) : sel.replace('.', '');
    const toks = out[name] ?? new Set<string>();
    for (const t of tokens(m[2])) toks.add(t);
    out[name] = toks;
  }
  return out;
}

describe('v2.3.10: every built-in theme defines the canonical token set', () => {
  const blocks = extractBlocks(css);

  it('the CSS blocks are parsed (root + dark + 5 data-themes)', () => {
    for (const id of ['root', 'dark', 'one-dark', 'discord', 'simple-light', 'material', 'light-dim-sidebar']) {
      expect(blocks[id], `block ${id} not found`).toBeDefined();
    }
  });

  // root='light' base + the [data-theme] blocks. .dark is merged into root
  // resolution at runtime — but every data-theme block must stand alone.
  for (const id of ['one-dark', 'discord', 'simple-light', 'material', 'light-dim-sidebar']) {
    it(`${id}: all ${CANONICAL.length} canonical tokens defined (no Ayu fall-through)`, () => {
      const missing = CANONICAL.filter((t) => !blocks[id]!.has(t));
      expect(missing, `${id} missing: ${missing.join(', ')}`).toEqual([]);
    });
  }
});

// ── 4. Custom-theme compiler derivations ───────────────────────────────────

function makeEntry(overrides: Partial<CustomThemeEntry['colors']> & { isDark: boolean }): CustomThemeEntry {
  return {
    id: 'custom-test',
    name: 'Test',
    isDark: overrides.isDark,
    colors: overrides,
  } as CustomThemeEntry;
}

describe('v2.3.10: customThemeCss derivations', () => {
  it('DARK themes: --border-subtle is DARKER than --border-default (was inverted)', () => {
    const out = customThemeCss(makeEntry({ isDark: true, border: '#404040' }));
    const subtle = out.match(/--border-subtle: (#[0-9a-f]{6})/)?.[1];
    expect(subtle).toBeDefined();
    // subtle mixed toward BLACK (from #404040 → ~#292929)
    expect(parseInt(subtle!.slice(1), 16)).toBeLessThan(0x404040);
  });

  it('LIGHT themes: --border-subtle stays LIGHTER than --border-default', () => {
    const out = customThemeCss(makeEntry({ isDark: false, border: '#404040' }));
    const subtle = out.match(/--border-subtle: (#[0-9a-f]{6})/)?.[1];
    expect(subtle).toBeDefined();
    expect(parseInt(subtle!.slice(1), 16)).toBeGreaterThan(0x404040);
  });

  it('accent derives focus/info/link/tag/syntax-blue/sidebar-selected', () => {
    const out = customThemeCss(makeEntry({ isDark: true, accent: '#00e5ff' }));
    for (const t of [
      '--border-focused: #00e5ff;',
      '--status-info: #00e5ff;',
      '--text-link: #00e5ff;',
      '--tag-text: #00e5ff;',
      '--accent-light-blue: #00e5ff;',
      '--splitter-color-hover: #00e5ff;',
      '--graph-node-selected: #00e5ff;',
      '--bg-sidebar-selected: rgba(0, 229, 255, 0.14);',
    ]) {
      expect(out, `missing ${t}`).toContain(t);
    }
  });

  it('status colors derive the syntax accent family + diff line/word tints', () => {
    const out = customThemeCss(makeEntry({
      isDark: true,
      statusAdded: '#00e676', statusModified: '#ffea00', statusDeleted: '#ff1744',
      statusConflict: '#ff9100', statusUntracked: '#e040fb',
    }));
    expect(out).toContain('--accent-green: #00e676;');
    expect(out).toContain('--accent-yellow: #ffea00;');
    expect(out).toContain('--accent-red: #ff1744;');
    expect(out).toContain('--accent-purple: #ff9100;');
    expect(out).toContain('--accent-cyan: #e040fb;');
    expect(out).toContain('--diff-added-line: rgba(0, 230, 118, 0.08);');
    expect(out).toContain('--diff-added-word: rgba(0, 230, 118, 0.35);');
    expect(out).toContain('--diff-removed-line: rgba(255, 23, 68, 0.08);');
    expect(out).toContain('--diff-removed-word: rgba(255, 23, 68, 0.35);');
    expect(out).toContain('--warning-icon: #ffea00;');
  });

  it('text-secondary derives scrollbar thumbs; border derives graph rail + comment', () => {
    const out = customThemeCss(makeEntry({ isDark: false, border: '#cccccc', textSecondary: '#666666', bgPrimary: '#ffffff', bgSecondary: '#fafafa' }));
    expect(out).toContain('--scrollbar-thumb: rgba(102, 102, 102, 0.22);');
    expect(out).toContain('--scrollbar-thumb-hover: rgba(102, 102, 102, 0.4);');
    expect(out).toContain('--graph-line: #cccccc;');
    expect(out).toContain('--graph-node-fill: #ffffff;');
  });

  it('without an accent, --text-inverse is derived from the background (readable)', () => {
    const out = customThemeCss(makeEntry({ isDark: false, bgPrimary: '#ffffff', bgSecondary: '#fafafa' }));
    // light bg → dark inverse text
    expect(out).toContain('--text-inverse: #1a1c20;');
  });

  it('the generated CSS stays parseable (balanced braces, one aside block)', () => {
    const out = customThemeCss(makeEntry({ isDark: true, bgPrimary: '#111111', bgSidebar: '#222222', accent: '#00e5ff', border: '#333333', textSecondary: '#aaaaaa' }));
    expect((out.match(/\{/g) ?? []).length).toBe((out.match(/\}/g) ?? []).length);
    expect(out).toContain('[data-theme="custom-test"] aside {');
  });
});
