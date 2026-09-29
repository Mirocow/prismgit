/**
 * Text measurement utilities for locale-aware layout.
 *
 * Problem: Russian/German UI strings are commonly 2-4x longer than the
 * English strings the layout was designed around ("Use" -> "Используйте").
 * Fixed-width columns sized for English truncate localized labels.
 *
 * Solution: measure the actual localized label width (Canvas measureText)
 * and clamp column widths so text always fits.
 */

let canvas: HTMLCanvasElement | null = null;

/** Default UI font stack — keep in sync with globals.css `--font-sans`. */
export const UI_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Measure a single line of text in px.
 * Falls back to a char-count heuristic (~0.6em per char) when Canvas is
 * unavailable (jsdom/unit tests) so the math stays deterministic there.
 */
export function measureTextWidth(text: string, font: string): number {
  if (typeof document === 'undefined') {
    const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(font);
    const size = sizeMatch ? Number(sizeMatch[1]) : 12;
    return text.length * size * 0.6;
  }
  try {
    canvas ??= document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return text.length * 7.2;
    ctx.font = font;
    const width = ctx.measureText(text).width;
    // jsdom stubs return 0 for everything — use the heuristic in that case
    return width > 0 ? width : text.length * 7.2;
  } catch {
    return text.length * 7.2;
  }
}

/**
 * Effective column width for a fixed set of possible cell labels:
 * never narrower than the longest label (+ padding), never narrower than
 * the persisted/user width. This makes the column locale-aware: English
 * keeps the compact default, Russian/German widen to fit their labels.
 */
export function computeStateColumnWidth(
  persistedWidth: number,
  labels: string[],
  measure: (text: string) => number,
  options?: { padding?: number; minWidth?: number },
): number {
  const padding = options?.padding ?? 20;
  const minWidth = options?.minWidth ?? 40;
  const longest = labels.reduce((max, label) => Math.max(max, measure(label)), 0);
  return Math.max(persistedWidth, Math.ceil(longest + padding), minWidth);
}
