/**
 * i18n completion patch — adds the 85 keys that were USED IN CODE but
 * missing from the dictionaries (they fell back to the raw key or an
 * inline defaultValue, so ru/zh/de showed English).
 *
 * Inserts into the right domain file per key prefix, in all four locale
 * dicts, right before each dict's closing `};`.
 *
 * Run: node scripts/patch-i18n-keys.cjs
 */
const fs = require('fs');
const path = require('path');

// key -> [en, ru, zh, de]
const NEW_KEYS = {
  // ── branches ──
  'branches.deleteConfirmTitle': ['Delete branch \'{name}\'', 'Удалить ветку \'{name}\'', '删除分支 \'{name}\'', 'Branch \'{name}\' löschen'],
  'branches.deleteConfirmMessage': ['This removes the branch pointer. Commits reachable from other branches or HEAD are not affected.', 'Указатель ветки будет удалён. Коммиты, достижимые из других веток или HEAD, не затрагиваются.', '这将移除分支指针。可从其他分支或 HEAD 访问的提交不受影响。', 'Der Branch-Zeiger wird entfernt. Commits, die von anderen Branches oder HEAD erreichbar sind, bleiben unberührt.'],
  'branches.deleteRemoteConfirmTitle': ['Delete remote branch \'{name}\'', 'Удалить удалённую ветку \'{name}\'', '删除远程分支 \'{name}\'', 'Remote-Branch \'{name}\' löschen'],
  'branches.deleteRemoteConfirmMessage': ['The branch is deleted on the remote. Commits stay in your local repository.', 'Ветка будет удалена на remote. Коммиты останутся в локальном репозитории.', '该分支将在远程删除。提交仍保留在本地仓库中。', 'Der Branch wird im Remote gelöscht. Commits bleiben im lokalen Repository.'],
  'branches.deleteTagTitle': ['Delete tag \'{name}\'', 'Удалить тег \'{name}\'', '删除标签 \'{name}\'', 'Tag \'{name}\' löschen'],
  'branches.deleteTagMessage': ['This permanently removes the tag reference. The tagged commit is not affected.', 'Ссылка на тег будет удалена навсегда. Помеченный коммит не затрагивается.', '这将永久移除标签引用。被标记的提交不受影响。', 'Die Tag-Referenz wird dauerhaft entfernt. Der getaggte Commit bleibt unberührt.'],
  'branches.pushTagTitle': ['Push tag \'{name}\'', 'Отправить тег \'{name}\'', '推送标签 \'{name}\'', 'Tag \'{name}\' pushen'],
  'branches.pushTagMessage': ['Push the tag to its remote?', 'Отправить тег на remote?', '将该标签推送到远程？', 'Den Tag zum Remote pushen?'],
  'branches.pushBlockedHint': ['Blocked while a merge/rebase/cherry-pick is in progress', 'Недоступно, пока идёт merge/rebase/cherry-pick', '已有 merge/rebase/cherry-pick 进行中，暂被阻止', 'Blockiert, solange ein Merge/Rebase/Cherry-pick läuft'],
  'branches.upstreamGroup': ['Upstream', 'Upstream (отслеживание)', '上游分支', 'Upstream'],
  // ── changes ──
  'changes.expandAllFolders': ['Expand all folders', 'Развернуть все папки', '展开全部文件夹', 'Alle Ordner ausklappen'],
  'changes.collapseAllFolders': ['Collapse all folders', 'Свернуть все папки', '折叠全部文件夹', 'Alle Ordner einklappen'],
  'changes.clearFolderScope': ['Clear folder scope (show all files)', 'Сбросить область папки (показать все файлы)', '清除文件夹范围（显示全部文件）', 'Ordnerbereich löschen (alle Dateien zeigen)'],
  // ── core common ──
  'common.lines': ['lines', 'строк', '行', 'Zeilen'],
  'common.load': ['Load', 'Загрузить', '加载', 'Laden'],
  'common.settings': ['Settings', 'Настройки', '设置', 'Einstellungen'],
  // ── history ──
  'history.filterPlaceholder': ['Filter commits...', 'Фильтр коммитов...', '筛选提交…', 'Commits filtern...'],
  // ── pages ──
  'pages.branchCreatedName': ['Branch \'{name}\' created', 'Ветка \'{name}\' создана', '分支 \'{name}\' 已创建', 'Branch \'{name}\' erstellt'],
  'pages.branchCreatedAtDetail': ['Points at {hash}', 'Указывает на {hash}', '指向 {hash}', 'Zeigt auf {hash}'],
  'pages.cherryPickBlocked': ['Cherry-pick blocked', 'Cherry-pick недоступен', '无法执行 cherry-pick', 'Cherry-pick blockiert'],
  'pages.cherryPickBlockedDetail': ['A merge, rebase or cherry-pick is already in progress. Finish or abort it first.', 'Уже идёт merge, rebase или cherry-pick. Сначала завершите или прервите его.', '已有 merge、rebase 或 cherry-pick 进行中。请先完成或中止。', 'Ein Merge, Rebase oder Cherry-pick läuft bereits. Beenden oder brechen Sie ihn zuerst ab.'],
  'pages.cherryPickEmptyHint': ['Nothing to cherry-pick from {hash}', 'Нечего cherry-pick из {hash}', '没有可从 {hash} 摘取的提交', 'Nichts aus {hash} zu übernehmen'],
  'pages.cherryPickEmptyStateDetail': ['No commits are marked for cherry-pick. Select commits and try again.', 'Нет коммитов, помеченных для cherry-pick. Выберите коммиты и попробуйте снова.', '没有标记为 cherry-pick 的提交。请选择提交后重试。', 'Keine Commits für den Cherry-pick markiert. Commits auswählen und erneut versuchen.'],
  'pages.colHash': ['Hash', 'Хеш', '哈希', 'Hash'],
  'pages.colSubject': ['Subject', 'Описание', '主题', 'Betreff'],
  'pages.colSource': ['Source', 'Источник', '来源', 'Quelle'],
  'pages.colDate': ['Date', 'Дата', '日期', 'Datum'],
  'pages.invalidBranchName': ['Invalid branch name', 'Недопустимое имя ветки', '无效的分支名', 'Ungültiger Branch-Name'],
  'pages.invalidBranchNameWs': ['Branch names cannot contain spaces', 'Имя ветки не может содержать пробелы', '分支名不能包含空格', 'Branch-Namen dürfen keine Leerzeichen enthalten'],
  'pages.invalidBranchNameDash': ['Branch names cannot start or end with a dash', 'Имя ветки не может начинаться или заканчиваться дефисом', '分支名不能以连字符开头或结尾', 'Branch-Namen dürfen nicht mit einem Bindestrich beginnen oder enden'],
  'pages.recyclableBranchAt': ['Branch was at {hash}', 'Ветка была на {hash}', '分支曾指向 {hash}', 'Branch war bei {hash}'],
  'pages.recyclableBranchCreate': ['Create branch', 'Создать ветку', '创建分支', 'Branch erstellen'],
  'pages.recyclableBranchPromptDetail': ['Enter a name for the new branch restored from the recycle bin.', 'Введите имя для новой ветки, восстановленной из корзины.', '为从回收站恢复的新分支输入名称。', 'Namen für den aus dem Papierkorb wiederhergestellten Branch eingeben.'],
  'pages.recyclableExpiredDetail': ['{count} commits may be lost — they are only reachable from the reflog.', '{count} коммитов могут быть потеряны — они достижимы только из reflog.', '{count} 个提交可能丢失——只能通过 reflog 访问。', '{count} Commits können verloren gehen — sie sind nur über das Reflog erreichbar.'],
  'pages.glNotConnected': ['Not connected to GitLab', 'Нет подключения к GitLab', '未连接到 GitLab', 'Nicht mit GitLab verbunden'],
  'pages.glNotConnectedHint': ['Open the Clone dialog → GitLab tab, or Settings → Integrations, to authenticate with a GitLab personal access token.', 'Откройте диалог клонирования → вкладку GitLab или Настройки → Интеграции, чтобы авторизоваться с личным токеном доступа GitLab.', '打开克隆对话框 → GitLab 标签页，或设置 → 集成，使用 GitLab 个人访问令牌进行身份验证。', 'Öffnen Sie den Klon-Dialog → GitLab-Tab oder Einstellungen → Integrationen, um sich mit einem GitLab-Zugriffstoken zu authentifizieren.'],
  'pages.prAllCommits': ['All commits', 'Все коммиты', '所有提交', 'Alle Commits'],
  'pages.prAnalyzeAI': ['AI Review', 'ИИ-обзор', 'AI 审查', 'KI-Review'],
  'pages.prAnalyzeWithAI': ['Analyze this PR with AI Assistant', 'Проанализировать этот PR с ИИ-ассистентом', '使用 AI 助手分析此 PR', 'Diesen PR mit dem KI-Assistenten analysieren'],
  'pages.prClickCommitForDiff': ['Click to view changes in this commit', 'Нажмите, чтобы посмотреть изменения в этом коммите', '点击查看此提交中的更改', 'Klicken, um die Änderungen dieses Commits anzusehen'],
  'pages.prCloseGitLabUnsupported': ['GitLab MR close is not yet supported — use the GitLab web UI', 'Закрытие MR в GitLab пока не поддерживается — используйте веб-интерфейс GitLab', '暂不支持关闭 GitLab MR — 请使用 GitLab 网页界面', 'GitLab-MR-Schließen wird noch nicht unterstützt — bitte die GitLab-Weboberfläche verwenden'],
  'pages.prComments': ['comments', 'комментариев', '评论', 'Kommentare'],
  'pages.prCommitFilesLoadFailed': ['Failed to load commit files', 'Не удалось загрузить файлы коммита', '加载提交文件失败', 'Commit-Dateien konnten nicht geladen werden'],
  'pages.prCommits': ['commits', 'коммитов', '提交', 'Commits'],
  'pages.prFiles': ['files', 'файлов', '文件', 'Dateien'],
  'pages.prFilterByCommit': ['Filter files by commit', 'Фильтровать файлы по коммиту', '按提交筛选文件', 'Dateien nach Commit filtern'],
  'pages.prManualEntry': ['Enter repository path', 'Введите путь к репозиторию', '输入仓库路径', 'Repository-Pfad eingeben'],
  'pages.prManualEntryHint': ['Could not auto-detect owner/repo from the remote URL. Enter them manually (e.g. myorg/myrepo).', 'Не удалось автоматически определить owner/repo из URL remote. Введите вручную (например, myorg/myrepo).', '无法从远程 URL 自动检测 owner/repo。请手动输入（例如 myorg/myrepo）。', 'Owner/repo konnte nicht automatisch aus der Remote-URL erkannt werden. Bitte manuell eingeben (z. B. myorg/myrepo).'],
  'pages.prNoFilesInCommit': ['No file changes found for this commit.', 'Для этого коммита не найдено изменений файлов.', '未找到此提交的文件更改。', 'Für diesen Commit wurden keine Dateiänderungen gefunden.'],
  'pages.prProviderNotDetected': ['Repository provider not detected', 'Провайдер репозитория не определён', '未检测到仓库提供商', 'Repository-Anbieter nicht erkannt'],
  'pages.prProviderNotDetectedHint': ['Click the provider chip in the header (top-left) and choose GitHub or GitLab. Only those two have API integrations wired.', 'Нажмите на чип провайдера в шапке (слева вверху) и выберите GitHub или GitLab. Только для них подключена интеграция.', '点击页眉（左上角）的提供商徽章并选择 GitHub 或 GitLab。目前仅为这两家接入了集成。', 'Klicken Sie auf den Anbieter-Chip in der Kopfzeile (oben links) und wählen Sie GitHub oder GitLab. Nur für diese beiden ist die API-Integration eingerichtet.'],
  'pages.pushButtonTitle': ['Pull the current branch from its remote', 'Загрузить (pull) текущую ветку с remote', '从远程拉取当前分支', 'Den aktuellen Branch vom Remote pullen'],
  'pages.reviewsGithubNotAuthed': ['Connect to GitHub first (Settings → Integrations)', 'Сначала подключите GitHub (Настройки → Интеграции)', '请先连接 GitHub（设置 → 集成）', 'Zuerst mit GitHub verbinden (Einstellungen → Integrationen)'],
  'pages.reviewsGitlabNotesUnsupported': ['GitLab MR note import is not yet available — use the GitLab web UI to view MR comments', 'Импорт комментариев GitLab MR пока недоступен — смотрите комментарии в веб-интерфейсе GitLab', 'GitLab MR 评论导入暂不可用 — 请在 GitLab 网页界面查看评论', 'Der GitLab-MR-Kommentarimport ist noch nicht verfügbar — MR-Kommentare in der GitLab-Weboberfläche ansehen'],
  'pages.reviewsImportFailed': ['Failed to import PR comments', 'Не удалось импортировать комментарии PR', '导入 PR 评论失败', 'PR-Kommentare konnten nicht importiert werden'],
  'pages.reviewsImported': ['Imported {count} review comments from PR #{pr}', 'Импортировано {count} комментариев обзора из PR #{pr}', '已从 PR #{pr} 导入 {count} 条审查评论', '{count} Review-Kommentare aus PR #{pr} importiert'],
  'pages.reviewsInvalidPRNumber': ['Invalid PR number', 'Неверный номер PR', '无效的 PR 编号', 'Ungültige PR-Nummer'],
  'pages.reviewsLoadFromPR': ['From PR', 'Из PR', '来自 PR', 'Aus PR'],
  'pages.reviewsLoadFromPRMessage': ['Enter the PR/MR number:', 'Введите номер PR/MR:', '输入 PR/MR 编号：', 'PR/MR-Nummer eingeben:'],
  'pages.reviewsLoadFromPRTitle': ['Load review comments from Pull Request', 'Загрузить комментарии обзора из Pull Request', '从 Pull Request 加载审查评论', 'Review-Kommentare aus dem Pull Request laden'],
  'pages.reviewsNoProvider': ['Repository is not hosted on GitHub/GitLab', 'Репозиторий размещён не на GitHub/GitLab', '仓库未托管在 GitHub/GitLab 上', 'Repository ist nicht auf GitHub/GitLab gehostet'],
  // ── settings ──
  'settings.aiGridSearchModels': ['Search models...', 'Поиск моделей...', '搜索模型…', 'Modelle suchen...'],
  'settings.aiGridNoMatch': ['No models match', 'Нет подходящих моделей', '没有匹配的模型', 'Keine passenden Modelle'],
  'settings.commitGraphHint': ['Write commit-graph cache after fetch — speeds up git log, blame, and history graph traversal by 40-60%.', 'Записывать кэш commit-graph после fetch — ускоряет git log, blame и обход графа истории на 40-60%.', 'fetch 后写入 commit-graph 缓存——将 git log、blame 和历史图遍历提速 40-60%。', 'Commit-Graph-Cache nach Fetch schreiben — beschleunigt git log, blame und das Durchlaufen des Historiengraphen um 40-60%.'],
  'settings.fsmonitorHint': ['FileSystem Monitor — git tracks changed files without scanning the whole tree. Massive speedup on repos with 100k+ files.', 'FileSystem Monitor — git отслеживает изменённые файлы без сканирования всего дерева. Огромное ускорение на репозиториях со 100k+ файлов.', '文件系统监视器——git 无需扫描整个文件树即可跟踪更改。在含 10 万+ 文件的仓库中提速显著。', 'FileSystem-Monitor — git verfolgt geänderte Dateien, ohne den ganzen Baum zu scannen. Enorme Beschleunigung bei Repositories mit 100k+ Dateien.'],
  'settings.gitPerformance': ['Git Performance', 'Производительность Git', 'Git 性能', 'Git-Performance'],
  'settings.gitPerformanceHint': ['These settings are applied globally via env override and affect ALL repositories. They are the same as running the git config commands manually, but without modifying your --global config.', 'Эти настройки применяются глобально через переменные окружения и действуют на ВСЕ репозитории. Эквивалентны ручным git config, но не меняют ваш --global конфиг.', '这些设置通过环境变量全局应用，影响所有仓库。效果等同于手动执行 git config 命令，但不会修改 --global 配置。', 'Diese Einstellungen werden global über Umgebungsvariablen angewendet und betreffen ALLE Repositories. Sie entsprechen manuellen git-config-Befehlen, ändern aber nicht Ihre --global-Konfiguration.'],
  'settings.gitlab': ['GitLab', 'GitLab', 'GitLab', 'GitLab'],
  'settings.gitlabAuthFailed': ['GitLab authentication failed', 'Не удалось авторизоваться в GitLab', 'GitLab 身份验证失败', 'GitLab-Authentifizierung fehlgeschlagen'],
  'settings.gitlabAuthenticatePat': ['Authenticate with a GitLab Personal Access Token', 'Авторизация с личным токеном доступа GitLab', '使用 GitLab 个人访问令牌进行身份验证', 'Mit einem GitLab-Zugriffstoken authentifizieren'],
  'settings.gitlabBaseUrlTitle': ['GitLab instance URL — https://gitlab.com for cloud, or your self-hosted URL', 'URL инстанса GitLab — https://gitlab.com для облачного или ваш self-hosted URL', 'GitLab 实例 URL——云托管用 https://gitlab.com，或自建 URL', 'GitLab-Instanz-URL — https://gitlab.com für die Cloud oder Ihre self-hosted-URL'],
  'settings.gitlabConnected': ['Connected to GitLab as {user}', 'Подключено к GitLab как {user}', '已连接到 GitLab，用户 {user}', 'Mit GitLab verbunden als {user}'],
  'settings.gitlabCreateTokenAt': ['Create a token at', 'Создать токен:', '在此创建令牌：', 'Token erstellen unter'],
  'settings.gitlabDisconnected': ['Disconnected from GitLab', 'Отключено от GitLab', '已断开与 GitLab 的连接', 'Von GitLab getrennt'],
  'settings.gitlabTokenRequired': ['GitLab personal access token is required', 'Требуется личный токен доступа GitLab', '需要 GitLab 个人访问令牌', 'Ein GitLab-Zugriffstoken ist erforderlich'],
  'settings.gitlabWithScopes': ['with scopes', 'со скоупами', '含权限范围', 'mit Berechtigungen'],
  'settings.manyFilesHint': ['Optimize index for repos with many files (index v4, reduced traversal). Speeds up git status by 30-50%.', 'Оптимизировать индекс для репозиториев со множеством файлов (index v4, сокращённый обход). Ускоряет git status на 30-50%.', '为含大量文件的仓库优化索引（index v4，减少遍历）。git status 提速 30-50%。', 'Index für Repositories mit vielen Dateien optimieren (Index v4, reduzierte Traversierung). Beschleunigt git status um 30-50%.'],
  'settings.testConnection': ['Test', 'Проверить', '测试', 'Testen'],
  'settings.testConnectionFailed': ['Connection test failed', 'Проверка соединения не удалась', '连接测试失败', 'Verbindungstest fehlgeschlagen'],
  'settings.testConnectionGithubOk': ['Authenticated as {login} ({name})', 'Авторизован как {login} ({name})', '已认证为 {login}（{name}）', 'Authentifiziert als {login} ({name})'],
  'settings.testConnectionGitlabOk': ['Authenticated — {count} projects accessible', 'Авторизовано — доступно проектов: {count}', '已认证——可访问 {count} 个项目', 'Authentifiziert — {count} Projekte zugreifbar'],
  'settings.testConnectionNotAuthed': ['Connect to GitHub first, then test the connection', 'Сначала подключите GitHub, затем проверьте соединение', '请先连接 GitHub，再测试连接', 'Zuerst mit GitHub verbinden, dann die Verbindung testen'],
  'settings.testConnectionOk': ['Connection OK', 'Соединение установлено', '连接正常', 'Verbindung OK'],
  'settings.testConnectionTooltip': ['Verify the GitHub token still works (calls /user)', 'Проверить, работает ли токен GitHub (вызов /user)', '验证 GitHub 令牌是否仍有效（调用 /user）', 'Prüfen, ob das GitHub-Token noch funktioniert (Aufruf von /user)'],
  // ── stashes ──
  'stashes.restoreGroup': ['Restore', 'Восстановить', '恢复', 'Wiederherstellen'],
};

