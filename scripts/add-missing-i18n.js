#!/usr/bin/env node
/**
 * Add missing i18n keys to all 4 locale files (en/ru/zh/de) in the pages domain.
 * Each key gets a translation in each locale.
 *
 * Usage: node scripts/add-missing-i18n.js
 */
const fs = require('fs');
const path = require('path');

const PAGES_FILE = 'src/i18n/locales/domains/pages.ts';
const SETTINGS_FILE = 'src/i18n/locales/domains/settings.ts';
const DIFF_FILE = 'src/i18n/locales/domains/diff.ts';
const COMMON_FILE = 'src/i18n/locales/domains/common.ts';

// ─── New keys to add to pages.ts ──────────────────────────────────────────
const PAGES_KEYS = {
  en: {
    'pages.prReviewNoOwnerRepo': 'Repository owner/name not detected from the remote URL. Open the provider chip in the header to re-detect or switch providers.',
    'pages.prReviewGitLabProjectNotFound': 'GitLab project "{path}" not found. Check that your GitLab token (Settings → Integrations) has access to this project.',
    'pages.prReviewNotFound': 'PR #{n} was not found on {provider}. Check that the provider chip in the header matches your repo, and that your token has access to {owner}/{repo}.',
    'pages.prReviewLoadFailed': 'Failed to load PR review',
    'pages.prTabOverview': 'Overview',
    'pages.prTabCommits': 'Commits',
    'pages.prTabFiles': 'Files',
    'pages.prTabDiscussion': 'Discussion',
    'pages.prMergeDraftBlocked': 'Draft PRs cannot be merged',
    'pages.prDescription': 'Description',
    'pages.prNoDescription': 'No description provided.',
    'pages.prMeta': 'Summary',
    'pages.prNoCommits': 'No commits found.',
    'pages.prChangedFiles': 'Changed files',
    'pages.prDiffTooBig': 'Diff for this file is too large to display inline. Open it on GitHub.',
    'pages.prOpenFileExternal': 'Open on GitHub',
    'pages.prSelectFile': 'Select a file to view its diff',
    'pages.prNoComments': 'No comments yet.',
    'pages.prCommentPlaceholder': 'Leave a comment...',
    'pages.prCommentHint': 'Cmd/Ctrl+Enter to post',
    'pages.prPostComment': 'Comment',
    'pages.prReviewNoProjectId': 'GitLab project ID not resolved. Go back to Pull Requests and re-select the MR.',
    'pages.reviewsNothingToPush': 'No reviews to push',
    'pages.reviewsNothingToPushHint': 'Add a review comment first, then push to share it with your team.',
    'pages.reviewsNoRemoteReviews': 'No reviews on remote yet',
    'pages.reviewsNoRemoteReviewsHint': 'The remote repository has no review notes. Push your local reviews first to share them.',
    'pages.reviewsExitPR': 'Exit PR review',
    'pages.reviewsBackToLocal': 'Back to local review comments',
    'pages.reviewsGoToPRs': 'Open Pull Requests to review a PR',
    'pages.prLoadNotFound': 'Repository not found on {provider}. Check the provider chip in the header — it may not match your remote URL. Owner/repo: {owner}/{repo}',
  },
  ru: {
    'pages.prReviewNoOwnerRepo': 'Owner/имя репозитория не определены из URL remote. Откройте чип провайдера в шапке для повторного определения или смены провайдера.',
    'pages.prReviewGitLabProjectNotFound': 'GitLab проект "{path}" не найден. Проверьте, что ваш GitLab токен (Настройки → Интеграции) имеет доступ к этому проекту.',
    'pages.prReviewNotFound': 'PR #{n} не найден на {provider}. Проверьте, что чип провайдера в шапке соответствует вашему репозиторию, и что ваш токен имеет доступ к {owner}/{repo}.',
    'pages.prReviewLoadFailed': 'Не удалось загрузить обзор PR',
    'pages.prTabOverview': 'Обзор',
    'pages.prTabCommits': 'Коммиты',
    'pages.prTabFiles': 'Файлы',
    'pages.prTabDiscussion': 'Обсуждение',
    'pages.prMergeDraftBlocked': 'Черновые PR нельзя сливать',
    'pages.prDescription': 'Описание',
    'pages.prNoDescription': 'Описание не предоставлено.',
    'pages.prMeta': 'Сводка',
    'pages.prNoCommits': 'Коммиты не найдены.',
    'pages.prChangedFiles': 'Изменённые файлы',
    'pages.prDiffTooBig': 'Diff для этого файла слишком большой для отображения. Откройте на GitHub.',
    'pages.prOpenFileExternal': 'Открыть на GitHub',
    'pages.prSelectFile': 'Выберите файл для просмотра diff',
    'pages.prNoComments': 'Комментариев пока нет.',
    'pages.prCommentPlaceholder': 'Оставить комментарий...',
    'pages.prCommentHint': 'Cmd/Ctrl+Enter для отправки',
    'pages.prPostComment': 'Комментарий',
    'pages.prReviewNoProjectId': 'ID GitLab проекта не определён. Вернитесь к Pull Requests и выберите MR заново.',
    'pages.reviewsNothingToPush': 'Нет обзоров для отправки',
    'pages.reviewsNothingToPushHint': 'Сначала добавьте комментарий обзора, затем отправьте, чтобы поделиться с командой.',
    'pages.reviewsNoRemoteReviews': 'На remote ещё нет обзоров',
    'pages.reviewsNoRemoteReviewsHint': 'На remote-репозитории нет заметок обзора. Сначала отправьте свои локальные обзоры.',
    'pages.reviewsExitPR': 'Выйти из обзора PR',
    'pages.reviewsBackToLocal': 'Назад к локальным комментариям обзора',
    'pages.reviewsGoToPRs': 'Открыть Pull Requests для обзора PR',
    'pages.prLoadNotFound': 'Репозиторий не найден на {provider}. Проверьте чип провайдера в шапке — возможно, он не соответствует вашему remote URL. Owner/repo: {owner}/{repo}',
  },
  zh: {
    'pages.prReviewNoOwnerRepo': '未能从 remote URL 检测到仓库 owner/名称。点击顶部的 provider 芯片重新检测或切换提供商。',
    'pages.prReviewGitLabProjectNotFound': '未找到 GitLab 项目"{path}"。请检查您的 GitLab 令牌（设置 → 集成）是否有权访问此项目。',
    'pages.prReviewNotFound': '在 {provider} 上未找到 PR #{n}。请检查顶部的 provider 芯片是否与您的仓库匹配，以及您的令牌是否有权访问 {owner}/{repo}。',
    'pages.prReviewLoadFailed': '加载 PR 审查失败',
    'pages.prTabOverview': '概览',
    'pages.prTabCommits': '提交',
    'pages.prTabFiles': '文件',
    'pages.prTabDiscussion': '讨论',
    'pages.prMergeDraftBlocked': '草稿 PR 不能合并',
    'pages.prDescription': '描述',
    'pages.prNoDescription': '未提供描述。',
    'pages.prMeta': '摘要',
    'pages.prNoCommits': '未找到提交。',
    'pages.prChangedFiles': '已更改的文件',
    'pages.prDiffTooBig': '此文件的差异太大，无法内联显示。请在 GitHub 上打开。',
    'pages.prOpenFileExternal': '在 GitHub 上打开',
    'pages.prSelectFile': '选择一个文件以查看差异',
    'pages.prNoComments': '暂无评论。',
    'pages.prCommentPlaceholder': '发表评论...',
    'pages.prCommentHint': 'Cmd/Ctrl+Enter 发表',
    'pages.prPostComment': '评论',
    'pages.prReviewNoProjectId': 'GitLab 项目 ID 未解析。返回 Pull Requests 重新选择 MR。',
    'pages.reviewsNothingToPush': '没有要推送的审查',
    'pages.reviewsNothingToPushHint': '先添加审查评论，然后推送以与团队分享。',
    'pages.reviewsNoRemoteReviews': '远程还没有审查',
    'pages.reviewsNoRemoteReviewsHint': '远程仓库没有审查笔记。请先推送您的本地审查。',
    'pages.reviewsExitPR': '退出 PR 审查',
    'pages.reviewsBackToLocal': '返回本地审查评论',
    'pages.reviewsGoToPRs': '打开 Pull Requests 审查 PR',
    'pages.prLoadNotFound': '在 {provider} 上未找到仓库。请检查顶部的 provider 芯片 — 它可能与您的 remote URL 不匹配。Owner/repo: {owner}/{repo}',
  },
  de: {
    'pages.prReviewNoOwnerRepo': 'Repository-Besitzer/Name wurde nicht aus der Remote-URL erkannt. Öffnen Sie den Provider-Chip im Header, um neu zu erkennen oder zu wechseln.',
    'pages.prReviewGitLabProjectNotFound': 'GitLab-Projekt "{path}" nicht gefunden. Prüfen Sie, ob Ihr GitLab-Token (Einstellungen → Integrationen) Zugriff auf dieses Projekt hat.',
    'pages.prReviewNotFound': 'PR #{n} wurde auf {provider} nicht gefunden. Prüfen Sie, dass der Provider-Chip im Header zu Ihrem Repo passt und Ihr Token Zugriff auf {owner}/{repo} hat.',
    'pages.prReviewLoadFailed': 'PR-Review konnte nicht geladen werden',
    'pages.prTabOverview': 'Übersicht',
    'pages.prTabCommits': 'Commits',
    'pages.prTabFiles': 'Dateien',
    'pages.prTabDiscussion': 'Diskussion',
    'pages.prMergeDraftBlocked': 'Draft-PRs können nicht gemergt werden',
    'pages.prDescription': 'Beschreibung',
    'pages.prNoDescription': 'Keine Beschreibung angegeben.',
    'pages.prMeta': 'Zusammenfassung',
    'pages.prNoCommits': 'Keine Commits gefunden.',
    'pages.prChangedFiles': 'Geänderte Dateien',
    'pages.prDiffTooBig': 'Diff für diese Datei ist zu groß für die Inline-Anzeige. Auf GitHub öffnen.',
    'pages.prOpenFileExternal': 'Auf GitHub öffnen',
    'pages.prSelectFile': 'Datei auswählen, um Diff anzuzeigen',
    'pages.prNoComments': 'Noch keine Kommentare.',
    'pages.prCommentPlaceholder': 'Kommentar hinterlassen...',
    'pages.prCommentHint': 'Cmd/Ctrl+Enter zum Senden',
    'pages.prPostComment': 'Kommentar',
    'pages.prReviewNoProjectId': 'GitLab-Projekt-ID nicht aufgelöst. Zurück zu Pull Requests und MR neu auswählen.',
    'pages.reviewsNothingToPush': 'Keine Reviews zum Pushen',
    'pages.reviewsNothingToPushHint': 'Fügen Sie zuerst einen Review-Kommentar hinzu, dann pushen Sie, um ihn mit dem Team zu teilen.',
    'pages.reviewsNoRemoteReviews': 'Noch keine Reviews auf Remote',
    'pages.reviewsNoRemoteReviewsHint': 'Das Remote-Repository hat keine Review-Notizen. Pushen Sie zuerst Ihre lokalen Reviews.',
    'pages.reviewsExitPR': 'PR-Review verlassen',
    'pages.reviewsBackToLocal': 'Zurück zu lokalen Review-Kommentaren',
    'pages.reviewsGoToPRs': 'Pull Requests öffnen, um PR zu reviewen',
    'pages.prLoadNotFound': 'Repository auf {provider} nicht gefunden. Prüfen Sie den Provider-Chip im Header — er passt möglicherweise nicht zu Ihrer Remote-URL. Owner/repo: {owner}/{repo}',
  },
};

