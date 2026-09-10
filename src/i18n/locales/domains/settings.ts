/**
 * settings domain translations.
 * Sweep owner: this file is the ONLY dictionary for the 'settings' domain —
 * add every new key to ALL FOUR locales (unit tests assert key parity).
 */
export const en: Record<string, string> = {
  // Toasts & handlers
  'settings.failedToLoadGitConfig': 'Failed to load git config',
  'settings.configSetToast': 'Set {key} ({scope})',
  'settings.failedToSetValue': 'Failed to set value',
  'settings.removeConfigEntryTitle': 'Remove config entry',
  "settings.removeConfigConfirm": "Remove '{key}' from {scope} config?",
  'settings.configRemovedToast': 'Removed {key}',
  'settings.failedToUnset': 'Failed to unset',
  'settings.pleaseEnterPat': 'Please enter a PAT',
  'settings.welcomeGithubUser': 'Welcome, {login}!',
  'settings.authFailed': 'Authentication failed',
  'settings.loggedOutGithub': 'Logged out from GitHub',
  'settings.cloneDirUpdated': 'Default clone directory updated',

  // Header & top-level tabs
  'settings.repoSettingsButtonTitle': 'Per-repository settings: remotes, authorization, metadata',
  'settings.repoSettingsButton': 'Repository Settings...',
  'settings.openRepoForProject': 'Open a repository to access Project Settings',

  // Appearance
  'settings.themeDescription': 'Switch between dark and light appearance',
  'settings.lightMode': 'Light',
  'settings.darkMode': 'Dark',
  'settings.languagesHint': 'English, Русский, 中文, Deutsch',
  'settings.contrastHint': 'Softer ↔ punchier. Applied as a live CSS contrast filter on the whole app.',
  'settings.contrastResetTitle': 'Reset to default (100%)',
  'settings.contrastReset': 'Reset',
  'settings.contrastSoft': 'Soft',
  'settings.contrastPunchy': 'Punchy',
  'settings.contrastSliderTitle': 'Drag left for softer appearance, right for punchier colors',
  'settings.contrastPresets': 'Presets:',
  'settings.presetSoft': 'Soft',
  'settings.presetNormal': 'Normal',
  'settings.presetHigh': 'High',
  'settings.presetMax': 'Max',
  'settings.fontSizeBase': 'Font size (base)',
  'settings.fontSizeBaseHint': 'Global base font size in pixels',
  'settings.perAreaFontSizes': 'Per-area font sizes',
  'settings.fontAreaTree': 'File tree',
  'settings.fontAreaLists': 'Commit/branch lists',
  'settings.fontAreaDiff': 'Diff viewer (code)',
  'settings.fontAreaMonospace': 'Monospace (hashes/paths)',
  'settings.fontSizesApplyHint': 'These apply to the respective UI areas immediately.',
  'settings.sidebarWidth': 'Sidebar width',
  'settings.sidebarWidthHint': 'Width in pixels',

  // Git
  'settings.defaultCloneDir': 'Default clone directory',
  'settings.defaultCloneDirHint': 'Where new repositories will be cloned to',
  'settings.notSet': '(not set)',
  'settings.browse': 'Browse',
  'settings.maxHistoryEntries': 'Max history entries',
  'settings.maxHistoryEntriesHint': 'Maximum commits to load in history view',
  'settings.showReflogInHistory': 'Show reflog in history',
  'settings.showReflogHint': 'Include reflog entries in the history view',
  'settings.repoList': 'Repository list',
  'settings.autoRefresh': 'Auto refresh',
  'settings.autoRefreshHint': 'Master switch for automatic repository refreshing. When off, no periodic remote checks happen — the ↓/↑ badges in the repository list stay frozen until you press "Check now".',
  'settings.remoteCheckInterval': 'Remote check interval',
  'settings.remoteCheckIntervalHint': 'How often the sidebar fetches all remotes of every listed repository and shows ↓ incoming / ↑ outgoing badges. Only applies while Auto refresh is on. Minimum 30\u00A0s; set 0 to disable the periodic check (the "Check now" button still works).',
  'settings.secUnit': 'sec',

  // GitHub Integration
  'settings.logout': 'Logout',
  'settings.authenticatePat': 'Authenticate with a Personal Access Token',
  'settings.createTokenAt': 'Create a token at',
  'settings.withScopes': 'with',
  'settings.and': 'and',
  'settings.scopesSuffix': ' scopes.',
  'settings.connect': 'Connect',

  // Repositories
  'settings.knownRepositories': 'Known Repositories ({count})',
  'settings.noReposAdded': 'No repositories added yet.',

  // External Tools (project)
  'settings.diffToolCommand': 'Diff tool command',
  'settings.diffToolSaved': 'Diff tool saved',
  'settings.diffVarsUse': 'Use',
  'settings.diffVarsSuffix': ' variables. Leave empty to use built-in diff viewer.',
  'settings.mergeToolCommand': 'Merge tool command',
  'settings.mergeToolSaved': 'Merge tool saved',
  'settings.variables': 'Variables:',

  // Pull Strategy
  'settings.whenPulling': 'When pulling from remote:',
  'settings.mergeDefault': 'Merge (default)',
  'settings.mergeDesc': 'Creates a merge commit when local and remote have diverged',
  'settings.rebaseDesc': 'Replays local commits on top of remote, linear history',
  'settings.pullStrategyHint': 'This setting applies to the quick Pull button and the Pull dropdown. The dropdown also has per-pull checkboxes for manual override.',

  // Git Config
  'settings.reloadConfig': 'Reload config',
  'settings.filterKeys': 'Filter keys...',
  'settings.noConfigEntries': 'No {scope} config entries',
  'settings.saveEnter': 'Save (Enter)',
  'settings.clickToEdit': 'Click to edit value',
  'settings.emptyValue': '(empty)',
  'settings.removeKeyTitle': 'Remove key (git config --unset)',
  'settings.valuePlaceholder': 'value',
  'settings.configScopeHint': 'Click a value to edit it. Changes apply to the',
  'settings.scopeNoteLocal': ' scope (this repository only).',
  'settings.scopeNoteGlobal': ' scope (your user account).',
  'settings.scopeNoteSystem': ' scope (whole machine).',

  // Commands
  'settings.allowModifyingPushed': 'Allow modifying pushed commits (e.g. forced-push)',
  'settings.allowModifyingPushedHint': 'When enabled, the amend / squash / rebase confirmation for pushed commits becomes a warning instead of a hard block.',
  'settings.detectRenames': 'Detect renames in refresh',
  'settings.detectRenamesHint': 'Pair added + deleted files as renames (git diff --find-renames=50%).',
  'settings.distinguishEol': 'Distinguish between content and EOL-only changes',
  'settings.distinguishEolHint': 'Marks files whose only changes are line-ending differences (CRLF ↔ LF).',
  'settings.autoStash': 'Auto-stash on common commands',
  'settings.autoStashHint': 'Stash local changes before merge/rebase/pull, then pop after.',
  'settings.includeUntrackedStash': 'Include untracked files in stash',
  'settings.includeUntrackedStashHint': 'Passes -u to git stash push — also stashes untracked files.',

  // External Tools (application)
  'settings.extToolsConfigure': 'Configure external tools for opening files, comparing, and conflict solving.',
  'settings.extToolsWrite': 'These write to git config',
  'settings.extToolsCommandHint': 'The actual tool command should be defined in',
  'settings.extToolsSectionsSuffix': ' sections.',

  // Low-Level Properties
  'settings.lowLevelHint': 'Advanced settings stored in',
  'settings.lowLevelRestart': 'Changes apply on next restart.',
  'settings.resetToDefaults': 'Reset to defaults',

  // AI Commit Messages
  'settings.enableAi': 'Enable AI integration',
  'settings.aiHintUse': 'Use',
  'settings.aiHintOr': 'in commit message to generate, or',
  'settings.aiHintWipSuffix': 'for "WIP: <ai message>".',
  'settings.provider': 'Provider',
  'settings.disabledOption': '— Disabled —',
  'settings.aiProviderOllamaLocal': 'Ollama (local)',
  'settings.aiProviderCustom': 'Custom (OpenAI-compatible)',
  'settings.model': 'Model',
  'settings.apiUrl': 'API URL',
  'settings.apiKey': 'API Key',
  'settings.ollamaHint': 'For Ollama (local LLM), leave API Key empty and set URL to',
  'settings.ollamaPullHint': 'The model must already be pulled',
  'settings.customPromptLabel': 'Custom System Prompt (optional — supports',
  'settings.customPromptSuffix': ' template vars)',

  // Force Push Policy
  'settings.policy': 'Policy',
  'settings.forcePushAllow': 'Allow force push on all branches (dangerous)',
  'settings.forcePushFeatureOnly': 'Allow on feature branches only (protect main/master)',
  'settings.forcePushDeny': 'Deny force push globally (safest)',
  'settings.protectedBranchesLabel': 'Protected branches (one glob per line — e.g., main, master, develop, release/*)',
  'settings.forcePushHint': 'When policy is',
  'settings.forcePushHint2': 'force push is rejected on protected branches.',
  'settings.forcePushManualNote': 'SmartGit Manual: thin safety configuration for force push.',

  // CI/CD Integration
  'settings.ciCdHint': 'Configure CI servers to display pipeline status badges in History. GitHub Actions is configured via GitHub PAT (see GitHub Integration above).',

  // Output Panel
  'settings.outputPanel': 'Output Panel',
  'settings.commandLogLimit': 'Command log limit',
  'settings.commandLogLimitHint': "Maximum number of commands shown in the Output panel's Commands tab (default 20)",

  // About
  'settings.version': 'Version',
  'settings.platform': 'Platform',
};

