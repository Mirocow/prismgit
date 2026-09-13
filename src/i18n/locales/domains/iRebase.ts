/**
 * Interactive rebase domain translations.
 * Sweep owner: this file is the ONLY dictionary for the 'iRebase' domain —
 * add every new key to ALL FOUR locales (unit tests assert key parity).
 *
 * Covers: InteractiveRebaseDialog.
 * English values are byte-identical to the previously hardcoded strings.
 */
export const en: Record<string, string> = {
  'iRebase.title': 'Interactive Rebase',
  'iRebase.rebasingOnto': 'Rebasing onto:',
  'iRebase.commitsCount': '{count} commits',
  'iRebase.selectBranchHint': 'Select this branch (visible in all tools) — click to view in History',
  'iRebase.autoSquashTitle': 'Squash adjacent commits with same subject (mimics git rebase --autosquash)',
  'iRebase.autoSquash': 'Auto-Squash',
  'iRebase.coalesceTitle': 'Toggle Coalesce mode: drag one commit onto another to merge them',
  'iRebase.coalesce': 'Coalesce',
  'iRebase.coalesceOnHint': 'Coalesce mode ON — drag one commit onto another to merge them',
  'iRebase.coalesceOffHint': 'Coalesce mode OFF',
  'iRebase.coalesceDropHint': 'Drop one commit onto another to combine',
  'iRebase.dragReorderHint': 'Drag rows to reorder',
  'iRebase.loadingCommits': 'Loading commits...',
  'iRebase.dragHandleTitle': 'Drag to reorder',
  'iRebase.selectCommitHint': 'Select this commit — click to view in History',
  'iRebase.splitCommitTitle': "Split commit (marks as 'edit' — rebase pauses here)",
  'iRebase.historyWillBeRewritten': 'History will be rewritten',
  'iRebase.noChanges': 'No changes — same as original history',
  'iRebase.startRebase': 'Start Rebase',
};

export const ru: Record<string, string> = {
  'iRebase.title': 'Интерактивный Rebase',
  'iRebase.rebasingOnto': 'Rebase на:',
  'iRebase.commitsCount': '{count} коммитов',
  'iRebase.selectBranchHint': 'Выбрать эту ветку (видна во всех инструментах) — нажмите, чтобы открыть в Истории',
  'iRebase.autoSquashTitle': 'Сжать соседние коммиты с тем же subject (имитирует git rebase --autosquash)',
  'iRebase.autoSquash': 'Auto-Squash',
  'iRebase.coalesceTitle': 'Переключить режим Coalesce: перетащите один коммит на другой, чтобы объединить',
  'iRebase.coalesce': 'Coalesce',
  'iRebase.coalesceOnHint': 'Режим Coalesce ВКЛ — перетащите один коммит на другой, чтобы объединить',
  'iRebase.coalesceOffHint': 'Режим Coalesce ВЫКЛ',
  'iRebase.coalesceDropHint': 'Перетащите один коммит на другой, чтобы объединить',
  'iRebase.dragReorderHint': 'Перетащите строки для упорядочивания',
  'iRebase.loadingCommits': 'Загрузка коммитов...',
  'iRebase.dragHandleTitle': 'Перетащите для упорядочивания',
  'iRebase.selectCommitHint': 'Выбрать этот коммит — нажмите, чтобы открыть в Истории',
  'iRebase.splitCommitTitle': "Разделить коммит (помечает как 'edit' — rebase остановится здесь)",
  'iRebase.historyWillBeRewritten': 'История будет переписана',
  'iRebase.noChanges': 'Нет изменений — то же, что и оригинальная история',
  'iRebase.startRebase': 'Запустить Rebase',
};

export const zh: Record<string, string> = {
  'iRebase.title': '交互式变基',
  'iRebase.rebasingOnto': '变基到:',
  'iRebase.commitsCount': '{count} 个提交',
  'iRebase.selectBranchHint': '选择此分支 (在所有工具中可见) — 点击在历史中查看',
  'iRebase.autoSquashTitle': '压缩相同 subject 的相邻提交 (模拟 git rebase --autosquash)',
  'iRebase.autoSquash': 'Auto-Squash',
  'iRebase.coalesceTitle': '切换 Coalesce 模式: 拖动一个提交到另一个以合并',
  'iRebase.coalesce': 'Coalesce',
  'iRebase.coalesceOnHint': 'Coalesce 模式开启 — 拖动一个提交到另一个以合并',
  'iRebase.coalesceOffHint': 'Coalesce 模式关闭',
  'iRebase.coalesceDropHint': '拖动一个提交到另一个以合并',
  'iRebase.dragReorderHint': '拖动行以重新排序',
  'iRebase.loadingCommits': '正在加载提交...',
  'iRebase.dragHandleTitle': '拖动以重新排序',
  'iRebase.selectCommitHint': '选择此提交 — 点击在历史中查看',
  'iRebase.splitCommitTitle': '拆分提交 (标记为 edit — 变基在此暂停)',
  'iRebase.historyWillBeRewritten': '历史将被重写',
  'iRebase.noChanges': '无更改 — 与原始历史相同',
  'iRebase.startRebase': '开始变基',
};

export const de: Record<string, string> = {
  'iRebase.title': 'Interaktiver Rebase',
  'iRebase.rebasingOnto': 'Rebase auf:',
  'iRebase.commitsCount': '{count} Commits',
  'iRebase.selectBranchHint': 'Diesen Branch auswählen (in allen Tools sichtbar) — klicken, um in der Historie anzuzeigen',
  'iRebase.autoSquashTitle': 'Angrenzende Commits mit gleichem Subject squashen (imitiert git rebase --autosquash)',
  'iRebase.autoSquash': 'Auto-Squash',
  'iRebase.coalesceTitle': 'Coalesce-Modus umschalten: einen Commit auf einen anderen ziehen, um sie zusammenzuführen',
  'iRebase.coalesce': 'Coalesce',
  'iRebase.coalesceOnHint': 'Coalesce-Modus AN — einen Commit auf einen anderen ziehen, um zusammenzuführen',
  'iRebase.coalesceOffHint': 'Coalesce-Modus AUS',
  'iRebase.coalesceDropHint': 'Einen Commit auf einen anderen ziehen, um zusammenzuführen',
  'iRebase.dragReorderHint': 'Zeilen ziehen zum Sortieren',
  'iRebase.loadingCommits': 'Commits werden geladen...',
  'iRebase.dragHandleTitle': 'Ziehen zum Sortieren',
  'iRebase.selectCommitHint': 'Diesen Commit auswählen — klicken, um in der Historie anzuzeigen',
  'iRebase.splitCommitTitle': "Commit aufteilen (als 'edit' markiert — Rebase pausiert hier)",
  'iRebase.historyWillBeRewritten': 'Historie wird umgeschrieben',
  'iRebase.noChanges': 'Keine Änderungen — wie die Original-Historie',
  'iRebase.startRebase': 'Rebase starten',
};
