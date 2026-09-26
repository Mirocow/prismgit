/**
 * i18n patch — squash-to-branch feature keys (History multi-selection →
 * SquashToBranchDialog). Adds every key to ALL FOUR locale dicts of the
 * matching domain file (unit tests assert key parity).
 *
 * Run: node scripts/patch-i18n-squash.cjs
 */
const fs = require('fs');

const NEW_KEYS = {
  // ── history (HistoryPage: selection bar + context menu) ──
  'history.nCommitsSelected': ['Commits selected: {count}', 'Выбрано коммитов: {count}', '已选提交：{count}', 'Ausgewählte Commits: {count}'],
  'history.squashGroupToBranch': ['Squash {count} commits to a branch…', 'Сквошить {count} коммитов в ветку…', '将 {count} 个提交压合到分支…', '{count} Commits in einen Branch squashen…'],
  'history.squashGroupToBranchAction': ['Squash to branch…', 'Сквошить в ветку…', '压合到分支…', 'In Branch squashen…'],
  'history.squashGroupToBranchTitle': ['Carry the selected commits to another branch as ONE squashed commit', 'Перенести выбранные коммиты в другую ветку одним сквош-коммитом', '将所选提交作为一个压合提交搬运到另一分支', 'Die ausgewählten Commits als EINEN Squash-Commit in einen anderen Branch übertragen'],

  // ── dialogs (SquashToBranchDialog) ──
  'dialogs.squashToBranch.title': ['Squash commits to a branch', 'Сквош коммитов в ветку', '将提交压合到分支', 'Commits in einen Branch squashen'],
  'dialogs.squashToBranch.nCommits': ['{count} commits', '{count} коммитов', '{count} 个提交', '{count} Commits'],
  'dialogs.squashToBranch.author': ['by {name}', 'автор: {name}', '作者：{name}', 'von {name}'],
  'dialogs.squashToBranch.messageLabel': ['Commit message', 'Сообщение коммита', '提交信息', 'Commit-Beschreibung'],
  'dialogs.squashToBranch.messagePlaceholder': ['Message for the squashed commit…', 'Сообщение для сквош-коммита…', '压合提交的信息…', 'Beschreibung des Squash-Commits…'],
  'dialogs.squashToBranch.newBranch': ['New branch', 'Новая ветка', '新建分支', 'Neuer Branch'],
  'dialogs.squashToBranch.namePlaceholder': ['branch-name', 'имя-ветки', '分支名称', 'branch-name'],
  'dialogs.squashToBranch.baseTitle': ['Where to fork the new branch from', 'Откуда ответвить новую ветку', '从何处切出新分支', 'Wo der neue Branch abgezweigt wird'],
  'dialogs.squashToBranch.baseRange': ['Base of selected commits', 'Основание выбранных коммитов', '所选提交的基点', 'Basis der ausgewählten Commits'],
  'dialogs.squashToBranch.baseBranch': ['from {name}', 'от {name}', '基于 {name}', 'von {name}'],
  'dialogs.squashToBranch.existingBranch': ['Existing branch', 'Существующая ветка', '已有分支', 'Bestehender Branch'],
  'dialogs.squashToBranch.noBranches': ['(no other local branches)', '(нет других локальных веток)', '（没有其他本地分支）', '(keine weiteren lokalen Branches)'],
  'dialogs.squashToBranch.keepAuthor': ['Keep original author', 'Сохранить исходного автора', '保留原作者', 'Originalen Autor behalten'],
  'dialogs.squashToBranch.keepAuthorTitle': ['Author name, e-mail and date of the oldest selected commit', 'Имя, e-mail и дата самого старого выбранного коммита', '最旧所选提交的作者姓名、邮箱和日期', 'Name, E-Mail und Datum des ältesten ausgewählten Commits'],
  'dialogs.squashToBranch.switchAfter': ['Switch to it afterwards', 'Переключиться на неё после', '完成后切换过去', 'Danach dorthin wechseln'],
  'dialogs.squashToBranch.switchTitle': ['Check out the target branch after the squash', 'Выполнить checkout целевой ветки после сквоша', '压合后检出目标分支', 'Den Ziel-Branch nach dem Squash auschecken'],
  'dialogs.squashToBranch.hint': ['A read-only check runs first: if the changes conflict with the target branch, nothing is touched until you confirm. The current branch and working tree stay untouched when the apply is clean.', 'Сначала выполняется проверка без изменений: если правки конфликтуют с целевой веткой, ничего не трогается до вашего подтверждения. При чистом применении текущая ветка и рабочая копия не затрагиваются.', '会先进行只读检查：若更改与目标分支冲突，在您确认前不会进行任何改动。干净应用时，当前分支和工作区保持不变。', 'Zuerst läuft eine schreibgeschützte Prüfung: Wenn die Änderungen mit dem Ziel-Branch kollidieren, wird nichts angerührt, bis Sie bestätigen. Bei sauberer Anwendung bleiben aktueller Branch und Arbeitsverzeichnis unberührt.'],
  'dialogs.squashToBranch.errMessage': ['Commit message is required', 'Нужно сообщение коммита', '必须填写提交信息', 'Commit-Beschreibung ist erforderlich'],
  'dialogs.squashToBranch.errBranch': ['Choose a target branch', 'Выберите целевую ветку', '请选择目标分支', 'Ziel-Branch auswählen'],
  'dialogs.squashToBranch.errName': ['Enter a valid branch name', 'Введите допустимое имя ветки', '请输入有效的分支名', 'Gültigen Branch-Namen eingeben'],
  'dialogs.squashToBranch.conflictTitle': ['{count} file(s) conflict with branch {branch}', 'Конфликтов файлов: {count} с веткой {branch}', '{count} 个文件与分支 {branch} 冲突', '{count} Datei(en) kollidieren mit Branch {branch}'],
  'dialogs.squashToBranch.conflictBody': ['To apply the squash, the app will switch to that branch and mark the conflicts — you resolve them on the Changes page (Continue finishes the squash as one commit). Your current branch is not modified.', 'Чтобы применить сквош, приложение переключится на эту ветку и пометит конфликты — разрешите их на странице «Изменения» (Continue завершит сквош одним коммитом). Текущая ветка не изменяется.', '为应用压合，应用将切换到该分支并标记冲突——您在「更改」页解决冲突（继续将以单个提交完成压合）。当前分支不会被修改。', 'Um den Squash anzuwenden, wechselt die App auf diesen Branch und markiert die Konflikte — lösen Sie sie auf der Änderungen-Seite (Weiter schließt den Squash als einen Commit ab). Ihr aktueller Branch wird nicht verändert.'],
  'dialogs.squashToBranch.proceedConflicts': ['Switch and resolve ({count})', 'Переключиться и разрешить ({count})', '切换并解决（{count}）', 'Wechseln und auflösen ({count})'],
  'dialogs.squashToBranch.squashAction': ['Squash {count} commits', 'Сквошить {count} коммитов', '压合 {count} 个提交', '{count} Commits squashen'],
  'dialogs.squashToBranch.needTwo': ['Select at least 2 commits (Shift+click)', 'Выберите минимум 2 коммита (Shift+клик)', '请至少选择 2 个提交（Shift+点击）', 'Mindestens 2 Commits auswählen (Shift+Klick)'],

  // ── toasts ──
  'toast.squashToBranch.done': ['Squashed onto {branch}', 'Сквош применён к {branch}', '已压合到 {branch}', 'Auf {branch} gesquasht'],
  'toast.squashToBranch.switched': ['Switched to {branch}', 'Переключено на {branch}', '已切换到 {branch}', 'Zu {branch} gewechselt'],
  'toast.squashToBranch.switchFailed': ['Could not switch branches', 'Не удалось переключить ветку', '无法切换分支', 'Branch-Wechsel fehlgeschlagen'],
  'toast.squashToBranch.conflicts': ['Conflicts: {count} on {branch}', 'Конфликтов: {count} на {branch}', '{branch} 上有 {count} 个冲突', 'Konflikte: {count} auf {branch}'],
  'toast.squashToBranch.conflictsDetail': ['Resolve them in Changes, then Continue — the squash lands as one commit', 'Разрешите их в «Изменениях», затем Continue — сквош станет одним коммитом', '在「更改」中解决冲突后点击继续——压合将作为单个提交落地', 'In Änderungen auflösen, dann Weiter — der Squash wird ein einzelner Commit'],
  'toast.squashToBranch.empty': ['{branch} already contains these changes', '{branch} уже содержит эти изменения', '{branch} 已包含这些更改', '{branch} enthält diese Änderungen bereits'],
  'toast.squashToBranch.failed': ['Squash to branch failed', 'Не удалось сделать сквош в ветку', '压合到分支失败', 'Squash in Branch fehlgeschlagen'],
};

