/**
 * Custom theme → CSS compiler.
 *
 * User-created themes (Settings → Appearance → Themes → «Создать тему…»)
 * are stored as a small set of color tokens (CustomThemeColors) and compiled
 * into CSS variables scoped to their own `data-theme="custom-<id>"` selector.
 * Unset tokens fall through to the :root / .dark base values — the same
 * partial-override model the built-in themes use.
 *
 * Derived tokens (accent-hover, text-inverse on accent, border-subtle/strong,
 * status synonyms, diff backgrounds) are computed from the base tokens so the
 * editor stays 13 inputs wide but the theme looks complete everywhere —
 * including TEXT COLORS in tools (the user's explicit requirement:
 * «в теме надо менять и цвета текста в инструментах»).
 */
import type { CustomThemeEntry, CustomThemeColors } from './themes';

const STYLE_TAG_ID = 'prismgit-custom-theme';

// ── color math ─────────────────────────────────────────────────────────────

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function toHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) | (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)).toString(16).slice(1)}`;
}

/** Linear blend a toward b by pct (0..1). */
function mix(a: [number, number, number], b: [number, number, number], pct: number): string {
  return toHex(a[0] + (b[0] - a[0]) * pct, a[1] + (b[1] - a[1]) * pct, a[2] + (b[2] - a[2]) * pct);
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black-ish or white-ish text that stays readable on the given color. */
export function readableOn(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return '#ffffff';
  return relativeLuminance(rgb) > 0.35 ? '#1a1c20' : '#ffffff';
}

// ── CSS compilation ────────────────────────────────────────────────────────

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [10, 11, 14];

/**
 * Build the CSS text for a custom theme. Pure function — used by
 * settingsStore (apply), theme-init (boot, FOUC-free) and the editor preview.
 */
export function customThemeCss(entry: CustomThemeEntry): string {
  const c: CustomThemeColors = entry.colors ?? {};
  const dark = entry.isDark;
  const lines: string[] = [];
  const put = (name: string, value: string | undefined) => {
    if (value) lines.push(`  ${name}: ${value};`);
  };

  // Base surfaces + text
  put('--bg-primary', c.bgPrimary);
  put('--bg-secondary', c.bgSecondary);
  put('--bg-tertiary', c.bgTertiary);
  put('--bg-elevated', c.bgElevated);
  put('--text-primary', c.textPrimary);
  put('--text-secondary', c.textSecondary);
  put('--text-tertiary', c.textTertiary);

  // Derived hover/selected states from the primary background
  const bg = parseHex(c.bgPrimary ?? (dark ? '#282c34' : '#f7f8fa'));
  if (bg) {
    const target = dark ? WHITE : BLACK;
    put('--bg-hover', mix(bg, target, 0.06));
    put('--bg-active', mix(bg, target, 0.10));
    put('--bg-selected', mix(bg, target, 0.14));
  }

  // Accent + derived shades
  const accent = parseHex(c.accent ?? '');
  put('--accent', c.accent);
  if (accent) {
    const target = dark ? WHITE : BLACK;
    put('--accent-hover', mix(accent, target, 0.12));
    put('--accent-active', mix(accent, target, 0.22));
    put('--accent-muted', `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, 0.15)`);
    // Text on accent-filled buttons/links — the requirement that themes
    // change TEXT colors everywhere, including on colored surfaces.
    put('--text-inverse', readableOn(c.accent!));
  }

  // Borders + derived subtle/strong
  const border = parseHex(c.border ?? '');
  put('--border-default', c.border);
  if (border) {
    const target = dark ? WHITE : BLACK;
    put('--border-subtle', mix(border, dark ? WHITE : WHITE, 0.35));
    put('--border-strong', mix(border, target, 0.18));
  }

  // Status colors + synonyms (success/warning/error/info) + diff tints
  const status: Array<[string, string | undefined]> = [
    ['--status-added', c.statusAdded],
    ['--status-modified', c.statusModified],
    ['--status-deleted', c.statusDeleted],
    ['--status-renamed', c.accent],
    ['--status-conflict', c.statusConflict ?? c.statusDeleted],
    ['--status-untracked', c.statusUntracked ?? c.statusModified],
  ];
  for (const [name, value] of status) put(name, value);
  if (c.statusAdded) {
    const rgb = parseHex(c.statusAdded);
    if (rgb) put('--status-success', `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`);
  }
  if (c.statusModified) {
    const rgb = parseHex(c.statusModified);
    if (rgb) {
      put('--status-warning', `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`);
      put('--diff-added-bg', `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.12)`);
    }
  }
  if (c.statusDeleted) {
    const rgb = parseHex(c.statusDeleted);
    if (rgb) {
      put('--status-error', `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`);
      put('--diff-removed-bg', `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.12)`);
    }
  }
  if (c.statusAdded) {
    const rgb = parseHex(c.statusAdded);
    if (rgb) put('--diff-added-bg', `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.12)`);
  }

  const mainBlock = lines.length
    ? `[data-theme="${entry.id}"] {\n${lines.join('\n')}\n}`
    : `[data-theme="${entry.id}"] { }`;

  // Dark sidebar block — the user's «тёмный сайдбар + светлое основное окно».
  // When bgSidebar is set (and it is DARKER than the main bg), the sidebar
  // gets its own surface + readable text tokens, exactly like the built-in
  // light-dim-sidebar theme.
  let asideBlock = '';
  const sidebarBg = parseHex(c.bgSidebar ?? '');
  if (sidebarBg) {
    const target = entry.isDark ? WHITE : BLACK;
    const aLines: string[] = [
      `  --bg-primary: ${c.bgSidebar};`,
      `  --bg-secondary: ${mix(sidebarBg, target, 0.05)};`,
      `  --bg-tertiary: ${mix(sidebarBg, target, 0.10)};`,
      `  --bg-elevated: ${mix(sidebarBg, target, 0.16)};`,
      `  --bg-hover: ${mix(sidebarBg, target, 0.08)};`,
      `  --bg-selected: ${mix(sidebarBg, target, 0.14)};`,
      `  --text-primary: ${readableOn(c.bgSidebar!)};`,
      `  --text-secondary: ${mix(sidebarBg, parseHex(readableOn(c.bgSidebar!)) ?? WHITE, 0.82)};`,
      `  --text-tertiary: ${mix(sidebarBg, parseHex(readableOn(c.bgSidebar!)) ?? WHITE, 0.65)};`,
      `  --border-default: ${mix(sidebarBg, target, 0.18)};`,
      `  --border-subtle: ${mix(sidebarBg, target, 0.10)};`,
      `  background-color: ${c.bgSidebar};`,
      `  color: ${readableOn(c.bgSidebar!)};`,
    ];
    if (accent) {
      const light = relativeLuminance(sidebarBg) > relativeLuminance(accent);
      const sidebarAccent = light ? mix(accent, BLACK, 0.25) : mix(accent, WHITE, 0.25);
      aLines.push(`  --accent: ${sidebarAccent};`);
      aLines.push(`  --accent-muted: rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, 0.18);`);
    }
    asideBlock = `\n\n[data-theme="${entry.id}"] aside {\n${aLines.join('\n')}\n}`;
  }

  return `${mainBlock}${asideBlock}`;
}

// ── DOM application (renderer) ─────────────────────────────────────────────

/** Inject (or replace) the custom-theme style tag. Safe to call repeatedly. */
export function applyCustomThemeStyleTag(entry: CustomThemeEntry): void {
  if (typeof document === 'undefined') return;
  let tag = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement('style');
    tag.id = STYLE_TAG_ID;
    document.head.appendChild(tag);
  }
  tag.textContent = customThemeCss(entry);
}

/** Remove the injected custom-theme CSS (switching to a built-in theme). */
export function removeCustomThemeStyleTag(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(STYLE_TAG_ID)?.remove();
}

/** localStorage mirror of the ACTIVE custom theme — read by theme-init.ts
 *  before React mounts so custom themes boot without a flash. */
export const ACTIVE_CUSTOM_LS_KEY = 'prismgit-custom-active';

export function persistActiveCustomTheme(entry: CustomThemeEntry): void {
  try {
    localStorage.setItem(ACTIVE_CUSTOM_LS_KEY, JSON.stringify(entry));
  } catch { /* ignore */ }
}

export function clearActiveCustomTheme(): void {
  try {
    localStorage.removeItem(ACTIVE_CUSTOM_LS_KEY);
  } catch { /* ignore */ }
}

export function loadActiveCustomTheme(): CustomThemeEntry | null {
  try {
    const raw = localStorage.getItem(ACTIVE_CUSTOM_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CustomThemeEntry;
    return parsed && typeof parsed.id === 'string' && parsed.id.startsWith('custom-') ? parsed : null;
  } catch {
    return null;
  }
}
