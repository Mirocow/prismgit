/**
 * LAR-3 — AI Assistant chat i18n strings.
 *
 * Used by:
 *   - src/components/AiAssistant.tsx (floating popup)
 *   - src/pages/AiChatPage.tsx (full-page chat)
 *
 * Both surfaces share the same keys so the user gets the same translations
 * regardless of where they interact with the AI.
 */

export const en: Record<string, string> = {

  // ── Favorites — saved parts of the dialogue, tree navigation ────────────
  'aiFav.title': 'Favorites',
  'aiFav.notes': 'notes',
  'aiFav.save': 'Save',
  'aiFav.saveTooltip': 'Save this message to favorites',
  'aiFav.saved': 'Added to favorites',
  'aiFav.empty': 'Nothing saved yet.',
  'aiFav.emptyHint': 'Press "Save" under any chat message to keep it here. Favorites are shared across all projects — organize notes into folders.',
  'aiFav.newFolderRoot': 'New folder',
  'aiFav.newFolderInside': 'New subfolder',
  'aiFav.folderName': 'Folder name',
  'aiFav.rename': 'Rename',
  'aiFav.deleteTitle': 'Delete from favorites',
  'aiFav.deleteFolderConfirm': 'Delete folder "{name}" and everything inside it?',
  'aiFav.deleteNoteConfirm': 'Delete "{name}" from favorites?',
  'aiFav.copy': 'Copy',
  'aiFav.copied': 'Copied',
  'aiFav.insertToInput': 'Insert into input',
  'aiFav.showInChat': 'Show in chat',
  'aiFav.notFoundInChat': 'Original message not found in this chat history (the note may be from another project — favorites are shared). Its text is preserved — use Copy or Insert into input.',
  'aiFav.collapseAll': 'Collapse all',
  'aiFav.moveToFolder': 'Move to folder…',
  'aiFav.moveToRoot': 'Root level',
  'aiFav.noTargetFolders': 'No other folders yet',

  // ── Header / titles ──────────────────────────────────────────────────────
  'aiAssistant.title': 'AI Assistant',
  'aiAssistant.toggleTitle': 'Toggle AI Assistant chat (Ctrl+Shift+A)',
  'aiAssistant.disabledHint': 'Enable AI in Settings → AI first',
  'aiAssistant.clearHistory': 'Clear chat history',
  'aiAssistant.clearChat': 'Clear chat',
  'aiAssistant.exportChatLog': 'Export chat log as Markdown (for debugging / sharing)',
  'aiAssistant.exportChatLabel': 'Export chat log',
  'aiAssistant.stopGeneration': 'Stop generation',
  'aiAssistant.stopButton': 'Stop',
  'aiAssistant.switchProvider': 'Switch AI Provider',
  'aiAssistant.switchProviderHint': 'Switching preserves the conversation — the new provider continues the chat.',
  'aiAssistant.noProvidersHint': 'No providers yet — add them in Settings → AI.',
  'aiAssistant.noProviderBanner': 'No AI provider configured',
  'aiAssistant.noProviderBannerHint': 'Add one in Settings → AI and the assistant, commit messages and merge descriptions all come alive.',

  // ── v2.3.12 — LLM error rendering (friendly, localized) ──────────────────
  'aiErr.rateLimitTitle': 'Model is rate-limited (429)',
  'aiErr.rateLimitHint': 'The shared free pool at the provider is busy right now. Wait a minute, pick another free model, or use the openrouter/free auto-router.',
  'aiErr.authTitle': 'API key rejected',
  'aiErr.authHint': 'Check the key on the provider card in Settings → AI.',
  'aiErr.creditsTitle': 'Payment required (402)',
  'aiErr.creditsHint': 'The provider requires credits or a paid plan for this model.',
  'aiErr.modelNotFoundTitle': 'Model not found (404)',
  'aiErr.modelNotFoundHint': 'The model id may be wrong or was removed upstream. Open Settings → AI and fetch the current model list.',
  'aiErr.networkTitle': 'Cannot reach the provider',
  'aiErr.networkHint': 'Check the URL and your network connection.',
  'aiErr.httpTitle': 'Provider error',
  'aiErr.unknownTitle': 'AI request failed',
  'aiErr.fallbackToastTitle': 'Model "{model}" is rate-limited',
  'aiErr.fallbackToastDetail': 'The request was automatically retried via the free auto-router openrouter/free.',
  'aiAssistant.openSettings': 'Configure',
  'aiAssistant.noProviderSelected': 'no provider',
  'aiAssistant.providerTitle': 'Provider',

  // ── Empty / loading states ───────────────────────────────────────────────
  'aiAssistant.emptyHint': 'Ask anything about this repository — "what changed since last commit?", "show me staged files", etc.',
  'aiAssistant.inputPlaceholder': 'Ask about this repo…',
  'aiAssistant.noRepo': 'No repo',
  'aiAssistant.loading': 'Loading…',
  'aiAssistant.noRepoMode': 'No repository (app-level mode)',
  'aiAssistant.emptyHintNoRepo': 'No repository is open. Ask me to list your repos, clone a new one, or initialize a fresh project. Try: "list my repos" or "clone https://github.com/user/repo".',
  'aiAssistant.inputPlaceholderNoRepo': 'Ask me to list, clone, or create a repo…',
  'aiAssistant.thinking': 'Thinking…',
  'aiAssistant.send': 'Send',

  // ── Session switcher ─────────────────────────────────────────────────────
  'aiAssistant.noRepoToolsHint': 'Use list_repos / clone_repo / init_repo tools.',
  'aiAssistant.knownRepositories': 'Known repositories',
  'aiAssistant.noRepositoriesYet': 'No repositories yet. Switch to "No repository" mode and use clone_repo or init_repo.',
  'aiAssistant.currentRepo': 'current',
  'aiAssistant.sessionNoRepo': 'No repository (app-level mode)',

  // ── Message actions ──────────────────────────────────────────────────────
  'aiAssistant.retry': 'Retry',
  'aiAssistant.copy': 'Copy',
  'aiAssistant.copied': 'Copied',
  'aiAssistant.copyMessage': 'Copy message',
  'aiAssistant.copyResult': 'Copy result',
  'aiAssistant.resendMessage': 'Resend this message',
  'aiAssistant.regenerateResponse': 'Regenerate this response',

  // ── Tool result bubble ───────────────────────────────────────────────────
  'aiAssistant.emptyResult': '(empty result)',
  'aiAssistant.line': 'line',
  'aiAssistant.lines': 'lines',

  // ── Token usage bar ──────────────────────────────────────────────────────
  'aiAssistant.tokensInput': 'Input tokens (sent to the model)',
  'aiAssistant.tokensOutput': 'Output tokens (generated by the model)',
  'aiAssistant.tokensContext': 'Total context size (all messages + tools sent to the model)',
  'aiAssistant.tokensIn': 'in',
  'aiAssistant.tokensOut': 'out',
  'aiAssistant.tokensCtx': 'ctx',
  'aiAssistant.largeContextWarn': 'large context',
  'aiAssistant.largeContextTitle': 'Context is getting large — consider starting a new conversation',

  // ── Stop state ───────────────────────────────────────────────────────────
  'aiAssistant.stoppedByUser': '⏹ Stopped by user. The conversation history is preserved — you can continue with a new message.',

  // ── Chat Search panel (AiChatPage) ───────────────────────────────────────
  'aiAssistant.chatSearch': 'Chat Search',
  'aiAssistant.searchPlaceholder': 'Search messages…',
  'aiAssistant.clearSearch': 'Clear search',
  'aiAssistant.searchHintEmpty': 'Type to search through the chat history. Matching messages are filtered in the chat panel on the left, and listed here as quick previews.',
  'aiAssistant.noMatchesFound': 'No matches found.',
  'aiAssistant.noMessagesMatch': 'No messages match “{query}”.',
  'aiAssistant.match': 'match',
  'aiAssistant.matches': 'matches',
  'aiAssistant.total': 'total',
  'aiAssistant.message': 'message',
  'aiAssistant.messages': 'messages',

  // ── Starter prompts ──────────────────────────────────────────────────────
  'aiAssistant.starterWhatChanged': 'What changed?',
  'aiAssistant.starterPullLatest': 'Pull latest',
  'aiAssistant.starterRecentCommits': 'Recent commits',
  'aiAssistant.starterListBranches': 'List branches',
  'aiAssistant.starterStashChanges': 'Stash changes',
  'aiAssistant.starterPushCommits': 'Push commits',
  'aiAssistant.starterListRepos': 'List my repos',
  'aiAssistant.starterCloneRepo': 'Clone a repo',
  'aiAssistant.starterCreateRepo': 'Create a repo',
};