const DOMAIN_FILES = {
  history: 'src/i18n/locales/domains/history.ts',
  dialogs: 'src/i18n/locales/domains/dialogs.ts',
  toast: 'src/i18n/locales/domains/toasts.ts',
};
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
  const marker = lines[2] ? lines[2].slice(0, 60) : '';
  if (marker && block.includes(marker)) return src; // already patched
  return src.slice(0, end) + '\n' + lines.join('\n') + src.slice(end);
}

const byDomain = {};
for (const [key, values] of Object.entries(NEW_KEYS)) {
  const prefix = key.split('.')[0];
  (byDomain[prefix] ??= []).push([key, values]);
}

let touched = 0;
for (const [prefix, entries] of Object.entries(byDomain)) {
  const file = DOMAIN_FILES[prefix];
  if (!file) { console.error('NO DOMAIN FILE for', prefix); continue; }
  for (const [i, loc] of LOCALES.entries()) {
    const lines = ['', '  // ── squash-to-branch (History multi-selection) ──'].concat(
      entries.map(([key, values]) => `  '${key}': '${esc(values[i])}',`)
    );
    const src = fs.readFileSync(file, 'utf8');
    const out = insertIntoDict(src, loc, lines);
    if (out !== src) { fs.writeFileSync(file, out); touched++; }
  }
}
console.log('dict blocks patched:', touched);
