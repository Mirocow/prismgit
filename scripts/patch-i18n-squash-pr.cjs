/**
 * i18n patch — squash-to-branch in the Pull Requests / Reviews tools.
 * Adds every key to ALL FOUR locale dicts of the pages domain (unit tests
 * assert key parity).
 *
 * Run: node scripts/patch-i18n-squash-pr.cjs
 */
const fs = require('fs');

const NEW_KEYS = {
  'pages.prSquashToBranch': ['Squash to branch…', 'Сквошить в ветку…', '压合到分支…', 'In Branch squashen…'],
  'pages.prSquashToBranchTitle': [
    'Carry the commits of this PR to another branch (existing or new) as ONE squashed commit',
    'Перенести коммиты этого PR в другую ветку (существующую или новую) одним сквош-коммитом',
    '将该 PR 的提交作为一个压合提交搬运到另一分支（已有或新建）',
    'Die Commits dieses PRs als EINEN Squash-Commit in einen anderen (bestehenden oder neuen) Branch übertragen',
  ],
  'pages.prSquashSingleCommit': [
    'Nothing to squash — only {count} commit(s) in this selection',
    'Нечего сквошить — в выборе всего {count} коммит(ов)',
    '无需压合——此选择只有 {count} 个提交',
    'Nichts zu squashen — nur {count} Commit(s) in dieser Auswahl',
  ],
  'pages.prSquashFailed': [
    'Could not squash this PR',
    'Не удалось сквошить этот PR',
    '无法压合此 PR',
    'Dieser PR konnte nicht gesquasht werden',
  ],
  'pages.prSquashFetchFailed': [
    'Could not fetch the PR commits from the remote',
    'Не удалось получить коммиты PR с сервера',
    '无法从远端获取 PR 提交',
    'Die PR-Commits konnten nicht vom Server geholt werden',
  ],
  'pages.prSquashMissing': [
    'Some PR commits are not available locally: {hashes}',
    'Некоторые коммиты PR недоступны локально: {hashes}',
    '部分 PR 提交在本地不可用：{hashes}',
    'Einige PR-Commits sind lokal nicht verfügbar: {hashes}',
  ],
  'pages.reviewsSquashOutsideWindow': [
    'Some selected commits are outside the loaded history window — open History to squash them',
    'Некоторые выбранные коммиты вне загруженного окна истории — откройте History, чтобы сквошить их',
    '部分所选提交超出了已加载的历史窗口——请打开 History 进行压合',
    'Einige ausgewählte Commits liegen außerhalb des geladenen History-Fensters — öffnen Sie History, um sie zu squashen',
  ],
};

const FILE = 'src/i18n/locales/domains/pages.ts';
const LOCALES = ['en', 'ru', 'zh', 'de'];
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function insertIntoDict(src, loc, lines) {
  const re = new RegExp(`(export const ${loc}[^\\n]*\\{\\n)`);
  const m = src.match(re);
  if (!m) throw new Error(`dict ${loc} not found`);
  const start = m.index + m[0].length;
  const end = src.indexOf('\n};', start);
  if (end < 0) throw new Error(`closing brace of ${loc} not found`);
  const block = src.slice(start, end);
  const marker = lines[1] ? lines[1].slice(0, 60) : '';
  if (marker && block.includes(marker)) return src; // already patched
  return src.slice(0, end) + '\n' + lines.join('\n') + src.slice(end);
}

let touched = 0;
for (const [i, loc] of LOCALES.entries()) {
  const lines = ['', '  // ── squash-to-branch (Pull Requests / Reviews) ──'].concat(
    Object.entries(NEW_KEYS).map(([key, values]) => `  '${key}': '${esc(values[i])}',`)
  );
  const src = fs.readFileSync(FILE, 'utf8');
  const out = insertIntoDict(src, loc, lines);
  if (out !== src) { fs.writeFileSync(FILE, out); touched++; }
}
console.log('dict blocks patched:', touched);
