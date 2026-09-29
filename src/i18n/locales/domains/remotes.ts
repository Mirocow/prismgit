/**
 * remotes domain translations — Remotes page, the add/edit remote dialogs and
 * the remote-related dialogs of BranchDialogs (PullOptions/SetDepth/
 * FetchMore/RemoteProperties).
 * Sweep owner: this file is the ONLY dictionary for the 'remotes' domain —
 * add every new key to ALL FOUR locales (unit tests assert key parity).
 */
export const en: Record<string, string> = {
  // Operations
  // Page chrome
  // Add remote dialog
  // Edit remote dialog
  // PullOptionsDialog
  'remotes.pullTitle': 'Pull — {name}',
  'remotes.pullSubtitle': "Fetch new commits from '{name}' and integrate them into the current branch.",
  'remotes.mergeDesc': 'git pull → fetch + merge. Creates a merge commit when histories diverged.',
  'remotes.rebaseDesc': 'git pull --rebase → replay your local commits on top of the fetched ones (linear history).',
  'remotes.noFFCheckbox': 'Create a merge commit even when a fast-forward is possible (--no-ff)',
  // SetDepthDialog
  'remotes.setDepthTitle': 'Set Depth — {name}',
  'remotes.setDepthSubtitle': "Set the shallow fetch depth for '{name}'.\nOnly the newest N commits will be downloaded (git fetch --depth=N).",
  'remotes.setDepthButton': 'Set Depth',
  'remotes.depthLabel': 'Depth:',
  'remotes.depthHintBefore': 'Enter',
  'remotes.depthHintMiddle': '(or a negative number) to download the',
  'remotes.depthHintFullHistory': 'full history',
  'remotes.depthHintAfter': '(git fetch --unshallow).',
  // FetchMoreDialog
  'remotes.fetchMoreTitle': 'Fetch More — {name}',
  'remotes.fetchMoreSubtitle': 'Download more commit history beyond the current shallow boundary\n(git fetch --deepen=N) without changing the depth setting.',
  'remotes.fetchMoreButton': 'Fetch More',
  'remotes.commitsLabel': 'Commits:',
  // RemotePropertiesDialog
  'remotes.propertiesTitle': 'Properties — {name}',
  'remotes.propertiesSubtitle': 'Read-only remote configuration, tracked branches and repository state.',
  'remotes.headBranchLabel': 'HEAD branch',
  'remotes.headUnknown': '(unknown — run Fetch)',
  'remotes.trackedBranchesLabel': 'Tracked branches',
  'remotes.cloneStateLabel': 'Clone state',
  'remotes.shallowBadge': 'shallow clone',
  'remotes.completeBadge': 'complete',
  'remotes.mirrorBadge': 'mirror',
  'remotes.trackingBranchesHeader': 'Remote-tracking branches',
  'remotes.showingFirst50': '+, showing first 50',
  'remotes.configHeader': 'Config (remote.{name}.*)',
};

export const ru: Record<string, string> = {
  // Operations
  // Page chrome
  // Add remote dialog
  // Edit remote dialog
  // PullOptionsDialog
  'remotes.pullTitle': 'Pull — {name}',
  'remotes.pullSubtitle': "Новые коммиты будут получены из '{name}' и интегрированы в текущую ветку.",
  'remotes.mergeDesc': 'git pull → fetch + merge. При расхождении историй создаёт merge-коммит.',
  'remotes.rebaseDesc': 'git pull --rebase → ваши локальные коммиты повторяются поверх полученных (линейная история).',
  'remotes.noFFCheckbox': 'Создавать merge-коммит, даже если возможен fast-forward (--no-ff)',
  // SetDepthDialog
  'remotes.setDepthTitle': 'Глубина — {name}',
  'remotes.setDepthSubtitle': "Установите глубину частичного забора для '{name}'.\nБудут загружены только последние N коммитов (git fetch --depth=N).",
  'remotes.setDepthButton': 'Установить глубину',
  'remotes.depthLabel': 'Глубина:',
  'remotes.depthHintBefore': 'Введите',
  'remotes.depthHintMiddle': '(или отрицательное число), чтобы загрузить',
  'remotes.depthHintFullHistory': 'полную историю',
  'remotes.depthHintAfter': '(git fetch --unshallow).',
  // FetchMoreDialog
  'remotes.fetchMoreTitle': 'Догрузить — {name}',
  'remotes.fetchMoreSubtitle': 'Загрузить больше истории за пределами текущей неглубокой границы\n(git fetch --deepen=N), не меняя настройку глубины.',
  'remotes.fetchMoreButton': 'Догрузить',
  'remotes.commitsLabel': 'Коммитов:',
  // RemotePropertiesDialog
  'remotes.propertiesTitle': 'Свойства — {name}',
  'remotes.propertiesSubtitle': 'Конфигурация репозитория (только чтение), отслеживаемые ветки и состояние.',
  'remotes.headBranchLabel': 'HEAD-ветка',
  'remotes.headUnknown': '(неизвестно — выполните Fetch)',
  'remotes.trackedBranchesLabel': 'Отслеживаемые ветки',
  'remotes.cloneStateLabel': 'Состояние клона',
  'remotes.shallowBadge': 'неглубокий клон',
  'remotes.completeBadge': 'полный',
  'remotes.mirrorBadge': 'зеркало',
  'remotes.trackingBranchesHeader': 'Удалённые ветки',
  'remotes.showingFirst50': '+, показаны первые 50',
  'remotes.configHeader': 'Конфиг (remote.{name}.*)',
};

