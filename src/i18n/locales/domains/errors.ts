/**
 * Error reporting domain translations.
 * Sweep owner: this file is the ONLY dictionary for the 'errors' domain —
 * add every new key to ALL FOUR locales (unit tests assert key parity).
 *
 * Covers: ErrorReportDialog (modal shown when a global error is caught),
 * GlobalErrorBoundary, useWatchdog, and the boot-time error recovery
 * screen in index.html (which reads the persisted error + shows plain
 * HTML — those strings are hard-coded in index.html for now since they
 * must render before React mounts and i18n loads).
 */

export const en: Record<string, string> = {
  'errors.kindRender': 'Render error',
  'errors.kindUncaught': 'Uncaught error',
  'errors.kindUnhandledRejection': 'Unhandled promise rejection',
  'errors.kindWatchdog': 'UI frozen (watchdog)',
  'errors.kindUnknown': 'Error',
  'errors.stackTrace': 'Stack trace',
  'errors.componentStack': 'Component stack',
  'errors.noStackAvailable': '(no stack trace available)',
  'errors.fullReportPreview': 'Full report preview (what gets copied)',
  'errors.hint': 'An unexpected error occurred. Please copy the report above and send it to the developer — it includes the stack trace and app version needed to diagnose the issue. Click "Reload app" to restart.',
  'errors.copyReport': 'Copy report',
  'errors.copied': 'Copied!',
  'errors.copiedToClipboard': 'Error report copied to clipboard',
  'errors.copyFailed': 'Failed to copy error report',
  'errors.copyTooltip': 'Copy the full error report (with stack trace) to the clipboard',
  'errors.reloadApp': 'Reload app',
  'errors.reloadTooltip': 'Reload the app (most errors are recoverable with a reload)',
  'errors.clearLog': 'Clear log',
  'errors.clearErrorLog': 'Clear the persisted error so the dialog doesn\'t re-appear on next reload',
  'errors.errorLogCleared': 'Error log cleared',
  'errors.watchdogFreeze': 'UI was frozen (unresponsive)',
};

export const ru: Record<string, string> = {
  'errors.kindRender': 'Ошибка рендеринга',
  'errors.kindUncaught': 'Необработанная ошибка',
  'errors.kindUnhandledRejection': 'Необработанное отклонение промиса',
  'errors.kindWatchdog': 'UI завис (watchdog)',
  'errors.kindUnknown': 'Ошибка',
  'errors.stackTrace': 'Трассировка стека',
  'errors.componentStack': 'Стек компонентов',
  'errors.noStackAvailable': '(трассировка стека недоступна)',
  'errors.fullReportPreview': 'Предпросмотр полного отчёта (что будет скопировано)',
  'errors.hint': 'Произошла непредвиденная ошибка. Скопируйте отчёт выше и отправьте его разработчику — он содержит трассировку стека и версию приложения, необходимые для диагностики. Нажмите «Перезагрузить приложение» для перезапуска.',
  'errors.copyReport': 'Копировать отчёт',
  'errors.copied': 'Скопировано!',
  'errors.copiedToClipboard': 'Отчёт об ошибке скопирован в буфер обмена',
  'errors.copyFailed': 'Не удалось скопировать отчёт об ошибке',
  'errors.copyTooltip': 'Скопировать полный отчёт об ошибке (с трассировкой стека) в буфер обмена',
  'errors.reloadApp': 'Перезагрузить приложение',
  'errors.reloadTooltip': 'Перезагрузить приложение (большинство ошибок устраняются перезагрузкой)',
  'errors.clearLog': 'Очистить журнал',
  'errors.clearErrorLog': 'Очистить сохранённую ошибку, чтобы диалог не появлялся при следующем запуске',
  'errors.errorLogCleared': 'Журнал ошибок очищен',
  'errors.watchdogFreeze': 'UI был завис (не отвечал)',
};

export const zh: Record<string, string> = {
  'errors.kindRender': '渲染错误',
  'errors.kindUncaught': '未捕获的错误',
  'errors.kindUnhandledRejection': '未处理的 Promise 拒绝',
  'errors.kindWatchdog': 'UI 冻结（看门狗）',
  'errors.kindUnknown': '错误',
  'errors.stackTrace': '堆栈跟踪',
  'errors.componentStack': '组件堆栈',
  'errors.noStackAvailable': '（无堆栈跟踪可用）',
  'errors.fullReportPreview': '完整报告预览（将被复制的内容）',
  'errors.hint': '发生了意外错误。请复制上面的报告并发送给开发者——它包含诊断问题所需的堆栈跟踪和应用程序版本。点击"重新加载应用"以重启。',
  'errors.copyReport': '复制报告',
  'errors.copied': '已复制！',
  'errors.copiedToClipboard': '错误报告已复制到剪贴板',
  'errors.copyFailed': '复制错误报告失败',
  'errors.copyTooltip': '将完整的错误报告（含堆栈跟踪）复制到剪贴板',
  'errors.reloadApp': '重新加载应用',
  'errors.reloadTooltip': '重新加载应用（大多数错误可通过重新加载恢复）',
  'errors.clearLog': '清除日志',
  'errors.clearErrorLog': '清除已保存的错误，使对话框在下次重新加载时不再出现',
  'errors.errorLogCleared': '错误日志已清除',
  'errors.watchdogFreeze': 'UI 已冻结（无响应）',
};

export const de: Record<string, string> = {
  'errors.kindRender': 'Render-Fehler',
  'errors.kindUncaught': 'Nicht abgefangener Fehler',
  'errors.kindUnhandledRejection': 'Nicht behandelte Promise-Ablehnung',
  'errors.kindWatchdog': 'UI eingefroren (Watchdog)',
  'errors.kindUnknown': 'Fehler',
  'errors.stackTrace': 'Stack-Trace',
  'errors.componentStack': 'Komponenten-Stack',
  'errors.noStackAvailable': '(kein Stack-Trace verfügbar)',
  'errors.fullReportPreview': 'Vollständige Berichtsvorschau (was kopiert wird)',
  'errors.hint': 'Ein unerwarteter Fehler ist aufgetreten. Bitte kopieren Sie den obigen Bericht und senden Sie ihn an den Entwickler — er enthält den Stack-Trace und die App-Version, die zur Diagnose benötigt werden. Klicken Sie auf „App neu laden", um neu zu starten.',
  'errors.copyReport': 'Bericht kopieren',
  'errors.copied': 'Kopiert!',
  'errors.copiedToClipboard': 'Fehlerbericht in die Zwischenablage kopiert',
  'errors.copyFailed': 'Fehlerbericht konnte nicht kopiert werden',
  'errors.copyTooltip': 'Den vollständigen Fehlerbericht (mit Stack-Trace) in die Zwischenablage kopieren',
  'errors.reloadApp': 'App neu laden',
  'errors.reloadTooltip': 'App neu laden (die meisten Fehler sind durch Neuladen behebbar)',
  'errors.clearLog': 'Protokoll löschen',
  'errors.clearErrorLog': 'Den gespeicherten Fehler löschen, damit der Dialog beim nächsten Neuladen nicht erneut erscheint',
  'errors.errorLogCleared': 'Fehlerprotokoll gelöscht',
  'errors.watchdogFreeze': 'UI war eingefroren (nicht reagierend)',
};
