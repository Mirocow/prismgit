/**
 * Conflict resolution domain translations.
 * Sweep owner: this file is the ONLY dictionary for the 'conflict' domain —
 * add every new key to ALL FOUR locales (unit tests assert key parity).
 *
 * Covers: ConflictMergeView, ConflictSolver (binary/delete-modify chooser +
 * toolbar titles + pane labels + shortcuts hint).
 * English values are byte-identical to the previously hardcoded strings.
 */
export const en: Record<string, string> = {
  // Binary / delete-modify conflict chooser
  'conflict.binaryTitle': 'Binary file conflict',
  'conflict.deleteModifyTitle': 'Delete / Modify conflict',
  'conflict.binaryHint': 'This file is binary and cannot be merged with a text-based solver. Choose which version to keep.',
  'conflict.deleteOursHint': 'The file was deleted on our side but modified on their side. Choose to keep theirs or delete.',
  'conflict.deleteTheirsHint': 'The file was deleted on their side but modified on our side. Choose to keep ours or delete.',

  // Toolbar button labels
  'conflict.takeLeft': 'Take Left',
  'conflict.takeRight': 'Take Right',
  'conflict.takeLR': 'Take L,R',
  'conflict.takeRL': 'Take R,L',
  'conflict.mergeTool': 'Merge Tool',
  'conflict.vsCode': 'VS Code',

  // Toolbar button titles (tooltips)
  'conflict.takeLeftTitle': 'Take Left — use OURS for this hunk (Ctrl+1)',
  'conflict.takeRightTitle': 'Take Right — use THEIRS for this hunk (Ctrl+2)',
  'conflict.takeLeftRightTitle': 'Take Left, Right — ours first then theirs (concatenate)',
  'conflict.takeRightLeftTitle': 'Take Right, Left — theirs first then ours',
  'conflict.vsCodeTitle': 'Open in VS Code 3-way merge editor',
  'conflict.saveStageTitle': 'Save resolved content and stage the file (Ctrl+Enter)',
  'conflict.prevConflictTitle': 'Previous conflict (Shift+F7)',
  'conflict.nextConflictTitle': 'Next conflict (F7)',
  'conflict.takeOursForHunk': 'Take ours for this hunk',
  'conflict.takeTheirsForHunk': 'Take theirs for this hunk',
  'conflict.runGitMergetool': 'Run git mergetool (uses your configured merge.tool)',

  // Pane labels and helper text
  'conflict.oursPaneTitle': 'ours ("HEAD")',
  'conflict.theirsPaneTitle': 'theirs',
  'conflict.linesCountSuffix': '({count} lines)',
  'conflict.editableHint': '(editable)',
  'conflict.modified': 'modified',
  'conflict.conflictsLabel': 'conflicts',
  'conflict.editableCenterHint': 'Editable center — direct typing or use toolbar actions above.',
  'conflict.shortcutsHint': 'Shortcuts: F7 next · Shift+F7 prev · Ctrl+1 ours · Ctrl+2 theirs · Ctrl+3 both · Ctrl+Enter save',
  'conflict.reloadingFile': 'Reloading file content…',
};