export const ru: Record<string, string> = {

  // ── Favorites — saved parts of the dialogue, tree navigation ────────────
  'aiFav.title': 'Избранное',
  'aiFav.notes': 'заметок',
  'aiFav.save': 'В избранное',
  'aiFav.saveTooltip': 'Сохранить это сообщение в избранное',
  'aiFav.saved': 'Добавлено в избранное',
  'aiFav.empty': 'Пока ничего не сохранено.',
  'aiFav.emptyHint': 'Нажмите «В избранное» под любым сообщением чата, чтобы сохранить его здесь. Избранное общее для всех проектов — раскладывайте заметки по папкам.',
  'aiFav.newFolderRoot': 'Новая папка',
  'aiFav.newFolderInside': 'Новая вложенная папка',
  'aiFav.folderName': 'Название папки',
  'aiFav.rename': 'Переименовать',
  'aiFav.deleteTitle': 'Удалить из избранного',
  'aiFav.deleteFolderConfirm': 'Удалить папку «{name}» и всё её содержимое?',
  'aiFav.deleteNoteConfirm': 'Удалить «{name}» из избранного?',
  'aiFav.copy': 'Копировать',
  'aiFav.copied': 'Скопировано',
  'aiFav.insertToInput': 'Вставить в поле ввода',
  'aiFav.showInChat': 'Показать в чате',
  'aiFav.notFoundInChat': 'Оригинал не найден в истории этого чата (заметка может быть из другого проекта — избранное общее). Текст сохранён — используйте «Копировать» или «Вставить в поле ввода».',
  'aiFav.collapseAll': 'Свернуть все',
  'aiFav.moveToFolder': 'Переместить в папку…',
  'aiFav.moveToRoot': 'В корень',
  'aiFav.noTargetFolders': 'Других папок пока нет',

  // ── Header / titles ──────────────────────────────────────────────────────
  'aiAssistant.title': 'AI Ассистент',
  'aiAssistant.toggleTitle': 'Переключить чат AI Ассистента (Ctrl+Shift+A)',
  'aiAssistant.disabledHint': 'Сначала включите AI в Настройки → AI',
  'aiAssistant.clearHistory': 'Очистить историю чата',
  'aiAssistant.clearChat': 'Очистить чат',
  'aiAssistant.exportChatLog': 'Экспортировать лог чата как Markdown (для отладки / обмена)',
  'aiAssistant.exportChatLabel': 'Экспорт лога',
  'aiAssistant.stopGeneration': 'Остановить генерацию',
  'aiAssistant.stopButton': 'Стоп',
  'aiAssistant.switchProvider': 'Сменить AI провайдера',
  'aiAssistant.switchProviderHint': 'Переключение сохраняет разговор — новый провайдер продолжит чат.',
  'aiAssistant.noProvidersHint': 'Провайдеров пока нет — добавьте их в Настройки → AI.',
  'aiAssistant.noProviderBanner': 'ИИ-провайдер не настроен',
  'aiAssistant.noProviderBannerHint': 'Добавьте его в Настройки → ИИ — и заработают ассистент, сообщения коммитов и описания слияний.',

  // ── v2.3.12 — понятные ошибки LLM ───────────────────────────────────────
  'aiErr.rateLimitTitle': 'Модель временно ограничена (429)',
  'aiErr.rateLimitHint': 'Общий бесплатный пул провайдера перегружен. Подождите минуту, выберите другую бесплатную модель или авто-маршрутизатор openrouter/free.',
  'aiErr.authTitle': 'API-ключ отклонён',
  'aiErr.authHint': 'Проверьте ключ на карточке провайдера в Настройки → ИИ.',
  'aiErr.creditsTitle': 'Требуется оплата (402)',
  'aiErr.creditsHint': 'Для этой модели провайдер требует кредиты или платный тариф.',
  'aiErr.modelNotFoundTitle': 'Модель не найдена (404)',
  'aiErr.modelNotFoundHint': 'Возможно, идентификатор модели неверен или модель удалена. Откройте Настройки → ИИ и загрузите актуальный список моделей.',
  'aiErr.networkTitle': 'Провайдер недоступен',
  'aiErr.networkHint': 'Проверьте адрес и подключение к сети.',
  'aiErr.httpTitle': 'Ошибка провайдера',
  'aiErr.unknownTitle': 'Ошибка запроса к ИИ',
  'aiErr.fallbackToastTitle': 'Модель «{model}» перегружена',
  'aiErr.fallbackToastDetail': 'Запрос автоматически повторен через бесплатный авто-маршрутизатор openrouter/free.',
  'aiAssistant.openSettings': 'Настроить',
  'aiAssistant.noProviderSelected': 'нет провайдера',
  'aiAssistant.providerTitle': 'Провайдер',

  // ── Empty / loading states ───────────────────────────────────────────────
  'aiAssistant.emptyHint': 'Спросите что угодно об этом репозитории — "что изменилось с последнего коммита?", "покажи staged файлы" и т.д.',
  'aiAssistant.inputPlaceholder': 'Спросите об этом репозитории…',
  'aiAssistant.noRepo': 'Нет репо',
  'aiAssistant.loading': 'Загрузка…',
  'aiAssistant.noRepoMode': 'Без репозитория (режим приложения)',
  'aiAssistant.emptyHintNoRepo': 'Репозиторий не открыт. Попросите меня показать список ваших репо, склонировать новый или инициализировать проект. Например: "покажи мои репо" или "clone https://github.com/user/repo".',
  'aiAssistant.inputPlaceholderNoRepo': 'Попросите показать, склонировать или создать репо…',
  'aiAssistant.thinking': 'Думаю…',
  'aiAssistant.send': 'Отправить',

  // ── Session switcher ─────────────────────────────────────────────────────
  'aiAssistant.noRepoToolsHint': 'Используйте инструменты list_repos / clone_repo / init_repo.',
  'aiAssistant.knownRepositories': 'Известные репозитории',
  'aiAssistant.noRepositoriesYet': 'Пока нет репозиториев. Переключитесь в режим "Без репозитория" и используйте clone_repo или init_repo.',
  'aiAssistant.currentRepo': 'текущий',
  'aiAssistant.sessionNoRepo': 'Без репозитория (режим приложения)',

  // ── Message actions ──────────────────────────────────────────────────────
  'aiAssistant.retry': 'Повторить',
  'aiAssistant.copy': 'Копировать',
  'aiAssistant.copied': 'Скопировано',
  'aiAssistant.copyMessage': 'Копировать сообщение',
  'aiAssistant.copyResult': 'Копировать результат',
  'aiAssistant.resendMessage': 'Отправить это сообщение снова',
  'aiAssistant.regenerateResponse': 'Сгенерировать ответ заново',

  // ── Tool result bubble ───────────────────────────────────────────────────
  'aiAssistant.emptyResult': '(пустой результат)',
  'aiAssistant.line': 'строка',
  'aiAssistant.lines': 'строк',

  // ── Token usage bar ──────────────────────────────────────────────────────
  'aiAssistant.tokensInput': 'Входящие токены (отправлены модели)',
  'aiAssistant.tokensOutput': 'Исходящие токены (сгенерированы моделью)',
  'aiAssistant.tokensContext': 'Общий размер контекста (все сообщения + инструменты, отправленные модели)',
  'aiAssistant.tokensIn': 'вх',
  'aiAssistant.tokensOut': 'исх',
  'aiAssistant.tokensCtx': 'конт',
  'aiAssistant.largeContextWarn': 'большой контекст',
  'aiAssistant.largeContextTitle': 'Контекст становится большим — попробуйте начать новый разговор',

  // ── Stop state ───────────────────────────────────────────────────────────
  'aiAssistant.stoppedByUser': '⏹ Остановлено пользователем. История разговора сохранена — вы можете продолжить новым сообщением.',

  // ── Chat Search panel (AiChatPage) ───────────────────────────────────────
  'aiAssistant.chatSearch': 'Поиск по чату',
  'aiAssistant.searchPlaceholder': 'Поиск сообщений…',
  'aiAssistant.clearSearch': 'Очистить поиск',
  'aiAssistant.searchHintEmpty': 'Введите запрос для поиска по истории чата. Совпадения фильтруются в панели чата слева и отображаются здесь как быстрый предпросмотр.',
  'aiAssistant.noMatchesFound': 'Совпадения не найдены.',
  'aiAssistant.noMessagesMatch': 'Нет сообщений, содержащих “{query}”.',
  'aiAssistant.match': 'совпадение',
  'aiAssistant.matches': 'совпадений',
  'aiAssistant.total': 'всего',
  'aiAssistant.message': 'сообщение',
  'aiAssistant.messages': 'сообщений',

  // ── Starter prompts ──────────────────────────────────────────────────────
  'aiAssistant.starterWhatChanged': 'Что изменилось?',
  'aiAssistant.starterPullLatest': 'Получить последние',
  'aiAssistant.starterRecentCommits': 'Недавние коммиты',
  'aiAssistant.starterListBranches': 'Список веток',
  'aiAssistant.starterStashChanges': 'Спрятать изменения',
  'aiAssistant.starterPushCommits': 'Отправить коммиты',
  'aiAssistant.starterListRepos': 'Мои репозитории',
  'aiAssistant.starterCloneRepo': 'Клонировать репо',
  'aiAssistant.starterCreateRepo': 'Создать репо',
};