// key prefix -> file (domain modules carry all four dicts inline)
const DOMAIN_FILES = {
  branches: 'src/i18n/locales/domains/branches.ts',
  changes: 'src/i18n/locales/domains/changes.ts',
  history: 'src/i18n/locales/domains/history.ts',
  pages: 'src/i18n/locales/domains/pages.ts',
  settings: 'src/i18n/locales/domains/settings.ts',
  stashes: 'src/i18n/locales/domains/stashes.ts',
};
// core common.* lives in the flat per-locale files
const CORE_FILES = { en: 'src/i18n/locales/en.ts', ru: 'src/i18n/locales/ru.ts', zh: 'src/i18n/locales/zh.ts', de: 'src/i18n/locales/de.ts' };

const LOCALES = ['en', 'ru', 'zh', 'de'];
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Insert `lines` before the closing `};` of `export const <loc>` dict in src. */
function insertIntoDict(src, loc, lines) {
  // Find the dict start, then the first "\n};" after it.
  const re = new RegExp(`(export const ${loc}[^\\n]*\\{\\n)`);
  const m = src.match(re);
  if (!m) throw new Error(`dict ${loc} not found`);
  const start = m.index + m[0].length;
  const end = src.indexOf('\n};', start);
  if (end < 0) throw new Error(`closing brace of ${loc} not found`);
  const block = src.slice(start, end);
  // Idempotency: check the first REAL key line (lines[2] — after the '' and
  // the comment line), not the leading blank.
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
  if (prefix === 'common') {
    // flat per-locale files — each exports `en`/`ru`/`zh`/`de` respectively
    for (const [i, loc] of LOCALES.entries()) {
      const file = CORE_FILES[loc];
      const lines = ['', '  // ── v3.4 localization completion ──'].concat(
        entries.map(([key, values]) => `  '${key}': '${esc(values[i])}',`)
      );
      const src = fs.readFileSync(file, 'utf8');
      const out = insertIntoDict(src, loc, lines);
      if (out !== src) { fs.writeFileSync(file, out); touched++; }
    }
    continue;
  }
  const file = DOMAIN_FILES[prefix];
  if (!file) { console.error('NO DOMAIN FILE for', prefix); continue; }
  for (const [i, loc] of LOCALES.entries()) {
    const lines = ['', '  // ── v3.4 localization completion ──'].concat(
      entries.map(([key, values]) => `  '${key}': '${esc(values[i])}',`)
    );
    const src = fs.readFileSync(file, 'utf8');
    const out = insertIntoDict(src, loc, lines);
    if (out !== src) { fs.writeFileSync(file, out); touched++; }
  }
}
console.log('dict blocks patched:', touched);
