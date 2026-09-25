/**
 * i18n audit — run with: npx vite-node scripts/audit-i18n.mts
 * 1. Loads the REAL en dictionary (core + all domains) via ES imports.
 * 2. Regex-scans src/ for t('...') / t("...") usages.
 * 3. Reports keys used in code but missing from the dictionary.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

// Load the real en dictionary pieces
const en: Record<string, string> = {};
// core
const core = await import('../src/i18n/locales/en.ts');
Object.assign(en, core.en);
// domains — import each file's `en` export
const domainsDir = 'src/i18n/locales/domains';
for (const f of readdirSync(domainsDir).filter((x) => x.endsWith('.ts'))) {
  const mod = await import(`../src/i18n/locales/domains/${f.replace(/\.ts$/, '')}.ts`);
  if (mod.en) Object.assign(en, mod.en);
}
console.log('EN keys:', Object.keys(en).length);

// Also load ru/zh/de aggregated to check per-locale coverage
const agg = {
  ru: await import('../src/i18n/locales/aggregated/ru'),
  zh: await import('../src/i18n/locales/aggregated/zh'),
  de: await import('../src/i18n/locales/aggregated/de'),
};
const ru = (agg.ru as unknown as { default?: Record<string, string>; ru?: Record<string, string> });
console.log('aggregated shapes:', Object.keys(agg.ru));

// Scan source for t('key') usages
const used = new Map<string, string[]>(); // key -> files
const walk = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?)$/.test(e.name) && !/\.test\./.test(e.name)) {
      const src = readFileSync(p, 'utf8');
      const re = /\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const list = used.get(m[1]) ?? [];
        if (list.length < 2) list.push(p);
        used.set(m[1], list);
      }
    }
  }
};
walk('src');

const missing = [...used.keys()].filter((k) => !(k in en));
console.log('\n=== USED IN CODE BUT MISSING FROM EN DICT (' + missing.length + ') ===');
for (const k of missing.sort()) console.log(k, ' <- ', used.get(k)![0]);

// unused keys (informational only)
const unused = Object.keys(en).filter((k) => !used.has(k) && !k.includes('.'));
console.log('\n=== DICT KEYS NEVER USED VIA t() (info) ===');
console.log('count:', unused.length);