export const ru: Record<string, string> = {
  // Toasts & handlers
  'settings.failedToLoadGitConfig': 'Не удалось загрузить git config',
  'settings.configSetToast': 'Задано {key} ({scope})',
  'settings.failedToSetValue': 'Не удалось установить значение',
  'settings.removeConfigEntryTitle': 'Удалить запись конфигурации',
  "settings.removeConfigConfirm": "Удалить '{key}' из конфигурации {scope}?",
  'settings.configRemovedToast': 'Удалено {key}',
  'settings.failedToUnset': 'Не удалось удалить',
  'settings.pleaseEnterPat': 'Введите личный токен доступа (PAT)',
  'settings.welcomeGithubUser': 'Добро пожаловать, {login}!',
  'settings.authFailed': 'Ошибка аутентификации',
  'settings.loggedOutGithub': 'Выполнен выход из GitHub',
  'settings.cloneDirUpdated': 'Каталог клонирования по умолчанию обновлён',

  // Header & top-level tabs
  'settings.repoSettingsButtonTitle': 'Настройки репозитория: удалённые репозитории, авторизация, метаданные',
  'settings.repoSettingsButton': 'Настройки репозитория...',
  'settings.openRepoForProject': 'Откройте репозиторий, чтобы перейти к настройкам проекта',

  // Appearance
  'settings.themeDescription': 'Переключение между тёмным и светлым оформлением',
  'settings.lightMode': 'Светлая',
  'settings.darkMode': 'Тёмная',
  'settings.languagesHint': 'English, Русский, 中文, Deutsch',
  'settings.contrastHint': 'Мягче ↔ насыщеннее. Применяется как живой CSS-фильтр контрастности ко всему приложению.',
  'settings.contrastResetTitle': 'Сбросить к значению по умолчанию (100%)',
  'settings.contrastReset': 'Сброс',
  'settings.contrastSoft': 'Мягче',
  'settings.contrastPunchy': 'Насыщеннее',
  'settings.contrastSliderTitle': 'Влево — мягче, вправо — насыщеннее цвета',
  'settings.contrastPresets': 'Пресеты:',
  'settings.presetSoft': 'Мягкий',
  'settings.presetNormal': 'Обычный',
  'settings.presetHigh': 'Высокий',
  'settings.presetMax': 'Макс.',
  'settings.fontSizeBase': 'Размер шрифта (базовый)',
  'settings.fontSizeBaseHint': 'Глобальный базовый размер шрифта в пикселях',
  'settings.perAreaFontSizes': 'Размеры шрифта по областям',
  'settings.fontAreaTree': 'Дерево файлов',
  'settings.fontAreaLists': 'Списки коммитов/веток',
  'settings.fontAreaDiff': 'Просмотр diff (код)',
  'settings.fontAreaMonospace': 'Моноширинный (хэши/пути)',
  'settings.fontSizesApplyHint': 'Применяются к соответствующим областям интерфейса сразу.',
  'settings.sidebarWidth': 'Ширина боковой панели',
  'settings.sidebarWidthHint': 'Ширина в пикселях',

  // Git
  'settings.defaultCloneDir': 'Каталог клонирования по умолчанию',
  'settings.defaultCloneDirHint': 'Куда будут клонироваться новые репозитории',
  'settings.notSet': '(не задано)',
  'settings.browse': 'Обзор',
  'settings.maxHistoryEntries': 'Максимум записей истории',
  'settings.maxHistoryEntriesHint': 'Максимум коммитов, загружаемых в истории',
  'settings.showReflogInHistory': 'Показывать reflog в истории',
  'settings.showReflogHint': 'Включать записи reflog в просмотр истории',
  'settings.repoList': 'Список репозиториев',
  'settings.autoRefresh': 'Автообновление',
  'settings.autoRefreshHint': 'Главный выключатель автоматического обновления репозиториев. Когда выключено, периодические проверки удалённых репозиториев не выполняются — значки ↓/↑ в списке репозиториев замирают, пока вы не нажмёте «Проверить сейчас».',
  'settings.remoteCheckInterval': 'Интервал проверки удалённых репозиториев',
  'settings.remoteCheckIntervalHint': 'Как часто боковая панель загружает все remote каждого репозитория и показывает значки ↓ входящих / ↑ исходящих. Действует только при включённом автообновлении. Минимум 30\u00A0с; установите 0, чтобы отключить периодическую проверку (кнопка «Проверить сейчас» продолжает работать).',
  'settings.secUnit': 'с',

  // GitHub Integration
  'settings.logout': 'Выйти',
  'settings.authenticatePat': 'Войдите с помощью личного токена доступа (PAT)',
  'settings.createTokenAt': 'Создайте токен на',
  'settings.withScopes': 'со скоупами',
  'settings.and': 'и',
  'settings.scopesSuffix': '.',
  'settings.connect': 'Подключить',

  // Repositories
  'settings.knownRepositories': 'Известные репозитории ({count})',
  'settings.noReposAdded': 'Репозитории ещё не добавлены.',

  // External Tools (project)
  'settings.diffToolCommand': 'Команда diff-инструмента',
  'settings.diffToolSaved': 'Diff-инструмент сохранён',
  'settings.diffVarsUse': 'Используйте',
  'settings.diffVarsSuffix': ' переменные. Оставьте пустым, чтобы использовать встроенный просмотр diff.',
  'settings.mergeToolCommand': 'Команда merge-инструмента',
  'settings.mergeToolSaved': 'Merge-инструмент сохранён',
  'settings.variables': 'Переменные:',

  // Pull Strategy
  'settings.whenPulling': 'При извлечении из удалённого репозитория:',
  'settings.mergeDefault': 'Merge (по умолчанию)',
  'settings.mergeDesc': 'Создаёт merge-коммит, когда локальная и удалённая истории разошлись',
  'settings.rebaseDesc': 'Повторяет локальные коммиты поверх удалённой ветки, линейная история',
  'settings.pullStrategyHint': 'Эта настройка применяется к быстрой кнопке Pull и выпадающему списку Pull. В списке также есть флажки для ручного переопределения каждого извлечения.',

  // Git Config
  'settings.reloadConfig': 'Перечитать конфигурацию',
  'settings.filterKeys': 'Фильтр ключей...',
  'settings.noConfigEntries': 'Нет записей конфигурации {scope}',
  'settings.saveEnter': 'Сохранить (Enter)',
  'settings.clickToEdit': 'Нажмите, чтобы изменить значение',
  'settings.emptyValue': '(пусто)',
  'settings.removeKeyTitle': 'Удалить ключ (git config --unset)',
  'settings.valuePlaceholder': 'значение',
  'settings.configScopeHint': 'Нажмите на значение, чтобы изменить его. Изменения применяются к области',
  'settings.scopeNoteLocal': ' (только этот репозиторий).',
  'settings.scopeNoteGlobal': ' (ваша учётная запись).',
  'settings.scopeNoteSystem': ' (вся машина).',

  // Commands
  'settings.allowModifyingPushed': 'Разрешать изменение отправленных коммитов (например, forced-push)',
  'settings.allowModifyingPushedHint': 'Если включено, подтверждение amend / squash / rebase для отправленных коммитов становится предупреждением вместо жёсткой блокировки.',
  'settings.detectRenames': 'Определять переименования при обновлении',
  'settings.detectRenamesHint': 'Объединяет добавленные и удалённые файлы в переименования (git diff --find-renames=50%).',
  'settings.distinguishEol': 'Различать изменения содержимого и только концов строк',
  'settings.distinguishEolHint': 'Помечает файлы, у которых отличаются только концы строк (CRLF ↔ LF).',
  'settings.autoStash': 'Автосташ при типовых командах',
  'settings.autoStashHint': 'Прячет локальные изменения перед merge/rebase/pull и восстанавливает после.',
  'settings.includeUntrackedStash': 'Включать неотслеживаемые файлы в stash',
  'settings.includeUntrackedStashHint': 'Передаёт -u в git stash push — неотслеживаемые файлы тоже прячутся.',

  // External Tools (application)
  'settings.extToolsConfigure': 'Настройте внешние инструменты для открытия файлов, сравнения и разрешения конфликтов.',
  'settings.extToolsWrite': 'Эти значения записываются в git config',
  'settings.extToolsCommandHint': 'Сама команда инструмента должна быть определена в',
  'settings.extToolsSectionsSuffix': ' секциях.',

  // Low-Level Properties
  'settings.lowLevelHint': 'Расширенные настройки хранятся в',
  'settings.lowLevelRestart': 'Изменения вступают в силу после перезапуска.',
  'settings.resetToDefaults': 'Сбросить к значениям по умолчанию',

  // AI Commit Messages
  'settings.enableAi': 'Включить интеграцию с ИИ',
  'settings.aiHintUse': 'Используйте',
  'settings.aiHintOr': 'в сообщении коммита для генерации, или',
  'settings.aiHintWipSuffix': 'для "WIP: <ai message>".',
  'settings.provider': 'Провайдер',
  'settings.disabledOption': '— Отключено —',
  'settings.aiProviderOllamaLocal': 'Ollama (локально)',
  'settings.aiProviderCustom': 'Свой (совместимый с OpenAI)',
  'settings.model': 'Модель',
  'settings.apiUrl': 'API URL',
  'settings.apiKey': 'API-ключ',
  'settings.ollamaHint': 'Для Ollama (локальной LLM) оставьте API-ключ пустым и укажите URL',
  'settings.ollamaPullHint': 'Модель должна быть предварительно скачана',
  'settings.customPromptLabel': 'Свой системный промпт (необязательно — поддерживаются переменные',
  'settings.customPromptSuffix': ')',

  // Force Push Policy
  'settings.policy': 'Политика',
  'settings.forcePushAllow': 'Разрешить force push для всех веток (опасно)',
  'settings.forcePushFeatureOnly': 'Разрешить только для feature-веток (защита main/master)',
  'settings.forcePushDeny': 'Запретить force push глобально (безопаснее всего)',
  'settings.protectedBranchesLabel': 'Защищённые ветки (один glob в строке — например, main, master, develop, release/*)',
  'settings.forcePushHint': 'Когда выбрана политика',
  'settings.forcePushHint2': 'force push на защищённые ветки отклоняется.',
  'settings.forcePushManualNote': 'SmartGit Manual: упрощённая настройка безопасности force push.',

  // CI/CD Integration
  'settings.ciCdHint': 'Настройте CI-серверы, чтобы отображать значки состояния конвейеров в History. GitHub Actions настраивается через GitHub PAT (см. GitHub Integration выше).',

  // Output Panel
  'settings.outputPanel': 'Панель вывода',
  'settings.commandLogLimit': 'Лимит журнала команд',
  'settings.commandLogLimitHint': 'Максимум команд, показываемых на вкладке Commands панели вывода (по умолчанию 20)',

  // About
  'settings.version': 'Версия',
  'settings.platform': 'Платформа',
};

