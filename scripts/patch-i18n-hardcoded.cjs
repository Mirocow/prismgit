/**
 * i18n hardcode sweep — adds keys for the previously HARDCODED UI strings
 * (tooltips/labels that ignored the active locale) in all four dictionaries.
 * The matching code edits are done by hand in the same change set.
 *
 * Run: node scripts/patch-i18n-hardcoded.cjs
 */
const fs = require('fs');

const NEW_KEYS = {
  // ── core (common.* / toolbar.*) — flat per-locale files ──
  'common.noRows': ['No rows', 'Нет записей', '暂无数据', 'Keine Zeilen'],
  'common.dismissNotification': ['Dismiss notification', 'Закрыть уведомление', '关闭通知', 'Benachrichtigung schließen'],
  'common.copyCode': ['Copy code', 'Копировать код', '复制代码', 'Code kopieren'],
  'common.apiKeySaved': ['API key saved', 'API-ключ сохранён', 'API 密钥已保存', 'API-Schlüssel gespeichert'],
  'common.loadingEllipsis': ['Loading...', 'Загрузка...', '加载中…', 'Lädt...'],
  'toolbar.stageAllTooltip': ['Stage all changes', 'Индексировать все изменения', '暂存所有更改', 'Alle Änderungen stagen'],

  // ── history ──
  'history.syncNoUpstreamHint': ['No upstream — push -u to set tracking', 'Нет upstream — выполните push -u, чтобы связать', '无上游分支——执行 push -u 设置跟踪', 'Kein Upstream — mit push -u das Tracking setzen'],
  'history.syncNoUpstream': ['No upstream', 'Нет upstream', '无上游分支', 'Kein Upstream'],
  'history.syncUpstreamGone': ['Upstream gone', 'Upstream удалён', '上游分支已删除', 'Upstream entfernt'],
  'history.syncInSync': ['In sync with {ref}', 'Синхронизировано с {ref}', '与 {ref} 同步', 'Synchron mit {ref}'],
  'history.syncInSyncShort': ['In sync', 'Синхронизировано', '已同步', 'Synchron'],
  'history.syncOutOfSync': ['Out of sync', 'Не синхронизировано', '未同步', 'Nicht synchron'],
  'history.ttActiveFilters': ['Active filters', 'Активные фильтры', '生效的筛选', 'Aktive Filter'],
  'history.ttClearFileFilter': ['Clear file filter', 'Сбросить фильтр файлов', '清除文件筛选', 'Dateifilter löschen'],
  'history.ttShowMyCommits': ['Show only my commits', 'Только мои коммиты', '只显示我的提交', 'Nur meine Commits zeigen'],
  'history.ttShowMerges': ['Show only merge commits', 'Только merge-коммиты', '只显示合并提交', 'Nur Merge-Commits zeigen'],
  'history.ttToggleGraph': ['Toggle graph', 'Вкл/выкл граф', '切换图形', 'Graph ein-/ausschalten'],
  'history.ttRefresh': ['Refresh', 'Обновить', '刷新', 'Aktualisieren'],
  'history.ttSelectCommit': ['Select a commit', 'Выберите коммит', '选择一个提交', 'Commit auswählen'],
  'history.ttAllBranches': ['All branches', 'Все ветки', '所有分支', 'Alle Branches'],
  'history.ttParents': ['Parents', 'Родители', '父提交', 'Parents'],
  'history.ttIncoming': ['{n} incoming commit(s) — exist on remote but not yet pulled', '{n} входящих коммитов — есть на remote, но ещё не загружены', '{n} 个传入提交——存在于远程但尚未拉取', '{n} eingehende Commits — liegen am Remote, wurden aber noch nicht gepullt'],
  'history.branchNameLabel': ['Branch name', 'Имя ветки', '分支名称', 'Branch-Name'],
  'history.branchCheckoutAfter': ['Checkout after creation', 'Переключиться после создания', '创建后检出', 'Nach dem Erstellen auschecken'],
  'history.branchStartsAt': ['Branch will start from this commit.', 'Ветка начнётся с этого коммита.', '分支将从此提交开始。', 'Der Branch beginnt bei diesem Commit.'],
  'history.splitOffTitle': ['Split Off Files Into New Commit', 'Вынести файлы в отдельный коммит', '将文件拆分为新提交', 'Dateien in einen neuen Commit abspalten'],
  'history.splitOffMessageLabel': ['Message for the new commit', 'Сообщение для нового коммита', '新提交的提交信息', 'Nachricht für den neuen Commit'],
  'history.loadingFiles': ['Loading files...', 'Загрузка файлов...', '加载文件…', 'Dateien werden geladen...'],
  'history.authorPlaceholder': ['name or email', 'имя или email', '姓名或邮箱', 'Name oder E-Mail'],

  // ── conflict / merge panels ──
  'conflict.mergePanelTakeOurs': ['Take ours (git checkout --ours)', 'Взять ours (git checkout --ours)', '采用我们的版本（git checkout --ours）', 'Take ours (git checkout --ours)'],
  'conflict.mergePanelTakeTheirs': ['Take theirs (git checkout --theirs)', 'Взять theirs (git checkout --theirs)', '采用他们的版本（git checkout --theirs）', 'Take theirs (git checkout --theirs)'],
  'conflict.basePaneLabel': ['Base (common ancestor):', 'База (общий предок):', '基准（共同祖先）：', 'Basis (gemeinsamer Vorfahre):'],
  'conflict.resultPaneTitle': ['Working Tree (Result)', 'Рабочее дерево (результат)', '工作区（结果）', 'Arbeitsverzeichnis (Ergebnis)'],
  'conflict.clearBlockAndEdit': ['Clear block and edit manually', 'Очистить блок и править вручную', '清除冲突块并手动编辑', 'Block leeren und manuell bearbeiten'],
  'conflict.undoLastResolution': ['Undo last resolution (⌘Z)', 'Отменить последнее разрешение (⌘Z)', '撤销上一次解决（⌘Z）', 'Letzte Auflösung rückgängig (⌘Z)'],
  'conflict.resetAll': ['Reset all', 'Сбросить всё', '全部重置', 'Alles zurücksetzen'],
  'conflict.toggleBasePane': ['Show / hide the base (common ancestor) pane', 'Показать/скрыть панель базы (общий предок)', '显示/隐藏基准（共同祖先）窗格', 'Basis-Bereich (gemeinsamer Vorfahre) ein-/ausblenden'],
  'conflict.moreActions': ['More actions', 'Ещё действия', '更多操作', 'Weitere Aktionen'],
  'conflict.unsavedChanges': ['Unsaved changes', 'Несохранённые изменения', '未保存的更改', 'Ungespeicherte Änderungen'],

  // ── settings (provider chip / model picker) ──
  'settings.providerAutoDetect': ['Auto-detect from remote URL', 'Автоопределение по URL remote', '从远程 URL 自动检测', 'Automatisch aus der Remote-URL erkennen'],
  'settings.providerAutoDetectHint': ['Re-scan the remote URL and pick the provider automatically', 'Пересканировать URL remote и выбрать провайдера автоматически', '重新扫描远程 URL 并自动选择提供商', 'Die Remote-URL neu scannen und den Anbieter automatisch wählen'],
  'settings.aiParamCount': ['Parameter count', 'Число параметров', '参数量', 'Parameteranzahl'],
  'settings.aiFileSize': ['File size on disk', 'Размер на диске', '磁盘占用', 'Dateigröße auf der Festplatte'],
  'settings.aiQuantization': ['Quantization', 'Квантизация', '量化', 'Quantisierung'],
  'settings.aiModelFamily': ['Model family', 'Семейство модели', '模型系列', 'Modellfamilie'],
  'settings.aiModelWarm': ['Model is currently loaded in memory (warm) — responds instantly', 'Модель сейчас загружена в память (warm) — отвечает мгновенно', '模型已加载到内存（热）——即时响应', 'Modell ist aktuell im Speicher geladen (warm) — antwortet sofort'],

  // ── pages ──
  'pages.currentBranchHead': ['Current branch (HEAD)', 'Текущая ветка (HEAD)', '当前分支（HEAD）', 'Aktueller Branch (HEAD)'],
  'pages.upstreamDeletedWarning': ['Upstream branch was deleted on the remote. Pull will fail — Push to recreate it, or set a new tracked branch.', 'Ветка upstream удалена на remote. Pull не сработает — отправьте Push, чтобы воссоздать её, или укажите новую отслеживаемую ветку.', '上游分支已在远程删除。Pull 将失败——请 Push 重新创建，或设置新的跟踪分支。', 'Der Upstream-Branch wurde im Remote gelöscht. Pull schlägt fehl — mit Push neu erstellen oder einen neuen getrackten Branch setzen.'],
};