// ─── New keys for settings.ts ────────────────────────────────────────────
const SETTINGS_KEYS = {
  en: {
    'settings.aiGuard': 'AI Guard',
    'settings.aiGuardHint': 'Control which destructive git actions the AI Assistant is allowed to perform. "Deny" blocks the action entirely — the AI will tell the user to do it manually.',
    'settings.aiGuardDiscardChanges': 'Discard changes (reset --hard + clean)',
    'settings.aiGuardSyncRemote': 'Sync with remote (reset --hard origin)',
    'settings.aiGuardForcePush': 'Force push (--force)',
    'settings.aiGuardAmend': 'Commit --amend',
    'settings.aiGuardClean': 'Clean (delete untracked files)',
    'settings.aiGuardStashDrop': 'Stash drop',
    'settings.aiGuardAllow': 'Allow',
    'settings.aiGuardConfirm': 'Confirm',
    'settings.aiGuardDeny': 'Deny',
    'settings.aiContextSize': 'Context Size',
    'settings.aiMaxContext': 'Max context (characters)',
    'settings.aiContextHint': 'When the conversation history exceeds this size (in characters, not messages), old messages are compressed into a short summary. Higher = AI remembers more, but costs more tokens. Lower = cheaper, but AI forgets older context faster. Default: 20,000 chars (~5,000 tokens).',
    'settings.aiToolLimits': 'Tool Limits',
    'settings.aiMaxLogCommits': 'Max log commits',
    'settings.aiLogSummaryCount': 'Log summary count',
    'settings.aiStatusFilePreview': 'Status file preview',
    'settings.aiMaxDiffFiles': 'Max diff files',
    'settings.aiToolLimitsHint': 'Controls how much data the AI tools return. Higher = more detail but uses more context. Lower = faster and cheaper. Changes apply immediately.',
    'settings.aiRequestTimeout': 'Request Timeout',
    'settings.aiResponseTimeout': 'Response timeout (seconds)',
    'settings.aiRequestTimeoutHint': 'How long to wait for the AI provider to respond before giving up. Higher = more patient (good for slow models), but the UI freezes longer on timeout. 0 = wait forever.',
  },
  ru: {
    'settings.aiGuard': 'AI-защита',
    'settings.aiGuardHint': 'Контроль того, какие деструктивные git-действия может выполнять AI-ассистент. «Запретить» блокирует действие полностью — AI скажет пользователю сделать это вручную.',
    'settings.aiGuardDiscardChanges': 'Отменить изменения (reset --hard + clean)',
    'settings.aiGuardSyncRemote': 'Синхронизация с remote (reset --hard origin)',
    'settings.aiGuardForcePush': 'Принудительный push (--force)',
    'settings.aiGuardAmend': 'Изменить коммит (--amend)',
    'settings.aiGuardClean': 'Очистка (удалить untracked файлы)',
    'settings.aiGuardStashDrop': 'Удалить stash',
    'settings.aiGuardAllow': 'Разрешить',
    'settings.aiGuardConfirm': 'Подтвердить',
    'settings.aiGuardDeny': 'Запретить',
    'settings.aiContextSize': 'Размер контекста',
    'settings.aiMaxContext': 'Макс. контекст (символов)',
    'settings.aiContextHint': 'Когда история диалога превышает этот размер (в символах, не в сообщениях), старые сообщения сжимаются в краткую сводку. Больше = AI помнит больше, но стоит больше токенов. Меньше = дешевле, но AI быстрее забывает старый контекст. По умолчанию: 20 000 символов (~5 000 токенов).',
    'settings.aiToolLimits': 'Лимиты инструментов',
    'settings.aiMaxLogCommits': 'Макс. коммитов в логе',
    'settings.aiLogSummaryCount': 'Кол-во в сводке лога',
    'settings.aiStatusFilePreview': 'Превью файла статуса',
    'settings.aiMaxDiffFiles': 'Макс. файлов в diff',
    'settings.aiToolLimitsHint': 'Контролирует, сколько данных возвращают AI-инструменты. Больше = больше деталей, но больше контекста. Меньше = быстрее и дешевле. Изменения применяются немедленно.',
    'settings.aiRequestTimeout': 'Таймаут запроса',
    'settings.aiResponseTimeout': 'Таймаут ответа (секунды)',
    'settings.aiRequestTimeoutHint': 'Сколько ждать ответа от AI-провайдера перед отменой. Больше = терпеливее (хорошо для медленных моделей), но UI дольше зависает при таймауте. 0 = ждать вечно.',
  },
  zh: {
    'settings.aiGuard': 'AI 防护',
    'settings.aiGuardHint': '控制 AI 助手允许执行哪些破坏性 git 操作。"拒绝"会完全阻止操作 — AI 会告诉用户手动完成。',
    'settings.aiGuardDiscardChanges': '丢弃更改 (reset --hard + clean)',
    'settings.aiGuardSyncRemote': '与远程同步 (reset --hard origin)',
    'settings.aiGuardForcePush': '强制推送 (--force)',
    'settings.aiGuardAmend': '修改提交 (--amend)',
    'settings.aiGuardClean': '清理 (删除未跟踪文件)',
    'settings.aiGuardStashDrop': '删除 stash',
    'settings.aiGuardAllow': '允许',
    'settings.aiGuardConfirm': '确认',
    'settings.aiGuardDeny': '拒绝',
    'settings.aiContextSize': '上下文大小',
    'settings.aiMaxContext': '最大上下文 (字符)',
    'settings.aiContextHint': '当对话历史超过此大小（以字符为单位，而非消息数），旧消息会被压缩为简短摘要。越高 = AI 记住越多，但消耗更多 token。越低 = 更便宜，但 AI 更快遗忘旧上下文。默认：20,000 字符（~5,000 token）。',
    'settings.aiToolLimits': '工具限制',
    'settings.aiMaxLogCommits': '最大日志提交数',
    'settings.aiLogSummaryCount': '日志摘要数量',
    'settings.aiStatusFilePreview': '状态文件预览',
    'settings.aiMaxDiffFiles': '最大 diff 文件数',
    'settings.aiToolLimitsHint': '控制 AI 工具返回多少数据。越高 = 更多细节但使用更多上下文。越低 = 更快更便宜。更改立即生效。',
    'settings.aiRequestTimeout': '请求超时',
    'settings.aiResponseTimeout': '响应超时 (秒)',
    'settings.aiRequestTimeoutHint': '等待 AI 提供商响应的时间。越高 = 更耐心（适合慢模型），但超时时 UI 冻结更久。0 = 永久等待。',
  },
  de: {
    'settings.aiGuard': 'AI-Wächter',
    'settings.aiGuardHint': 'Steuert, welche destruktiven Git-Aktionen der AI-Assistent ausführen darf. "Verweigern" blockiert die Aktion vollständig — die AI wird den Nutzer auffordern, es manuell zu tun.',
    'settings.aiGuardDiscardChanges': 'Änderungen verwerfen (reset --hard + clean)',
    'settings.aiGuardSyncRemote': 'Mit Remote synchronisieren (reset --hard origin)',
    'settings.aiGuardForcePush': 'Force-Push (--force)',
    'settings.aiGuardAmend': 'Commit ändern (--amend)',
    'settings.aiGuardClean': 'Bereinigen (ungetrackte Dateien löschen)',
    'settings.aiGuardStashDrop': 'Stash löschen',
    'settings.aiGuardAllow': 'Erlauben',
    'settings.aiGuardConfirm': 'Bestätigen',
    'settings.aiGuardDeny': 'Verweigern',
    'settings.aiContextSize': 'Kontextgröße',
    'settings.aiMaxContext': 'Max. Kontext (Zeichen)',
    'settings.aiContextHint': 'Wenn der Gesprächsverlauf diese Größe überschreitet (in Zeichen, nicht Nachrichten), werden alte Nachrichten zu einer kurzen Zusammenfassung komprimiert. Höher = AI merkt sich mehr, kostet aber mehr Token. Niedriger = billiger, aber AI vergisst älteren Kontext schneller. Standard: 20.000 Zeichen (~5.000 Token).',
    'settings.aiToolLimits': 'Werkzeug-Limits',
    'settings.aiMaxLogCommits': 'Max. Log-Commits',
    'settings.aiLogSummaryCount': 'Log-Zusammenfassungsanzahl',
    'settings.aiStatusFilePreview': 'Status-Dateivorschau',
    'settings.aiMaxDiffFiles': 'Max. Diff-Dateien',
    'settings.aiToolLimitsHint': 'Steuert, wie viele Daten die AI-Werkzeuge zurückgeben. Höher = mehr Details, aber mehr Kontext. Niedriger = schneller und billiger. Änderungen gelten sofort.',
    'settings.aiRequestTimeout': 'Anfrage-Timeout',
    'settings.aiResponseTimeout': 'Antwort-Timeout (Sekunden)',
    'settings.aiRequestTimeoutHint': 'Wie lange auf die AI-Antwort gewartet wird, bevor abgebrochen wird. Höher = geduldiger (gut für langsame Modelle), aber die UI friert länger ein. 0 = ewig warten.',
  },
};

