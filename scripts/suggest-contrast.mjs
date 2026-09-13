/**
 * A11Y-3 — Suggest AA-compliant text-tertiary colors for each theme.
 *
 * For light themes: darkens the existing text-tertiary until ≥4.5:1.
 * For dark themes: lightens the existing text-tertiary until ≥4.5:1.
 * Output: a list of CSS one-liners to copy into globals.css.
 */

import fs from 'node:fs';
import path from 'node:path';

const CSS_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../src/styles/globals.css',
);

const css = fs.readFileSync(CSS_PATH, 'utf8');

function parseColor(s) {
  if (!s) return null;
  const str = s.trim();
  let m = str.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    return {
      r: parseInt(m[1][0] + m[1][0], 16),
      g: parseInt(m[1][1] + m[1][1], 16),
      b: parseInt(m[1][2] + m[1][2], 16),
    };
  }
  m = str.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
  }
  return null;
}

function srgbToLinear(c) {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function luminance({ r, g, b }) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a, b) {
  const L1 = luminance(a);
  const L2 = luminance(b);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

function toHex({ r, g, b }) {
  const to2 = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/**
 * Adjust the text color's luminance toward black (darken) or white
 * (lighten) until contrastRatio(text, bg) >= target.
 */
function adjustToTarget(text, bg, target, direction) {
  let { r, g, b } = text;
  // Binary search by mixing factor 0..1 with white (lighten) or black (darken).
  for (let i = 1; i <= 100; i++) {
    const factor = i / 100;
    let candidate;
    if (direction === 'lighten') {
      candidate = {
        r: r + (255 - r) * factor,
        g: g + (255 - g) * factor,
        b: b + (255 - b) * factor,
      };
    } else {
      candidate = {
        r: r * (1 - factor),
        g: g * (1 - factor),
        b: b * (1 - factor),
      };
    }
    if (contrastRatio(candidate, bg) >= target) {
      return candidate;
    }
  }
  return null;
}

const blocks = css.split('}');
const themes = [];
for (const block of blocks) {
  const openIdx = block.indexOf('{');
  if (openIdx < 0) continue;
  const selector = block.slice(0, openIdx).trim();
  const body = block.slice(openIdx + 1).trim();
  const bgMatch = body.match(/--bg-tertiary:\s*([^;]+);/);
  const textMatch = body.match(/--text-tertiary:\s*([^;]+);/);
  if (!bgMatch || !textMatch) continue;
  const bg = parseColor(bgMatch[1]);
  const text = parseColor(textMatch[1]);
  if (!bg || !text) continue;
  // Use luminance to detect light vs dark theme.
  const bgL = luminance(bg);
  const isLightTheme = bgL > 0.4;
  const existingRatio = contrastRatio(text, bg);
  if (existingRatio >= 4.5) continue;
  // Lighten or darken toward AA.
  const adjusted = adjustToTarget(text, bg, 4.5, isLightTheme ? 'darken' : 'lighten');
  if (adjusted) {
    const newRatio = contrastRatio(adjusted, bg);
    themes.push({
      selector: selector.split('\n').pop().trim(),
      oldColor: textMatch[1],
      newColor: toHex(adjusted),
      oldRatio: existingRatio.toFixed(2),
      newRatio: newRatio.toFixed(2),
    });
  } else {
    themes.push({
      selector: selector.split('\n').pop().trim(),
      oldColor: textMatch[1],
      newColor: null,
      oldRatio: existingRatio.toFixed(2),
      newRatio: 'N/A',
    });
  }
}

console.log('Suggested AA-compliant text-tertiary replacements:\n');
for (const t of themes) {
  if (t.newColor) {
    console.log(`  ${t.selector.padEnd(28)}  ${t.oldColor} (${t.oldRatio}:1) → ${t.newColor} (${t.newRatio}:1)`);
  } else {
    console.log(`  ${t.selector.padEnd(28)}  ${t.oldColor} (${t.oldRatio}:1) → NOT FOUND (need full white/black)`);
  }
}
