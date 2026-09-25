/**
 * i18n audit part 2 — run with: npx vite-node scripts/audit-i18n-parity.mts
 * 1. Per-locale parity: en vs ru/zh/de key sets (per domain).
 * 2. Hardcoded-string scan: JSX text / attributes with user-visible words
 *    that don't go through t().
 */
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

const domainsDir = 'src/i18n/locales/domains';
const locales: Array<'ru' | 'zh' | 'de'> = ['ru', 'zh', 'de'];

type Dict = Record<string, string>;
const enCore = (await import('../src/i18n/locales/en.ts')).en as Dict;
const ruCore = (await import('../src/i18n/locales/ru.ts')).ru as Dict;
const zhCore = (await import('../src/i18n/locales/zh.ts')).zh as Dict;
const deCore = (await import('../src/i18n/locales/de.ts')).de as Dict;

const en: Dict = { ...enCore };
const perLocale: Record<string, Dict> = { ru: { ...ruCore }, zh: { ...zhCore }, de: { ...deCore } };

for (const f of readdirSync(domainsDir).filter((x) => x.endsWith('.ts'))) {
  const name = f.replace(/\.ts$/, '');
  const mod = await import(`../src/i18n/locales/domains/${name}.ts`);
  if (mod.en) Object.assign(en, mod.en);
  for (const loc of locales) if (mod[loc]) Object.assign(perLocale[loc], mod[loc]);
}

console.log('en total:', Object.keys(en).length);
for (const loc of locales) {
  const dict = perLocale[loc];
  const missing = Object.keys(en).filter((k) => !(k in dict));
  const extra = Object.keys(dict).filter((k) => !(k in en));
  console.log(`\n[${loc}] keys=${Object.keys(dict).length} missing-vs-en=${missing.length} extra=${extra.length}`);
  if (missing.length) console.log('  missing:', missing.slice(0, 30).join(', '));
  if (extra.length) console.log('  extra:', extra.slice(0, 30).join(', '));
}

// ── Hardcoded strings scan ────────────────────────────────────────────────
// Heuristic: JSX text nodes and common attributes containing 2+ consecutive
// English words starting with a capital, or Cyrillic text, in pages/components.
const SKIP = /(?:\.test\.|\.spec\.|__tests__|node_modules|\/dist)/;
const results: string[] = [];
const walk = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP.test(p)) continue;
      walk(p);
    } else if (/\.(tsx)$/.test(e.name)) {
      const src = readFileSync(p, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*|import|export)/.test(line)) return;
        // JSX text: >Some words here< or placeholder="..." title="..." label="..."
        const jsxText = line.match(/>\s*([A-ZА-ЯЁ][a-zA-Zа-яёA-ZА-ЯЁ0-9 ,.'()\/&:;?!-]{6,})\s*</);
        const attr = line.match(/\b(?:placeholder|title|label|aria-label|alt)=["']([^{}"']{6,})["']/);
        const txt = (jsxText?.[1] || attr?.[1] || '').trim();
        if (!txt) return;
        if (/^(true|false|null|undefined)$/.test(txt)) return;
        // skip things that look like identifiers/paths
        if (/[{}]/.test(txt)) return;
        results.push(`${p}:${i + 1}: ${txt}`);
      });
    }
  }
};
walk('src');
console.log('\n=== POSSIBLE HARDCODED UI STRINGS (' + results.length + ') ===');
console.log(results.slice(0, 120).join('\n'));