// ─── New keys for diff.ts ────────────────────────────────────────────────
const DIFF_KEYS = {
  en: {
    'diff.editOpenFailed': 'Failed to open file for editing',
    'diff.editOpened': 'File opened for editing',
    'diff.editOpenedHint': 'Save your changes in the editor, then return here to stage them.',
    'diff.stagedAfterEdit': 'Staged {file}',
    'diff.stageFailed': 'Failed to stage file',
    'diff.editFileTooltip': 'Edit this file in your editor. After saving, you\'ll be prompted to stage the changes.',
    'diff.editFile': 'Edit',
    'diff.stageAfterEditTitle': 'Stage edited changes?',
    'diff.stageAfterEditBody': 'You edited {file} in your editor. Stage the changes now?',
    'diff.stageAfterEditHint': 'Staging adds the file to the index so it can be committed. You can also stage later from the Changes page.',
  },
  ru: {
    'diff.editOpenFailed': 'Не удалось открыть файл для редактирования',
    'diff.editOpened': 'Файл открыт для редактирования',
    'diff.editOpenedHint': 'Сохраните изменения в редакторе, затем вернитесь сюда, чтобы добавить их в индекс.',
    'diff.stagedAfterEdit': '{file} добавлен в индекс',
    'diff.stageFailed': 'Не удалось добавить файл в индекс',
    'diff.editFileTooltip': 'Отредактируйте файл в вашем редакторе. После сохранения вам будет предложено добавить изменения в индекс.',
    'diff.editFile': 'Изменить',
    'diff.stageAfterEditTitle': 'Добавить изменённые файлы в индекс?',
    'diff.stageAfterEditBody': 'Вы отредактировали {file} в редакторе. Добавить изменения в индекс сейчас?',
    'diff.stageAfterEditHint': 'Добавление в индекс позволяет закоммитить файл. Вы также можете добавить позже на странице Changes.',
  },
  zh: {
    'diff.editOpenFailed': '打开文件进行编辑失败',
    'diff.editOpened': '文件已打开进行编辑',
    'diff.editOpenedHint': '在编辑器中保存更改，然后返回此处暂存它们。',
    'diff.stagedAfterEdit': '已暂存 {file}',
    'diff.stageFailed': '暂存文件失败',
    'diff.editFileTooltip': '在编辑器中编辑此文件。保存后，系统会提示您暂存更改。',
    'diff.editFile': '编辑',
    'diff.stageAfterEditTitle': '暂存已编辑的更改？',
    'diff.stageAfterEditBody': '您在编辑器中编辑了 {file}。现在暂存更改吗？',
    'diff.stageAfterEditHint': '暂存将文件添加到索引以便提交。您也可以稍后从 Changes 页面暂存。',
  },
  de: {
    'diff.editOpenFailed': 'Datei konnte nicht zum Bearbeiten geöffnet werden',
    'diff.editOpened': 'Datei zum Bearbeiten geöffnet',
    'diff.editOpenedHint': 'Speichern Sie Ihre Änderungen im Editor und kehren Sie dann hierher zurück, um sie zu stagen.',
    'diff.stagedAfterEdit': '{file} gestaged',
    'diff.stageFailed': 'Datei konnte nicht gestaged werden',
    'diff.editFileTooltip': 'Diese Datei in Ihrem Editor bearbeiten. Nach dem Speichern werden Sie aufgefordert, die Änderungen zu stagen.',
    'diff.editFile': 'Bearbeiten',
    'diff.stageAfterEditTitle': 'Bearbeitete Änderungen stagen?',
    'diff.stageAfterEditBody': 'Sie haben {file} im Editor bearbeitet. Änderungen jetzt stagen?',
    'diff.stageAfterEditHint': 'Staging fügt die Datei zum Index hinzu, damit sie committet werden kann. Sie können auch später auf der Changes-Seite stagen.',
  },
};