export const zh: Record<string, string> = {
  // Toasts & handlers
  'settings.failedToLoadGitConfig': '加载 git 配置失败',
  'settings.configSetToast': '已设置 {key}（{scope}）',
  'settings.failedToSetValue': '设置值失败',
  'settings.removeConfigEntryTitle': '删除配置项',
  "settings.removeConfigConfirm": "从 {scope} 配置中删除“{key}”？",
  'settings.configRemovedToast': '已删除 {key}',
  'settings.failedToUnset': '取消设置失败',
  'settings.pleaseEnterPat': '请输入个人访问令牌（PAT）',
  'settings.welcomeGithubUser': '欢迎，{login}！',
  'settings.authFailed': '身份验证失败',
  'settings.loggedOutGithub': '已退出 GitHub 登录',
  'settings.cloneDirUpdated': '默认克隆目录已更新',

  // Header & top-level tabs
  'settings.repoSettingsButtonTitle': '仓库级设置：远程、授权、元数据',
  'settings.repoSettingsButton': '仓库设置...',
  'settings.openRepoForProject': '打开一个仓库以访问项目设置',

  // Appearance
  'settings.themeDescription': '在深色和浅色外观之间切换',
  'settings.lightMode': '浅色',
  'settings.darkMode': '深色',
  'settings.languagesHint': 'English, Русский, 中文, Deutsch',
  'settings.contrastHint': '柔和 ↔ 鲜明。作为实时 CSS 对比度滤镜应用于整个应用。',
  'settings.contrastResetTitle': '重置为默认值（100%）',
  'settings.contrastReset': '重置',
  'settings.contrastSoft': '柔和',
  'settings.contrastPunchy': '鲜明',
  'settings.contrastSliderTitle': '向左拖动更柔和，向右拖动色彩更鲜明',
  'settings.contrastPresets': '预设：',
  'settings.presetSoft': '柔和',
  'settings.presetNormal': '正常',
  'settings.presetHigh': '高',
  'settings.presetMax': '最高',
  'settings.fontSizeBase': '基础字号',
  'settings.fontSizeBaseHint': '全局基础字号（像素）',
  'settings.perAreaFontSizes': '各区域字号',
  'settings.fontAreaTree': '文件树',
  'settings.fontAreaLists': '提交/分支列表',
  'settings.fontAreaDiff': 'Diff 查看器（代码）',
  'settings.fontAreaMonospace': '等宽字体（哈希/路径）',
  'settings.fontSizesApplyHint': '立即应用到相应的界面区域。',
  'settings.sidebarWidth': '侧边栏宽度',
  'settings.sidebarWidthHint': '宽度（像素）',

  // Git
  'settings.defaultCloneDir': '默认克隆目录',
  'settings.defaultCloneDirHint': '新仓库将克隆到此位置',
  'settings.notSet': '（未设置）',
  'settings.browse': '浏览',
  'settings.maxHistoryEntries': '最大历史条目数',
  'settings.maxHistoryEntriesHint': '历史视图中加载的最大提交数',
  'settings.showReflogInHistory': '在历史中显示 reflog',
  'settings.showReflogHint': '在历史视图中包含 reflog 条目',
  'settings.repoList': '仓库列表',
  'settings.autoRefresh': '自动刷新',
  'settings.autoRefreshHint': '自动刷新仓库的总开关。关闭后不再进行定期远程检查——仓库列表中的 ↓/↑ 徽标会保持冻结，直到您点击“立即检查”。',
  'settings.remoteCheckInterval': '远程检查间隔',
  'settings.remoteCheckIntervalHint': '侧边栏每隔多久获取所有仓库的全部远程并显示 ↓ 流入 / ↑ 流出徽标。仅在自动刷新开启时生效。最小 30\u00A0秒；设为 0 可禁用定期检查（“立即检查”按钮仍然可用）。',
  'settings.secUnit': '秒',

  // GitHub Integration
  'settings.logout': '退出登录',
  'settings.authenticatePat': '使用个人访问令牌（PAT）进行身份验证',
  'settings.createTokenAt': '请在以下地址创建令牌：',
  'settings.withScopes': '并授予',
  'settings.and': '和',
  'settings.scopesSuffix': ' 权限。',
  'settings.connect': '连接',

  // Repositories
  'settings.knownRepositories': '已知仓库（{count}）',
  'settings.noReposAdded': '尚未添加任何仓库。',

  // External Tools (project)
  'settings.diffToolCommand': 'Diff 工具命令',
  'settings.diffToolSaved': 'Diff 工具已保存',
  'settings.diffVarsUse': '使用',
  'settings.diffVarsSuffix': ' 变量。留空则使用内置 diff 查看器。',
  'settings.mergeToolCommand': 'Merge 工具命令',
  'settings.mergeToolSaved': 'Merge 工具已保存',
  'settings.variables': '可用变量：',

  // Pull Strategy
  'settings.whenPulling': '从远程拉取时：',
  'settings.mergeDefault': 'Merge（默认）',
  'settings.mergeDesc': '当本地与远程历史分叉时创建合并提交',
  'settings.rebaseDesc': '将本地提交重放到远程之上，保持线性历史',
  'settings.pullStrategyHint': '此设置应用于快速 Pull 按钮和 Pull 下拉菜单。下拉菜单中还有逐次拉取的复选框可供手动覆盖。',

  // Git Config
  'settings.reloadConfig': '重新加载配置',
  'settings.filterKeys': '筛选键...',
  'settings.noConfigEntries': '没有 {scope} 配置项',
  'settings.saveEnter': '保存（Enter）',
  'settings.clickToEdit': '点击以编辑值',
  'settings.emptyValue': '（空）',
  'settings.removeKeyTitle': '删除键（git config --unset）',
  'settings.valuePlaceholder': '值',
  'settings.configScopeHint': '点击值即可编辑。更改将应用于',
  'settings.scopeNoteLocal': ' 作用域（仅此仓库）。',
  'settings.scopeNoteGlobal': ' 作用域（您的用户账户）。',
  'settings.scopeNoteSystem': ' 作用域（整台机器）。',

  // Commands
  'settings.allowModifyingPushed': '允许修改已推送的提交（如强制推送）',
  'settings.allowModifyingPushedHint': '启用后，对已推送提交执行 amend / squash / rebase 的确认将变为警告，而不是硬性阻止。',
  'settings.detectRenames': '刷新时检测重命名',
  'settings.detectRenamesHint': '将新增 + 删除的文件配对为重命名（git diff --find-renames=50%）。',
  'settings.distinguishEol': '区分内容更改与仅行尾更改',
  'settings.distinguishEolHint': '标记仅行尾差异（CRLF ↔ LF）的文件。',
  'settings.autoStash': '常用命令前自动 stash',
  'settings.autoStashHint': '在 merge/rebase/pull 前贮藏本地更改，之后恢复。',
  'settings.includeUntrackedStash': 'stash 包含未跟踪文件',
  'settings.includeUntrackedStashHint': '向 git stash push 传递 -u——未跟踪文件也会被贮藏。',

  // External Tools (application)
  'settings.extToolsConfigure': '配置用于打开文件、比较和解决冲突的外部工具。',
  'settings.extToolsWrite': '这些设置会写入 git config',
  'settings.extToolsCommandHint': '实际的工具命令应在',
  'settings.extToolsSectionsSuffix': ' 等节中定义。',

  // Low-Level Properties
  'settings.lowLevelHint': '高级设置存储于',
  'settings.lowLevelRestart': '更改将在下次重启后生效。',
  'settings.resetToDefaults': '重置为默认值',

  // AI Commit Messages
  'settings.enableAi': '启用 AI 集成',
  'settings.aiHintUse': '在提交信息中使用',
  'settings.aiHintOr': '来生成，或用',
  'settings.aiHintWipSuffix': '生成 "WIP: <ai message>"。',
  'settings.provider': '提供商',
  'settings.disabledOption': '— 禁用 —',
  'settings.aiProviderOllamaLocal': 'Ollama（本地）',
  'settings.aiProviderCustom': '自定义（OpenAI 兼容）',
  'settings.model': '模型',
  'settings.apiUrl': 'API 地址',
  'settings.apiKey': 'API 密钥',
  'settings.ollamaHint': '对于 Ollama（本地 LLM），API 密钥留空，并将 URL 设置为',
  'settings.ollamaPullHint': '模型必须已提前拉取',
  'settings.customPromptLabel': '自定义系统提示词（可选——支持模板变量',
  'settings.customPromptSuffix': '）',

  // Force Push Policy
  'settings.policy': '策略',
  'settings.forcePushAllow': '允许对所有分支强制推送（危险）',
  'settings.forcePushFeatureOnly': '仅允许对 feature 分支强制推送（保护 main/master）',
  'settings.forcePushDeny': '全局禁止强制推送（最安全）',
  'settings.protectedBranchesLabel': '受保护分支（每行一个 glob——例如 main, master, develop, release/*）',
  'settings.forcePushHint': '当策略为',
  'settings.forcePushHint2': '时，受保护分支上的强制推送将被拒绝。',
  'settings.forcePushManualNote': 'SmartGit Manual：force push 的轻量安全配置。',

  // CI/CD Integration
  'settings.ciCdHint': '配置 CI 服务器以在 History 中显示流水线状态徽标。GitHub Actions 通过 GitHub PAT 配置（见上方的 GitHub 集成）。',

  // Output Panel
  'settings.outputPanel': '输出面板',
  'settings.commandLogLimit': '命令日志上限',
  'settings.commandLogLimitHint': '输出面板 Commands 标签页中显示的最大命令数（默认 20）',

  // About
  'settings.version': '版本',
  'settings.platform': '平台',
};