export const zh: Record<string, string> = {

  // ── Favorites — saved parts of the dialogue, tree navigation ────────────
  'aiFav.title': '收藏',
  'aiFav.notes': '条',
  'aiFav.save': '收藏',
  'aiFav.saveTooltip': '将此消息保存到收藏',
  'aiFav.saved': '已加入收藏',
  'aiFav.empty': '还没有保存的内容。',
  'aiFav.emptyHint': '点击聊天消息下方的"收藏"按钮即可保存到这里。收藏对所有项目通用——可用文件夹整理。',
  'aiFav.newFolderRoot': '新建文件夹',
  'aiFav.newFolderInside': '新建子文件夹',
  'aiFav.folderName': '文件夹名称',
  'aiFav.rename': '重命名',
  'aiFav.deleteTitle': '从收藏中删除',
  'aiFav.deleteFolderConfirm': '删除文件夹"{name}"及其全部内容？',
  'aiFav.deleteNoteConfirm': '从收藏中删除"{name}"？',
  'aiFav.copy': '复制',
  'aiFav.copied': '已复制',
  'aiFav.insertToInput': '插入到输入框',
  'aiFav.showInChat': '在聊天中显示',
  'aiFav.notFoundInChat': '未在当前聊天历史中找到原始消息（该笔记可能来自其他项目——收藏为全局共享）。文本已保存——可使用"复制"或"插入到输入框"。',
  'aiFav.collapseAll': '全部折叠',
  'aiFav.moveToFolder': '移动到文件夹…',
  'aiFav.moveToRoot': '根目录',
  'aiFav.noTargetFolders': '暂无其他文件夹',

  // ── Header / titles ──────────────────────────────────────────────────────
  'aiAssistant.title': 'AI 助手',
  'aiAssistant.toggleTitle': '切换 AI 助手聊天 (Ctrl+Shift+A)',
  'aiAssistant.disabledHint': '请先在 设置 → AI 中启用 AI',
  'aiAssistant.clearHistory': '清除聊天记录',
  'aiAssistant.clearChat': '清空聊天',
  'aiAssistant.exportChatLog': '将聊天日志导出为 Markdown（用于调试 / 分享）',
  'aiAssistant.exportChatLabel': '导出日志',
  'aiAssistant.stopGeneration': '停止生成',
  'aiAssistant.stopButton': '停止',
  'aiAssistant.switchProvider': '切换 AI 提供商',
  'aiAssistant.switchProviderHint': '切换会保留对话 — 新提供商将继续聊天。',
  'aiAssistant.noProvidersHint': '暂无提供商——请在设置 → AI 中添加。',
  'aiAssistant.noProviderBanner': '未配置 AI 提供商',
  'aiAssistant.noProviderBannerHint': '在 设置 → AI 中添加后，助手、提交信息和合并描述即可使用。',

  // ── v2.3.12 — 友好的 LLM 错误提示 ───────────────────────────────────────
  'aiErr.rateLimitTitle': '模型被限流 (429)',
  'aiErr.rateLimitHint': '提供商的共享免费池当前繁忙。请稍等一分钟、换一个免费模型，或使用 openrouter/free 自动路由。',
  'aiErr.authTitle': 'API 密钥被拒绝',
  'aiErr.authHint': '请在 设置 → AI 的提供商卡片中检查密钥。',
  'aiErr.creditsTitle': '需要付费 (402)',
  'aiErr.creditsHint': '该模型需要提供商账户有余额或付费套餐。',
  'aiErr.modelNotFoundTitle': '模型未找到 (404)',
  'aiErr.modelNotFoundHint': '模型 ID 可能有误或已被下线。请打开 设置 → AI 拉取最新模型列表。',
  'aiErr.networkTitle': '无法连接提供商',
  'aiErr.networkHint': '请检查地址和网络连接。',
  'aiErr.httpTitle': '提供商错误',
  'aiErr.unknownTitle': 'AI 请求失败',
  'aiErr.fallbackToastTitle': '模型「{model}」已限流',
  'aiErr.fallbackToastDetail': '已自动改用免费自动路由 openrouter/free 重试请求。',
  'aiAssistant.openSettings': '去设置',
  'aiAssistant.noProviderSelected': '无提供商',
  'aiAssistant.providerTitle': '提供商',

  // ── Empty / loading states ───────────────────────────────────────────────
  'aiAssistant.emptyHint': '问任何关于此仓库的问题 — "自上次提交以来有什么变化？"、"显示暂存文件" 等。',
  'aiAssistant.inputPlaceholder': '询问此仓库…',
  'aiAssistant.noRepo': '无仓库',
  'aiAssistant.loading': '加载中…',
  'aiAssistant.noRepoMode': '无仓库（应用级模式）',
  'aiAssistant.emptyHintNoRepo': '尚未打开任何仓库。让我列出您的仓库、克隆新仓库或初始化新项目。试试："列出我的仓库" 或 "clone https://github.com/user/repo"。',
  'aiAssistant.inputPlaceholderNoRepo': '让我列出、克隆或创建仓库…',
  'aiAssistant.thinking': '思考中…',
  'aiAssistant.send': '发送',

  // ── Session switcher ─────────────────────────────────────────────────────
  'aiAssistant.noRepoToolsHint': '使用 list_repos / clone_repo / init_repo 工具。',
  'aiAssistant.knownRepositories': '已知仓库',
  'aiAssistant.noRepositoriesYet': '尚无仓库。切换到"无仓库"模式，使用 clone_repo 或 init_repo。',
  'aiAssistant.currentRepo': '当前',
  'aiAssistant.sessionNoRepo': '无仓库（应用级模式）',

  // ── Message actions ──────────────────────────────────────────────────────
  'aiAssistant.retry': '重试',
  'aiAssistant.copy': '复制',
  'aiAssistant.copied': '已复制',
  'aiAssistant.copyMessage': '复制消息',
  'aiAssistant.copyResult': '复制结果',
  'aiAssistant.resendMessage': '重新发送此消息',
  'aiAssistant.regenerateResponse': '重新生成此回复',

  // ── Tool result bubble ───────────────────────────────────────────────────
  'aiAssistant.emptyResult': '（空结果）',
  'aiAssistant.line': '行',
  'aiAssistant.lines': '行',

  // ── Token usage bar ──────────────────────────────────────────────────────
  'aiAssistant.tokensInput': '输入令牌（发送给模型）',
  'aiAssistant.tokensOutput': '输出令牌（模型生成）',
  'aiAssistant.tokensContext': '总上下文大小（所有消息 + 工具发送给模型）',
  'aiAssistant.tokensIn': '入',
  'aiAssistant.tokensOut': '出',
  'aiAssistant.tokensCtx': '上下文',
  'aiAssistant.largeContextWarn': '上下文过大',
  'aiAssistant.largeContextTitle': '上下文过大 — 建议开始新的对话',

  // ── Stop state ───────────────────────────────────────────────────────────
  'aiAssistant.stoppedByUser': '⏹ 用户已停止。对话历史已保留 — 您可以继续发送新消息。',

  // ── Chat Search panel (AiChatPage) ───────────────────────────────────────
  'aiAssistant.chatSearch': '聊天搜索',
  'aiAssistant.searchPlaceholder': '搜索消息…',
  'aiAssistant.clearSearch': '清除搜索',
  'aiAssistant.searchHintEmpty': '输入以搜索聊天历史。匹配的消息将在左侧聊天面板中过滤，并在此处作为快速预览列出。',
  'aiAssistant.noMatchesFound': '未找到匹配项。',
  'aiAssistant.noMessagesMatch': '没有消息匹配“{query}”。',
  'aiAssistant.match': '个匹配',
  'aiAssistant.matches': '个匹配',
  'aiAssistant.total': '总数',
  'aiAssistant.message': '条消息',
  'aiAssistant.messages': '条消息',

  // ── Starter prompts ──────────────────────────────────────────────────────
  'aiAssistant.starterWhatChanged': '有什么变化？',
  'aiAssistant.starterPullLatest': '拉取最新',
  'aiAssistant.starterRecentCommits': '最近提交',
  'aiAssistant.starterListBranches': '列出分支',
  'aiAssistant.starterStashChanges': '暂存更改',
  'aiAssistant.starterPushCommits': '推送提交',
  'aiAssistant.starterListRepos': '我的仓库',
  'aiAssistant.starterCloneRepo': '克隆仓库',
  'aiAssistant.starterCreateRepo': '创建仓库',
};