const DOMAIN_FILES = {
  history: 'src/i18n/locales/domains/history.ts',
  conflict: 'src/i18n/locales/domains/conflict.ts',
  settings: 'src/i18n/locales/domains/settings.ts',
  pages: 'src/i18n/locales/domains/pages.ts',
};
const CORE_FILES = { en: 'src/i18n/locales/en.ts', ru: 'src/i18n/locales/ru.ts', zh: 'src/i18n/locales/zh.ts', de: 'src/i18n/locales/de.ts' };
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
  const marker = lines.length > 2 ? lines[2].slice(0, 60) : lines[lines.length - 1].slice(0, 60);
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
  if (prefix === 'common' || prefix === 'toolbar') {
    for (const [i, loc] of LOCALES.entries()) {
      const file = CORE_FILES[loc];
      const lines = ['', '  // ── v3.4 hardcoded-string sweep ──'].concat(
        entries.filter(([k]) => k.startsWith(prefix + '.')).map(([key, values]) => `  '${key}': '${esc(values[i])}',`)
      );
      if (lines.length <= 2) continue;
      const src = fs.readFileSync(file, 'utf8');
      const out = insertIntoDict(src, loc, lines);
      if (out !== src) { fs.writeFileSync(file, out); touched++; }
    }
    continue;
  }
  const file = DOMAIN_FILES[prefix];
  if (!file) { console.error('NO DOMAIN FILE for', prefix); continue; }
  for (const [i, loc] of LOCALES.entries()) {
    const lines = ['', '  // ── v3.4 hardcoded-string sweep ──'].concat(
      entries.map(([key, values]) => `  '${key}': '${esc(values[i])}',`)
    );
    const src = fs.readFileSync(file, 'utf8');
    const out = insertIntoDict(src, loc, lines);
    if (out !== src) { fs.writeFileSync(file, out); touched++; }
  }
}
console.log('dict blocks patched:', touched);