export const ru: Record<string, string> = {
  'conflict.binaryTitle': 'Конфликт бинарного файла',
  'conflict.deleteModifyTitle': 'Конфликт Удалить / Изменить',
  'conflict.binaryHint': 'Этот файл бинарный и не может быть разрешён текстовым решателем. Выберите, какую версию оставить.',
  'conflict.deleteOursHint': 'Файл удалён на нашей стороне, но изменён на их стороне. Возьмите их версию или удалите.',
  'conflict.deleteTheirsHint': 'Файл удалён на их стороне, но изменён на нашей. Возьмите нашу версию или удалите.',

  'conflict.takeLeft': 'Взять левый',
  'conflict.takeRight': 'Взять правый',
  'conflict.takeLR': 'Взять Л,П',
  'conflict.takeRL': 'Взять П,Л',
  'conflict.mergeTool': 'Merge Tool',
  'conflict.vsCode': 'VS Code',

  'conflict.takeLeftTitle': 'Взять левый — использовать OURS для этого хунка (Ctrl+1)',
  'conflict.takeRightTitle': 'Взять правый — использовать THEIRS для этого хунка (Ctrl+2)',
  'conflict.takeLeftRightTitle': 'Взять левый, правый — сначала ours, затем theirs (конкатенация)',
  'conflict.takeRightLeftTitle': 'Взять правый, левый — сначала theirs, затем ours',
  'conflict.vsCodeTitle': 'Открыть в 3-стороннем merge-редакторе VS Code',
  'conflict.saveStageTitle': 'Сохранить разрешённое содержимое и проиндексировать файл (Ctrl+Enter)',
  'conflict.prevConflictTitle': 'Предыдущий конфликт (Shift+F7)',
  'conflict.nextConflictTitle': 'Следующий конфликт (F7)',
  'conflict.takeOursForHunk': 'Взять ours для этого хунка',
  'conflict.takeTheirsForHunk': 'Взять theirs для этого хунка',
  'conflict.runGitMergetool': 'Запустить git mergetool (использует настроенный merge.tool)',

  'conflict.oursPaneTitle': 'ours ("HEAD")',
  'conflict.theirsPaneTitle': 'theirs',
  'conflict.linesCountSuffix': '({count} строк)',
  'conflict.editableHint': '(редактируемый)',
  'conflict.modified': 'изменён',
  'conflict.conflictsLabel': 'конфликтов',
  'conflict.editableCenterHint': 'Редактируемый центр — прямой ввод или используйте действия тулбара выше.',
  'conflict.shortcutsHint': 'Горячие клавиши: F7 следующий · Shift+F7 предыдущий · Ctrl+1 ours · Ctrl+2 theirs · Ctrl+3 оба · Ctrl+Enter сохранить',
  'conflict.reloadingFile': 'Перезагрузка содержимого файла…',
};

export const zh: Record<string, string> = {
  'conflict.binaryTitle': '二进制文件冲突',
  'conflict.deleteModifyTitle': '删除 / 修改冲突',
  'conflict.binaryHint': '此文件是二进制文件，无法用基于文本的解决器合并。请选择要保留的版本。',
  'conflict.deleteOursHint': '文件在我们这边被删除，但在他们那边被修改。选择保留 theirs 或删除。',
  'conflict.deleteTheirsHint': '文件在他们那边被删除，但在我们这边被修改。选择保留 ours 或删除。',

  'conflict.takeLeft': '取左侧',
  'conflict.takeRight': '取右侧',
  'conflict.takeLR': '取 左,右',
  'conflict.takeRL': '取 右,左',
  'conflict.mergeTool': '合并工具',
  'conflict.vsCode': 'VS Code',

  'conflict.takeLeftTitle': '取左侧 — 对此冲突块使用 OURS (Ctrl+1)',
  'conflict.takeRightTitle': '取右侧 — 对此冲突块使用 THEIRS (Ctrl+2)',
  'conflict.takeLeftRightTitle': '取左侧,右侧 — 先 ours 再 theirs (连接)',
  'conflict.takeRightLeftTitle': '取右侧,左侧 — 先 theirs 再 ours',
  'conflict.vsCodeTitle': '在 VS Code 三方合并编辑器中打开',
  'conflict.saveStageTitle': '保存解决后的内容并暂存文件 (Ctrl+Enter)',
  'conflict.prevConflictTitle': '上一个冲突 (Shift+F7)',
  'conflict.nextConflictTitle': '下一个冲突 (F7)',
  'conflict.takeOursForHunk': '对此冲突块取 ours',
  'conflict.takeTheirsForHunk': '对此冲突块取 theirs',
  'conflict.runGitMergetool': '运行 git mergetool (使用您配置的 merge.tool)',

  'conflict.oursPaneTitle': 'ours ("HEAD")',
  'conflict.theirsPaneTitle': 'theirs',
  'conflict.linesCountSuffix': '({count} 行)',
  'conflict.editableHint': '(可编辑)',
  'conflict.modified': '已修改',
  'conflict.conflictsLabel': '个冲突',
  'conflict.editableCenterHint': '可编辑的中间面板 — 直接输入或使用上方工具栏操作。',
  'conflict.shortcutsHint': '快捷键: F7 下一个 · Shift+F7 上一个 · Ctrl+1 ours · Ctrl+2 theirs · Ctrl+3 两者 · Ctrl+Enter 保存',
  'conflict.reloadingFile': '重新加载文件内容…',
};