export const zh: Record<string, string> = {
  // Operations
  // Page chrome
  // Add remote dialog
  // Edit remote dialog
  // PullOptionsDialog
  'remotes.pullTitle': '拉取 — {name}',
  'remotes.pullSubtitle': "从 '{name}' 抓取新提交并集成到当前分支。",
  'remotes.mergeDesc': 'git pull → 抓取 + 合并。历史分叉时创建合并提交。',
  'remotes.rebaseDesc': 'git pull --rebase → 将本地提交变基到抓取的提交之上（线性历史）。',
  'remotes.noFFCheckbox': '即使可以快进也创建合并提交（--no-ff）',
  // SetDepthDialog
  'remotes.setDepthTitle': '设置深度 — {name}',
  'remotes.setDepthSubtitle': "为 '{name}' 设置浅抓取深度。\n仅下载最近的 N 个提交（git fetch --depth=N）。",
  'remotes.setDepthButton': '设置深度',
  'remotes.depthLabel': '深度：',
  'remotes.depthHintBefore': '输入',
  'remotes.depthHintMiddle': '（或负数）以下载',
  'remotes.depthHintFullHistory': '完整历史',
  'remotes.depthHintAfter': '（git fetch --unshallow）。',
  // FetchMoreDialog
  'remotes.fetchMoreTitle': '追加抓取 — {name}',
  'remotes.fetchMoreSubtitle': '在当前浅克隆边界之外下载更多提交历史\n（git fetch --deepen=N），不改变深度设置。',
  'remotes.fetchMoreButton': '追加抓取',
  'remotes.commitsLabel': '提交数：',
  // RemotePropertiesDialog
  'remotes.propertiesTitle': '属性 — {name}',
  'remotes.propertiesSubtitle': '远程配置（只读）、跟踪分支和仓库状态。',
  'remotes.headBranchLabel': 'HEAD 分支',
  'remotes.headUnknown': '（未知 — 请先抓取）',
  'remotes.trackedBranchesLabel': '跟踪分支',
  'remotes.cloneStateLabel': '克隆状态',
  'remotes.shallowBadge': '浅克隆',
  'remotes.completeBadge': '完整',
  'remotes.mirrorBadge': '镜像',
  'remotes.trackingBranchesHeader': '远程跟踪分支',
  'remotes.showingFirst50': '+，仅显示前 50 个',
  'remotes.configHeader': '配置（remote.{name}.*）',
};

export const de: Record<string, string> = {
  // Operations
  // Page chrome
  // Add remote dialog
  // Edit remote dialog
  // PullOptionsDialog
  'remotes.pullTitle': 'Pull — {name}',
  'remotes.pullSubtitle': "Neue Commits von '{name}' holen und in den aktuellen Branch integrieren.",
  'remotes.mergeDesc': 'git pull → fetch + merge. Erstellt einen Merge-Commit, wenn die Historien divergiert sind.',
  'remotes.rebaseDesc': 'git pull --rebase → spiegelt Ihre lokalen Commits auf die geholten (lineare Historie).',
  'remotes.noFFCheckbox': 'Auch bei möglichem Fast-Forward einen Merge-Commit erstellen (--no-ff)',
  // SetDepthDialog
  'remotes.setDepthTitle': 'Tiefe setzen — {name}',
  'remotes.setDepthSubtitle': "Shallow-Fetch-Tiefe für '{name}' setzen.\nNur die neuesten N Commits werden heruntergeladen (git fetch --depth=N).",
  'remotes.setDepthButton': 'Tiefe setzen',
  'remotes.depthLabel': 'Tiefe:',
  'remotes.depthHintBefore': 'Geben Sie',
  'remotes.depthHintMiddle': '(oder eine negative Zahl) ein, um die',
  'remotes.depthHintFullHistory': 'vollständige Historie',
  'remotes.depthHintAfter': 'zu laden (git fetch --unshallow).',
  // FetchMoreDialog
  'remotes.fetchMoreTitle': 'Mehr holen — {name}',
  'remotes.fetchMoreSubtitle': 'Weitere Commit-Historie über die aktuelle Shallow-Grenze hinaus laden\n(git fetch --deepen=N), ohne die Tiefe-Einstellung zu ändern.',
  'remotes.fetchMoreButton': 'Mehr holen',
  'remotes.commitsLabel': 'Commits:',
  // RemotePropertiesDialog
  'remotes.propertiesTitle': 'Eigenschaften — {name}',
  'remotes.propertiesSubtitle': 'Remote-Konfiguration (schreibgeschützt), getrackte Branches und Repository-Status.',
  'remotes.headBranchLabel': 'HEAD-Branch',
  'remotes.headUnknown': '(unbekannt — Fetch ausführen)',
  'remotes.trackedBranchesLabel': 'Getrackte Branches',
  'remotes.cloneStateLabel': 'Klon-Status',
  'remotes.shallowBadge': 'shallow clone',
  'remotes.completeBadge': 'vollständig',
  'remotes.mirrorBadge': 'mirror',
  'remotes.trackingBranchesHeader': 'Remote-Tracking-Branches',
  'remotes.showingFirst50': '+, zeige erste 50',
  'remotes.configHeader': 'Config (remote.{name}.*)',
};
