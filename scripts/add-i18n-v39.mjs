import * as fs from 'node:fs';
const p = 'src/i18n/locales/domains/pages.ts';
let s = fs.readFileSync(p, 'utf8');
const pairs = [
  ["'pages.invBlameAtLine': 'Blame — line {line} (who introduced it)',",
   ["'pages.invOpenCommitHint': 'Open the commit that introduced this line in History',",
    "'pages.invBlameLookupFailed': 'Could not identify the commit',"]],
  ["'pages.invBlameAtLine': 'Blame — строка {line} (кто внёс изменение)',",
   ["'pages.invOpenCommitHint': 'Открыть коммит, внёсший строку, в History',",
    "'pages.invBlameLookupFailed': 'Не удалось определить коммит',"]],
  ["'pages.invBlameAtLine': 'Blame — 第 {line} 行（谁引入的）',",
   ["'pages.invOpenCommitHint': '在 History 中打开引入此行的提交',",
    "'pages.invBlameLookupFailed': '无法确定提交',"]],
  ["'pages.invBlameAtLine': 'Blame — Zeile {line} (wer hat es eingeführt)',",
   ["'pages.invOpenCommitHint': 'Den Commit, der diese Zeile einführte, in History öffnen',",
    "'pages.invBlameLookupFailed': 'Commit konnte nicht ermittelt werden',"]],
];
for (const [anchor, lines] of pairs) {
  if (s.includes(anchor) && !s.includes(lines[0])) {
    s = s.replace(anchor, anchor + '\n  ' + lines.join('\n  '));
    console.log('added for', anchor.slice(0, 40));
  }
}
fs.writeFileSync(p, s);
console.log('done');
