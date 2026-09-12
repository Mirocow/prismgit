/**
 * A11Y-3 — Color contrast audit script.
 *
 * Parses src/styles/globals.css, finds every theme block (the selectors
 * that set --bg-tertiary + --text-tertiary together), computes the WCAG
 * contrast ratio for the (text-tertiary, bg-tertiary) pair, and reports
 * any pair that fails AA (≥4.5:1 for normal text).
 *
 * Usage:
 *   node /home/z/my-project/repos/prismgit/scripts/audit-contrast.mjs
 *
 * Exit code:
 *   0 if every theme passes AA; 1 otherwise. Plug into CI.
 */

import fs from 'node:fs';
import path from 'node:path';

const CSS_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../src/styles/globals.css',
);

const css = fs.readFileSync(CSS_PATH, 'utf8');

/**
 * Parse a CSS color string (#abc / #aabbcc / rgb(...)) into {r,g,b} 0-255.
 * Returns null for unsupported formats.
 */
function parseColor(s) {
  if (!s) return null;
  const str = s.trim();
  // #abc or #aabbcc
  let m = str.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const r = m[1][0] + m[1][0];
    const g = m[1][1] + m[1][1];
    const b = m[1][2] + m[1][2];
    return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16) };
  }
  m = str.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
  }
  // rgb(r, g, b)
  m = str.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (m) {
    return { r: +m[1], g: +m[2], b: +m[3] };
  }
  return null;
}

function srgbToLinear(c) {
  // c is 0-255; return linear 0-1
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function luminance({ r, g, b }) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * WCAG contrast ratio. Always ≥1; ≥4.5 needed for AA normal text.
 */
function contrastRatio(a, b) {
  const L1 = luminance(a);
  const L2 = luminance(b);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Walk the CSS, splitting on `}` and looking for selector+body pairs.
const blocks = css.split('}');
const themes = [];

for (let i = 0; i < blocks.length; i++) {
  const block = blocks[i];
  // Find selector (everything before `{`)
  const openIdx = block.indexOf('{');
  if (openIdx < 0) continue;
  // The "selector" is everything before {, but it may include leading
  // CSS comments. Extract the actual selector by taking the LAST line
  // before { that isn't a comment.
  const beforeBrace = block.slice(0, openIdx);
  // Strip trailing CSS comments (/* ... */) — keep only the selector
  const selector = beforeBrace.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const body = block.slice(openIdx + 1).trim();
  if (!selector) continue;
  // Only consider rules that set BOTH --bg-tertiary and --text-tertiary.
  const bgMatch = body.match(/--bg-tertiary:\s*([^;]+);/);
  const textMatch = body.match(/--text-tertiary:\s*([^;]+);/);
  if (!bgMatch || !textMatch) continue;
  const bg = parseColor(bgMatch[1]);
  const text = parseColor(textMatch[1]);
  if (!bg || !text) continue;
  themes.push({ selector, bg, text, bgRaw: bgMatch[1], textRaw: textMatch[1] });
}

let failures = 0;
const AA_THRESHOLD = 4.5;
console.log(`Auditing ${themes.length} theme blocks for AA contrast (text-tertiary on bg-tertiary, ≥ ${AA_THRESHOLD}:1)…\n`);
for (const t of themes) {
  const ratio = contrastRatio(t.text, t.bg);
  const status = ratio >= AA_THRESHOLD ? 'PASS' : 'FAIL';
  console.log(`${status}  ${ratio.toFixed(2)}:1  ${t.selector.padEnd(28)}  text=${t.textRaw}  bg=${t.bgRaw}`);
  if (ratio < AA_THRESHOLD) failures++;
}

console.log('');
if (failures === 0) {
  console.log(`✓ All ${themes.length} theme blocks pass AA (≥ ${AA_THRESHOLD}:1).`);
  process.exit(0);
} else {
  console.log(`✗ ${failures} theme block(s) fail AA — see FAIL lines above.`);
  process.exit(1);
}
