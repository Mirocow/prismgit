import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * BUGFIX "тёмные темы не адаптированы + разделители слишком яркие" —
 * theme-registry ↔ CSS ↔ boot-screen guards.
 *
 * The reported symptoms traced back to several drifts between the four
 * places a theme is described:
 *   src/lib/themes.ts        (registry: ids, isDark, preview colors)
 *   src/styles/globals.css   ([data-theme] blocks + .dark)
 *   src/theme-init.ts        (pre-React .dark class — used to be a stale list)
 *   index.html               (boot-screen THEMES table + isLight list)
 *   electron/services/themeDark.ts (native window background)
 *
 * These tests fail whenever any of them drifts again, and validate the
 * dark-theme border brightness invariant ("separators too bright").
 */
import { THEMES, isThemeDark } from '../../src/lib/themes';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(ROOT, 'src/styles/globals.css'), 'utf8');
const indexHtml = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ── CSS block extraction ───────────────────────────────────────────────────

function extractBlocks(source: string): Record<string, Record<string, string>> {
  const blocks: Record<string, Record<string, string>> = {};
  const re = /((?:\.dark)|(?:\[data-theme="[^"]+"\])|(?::root))\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const sel = m[1];
    const name = sel === ':root' ? 'root' : sel.startsWith('[data-theme="') ? sel.slice(13, -2) : sel.replace('.', '');
    // The file legitimately has TWO :root and TWO .dark blocks (tokens +
    // font/utility overrides later in the file) — merge them like the CSS
    // cascade does instead of overwriting (later declarations win per token).
    const toks: Record<string, string> = blocks[name] ?? {};
    for (const line of m[2].split('\n')) {
      const t = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/);
      if (t) toks[t[1]] = t[2].trim();
    }
    blocks[name] = toks;
  }
  return blocks;
}

const blocks = extractBlocks(css);

// ── Luminance helpers (WCAG) ───────────────────────────────────────────────

function lum(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  const chan = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

function ratio(a: string, b: string): number {
  const la = lum(a);
  const lb = lum(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ── Registry ↔ CSS coverage ────────────────────────────────────────────────

describe('theme registry ↔ globals.css coverage', () => {
  it('every registered theme has a [data-theme] block (or is the :root/.dark base)', () => {
    for (const t of THEMES) {
      const covered = t.id === 'light' || t.id === 'dark' || !!blocks[t.id];
      expect(covered, `theme "${t.id}" has no [data-theme] block in globals.css`).toBe(true);
    }
  });

  it('globals.css defines no [data-theme] block unknown to the registry', () => {
    const known = new Set(THEMES.map((t) => t.id));
    for (const name of Object.keys(blocks)) {
      if (name === 'root' || name === 'dark') continue;
      expect(known.has(name), `globals.css block "${name}" is not in THEMES`).toBe(true);
    }
  });

  it('every --border-* token in every block is a valid 6-digit hex (catches #1a56670)', () => {
    for (const [name, toks] of Object.entries(blocks)) {
      for (const [k, v] of Object.entries(toks)) {
        if (!k.startsWith('--border')) continue;
        expect(
          /^#[0-9a-fA-F]{6}$/.test(v),
          `${name} ${k} = "${v}" — invalid hex (an invalid custom property makes var() resolve to currentColor → BRIGHT separators)`,
        ).toBe(true);
      }
    }
  });
});

// ── Dark-theme border brightness invariant ─────────────────────────────────

describe('dark themes: separators are muted (not "слишком яркие")', () => {
  const darkIds = THEMES.filter((t) => t.isDark).map((t) => t.id);

  it('there are dark themes to guard', () => {
    expect(darkIds.length).toBeGreaterThanOrEqual(13);
  });

  for (const id of darkIds) {
    it(`${id}: --border-default stays within 1.10..1.45 luminance ratio of --bg-primary`, () => {
      const toks = blocks[id] ?? (id === 'dark' ? blocks['dark'] : undefined);
      expect(toks, `missing block for ${id}`).toBeDefined();
      const bd = toks!['--border-default'];
      const bg = toks!['--bg-primary'];
      expect(bd).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(bg).toMatch(/^#[0-9a-fA-F]{6}$/);
      // Symmetric ratio covers both directions: too bright (github-dark was
      // 1.55, catppuccin 1.80) AND too dark (invisible separators).
      const r = ratio(bd, bg);
      expect(r, `${id} border ${bd} vs bg ${bg} → ratio ${r.toFixed(2)}`).toBeGreaterThanOrEqual(1.10);
      expect(r, `${id} border ${bd} vs bg ${bg} → ratio ${r.toFixed(2)}`).toBeLessThanOrEqual(1.45);
    });
  }
});

// ── theme-init.ts: .dark class at boot for EVERY dark theme ────────────────

describe('theme-init: pre-React .dark class (no light-token flash)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme');
  });

  it('applies .dark for the legacy 10 dark themes AND the previously-missing slack-dark/discord/purple', async () => {
    for (const id of THEMES.filter((t) => t.isDark).map((t) => t.id)) {
      localStorage.setItem('prismgit-theme', id);
      vi.resetModules();
      await import('../../src/theme-init');
      expect(
        document.documentElement.classList.contains('dark'),
        `boot with saved theme "${id}" did not add the .dark class → unfilled tokens resolved to LIGHT :root values`,
      ).toBe(true);
      expect(document.documentElement.getAttribute('data-theme')).toBe(id);
    }
  });

  it('light themes do NOT get the .dark class at boot', async () => {
    for (const id of THEMES.filter((t) => !t.isDark).map((t) => t.id)) {
      localStorage.setItem('prismgit-theme', id);
      vi.resetModules();
      await import('../../src/theme-init');
      expect(document.documentElement.classList.contains('dark'), `${id} should stay light`).toBe(false);
    }
  });
});