export const de: Record<string, string> = {
  'conflict.binaryTitle': 'Binärdatei-Konflikt',
  'conflict.deleteModifyTitle': 'Löschen / Ändern-Konflikt',
  'conflict.binaryHint': 'Diese Datei ist binär und kann nicht mit einem textbasierten Solver gemergt werden. Wählen Sie, welche Version behalten werden soll.',
  'conflict.deleteOursHint': 'Die Datei wurde auf unserer Seite gelöscht, aber auf ihrer Seite geändert. theirs behalten oder löschen.',
  'conflict.deleteTheirsHint': 'Die Datei wurde auf ihrer Seite gelöscht, aber auf unserer Seite geändert. ours behalten oder löschen.',

  'conflict.takeLeft': 'Links nehmen',
  'conflict.takeRight': 'Rechts nehmen',
  'conflict.takeLR': 'L,R nehmen',
  'conflict.takeRL': 'R,L nehmen',
  'conflict.mergeTool': 'Merge-Tool',
  'conflict.vsCode': 'VS Code',

  'conflict.takeLeftTitle': 'Links nehmen — OURS für diesen Hunk verwenden (Ctrl+1)',
  'conflict.takeRightTitle': 'Rechts nehmen — THEIRS für diesen Hunk verwenden (Ctrl+2)',
  'conflict.takeLeftRightTitle': 'Links, Rechts nehmen — zuerst ours dann theirs (verketten)',
  'conflict.takeRightLeftTitle': 'Rechts, Links nehmen — zuerst theirs dann ours',
  'conflict.vsCodeTitle': 'Im 3-Wege-Merge-Editor von VS Code öffnen',
  'conflict.saveStageTitle': 'Aufgelösten Inhalt speichern und Datei indexieren (Ctrl+Enter)',
  'conflict.prevConflictTitle': 'Vorheriger Konflikt (Shift+F7)',
  'conflict.nextConflictTitle': 'Nächster Konflikt (F7)',
  'conflict.takeOursForHunk': 'ours für diesen Hunk übernehmen',
  'conflict.takeTheirsForHunk': 'theirs für diesen Hunk übernehmen',
  'conflict.runGitMergetool': 'git mergetool ausführen (verwendet konfiguriertes merge.tool)',

  'conflict.oursPaneTitle': 'ours ("HEAD")',
  'conflict.theirsPaneTitle': 'theirs',
  'conflict.linesCountSuffix': '({count} Zeilen)',
  'conflict.editableHint': '(bearbeitbar)',
  'conflict.modified': 'geändert',
  'conflict.conflictsLabel': 'Konflikte',
  'conflict.editableCenterHint': 'Bearbeitbare Mitte — direkte Eingabe oder Toolbar-Aktionen oben verwenden.',
  'conflict.shortcutsHint': 'Tastenkürzel: F7 weiter · Shift+F7 zurück · Ctrl+1 ours · Ctrl+2 theirs · Ctrl+3 beide · Ctrl+Enter speichern',
  'conflict.reloadingFile': 'Dateiinhalt wird neu geladen…',
};
