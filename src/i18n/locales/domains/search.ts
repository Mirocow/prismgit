/**
 * search domain translations.
 * Sweep owner: this file is the ONLY dictionary for the 'search' domain.
 * Add every new key to ALL FOUR locales (unit tests assert key parity).
 *
 * Used by: GlobalSearch.tsx
 */

// ─── English ─────────────────────────────────────────────────────────────────
export const en = {
  'search.title': 'Global Search',
  'search.placeholderWithRepo': 'Search commits, branches, tags, files, stashes in "{name}"...',
  'search.placeholderNoRepo': 'Search repositories and tools...',
  'search.openRepoFirst': 'Type to search your repositories. Open a repository to also search commits, branches, tags, files and stashes.',
  'search.typeToSearch': 'Type to search across commits, branches, tags, files and stashes',
  'search.noResults': 'No results for "{query}"',
  'search.searching': 'Searching...',
  'search.navigate': 'Navigate',
  'search.open': 'Open',
  'search.close': 'Close',
  'search.resultsCount': '{count} result(s)',
  'search.groupRepos': 'Repositories',
  'search.groupCommits': 'Commits',
  'search.groupBranches': 'Branches',
  'search.groupTags': 'Tags',
  'search.groupFiles': 'Files',
  'search.groupStashes': 'Stashes',
  'search.toolbarButtonTitle': 'Global Search (Ctrl+Shift+F)',
  'search.toolbarButton': 'Search',

  // ── FindObjectDialog (Ctrl+F) ──
  'search.findObject.placeholder': 'Find branch, tag, or ref...',
  'search.findObject.searching': 'searching...',
  'search.findObject.noRefs': 'No refs found',
  'search.findObject.startTyping': 'Start typing to search...',
  'search.findObject.navigate': '↑↓ navigate',
  'search.findObject.select': '↵ select',
  'search.findObject.close': 'esc close',
  'search.findObject.results': '{count} results',
  'search.findObject.searchFailed': 'Search failed',
};

// ─── Russian ─────────────────────────────────────────────────────────────────
export const ru = {
  'search.title': 'Глобальный поиск',
  'search.placeholderWithRepo': 'Поиск коммитов, веток, тегов, файлов, стэшей в "{name}"...',
  'search.placeholderNoRepo': 'Поиск репозиториев и инструментов...',
  'search.openRepoFirst': 'Введите имя репозитория для поиска. Откройте репозиторий, чтобы также искать коммиты, ветки, теги, файлы и стэши.',
  'search.typeToSearch': 'Начните вводить для поиска по коммитам, веткам, тегам, файлам и стэшам',
  'search.noResults': 'Ничего не найдено по запросу "{query}"',
  'search.searching': 'Поиск...',
  'search.navigate': 'Навигация',
  'search.open': 'Открыть',
  'search.close': 'Закрыть',
  'search.resultsCount': '{count} результат(ов)',
  'search.groupRepos': 'Репозитории',
  'search.groupCommits': 'Коммиты',
  'search.groupBranches': 'Ветки',
  'search.groupTags': 'Теги',
  'search.groupFiles': 'Файлы',
  'search.groupStashes': 'Стэши',
  'search.toolbarButtonTitle': 'Глобальный поиск (Ctrl+Shift+F)',
  'search.toolbarButton': 'Поиск',

  // ── FindObjectDialog (Ctrl+F) ──
  'search.findObject.placeholder': 'Найти ветку, тег или ref...',
  'search.findObject.searching': 'поиск...',
  'search.findObject.noRefs': 'Refs не найдены',
  'search.findObject.startTyping': 'Начните вводить для поиска...',
  'search.findObject.navigate': '↑↓ навигация',
  'search.findObject.select': '↵ выбрать',
  'search.findObject.close': 'esc закрыть',
  'search.findObject.results': '{count} результатов',
  'search.findObject.searchFailed': 'Поиск не удался',
};

// ─── Chinese ─────────────────────────────────────────────────────────────────
export const zh = {
  'search.title': '全局搜索',
  'search.placeholderWithRepo': '在 "{name}" 中搜索提交、分支、标签、文件、贮藏...',
  'search.placeholderNoRepo': '搜索仓库和工具...',
  'search.openRepoFirst': '打开一个仓库以搜索提交、分支、标签、文件和贮藏',
  'search.typeToSearch': '输入以搜索提交、分支、标签、文件和贮藏',
  'search.noResults': '未找到 "{query}" 的结果',
  'search.searching': '搜索中...',
  'search.navigate': '导航',
  'search.open': '打开',
  'search.close': '关闭',
  'search.resultsCount': '{count} 个结果',
  'search.groupRepos': '仓库',
  'search.groupCommits': '提交',
  'search.groupBranches': '分支',
  'search.groupTags': '标签',
  'search.groupFiles': '文件',
  'search.groupStashes': '贮藏',
  'search.toolbarButtonTitle': '全局搜索 (Ctrl+Shift+F)',
  'search.toolbarButton': '搜索',

  // ── FindObjectDialog (Ctrl+F) ──
  'search.findObject.placeholder': '查找分支、标签或引用...',
  'search.findObject.searching': '搜索中...',
  'search.findObject.noRefs': '未找到引用',
  'search.findObject.startTyping': '开始输入以搜索...',
  'search.findObject.navigate': '↑↓ 导航',
  'search.findObject.select': '↵ 选择',
  'search.findObject.close': 'esc 关闭',
  'search.findObject.results': '{count} 个结果',
  'search.findObject.searchFailed': '搜索失败',
};

// ─── German ──────────────────────────────────────────────────────────────────
export const de = {
  'search.title': 'Globale Suche',
  'search.placeholderWithRepo': 'Commits, Branches, Tags, Dateien, Stashes in "{name}" durchsuchen...',
  'search.placeholderNoRepo': 'Repositories und Tools durchsuchen...',
  'search.openRepoFirst': 'Öffnen Sie ein Repository, um Commits, Branches, Tags, Dateien und Stashes zu durchsuchen',
  'search.typeToSearch': 'Tippen Sie, um Commits, Branches, Tags, Dateien und Stashes zu durchsuchen',
  'search.noResults': 'Keine Ergebnisse für "{query}"',
  'search.searching': 'Suche...',
  'search.navigate': 'Navigieren',
  'search.open': 'Öffnen',
  'search.close': 'Schließen',
  'search.resultsCount': '{count} Ergebnis(se)',
  'search.groupRepos': 'Repositories',
  'search.groupCommits': 'Commits',
  'search.groupBranches': 'Branches',
  'search.groupTags': 'Tags',
  'search.groupFiles': 'Dateien',
  'search.groupStashes': 'Stashes',
  'search.toolbarButtonTitle': 'Globale Suche (Strg+Umschalt+F)',
  'search.toolbarButton': 'Suche',

  // ── FindObjectDialog (Ctrl+F) ──
  'search.findObject.placeholder': 'Branch, Tag oder Ref finden...',
  'search.findObject.searching': 'suchen...',
  'search.findObject.noRefs': 'Keine Refs gefunden',
  'search.findObject.startTyping': 'Tippen Sie, um zu suchen...',
  'search.findObject.navigate': '↑↓ navigieren',
  'search.findObject.select': '↵ auswählen',
  'search.findObject.close': 'esc schließen',
  'search.findObject.results': '{count} Ergebnisse',
  'search.findObject.searchFailed': 'Suche fehlgeschlagen',
};
