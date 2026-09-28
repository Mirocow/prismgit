/**
 * i18n patcher — Stacked PR/MR visibility (Task: «Жаль что не видно фишек
 * гитхаба которых нет в гите типа "Stacked PRs"»).
 *
 * Inserts the new keys AFTER the prConflictsBadge anchor in
 * domains/pages.ts for all 4 locales (en/ru/zh/de).
 *
 * Idempotent: skips insertion when the key already exists — the existence
 * check is scoped to the CURRENT locale block (from this anchor to the
 * next), never the whole file.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILE = 'src/i18n/locales/domains/pages.ts';
const ANCHOR = "'pages.prConflictsBadge'";

const KEYS = {
  en: [
    ['pages.prStackTooltip', 'Part of a {total}-PR stack: {chain} — accept bottom-up'],
    ['pages.prStackMenuLabel', 'Stack ({total})'],
    ['pages.prStackMenuOpen', 'Open {n}'],
    ['pages.prStackMergeFirst', 'Accept this one first (below in the stack)'],
    ['pages.prStackTitle', 'Stack'],
    ['pages.prStackHint', 'Accept bottom-up — {n} first'],
    ['pages.prStackHintTitle', 'Merge order: the BOTTOM of the stack merges first. Merging out of order makes the PRs above unmergeable until they are rebased onto the new base.'],
  ],
  ru: [
    ['pages.prStackTooltip', 'Часть стека из {total} PR/MR: {chain} — принимайте снизу вверх'],
    ['pages.prStackMenuLabel', 'Стек ({total})'],
    ['pages.prStackMenuOpen', 'Открыть {n}'],
    ['pages.prStackMergeFirst', 'Сначала принять этот (ниже по стеку)'],
    ['pages.prStackTitle', 'Стек'],
    ['pages.prStackHint', 'Принимайте снизу вверх — сначала {n}'],
    ['pages.prStackHintTitle', 'Порядок приёмки: сначала сливается НИЖНИЙ MR стека. Слияние не по порядку делает верхние MR несливаемыми до rebase на новую базу.'],
  ],
  zh: [
    ['pages.prStackTooltip', '属于 {total} 个 PR/MR 的堆叠链：{chain} — 自底向上接受'],
    ['pages.prStackMenuLabel', '堆叠 ({total})'],
    ['pages.prStackMenuOpen', '打开 {n}'],
    ['pages.prStackMergeFirst', '先接受此项（堆叠下方）'],
    ['pages.prStackTitle', '堆叠'],
    ['pages.prStackHint', '自底向上接受 — 先 {n}'],
    ['pages.prStackHintTitle', '合并顺序：先合并堆叠底部的 MR。乱序合并会使上方的 MR 在 rebase 到新基准前无法合并。'],
  ],
  de: [
    ['pages.prStackTooltip', 'Teil eines {total}-PR-Stapels: {chain} — bottom-up annehmen'],
    ['pages.prStackMenuLabel', 'Stapel ({total})'],
    ['pages.prStackMenuOpen', '{n} öffnen'],
    ['pages.prStackMergeFirst', 'Diesen zuerst annehmen (unten im Stapel)'],
    ['pages.prStackTitle', 'Stapel'],
    ['pages.prStackHint', 'Bottom-up annehmen — zuerst {n}'],
    ['pages.prStackHintTitle', 'Merge-Reihenfolge: zuerst das UNTERSTE MR des Stapels. Außer der Reihe gemergt werden die MR darüber bis zum Rebase auf die neue Basis unmergebar.'],
  ],
};

const src = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
const lines = src.split('\n');

// Find the 4 anchor line indexes (en, ru, zh, de in file order).
const anchorLineIdxs = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes(ANCHOR)) anchorLineIdxs.push(i);
}
if (anchorLineIdxs.length !== 4) {
  console.error(`ERROR: expected 4 anchors, found ${anchorLineIdxs.length}`);
  process.exit(1);
}
const locales = ['en', 'ru', 'zh', 'de'];

// Walk from the LAST locale to the FIRST so earlier insertions don't shift
// the line indexes of later blocks.
let inserted = 0;
for (let li = 3; li >= 0; li--) {
  const anchorIdx = anchorLineIdxs[li];
  const locale = locales[li];
  // Locale block = from this anchor to the next anchor (or EOF for de).
  const blockEnd = li < 3 ? anchorLineIdxs[li + 1] : lines.length;
  const block = lines.slice(anchorIdx, blockEnd).join('\n');
  const entries = KEYS[locale]
    .filter(([k]) => !block.includes(`'${k}'`))
    .map(([k, v]) => `  '${k}': ${JSON.stringify(v)},`);
  if (entries.length > 0) {
    lines.splice(anchorIdx + 1, 0, ...entries);
    inserted += entries.length;
  }
}

fs.writeFileSync(path.join(ROOT, FILE), lines.join('\n'));
console.log(`inserted ${inserted} key lines across 4 locale blocks`);