// ── index.html boot screen coverage ────────────────────────────────────────

describe('index.html boot screen theme table', () => {
  it('boot THEMES table covers every registered theme (no wrong-color boot)', () => {
    const m = indexHtml.match(/var THEMES = \{([\s\S]*?)\};/);
    expect(m).not.toBeNull();
    const ids = Array.from(m![1].matchAll(/'([a-z-]+)'\s*:\s*\{/g)).map((x) => x[1]);
    const known = new Set(ids);
    for (const t of THEMES) {
      expect(known.has(t.id), `boot screen table missing "${t.id}"`).toBe(true);
    }
  });

  it('isLight list covers every LIGHT theme (dark boot borders on a light bg otherwise)', () => {
    const m = indexHtml.match(/var isLight = \[([^\]]*)\]\.indexOf/);
    expect(m).not.toBeNull();
    const listed = new Set(Array.from(m![1].matchAll(/'([a-z-]+)'/g)).map((x) => x[1]));
    for (const t of THEMES.filter((x) => !x.isDark)) {
      expect(listed.has(t.id), `isLight list missing "${t.id}"`).toBe(true);
    }
    for (const id of listed) {
      expect(isThemeDark(id as never), `isLight list contains DARK theme "${id}"`).toBe(false);
    }
  });
});

// ── electron main-process dark list stays in sync ──────────────────────────

describe('electron/services/themeDark.ts (native window background)', () => {
  it('DARK_THEMES matches THEMES isDark exactly (dark themes must not flash a white window)', async () => {
    const { DARK_THEMES, windowBackgroundForTheme } = await import('../../electron/services/themeDark');
    const registryDark = new Set(THEMES.filter((t) => t.isDark).map((t) => t.id));
    const registryLight = new Set(THEMES.filter((t) => !t.isDark).map((t) => t.id));
    for (const id of registryDark) {
      expect(DARK_THEMES.has(id), `DARK_THEMES missing "${id}" — that theme would boot with a WHITE window`).toBe(true);
    }
    for (const id of registryLight) {
      expect(!DARK_THEMES.has(id), `DARK_THEMES wrongly contains light theme "${id}"`).toBe(true);
    }
    expect(windowBackgroundForTheme('dracula')).not.toBe('#f7f8fa');
    expect(windowBackgroundForTheme('light')).toBe('#f7f8fa');
    expect(windowBackgroundForTheme(undefined)).toBe('#f7f8fa');
  });
});