export const de: Record<string, string> = {
  // Toasts & handlers
  'settings.failedToLoadGitConfig': 'git config konnte nicht geladen werden',
  'settings.configSetToast': '{key} gesetzt ({scope})',
  'settings.failedToSetValue': 'Wert konnte nicht gesetzt werden',
  'settings.removeConfigEntryTitle': 'Konfigurationseintrag entfernen',
  "settings.removeConfigConfirm": "'{key}' aus der {scope}-Konfiguration entfernen?",
  'settings.configRemovedToast': '{key} entfernt',
  'settings.failedToUnset': 'Entfernen fehlgeschlagen',
  'settings.pleaseEnterPat': 'Bitte einen PAT eingeben',
  'settings.welcomeGithubUser': 'Willkommen, {login}!',
  'settings.authFailed': 'Authentifizierung fehlgeschlagen',
  'settings.loggedOutGithub': 'Von GitHub abgemeldet',
  'settings.cloneDirUpdated': 'Standard-Klonverzeichnis aktualisiert',

  // Header & top-level tabs
  'settings.repoSettingsButtonTitle': 'Repository-Einstellungen: Remotes, Autorisierung, Metadaten',
  'settings.repoSettingsButton': 'Repository-Einstellungen...',
  'settings.openRepoForProject': 'Öffnen Sie ein Repository, um auf die Projekteinstellungen zuzugreifen',

  // Appearance
  'settings.themeDescription': 'Zwischen dunkler und heller Darstellung wechseln',
  'settings.lightMode': 'Hell',
  'settings.darkMode': 'Dunkel',
  'settings.languagesHint': 'English, Русский, 中文, Deutsch',
  'settings.contrastHint': 'Weicher ↔ knackiger. Wird als Live-CSS-Kontrastfilter auf die gesamte App angewendet.',
  'settings.contrastResetTitle': 'Auf Standard zurücksetzen (100%)',
  'settings.contrastReset': 'Zurücksetzen',
  'settings.contrastSoft': 'Weich',
  'settings.contrastPunchy': 'Knackig',
  'settings.contrastSliderTitle': 'Nach links für weichere Darstellung, nach rechts für kräftigere Farben',
  'settings.contrastPresets': 'Presets:',
  'settings.presetSoft': 'Weich',
  'settings.presetNormal': 'Normal',
  'settings.presetHigh': 'Hoch',
  'settings.presetMax': 'Max.',
  'settings.fontSizeBase': 'Schriftgröße (Basis)',
  'settings.fontSizeBaseHint': 'Globale Basisschriftgröße in Pixeln',
  'settings.perAreaFontSizes': 'Schriftgrößen pro Bereich',
  'settings.fontAreaTree': 'Dateibaum',
  'settings.fontAreaLists': 'Commit-/Branch-Listen',
  'settings.fontAreaDiff': 'Diff-Ansicht (Code)',
  'settings.fontAreaMonospace': 'Monospace (Hashes/Pfade)',
  'settings.fontSizesApplyHint': 'Gelten sofort für die jeweiligen UI-Bereiche.',
  'settings.sidebarWidth': 'Seitenleistenbreite',
  'settings.sidebarWidthHint': 'Breite in Pixeln',

  // Git
  'settings.defaultCloneDir': 'Standard-Klonverzeichnis',
  'settings.defaultCloneDirHint': 'Wohin neue Repositories geklont werden',
  'settings.notSet': '(nicht gesetzt)',
  'settings.browse': 'Durchsuchen',
  'settings.maxHistoryEntries': 'Max. Historieneinträge',
  'settings.maxHistoryEntriesHint': 'Maximale Anzahl geladener Commits in der Historie',
  'settings.showReflogInHistory': 'Reflog in der Historie anzeigen',
  'settings.showReflogHint': 'Reflog-Einträge in die Historienansicht aufnehmen',
  'settings.repoList': 'Repository-Liste',
  'settings.autoRefresh': 'Auto-Aktualisierung',
  'settings.autoRefreshHint': 'Hauptschalter für die automatische Repository-Aktualisierung. Bei ausgeschalteter Option finden keine periodischen Remote-Prüfungen statt — die ↓/↑-Abzeichen in der Repository-Liste bleiben eingefroren, bis Sie „Jetzt prüfen“ klicken.',
  'settings.remoteCheckInterval': 'Intervall der Remote-Prüfung',
  'settings.remoteCheckIntervalHint': 'Wie oft die Seitenleiste alle Remotes jedes gelisteten Repositories abruft und ↓ eingehend / ↑ ausgehend anzeigt. Gilt nur bei eingeschalteter Auto-Aktualisierung. Minimum 30\u00A0s; 0 deaktiviert die periodische Prüfung (die Schaltfläche „Jetzt prüfen“ funktioniert weiterhin).',
  'settings.secUnit': 'Sek.',

  // GitHub Integration
  'settings.logout': 'Abmelden',
  'settings.authenticatePat': 'Mit einem Personal Access Token authentifizieren',
  'settings.createTokenAt': 'Erstellen Sie einen Token unter',
  'settings.withScopes': 'mit den Scopes',
  'settings.and': 'und',
  'settings.scopesSuffix': '.',
  'settings.connect': 'Verbinden',

  // Repositories
  'settings.knownRepositories': 'Bekannte Repositories ({count})',
  'settings.noReposAdded': 'Noch keine Repositories hinzugefügt.',

  // External Tools (project)
  'settings.diffToolCommand': 'Diff-Tool-Befehl',
  'settings.diffToolSaved': 'Diff-Tool gespeichert',
  'settings.diffVarsUse': 'Verwenden Sie',
  'settings.diffVarsSuffix': ' Variablen. Leer lassen, um den integrierten Diff-Viewer zu verwenden.',
  'settings.mergeToolCommand': 'Merge-Tool-Befehl',
  'settings.mergeToolSaved': 'Merge-Tool gespeichert',
  'settings.variables': 'Variablen:',

  // Pull Strategy
  'settings.whenPulling': 'Beim Pull von Remote:',
  'settings.mergeDefault': 'Merge (Standard)',
  'settings.mergeDesc': 'Erstellt einen Merge-Commit, wenn lokale und Remote-Historie divergiert sind',
  'settings.rebaseDesc': 'Spielt lokale Commits über Remote auf, lineare Historie',
  'settings.pullStrategyHint': 'Diese Einstellung gilt für den schnellen Pull-Button und das Pull-Dropdown. Das Dropdown enthält außerdem Checkboxen für manuelle Übersteuerung pro Pull.',

  // Git Config
  'settings.reloadConfig': 'Konfiguration neu laden',
  'settings.filterKeys': 'Schlüssel filtern...',
  'settings.noConfigEntries': 'Keine {scope}-Konfigurationseinträge',
  'settings.saveEnter': 'Speichern (Enter)',
  'settings.clickToEdit': 'Klicken, um den Wert zu bearbeiten',
  'settings.emptyValue': '(leer)',
  'settings.removeKeyTitle': 'Schlüssel entfernen (git config --unset)',
  'settings.valuePlaceholder': 'Wert',
  'settings.configScopeHint': 'Klicken Sie auf einen Wert, um ihn zu bearbeiten. Änderungen gelten für den Bereich',
  'settings.scopeNoteLocal': ' (nur dieses Repository).',
  'settings.scopeNoteGlobal': ' (Ihr Benutzerkonto).',
  'settings.scopeNoteSystem': ' (der ganze Rechner).',

  // Commands
  'settings.allowModifyingPushed': 'Ändern bereits gepushter Commits erlauben (z. B. Forced Push)',
  'settings.allowModifyingPushedHint': 'Wenn aktiviert, wird die Amend-/Squash-/Rebase-Bestätigung für gepushte Commits zu einer Warnung statt einer harten Blockade.',
  'settings.detectRenames': 'Umbenennungen bei der Aktualisierung erkennen',
  'settings.detectRenamesHint': 'Paart hinzugefügte + gelöschte Dateien als Umbenennungen (git diff --find-renames=50%).',
  'settings.distinguishEol': 'Zwischen Inhalts- und reinen Zeilenende-Änderungen unterscheiden',
  'settings.distinguishEolHint': 'Markiert Dateien, bei denen sich nur die Zeilenenden unterscheiden (CRLF ↔ LF).',
  'settings.autoStash': 'Auto-Stash bei häufigen Befehlen',
  'settings.autoStashHint': 'Stasht lokale Änderungen vor Merge/Rebase/Pull und holt sie danach zurück.',
  'settings.includeUntrackedStash': 'Untracked-Dateien in den Stash aufnehmen',
  'settings.includeUntrackedStashHint': 'Übergibt -u an git stash push — stasht auch untracked Dateien.',

  // External Tools (application)
  'settings.extToolsConfigure': 'Konfigurieren Sie externe Tools zum Öffnen von Dateien, Vergleichen und Konfliktlösen.',
  'settings.extToolsWrite': 'Diese Werte landen in der git config',
  'settings.extToolsCommandHint': 'Der eigentliche Tool-Befehl sollte definiert sein in',
  'settings.extToolsSectionsSuffix': '-Abschnitten.',

  // Low-Level Properties
  'settings.lowLevelHint': 'Erweiterte Einstellungen werden gespeichert in',
  'settings.lowLevelRestart': 'Änderungen werden beim nächsten Neustart wirksam.',
  'settings.resetToDefaults': 'Auf Standardwerte zurücksetzen',

  // AI Commit Messages
  'settings.enableAi': 'KI-Integration aktivieren',
  'settings.aiHintUse': 'Verwenden Sie',
  'settings.aiHintOr': 'in der Commit-Nachricht zum Generieren, oder',
  'settings.aiHintWipSuffix': 'für "WIP: <ai message>".',
  'settings.provider': 'Anbieter',
  'settings.disabledOption': '— Deaktiviert —',
  'settings.aiProviderOllamaLocal': 'Ollama (lokal)',
  'settings.aiProviderCustom': 'Benutzerdefiniert (OpenAI-kompatibel)',
  'settings.model': 'Modell',
  'settings.apiUrl': 'API-URL',
  'settings.apiKey': 'API-Key',
  'settings.ollamaHint': 'Lassen Sie für Ollama (lokale LLM) das API-Key-Feld leer und setzen Sie die URL auf',
  'settings.ollamaPullHint': 'Das Modell muss bereits gepullt sein',
  'settings.customPromptLabel': 'Eigener System-Prompt (optional — unterstützt die Vorlagenvariablen',
  'settings.customPromptSuffix': ')',

  // Force Push Policy
  'settings.policy': 'Richtlinie',
  'settings.forcePushAllow': 'Force Push auf allen Branches erlauben (gefährlich)',
  'settings.forcePushFeatureOnly': 'Nur auf Feature-Branches erlauben (schützt main/master)',
  'settings.forcePushDeny': 'Force Push global verbieten (am sichersten)',
  'settings.protectedBranchesLabel': 'Geschützte Branches (ein Glob pro Zeile — z. B. main, master, develop, release/*)',
  'settings.forcePushHint': 'Wenn die Richtlinie',
  'settings.forcePushHint2': 'ist, wird Force Push auf geschützten Branches abgelehnt.',
  'settings.forcePushManualNote': 'SmartGit-Handbuch: schlanke Sicherheitskonfiguration für Force Push.',

  // CI/CD Integration
  'settings.ciCdHint': 'Konfigurieren Sie CI-Server, um Pipeline-Status-Abzeichen in der Historie anzuzeigen. GitHub Actions wird über den GitHub PAT konfiguriert (siehe GitHub-Integration oben).',

  // Output Panel
  'settings.outputPanel': 'Ausgabe-Panel',
  'settings.commandLogLimit': 'Befehlsprotokoll-Limit',
  'settings.commandLogLimitHint': 'Maximale Anzahl der im Commands-Tab des Ausgabe-Panels angezeigten Befehle (Standard 20)',

  // About
  'settings.version': 'Version',
  'settings.platform': 'Plattform',
};