export const de: Record<string, string> = {

  // ── Favorites — saved parts of the dialogue, tree navigation ────────────
  'aiFav.title': 'Favoriten',
  'aiFav.notes': 'Einträge',
  'aiFav.save': 'Speichern',
  'aiFav.saveTooltip': 'Diese Nachricht zu den Favoriten hinzufügen',
  'aiFav.saved': 'Zu Favoriten hinzugefügt',
  'aiFav.empty': 'Noch nichts gespeichert.',
  'aiFav.emptyHint': 'Klicken Sie unter einer Chat-Nachricht auf "Speichern", um sie hier abzulegen. Favoriten gelten für alle Projekte — ordnen Sie Notizen in Ordnern.',
  'aiFav.newFolderRoot': 'Neuer Ordner',
  'aiFav.newFolderInside': 'Neuer Unterordner',
  'aiFav.folderName': 'Ordnername',
  'aiFav.rename': 'Umbenennen',
  'aiFav.deleteTitle': 'Aus Favoriten löschen',
  'aiFav.deleteFolderConfirm': 'Ordner "{name}" und den gesamten Inhalt löschen?',
  'aiFav.deleteNoteConfirm': '"{name}" aus den Favoriten löschen?',
  'aiFav.copy': 'Kopieren',
  'aiFav.copied': 'Kopiert',
  'aiFav.insertToInput': 'In Eingabefeld einfügen',
  'aiFav.showInChat': 'Im Chat anzeigen',
  'aiFav.notFoundInChat': 'Originalnachricht nicht im Verlauf dieses Chats gefunden (die Notiz stammt möglicherweise aus einem anderen Projekt — Favoriten sind global). Der Text ist erhalten — verwenden Sie „Kopieren“ oder „In Eingabe einfügen“.',
  'aiFav.collapseAll': 'Alle einklappen',
  'aiFav.moveToFolder': 'In Ordner verschieben…',
  'aiFav.moveToRoot': 'Ins Hauptverzeichnis',
  'aiFav.noTargetFolders': 'Keine weiteren Ordner',

  // ── Header / titles ──────────────────────────────────────────────────────
  'aiAssistant.title': 'KI-Assistent',
  'aiAssistant.toggleTitle': 'KI-Assistent-Chat umschalten (Strg+Shift+A)',
  'aiAssistant.disabledHint': 'Aktivieren Sie KI in Einstellungen → KI',
  'aiAssistant.clearHistory': 'Chat-Verlauf löschen',
  'aiAssistant.clearChat': 'Chat löschen',
  'aiAssistant.exportChatLog': 'Chat-Verlauf als Markdown exportieren (für Debugging / Freigabe)',
  'aiAssistant.exportChatLabel': 'Protokoll exportieren',
  'aiAssistant.stopGeneration': 'Generierung stoppen',
  'aiAssistant.stopButton': 'Stopp',
  'aiAssistant.switchProvider': 'KI-Anbieter wechseln',
  'aiAssistant.switchProviderHint': 'Wechseln erhält die Konversation — der neue Anbieter setzt den Chat fort.',
  'aiAssistant.noProvidersHint': 'Noch keine Anbieter — bitte in Einstellungen → AI hinzufügen.',
  'aiAssistant.noProviderBanner': 'Kein KI-Provider konfiguriert',
  'aiAssistant.noProviderBannerHint': 'Fügen Sie einen unter Einstellungen → KI hinzu — dann funktionieren Assistent, Commit-Nachrichten und Merge-Beschreibungen.',

  // ── v2.3.12 — verständliche LLM-Fehlermeldungen ────────────────────────────
  'aiErr.rateLimitTitle': 'Modell gedrosselt (429)',
  'aiErr.rateLimitHint': 'Der gemeinsame Free-Pool des Anbieters ist gerade überlastet. Warten Sie eine Minute, wählen Sie ein anderes kostenloses Modell oder den Auto-Router openrouter/free.',
  'aiErr.authTitle': 'API-Schlüssel abgelehnt',
  'aiErr.authHint': 'Prüfen Sie den Schlüssel auf der Anbieter-Karte unter Einstellungen → KI.',
  'aiErr.creditsTitle': 'Bezahlung erforderlich (402)',
  'aiErr.creditsHint': 'Für dieses Modell verlangt der Anbieter Guthaben oder einen Tarif.',
  'aiErr.modelNotFoundTitle': 'Modell nicht gefunden (404)',
  'aiErr.modelNotFoundHint': 'Die Modell-ID ist eventuell falsch oder wurde entfernt. Öffnen Sie Einstellungen → KI und laden Sie die aktuelle Modellliste.',
  'aiErr.networkTitle': 'Anbieter nicht erreichbar',
  'aiErr.networkHint': 'Prüfen Sie URL und Netzwerkverbindung.',
  'aiErr.httpTitle': 'Anbieterfehler',
  'aiErr.unknownTitle': 'KI-Anfrage fehlgeschlagen',
  'aiErr.fallbackToastTitle': 'Modell „{model}“ ist gedrosselt',
  'aiErr.fallbackToastDetail': 'Die Anfrage wurde automatisch über den kostenlosen Auto-Router openrouter/free wiederholt.',
  'aiAssistant.openSettings': 'Konfigurieren',
  'aiAssistant.noProviderSelected': 'kein Anbieter',
  'aiAssistant.providerTitle': 'Anbieter',

  // ── Empty / loading states ───────────────────────────────────────────────
  'aiAssistant.emptyHint': 'Fragen Sie alles über dieses Repository — "was hat sich seit dem letzten Commit geändert?", "zeige mir gestaffte Dateien" usw.',
  'aiAssistant.inputPlaceholder': 'Fragen Sie zu diesem Repo…',
  'aiAssistant.noRepo': 'Kein Repo',
  'aiAssistant.loading': 'Laden…',
  'aiAssistant.noRepoMode': 'Kein Repository (App-Ebene-Modus)',
  'aiAssistant.emptyHintNoRepo': 'Kein Repository geöffnet. Bitten Sie mich, Ihre Repos aufzulisten, ein neues zu klonen oder ein Projekt zu initialisieren. Versuchen Sie: "meine Repos auflisten" oder "clone https://github.com/user/repo".',
  'aiAssistant.inputPlaceholderNoRepo': 'Bitten Sie mich, Repos aufzulisten, zu klonen oder zu erstellen…',
  'aiAssistant.thinking': 'Denke nach…',
  'aiAssistant.send': 'Senden',

  // ── Session switcher ─────────────────────────────────────────────────────
  'aiAssistant.noRepoToolsHint': 'Verwenden Sie list_repos / clone_repo / init_repo Werkzeuge.',
  'aiAssistant.knownRepositories': 'Bekannte Repositories',
  'aiAssistant.noRepositoriesYet': 'Noch keine Repositories. Wechseln Sie in den Modus "Kein Repository" und verwenden Sie clone_repo oder init_repo.',
  'aiAssistant.currentRepo': 'aktuell',
  'aiAssistant.sessionNoRepo': 'Kein Repository (App-Ebene-Modus)',

  // ── Message actions ──────────────────────────────────────────────────────
  'aiAssistant.retry': 'Erneut',
  'aiAssistant.copy': 'Kopieren',
  'aiAssistant.copied': 'Kopiert',
  'aiAssistant.copyMessage': 'Nachricht kopieren',
  'aiAssistant.copyResult': 'Ergebnis kopieren',
  'aiAssistant.resendMessage': 'Diese Nachricht erneut senden',
  'aiAssistant.regenerateResponse': 'Diese Antwort neu generieren',

  // ── Tool result bubble ───────────────────────────────────────────────────
  'aiAssistant.emptyResult': '(leeres Ergebnis)',
  'aiAssistant.line': 'Zeile',
  'aiAssistant.lines': 'Zeilen',

  // ── Token usage bar ──────────────────────────────────────────────────────
  'aiAssistant.tokensInput': 'Eingabe-Token (an das Modell gesendet)',
  'aiAssistant.tokensOutput': 'Ausgabe-Token (vom Modell generiert)',
  'aiAssistant.tokensContext': 'Gesamte Kontextgröße (alle Nachrichten + Werkzeuge an das Modell gesendet)',
  'aiAssistant.tokensIn': 'ein',
  'aiAssistant.tokensOut': 'aus',
  'aiAssistant.tokensCtx': 'Ktx',
  'aiAssistant.largeContextWarn': 'großer Kontext',
  'aiAssistant.largeContextTitle': 'Kontext wird groß — erwägen Sie, eine neue Konversation zu beginnen',

  // ── Stop state ───────────────────────────────────────────────────────────
  'aiAssistant.stoppedByUser': '⏹ Vom Benutzer gestoppt. Der Konversationsverlauf bleibt erhalten — Sie können mit einer neuen Nachricht fortfahren.',

  // ── Chat Search panel (AiChatPage) ───────────────────────────────────────
  'aiAssistant.chatSearch': 'Chat-Suche',
  'aiAssistant.searchPlaceholder': 'Nachrichten durchsuchen…',
  'aiAssistant.clearSearch': 'Suche löschen',
  'aiAssistant.searchHintEmpty': 'Tippen Sie, um den Chat-Verlauf zu durchsuchen. Übereinstimmende Nachrichten werden im Chat-Panel links gefiltert und hier als schnelle Vorschau aufgelistet.',
  'aiAssistant.noMatchesFound': 'Keine Treffer gefunden.',
  'aiAssistant.noMessagesMatch': 'Keine Nachrichten entsprechen „{query}“.',
  'aiAssistant.match': 'Treffer',
  'aiAssistant.matches': 'Treffer',
  'aiAssistant.total': 'gesamt',
  'aiAssistant.message': 'Nachricht',
  'aiAssistant.messages': 'Nachrichten',

  // ── Starter prompts ──────────────────────────────────────────────────────
  'aiAssistant.starterWhatChanged': 'Was hat sich geändert?',
  'aiAssistant.starterPullLatest': 'Neueste abrufen',
  'aiAssistant.starterRecentCommits': 'Letzte Commits',
  'aiAssistant.starterListBranches': 'Branches auflisten',
  'aiAssistant.starterStashChanges': 'Änderungen stashen',
  'aiAssistant.starterPushCommits': 'Commits pushen',
  'aiAssistant.starterListRepos': 'Meine Repos',
  'aiAssistant.starterCloneRepo': 'Repo klonen',
  'aiAssistant.starterCreateRepo': 'Repo erstellen',
};