// ─── New keys for common.ts ──────────────────────────────────────────────
const COMMON_KEYS = {
  en: {
    'common.openExternal': 'Open in browser',
    'common.retry': 'Retry',
  },
  ru: {
    'common.openExternal': 'Открыть в браузере',
    'common.retry': 'Повторить',
  },
  zh: {
    'common.openExternal': '在浏览器中打开',
    'common.retry': '重试',
  },
  de: {
    'common.openExternal': 'Im Browser öffnen',
    'common.retry': 'Erneut versuchen',
  },
};

// ─── Helper: insert keys before the closing } of each locale block ────────
function addKeysToFile(filePath, keysByLocale) {
  const content = fs.readFileSync(filePath, 'utf8');
  let newContent = content;

  for (const [locale, keys] of Object.entries(keysByLocale)) {
    const entries = Object.entries(keys);
    if (entries.length === 0) continue;

    // Build the new key lines to insert
    const keyLines = entries.map(([k, v]) => `  '${k}': '${String(v).replace(/'/g, "\\'")}',`).join('\n');

    // Find the closing brace of this locale block.
    // Locale blocks start with `export const <locale>:` and end with `};`
    const localePattern = new RegExp(`(export const ${locale}[^{]*\\{[\\s\\S]*?)(\\n\\};)`);
    const match = newContent.match(localePattern);
    if (!match) {
      console.error(`Could not find locale block for ${locale} in ${filePath}`);
      continue;
    }

    // Check if any key already exists (skip insertion to avoid duplicates)
    const block = match[1];
    let hasExisting = false;
    for (const [k] of entries) {
      if (block.includes(`'${k}':`)) {
        console.log(`  [SKIP] ${locale}: '${k}' already exists in ${filePath}`);
        hasExisting = true;
        break;
      }
    }
    if (hasExisting) continue;

    // Insert before the closing brace
    const replacement = `${match[1]}\n${keyLines}\n${match[2]}`;
    newContent = newContent.replace(localePattern, replacement);
    console.log(`  [OK] ${locale}: added ${entries.length} keys to ${filePath}`);
  }

  fs.writeFileSync(filePath, newContent, 'utf8');
}

// ─── Main ─────────────────────────────────────────────────────────────────
console.log('Adding missing i18n keys...\n');
addKeysToFile(PAGES_FILE, PAGES_KEYS);
addKeysToFile(SETTINGS_FILE, SETTINGS_KEYS);
addKeysToFile(DIFF_FILE, DIFF_KEYS);

// Common keys — check if common.ts exists
if (fs.existsSync(COMMON_FILE)) {
  addKeysToFile(COMMON_FILE, COMMON_KEYS);
} else {
  console.log(`  [SKIP] ${COMMON_FILE} does not exist — common keys need to be added to a different file`);
  // Try adding to pages.ts as fallback
  addKeysToFile(PAGES_FILE, COMMON_KEYS);
}

console.log('\nDone! Run i18n parity test to verify: npx vitest run tests/unit/i18nParity.test.ts');
