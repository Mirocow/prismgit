/**
 * Toast messages — short user-facing notifications shown by toastStore.
 *
 * Most of these were previously hardcoded English strings in:
 *   - src/App.tsx (70 toast calls)
 *   - src/pages/HistoryPage.tsx (78 toast calls)
 *   - src/components/Toolbar.tsx (25 toast calls)
 *   - src/components/ConflictMergeView.tsx (18 toast calls)
 *   - src/pages/ChangesPage.tsx (8 toast calls)
 *   - src/components/RepoSettingsDialog.tsx (12 toast calls)
 *   - src/components/MergeInProgressPanel.tsx (6 toast calls)
 *   - src/pages/BranchesPage.tsx (2 toast calls)
 *
 * Key prefix: 'toast.'
 * Sub-prefixes by area:
 *   - toast.git.*     — git operations (commit, push, pull, fetch, etc.)
 *   - toast.merge.*   — merge/rebase operations
 *   - toast.bisect.*  — bisect operations
 *   - toast.tag.*     — tag create/delete
 *   - toast.stash.*   — stash operations
 *   - toast.discard.* — discard/reset operations
 *   - toast.edit.*    — edit message / author
 *   - toast.vscode.*  — VS Code integration
 *   - toast.conflict.*— merge conflict resolution
 *   - toast.repo.*    — repository open/close/clone/init
 *   - toast.ai.*      — AI assistant
 */

export const en: Record<string, string> = {
  // ── Generic git operations ──────────────────────────────────────────────
  'toast.git.pushSuccess': 'Pushed successfully',
  'toast.git.pushFailed': 'Push failed',
  'toast.git.pullFailed': 'Pull failed',
  'toast.git.pullConflicts': 'Pull resulted in conflicts',
  'toast.git.fetchSuccess': 'Fetched successfully',
  'toast.git.fetchFailed': 'Fetch failed',
  'toast.git.stageSuccess': 'Staged {file}',
  'toast.git.stageFailed': 'Stage failed',
  'toast.git.stageAllSuccess': 'All changes staged',
  'toast.git.unstageSuccess': 'Unstaged {file}',
  'toast.git.unstageFailed': 'Unstage failed',
  'toast.git.unstageAllSuccess': 'All changes unstaged',
  'toast.git.discardSuccess': 'Changes discarded',
  'toast.git.discardFailed': 'Discard failed',
  'toast.git.discardedIn': 'Discarded changes in {file}',
  'toast.git.checkoutSuccess': 'Checked out {ref}',
  'toast.git.checkoutFailed': 'Checkout failed',
  'toast.git.noLocalBranch': 'No local branch checked out',
  'toast.git.setTrackedFailed': 'Set tracked branch failed',
  'toast.git.stopTrackingFailed': 'Stop tracking failed',
  'toast.git.invalidFormat': 'Invalid format',
  'toast.git.resolveFailed': 'Resolve failed',
  'toast.git.noFileSelected': 'No file selected',
  'toast.git.openRepoFailed': 'Failed to open repository',

  // ── Merge / rebase ────────────────────────────────────────────────────────
  'toast.merge.committed': 'Merge committed',
  'toast.merge.continueFailed': 'Continue failed',
  'toast.merge.aborted': 'Merge aborted',
  'toast.merge.abortFailed': 'Abort failed',
  'toast.merge.takeOursFailed': 'Take ours failed',
  'toast.merge.takeTheirsFailed': 'Take theirs failed',
  'toast.merge.rebaseStarted': 'Rebase started',
  'toast.merge.rebaseFailed': 'Rebase failed',
  'toast.merge.rebaseCompleted': 'Interactive rebase completed',
  'toast.merge.rebaseFailedGeneric': 'Rebase failed',
  'toast.merge.abortStateFailed': 'Abort {state} failed',
  'toast.merge.startEditStarted': 'Interactive edit started — use the Rebase panel to continue',
  'toast.merge.splitStartFailed': 'Failed to start split',
  'toast.merge.splitFailed': 'Split failed',
  'toast.merge.splitOffFailed': 'Split off failed',
  'toast.merge.splitMoved': 'Moved {count} file(s)',
  'toast.merge.selectFileRequired': 'Select at least one file',
  'toast.merge.messageRequired': 'New commit message is required',

  // ── Cherry-pick / revert ─────────────────────────────────────────────────
  'toast.cherryPick.cherryPicked': 'Cherry-picked',
  'toast.cherryPick.failed': 'Cherry-pick failed',
  'toast.cherryPick.emptyAfter': 'The previous cherry-pick is now empty',
  'toast.cherryPick.finished': 'Cherry-pick finished — commit created',
  'toast.cherryPick.continueFailed': 'Cherry-pick Continue failed',
  'toast.revert.reverted': 'Reverted',
  'toast.revert.failed': 'Revert failed',

  // ── Reset ────────────────────────────────────────────────────────────────
  'toast.reset.success': 'Reset {mode} to {hash}',
  'toast.reset.failed': 'Reset failed',

  // ── Tag ──────────────────────────────────────────────────────────────────
  'toast.tag.created': 'Tag {name} created{target}',
  'toast.tag.createFailed': 'Add tag failed',

  // ── Stash ────────────────────────────────────────────────────────────────
  'toast.stash.saved': 'Stash saved',
  'toast.stash.failed': 'Stash failed',
  'toast.stash.popped': 'Stash popped',
  'toast.stash.popFailed': 'Pop failed',
  'toast.stash.allStashed': 'All changes stashed',
  'toast.stash.none': 'No stashes',
  'toast.stash.aborted': 'Operation aborted',
  'toast.stash.abortFailed': 'Stash & abort failed',

  // ── Edit commit message / author ────────────────────────────────────────
  'toast.edit.messageUpdated': 'Commit message updated',
  'toast.edit.messageFailed': 'Edit message failed',
  'toast.edit.authorUpdated': 'Author updated',
  'toast.edit.authorFailed': 'Edit author failed',
  'toast.edit.noteRemoved': 'Note removed',
  'toast.edit.noteRemoveFailed': 'Remove note failed',

  // ── VS Code integration ─────────────────────────────────────────────────
  'toast.vscode.opened': 'Opened in VS Code',
  'toast.vscode.openFailed': 'Failed to open VS Code',
  'toast.vscode.mergeEditorOpened': 'Opened in VS Code merge editor',
  'toast.vscode.notFound': 'VS Code not found',
  'toast.vscode.mergeFailed': 'VS Code merge failed',
  'toast.vscode.mergeToolCompleted': 'Merge tool completed',
  'toast.vscode.mergeToolFailed': 'Merge tool failed',

  // ── Conflict resolution ──────────────────────────────────────────────────
  'toast.conflict.notConflicted': 'File is not conflicted',
  'toast.conflict.markersRemain': 'Conflict markers remain',
  'toast.conflict.takeOurs': 'Took ours',
  'toast.conflict.takeTheirs': 'Took theirs',
  'toast.conflict.deleted': 'Resolved as deleted',
  'toast.conflict.failed': 'Failed',
  'toast.conflict.allResolved': 'All conflicts resolved',
  'toast.conflict.hunkResolved': 'Hunk {idx}: {resolution}',
  'toast.conflict.searchFailed': 'Search failed',

  // ── Repository operations ────────────────────────────────────────────────
  'toast.repo.settingsSaved': 'Repository settings saved',
  'toast.repo.settingsLoadFailed': 'Failed to load repository settings',
  'toast.repo.settingsSaveFailed': 'Failed to save settings',

  // ── Bisect ───────────────────────────────────────────────────────────────
  'toast.bisect.started': 'Bisect started',
  'toast.bisect.headBad': 'HEAD marked as bad',
  'toast.bisect.headGood': 'HEAD marked as good',
  'toast.bisect.skipped': 'Commit skipped',
  'toast.bisect.finished': 'Bisect finished',
  'toast.bisect.failed': 'Bisect failed',

  // ── History-specific ─────────────────────────────────────────────────────
  'toast.history.loadFailed': 'Failed to load history',
  'toast.history.loadMoreFailed': 'Failed to load more commits',
  'toast.history.commitDiffFailed': 'Failed to load commit diff',

  // ── Smart pull ──────────────────────────────────────────────────────────
  'toast.smartPull.success': 'Smart pull: {strategy}',

  // ── Investigate page ────────────────────────────────────────────────────
  'toast.investigate.copied': 'Copied',

  // ── Interactive rebase ──────────────────────────────────────────────────
  'toast.iRebase.loadFailed': 'Failed to load commits',
  'toast.iRebase.autoSquashed': 'Auto-squashed {count} commit(s)',
  'toast.iRebase.noCoalesce': 'No adjacent commits with same subject to auto-squash',
  'toast.iRebase.coalescing': 'Coalescing {detail}',
  'toast.iRebase.marked': 'Marked {detail}',
  'toast.iRebase.targetRequired': 'Target branch is required',

  // ── Generic fallback ────────────────────────────────────────────────────
  'toast.generic.failed': 'Failed',
};

export const ru: Record<string, string> = {
  'toast.git.pushSuccess': 'Успешно отправлено',
  'toast.git.pushFailed': 'Ошибка push',
  'toast.git.pullFailed': 'Ошибка pull',
  'toast.git.pullConflicts': 'Pull привёл к конфликтам',
  'toast.git.fetchSuccess': 'Успешно получено',
  'toast.git.fetchFailed': 'Ошибка fetch',
  'toast.git.stageSuccess': 'Индексирован {file}',
  'toast.git.stageFailed': 'Не удалось проиндексировать',
  'toast.git.stageAllSuccess': 'Все изменения проиндексированы',
  'toast.git.unstageSuccess': 'Снято с индексации: {file}',
  'toast.git.unstageFailed': 'Не удалось снять с индексации',
  'toast.git.unstageAllSuccess': 'Все изменения сняты с индексации',
  'toast.git.discardSuccess': 'Изменения отменены',
  'toast.git.discardFailed': 'Не удалось отменить изменения',
  'toast.git.discardedIn': 'Изменения в {file} отменены',
  'toast.git.checkoutSuccess': 'Переключено на {ref}',
  'toast.git.checkoutFailed': 'Ошибка переключения ветки',
  'toast.git.noLocalBranch': 'Локальная ветка не выбрана',
  'toast.git.setTrackedFailed': 'Не удалось установить отслеживаемую ветку',
  'toast.git.stopTrackingFailed': 'Не удалось отключить отслеживание',
  'toast.git.invalidFormat': 'Неверный формат',
  'toast.git.resolveFailed': 'Не удалось разрешить конфликт',
  'toast.git.noFileSelected': 'Файл не выбран',
  'toast.git.openRepoFailed': 'Не удалось открыть репозиторий',

  'toast.merge.committed': 'Merge-коммит создан',
  'toast.merge.continueFailed': 'Не удалось продолжить',
  'toast.merge.aborted': 'Merge отменён',
  'toast.merge.abortFailed': 'Не удалось отменить merge',
  'toast.merge.takeOursFailed': 'Не удалось взять ours',
  'toast.merge.takeTheirsFailed': 'Не удалось взять theirs',
  'toast.merge.rebaseStarted': 'Rebase запущен',
  'toast.merge.rebaseFailed': 'Ошибка rebase',
  'toast.merge.rebaseCompleted': 'Интерактивный rebase завершён',
  'toast.merge.rebaseFailedGeneric': 'Ошибка rebase',
  'toast.merge.abortStateFailed': 'Не удалось отменить {state}',
  'toast.merge.startEditStarted': 'Интерактивное редактирование начато — используйте панель Rebase для продолжения',
  'toast.merge.splitStartFailed': 'Не удалось начать split',
  'toast.merge.splitFailed': 'Ошибка split',
  'toast.merge.splitOffFailed': 'Не удалось отделить',
  'toast.merge.splitMoved': 'Перемещено файлов: {count}',
  'toast.merge.selectFileRequired': 'Выберите хотя бы один файл',
  'toast.merge.messageRequired': 'Требуется новое сообщение коммита',

  'toast.cherryPick.cherryPicked': 'Cherry-pick выполнен',
  'toast.cherryPick.failed': 'Ошибка cherry-pick',
  'toast.cherryPick.emptyAfter': 'Предыдущий cherry-pick теперь пуст',
  'toast.cherryPick.finished': 'Cherry-pick завершён — коммит создан',
  'toast.cherryPick.continueFailed': 'Cherry-pick Continue не удался',
  'toast.revert.reverted': 'Revert выполнен',
  'toast.revert.failed': 'Ошибка revert',

  'toast.reset.success': '{mode} сброшен к {hash}',
  'toast.reset.failed': 'Ошибка reset',

  'toast.tag.created': 'Тег {name} создан{target}',
  'toast.tag.createFailed': 'Не удалось создать тег',

  'toast.stash.saved': 'Stash сохранён',
  'toast.stash.failed': 'Не удалось создать stash',
  'toast.stash.popped': 'Stash применён',
  'toast.stash.popFailed': 'Не удалось применить stash',
  'toast.stash.allStashed': 'Все изменения в stash',
  'toast.stash.none': 'Нет stash',
  'toast.stash.aborted': 'Операция отменена',
  'toast.stash.abortFailed': 'Не удалось отменить через stash',

  'toast.edit.messageUpdated': 'Сообщение коммита обновлено',
  'toast.edit.messageFailed': 'Не удалось изменить сообщение',
  'toast.edit.authorUpdated': 'Автор обновлён',
  'toast.edit.authorFailed': 'Не удалось изменить автора',
  'toast.edit.noteRemoved': 'Заметка удалена',
  'toast.edit.noteRemoveFailed': 'Не удалось удалить заметку',

  'toast.vscode.opened': 'Открыто в VS Code',
  'toast.vscode.openFailed': 'Не удалось открыть VS Code',
  'toast.vscode.mergeEditorOpened': 'Открыто в merge-редакторе VS Code',
  'toast.vscode.notFound': 'VS Code не найден',
  'toast.vscode.mergeFailed': 'VS Code merge не удался',
  'toast.vscode.mergeToolCompleted': 'Merge-инструмент завершён',
  'toast.vscode.mergeToolFailed': 'Ошибка merge-инструмента',

  'toast.conflict.notConflicted': 'Файл без конфликтов',
  'toast.conflict.markersRemain': 'Остались маркеры конфликтов',
  'toast.conflict.takeOurs': 'Взято ours',
  'toast.conflict.takeTheirs': 'Взято theirs',
  'toast.conflict.deleted': 'Разрешено как удалённое',
  'toast.conflict.failed': 'Не удалось',
  'toast.conflict.allResolved': 'Все конфликты разрешены',
  'toast.conflict.hunkResolved': 'Ханк {idx}: {resolution}',
  'toast.conflict.searchFailed': 'Ошибка поиска',

  'toast.repo.settingsSaved': 'Настройки репозитория сохранены',
  'toast.repo.settingsLoadFailed': 'Не удалось загрузить настройки репозитория',
  'toast.repo.settingsSaveFailed': 'Не удалось сохранить настройки',

  'toast.bisect.started': 'Bisect начат',
  'toast.bisect.headBad': 'HEAD отмечен как плохой',
  'toast.bisect.headGood': 'HEAD отмечен как хороший',
  'toast.bisect.skipped': 'Коммит пропущен',
  'toast.bisect.finished': 'Bisect завершён',
  'toast.bisect.failed': 'Bisect не удался',

  'toast.history.loadFailed': 'Не удалось загрузить историю',
  'toast.history.loadMoreFailed': 'Не удалось загрузить ещё коммиты',
  'toast.history.commitDiffFailed': 'Не удалось загрузить diff коммита',

  'toast.smartPull.success': 'Smart pull: {strategy}',

  'toast.investigate.copied': 'Скопировано',

  'toast.iRebase.loadFailed': 'Не удалось загрузить коммиты',
  'toast.iRebase.autoSquashed': 'Auto-squash: {count} коммит(ов)',
  'toast.iRebase.noCoalesce': 'Нет соседних коммитов с тем же subject для auto-squash',
  'toast.iRebase.coalescing': 'Coalescing: {detail}',
  'toast.iRebase.marked': 'Отмечено: {detail}',
  'toast.iRebase.targetRequired': 'Требуется целевая ветка',

  'toast.generic.failed': 'Не удалось',
};

export const zh: Record<string, string> = {
  'toast.git.pushSuccess': '推送成功',
  'toast.git.pushFailed': '推送失败',
  'toast.git.pullFailed': '拉取失败',
  'toast.git.pullConflicts': '拉取导致冲突',
  'toast.git.fetchSuccess': '获取成功',
  'toast.git.fetchFailed': '获取失败',
  'toast.git.stageSuccess': '已暂存 {file}',
  'toast.git.stageFailed': '暂存失败',
  'toast.git.stageAllSuccess': '所有更改已暂存',
  'toast.git.unstageSuccess': '已取消暂存 {file}',
  'toast.git.unstageFailed': '取消暂存失败',
  'toast.git.unstageAllSuccess': '所有更改已取消暂存',
  'toast.git.discardSuccess': '更改已丢弃',
  'toast.git.discardFailed': '丢弃更改失败',
  'toast.git.discardedIn': '已丢弃 {file} 中的更改',
  'toast.git.checkoutSuccess': '已切换到 {ref}',
  'toast.git.checkoutFailed': '切换分支失败',
  'toast.git.noLocalBranch': '未检出本地分支',
  'toast.git.setTrackedFailed': '设置跟踪分支失败',
  'toast.git.stopTrackingFailed': '取消跟踪失败',
  'toast.git.invalidFormat': '格式无效',
  'toast.git.resolveFailed': '解决失败',
  'toast.git.noFileSelected': '未选择文件',
  'toast.git.openRepoFailed': '无法打开仓库',

  'toast.merge.committed': '合并提交已创建',
  'toast.merge.continueFailed': '继续失败',
  'toast.merge.aborted': '合并已中止',
  'toast.merge.abortFailed': '中止合并失败',
  'toast.merge.takeOursFailed': '采用 ours 失败',
  'toast.merge.takeTheirsFailed': '采用 theirs 失败',
  'toast.merge.rebaseStarted': '变基已开始',
  'toast.merge.rebaseFailed': '变基失败',
  'toast.merge.rebaseCompleted': '交互式变基完成',
  'toast.merge.rebaseFailedGeneric': '变基失败',
  'toast.merge.abortStateFailed': '中止 {state} 失败',
  'toast.merge.startEditStarted': '交互式编辑已开始 — 使用 Rebase 面板继续',
  'toast.merge.splitStartFailed': '无法开始 split',
  'toast.merge.splitFailed': 'split 失败',
  'toast.merge.splitOffFailed': 'split off 失败',
  'toast.merge.splitMoved': '已移动 {count} 个文件',
  'toast.merge.selectFileRequired': '请至少选择一个文件',
  'toast.merge.messageRequired': '需要新的提交消息',

  'toast.cherryPick.cherryPicked': '已 cherry-pick',
  'toast.cherryPick.failed': 'cherry-pick 失败',
  'toast.cherryPick.emptyAfter': '之前的 cherry-pick 现在为空',
  'toast.cherryPick.finished': 'cherry-pick 完成 — 已创建提交',
  'toast.cherryPick.continueFailed': 'cherry-pick Continue 失败',
  'toast.revert.reverted': '已 revert',
  'toast.revert.failed': 'revert 失败',

  'toast.reset.success': '{mode} 已重置到 {hash}',
  'toast.reset.failed': '重置失败',

  'toast.tag.created': '标签 {name} 已创建{target}',
  'toast.tag.createFailed': '创建标签失败',

  'toast.stash.saved': 'stash 已保存',
  'toast.stash.failed': 'stash 失败',
  'toast.stash.popped': 'stash 已弹出',
  'toast.stash.popFailed': '弹出 stash 失败',
  'toast.stash.allStashed': '所有更改已 stash',
  'toast.stash.none': '无 stash',
  'toast.stash.aborted': '操作已中止',
  'toast.stash.abortFailed': 'stash 中止失败',

  'toast.edit.messageUpdated': '提交消息已更新',
  'toast.edit.messageFailed': '修改消息失败',
  'toast.edit.authorUpdated': '作者已更新',
  'toast.edit.authorFailed': '修改作者失败',
  'toast.edit.noteRemoved': '备注已删除',
  'toast.edit.noteRemoveFailed': '删除备注失败',

  'toast.vscode.opened': '已在 VS Code 中打开',
  'toast.vscode.openFailed': '无法打开 VS Code',
  'toast.vscode.mergeEditorOpened': '已在 VS Code merge 编辑器中打开',
  'toast.vscode.notFound': '未找到 VS Code',
  'toast.vscode.mergeFailed': 'VS Code merge 失败',
  'toast.vscode.mergeToolCompleted': 'merge 工具完成',
  'toast.vscode.mergeToolFailed': 'merge 工具失败',

  'toast.conflict.notConflicted': '文件无冲突',
  'toast.conflict.markersRemain': '仍有冲突标记',
  'toast.conflict.takeOurs': '采用 ours',
  'toast.conflict.takeTheirs': '采用 theirs',
  'toast.conflict.deleted': '解决为已删除',
  'toast.conflict.failed': '失败',
  'toast.conflict.allResolved': '所有冲突已解决',
  'toast.conflict.hunkResolved': '块 {idx}: {resolution}',
  'toast.conflict.searchFailed': '搜索失败',

  'toast.repo.settingsSaved': '仓库设置已保存',
  'toast.repo.settingsLoadFailed': '加载仓库设置失败',
  'toast.repo.settingsSaveFailed': '保存设置失败',

  'toast.bisect.started': 'bisect 已开始',
  'toast.bisect.headBad': 'HEAD 标记为 bad',
  'toast.bisect.headGood': 'HEAD 标记为 good',
  'toast.bisect.skipped': '提交已跳过',
  'toast.bisect.finished': 'bisect 完成',
  'toast.bisect.failed': 'bisect 失败',

  'toast.history.loadFailed': '加载历史失败',
  'toast.history.loadMoreFailed': '加载更多提交失败',
  'toast.history.commitDiffFailed': '加载提交 diff 失败',

  'toast.smartPull.success': 'Smart pull: {strategy}',

  'toast.investigate.copied': '已复制',

  'toast.iRebase.loadFailed': '加载提交失败',
  'toast.iRebase.autoSquashed': 'Auto-squash {count} 个提交',
  'toast.iRebase.noCoalesce': '没有相同 subject 的相邻提交可 auto-squash',
  'toast.iRebase.coalescing': '合并中: {detail}',
  'toast.iRebase.marked': '已标记: {detail}',
  'toast.iRebase.targetRequired': '需要目标分支',

  'toast.generic.failed': '失败',
};

export const de: Record<string, string> = {
  'toast.git.pushSuccess': 'Erfolgreich gepusht',
  'toast.git.pushFailed': 'Push fehlgeschlagen',
  'toast.git.pullFailed': 'Pull fehlgeschlagen',
  'toast.git.pullConflicts': 'Pull führte zu Konflikten',
  'toast.git.fetchSuccess': 'Erfolgreich geholt',
  'toast.git.fetchFailed': 'Fetch fehlgeschlagen',
  'toast.git.stageSuccess': '{file} indexiert',
  'toast.git.stageFailed': 'Indexieren fehlgeschlagen',
  'toast.git.stageAllSuccess': 'Alle Änderungen indexiert',
  'toast.git.unstageSuccess': '{file} deindexiert',
  'toast.git.unstageFailed': 'Deindexieren fehlgeschlagen',
  'toast.git.unstageAllSuccess': 'Alle Änderungen deindexiert',
  'toast.git.discardSuccess': 'Änderungen verworfen',
  'toast.git.discardFailed': 'Verwerfen fehlgeschlagen',
  'toast.git.discardedIn': 'Änderungen in {file} verworfen',
  'toast.git.checkoutSuccess': 'Zu {ref} gewechselt',
  'toast.git.checkoutFailed': 'Checkout fehlgeschlagen',
  'toast.git.noLocalBranch': 'Kein lokaler Branch ausgecheckt',
  'toast.git.setTrackedFailed': 'Tracking-Branch setzen fehlgeschlagen',
  'toast.git.stopTrackingFailed': 'Tracking aufheben fehlgeschlagen',
  'toast.git.invalidFormat': 'Ungültiges Format',
  'toast.git.resolveFailed': 'Auflösen fehlgeschlagen',
  'toast.git.noFileSelected': 'Keine Datei ausgewählt',
  'toast.git.openRepoFailed': 'Repository konnte nicht geöffnet werden',

  'toast.merge.committed': 'Merge-Commit erstellt',
  'toast.merge.continueFailed': 'Fortsetzen fehlgeschlagen',
  'toast.merge.aborted': 'Merge abgebrochen',
  'toast.merge.abortFailed': 'Merge-Abbruch fehlgeschlagen',
  'toast.merge.takeOursFailed': 'Take ours fehlgeschlagen',
  'toast.merge.takeTheirsFailed': 'Take theirs fehlgeschlagen',
  'toast.merge.rebaseStarted': 'Rebase gestartet',
  'toast.merge.rebaseFailed': 'Rebase fehlgeschlagen',
  'toast.merge.rebaseCompleted': 'Interaktiver Rebase abgeschlossen',
  'toast.merge.rebaseFailedGeneric': 'Rebase fehlgeschlagen',
  'toast.merge.abortStateFailed': '{state} abbrechen fehlgeschlagen',
  'toast.merge.startEditStarted': 'Interaktive Bearbeitung gestartet — Rebase-Panel zum Fortsetzen verwenden',
  'toast.merge.splitStartFailed': 'Split konnte nicht gestartet werden',
  'toast.merge.splitFailed': 'Split fehlgeschlagen',
  'toast.merge.splitOffFailed': 'Split off fehlgeschlagen',
  'toast.merge.splitMoved': '{count} Datei(en) verschoben',
  'toast.merge.selectFileRequired': 'Mindestens eine Datei auswählen',
  'toast.merge.messageRequired': 'Neue Commit-Nachricht erforderlich',

  'toast.cherryPick.cherryPicked': 'Cherry-pick ausgeführt',
  'toast.cherryPick.failed': 'Cherry-pick fehlgeschlagen',
  'toast.cherryPick.emptyAfter': 'Der vorherige cherry-pick ist nun leer',
  'toast.cherryPick.finished': 'Cherry-pick abgeschlossen — Commit erstellt',
  'toast.cherryPick.continueFailed': 'Cherry-pick Continue fehlgeschlagen',
  'toast.revert.reverted': 'Revert ausgeführt',
  'toast.revert.failed': 'Revert fehlgeschlagen',

  'toast.reset.success': '{mode} auf {hash} zurückgesetzt',
  'toast.reset.failed': 'Reset fehlgeschlagen',

  'toast.tag.created': 'Tag {name} erstellt{target}',
  'toast.tag.createFailed': 'Tag-Erstellung fehlgeschlagen',

  'toast.stash.saved': 'Stash gespeichert',
  'toast.stash.failed': 'Stash fehlgeschlagen',
  'toast.stash.popped': 'Stash angewendet',
  'toast.stash.popFailed': 'Stash-Anwenden fehlgeschlagen',
  'toast.stash.allStashed': 'Alle Änderungen in stash',
  'toast.stash.none': 'Keine Stashes',
  'toast.stash.aborted': 'Operation abgebrochen',
  'toast.stash.abortFailed': 'Stash-Abbruch fehlgeschlagen',

  'toast.edit.messageUpdated': 'Commit-Nachricht aktualisiert',
  'toast.edit.messageFailed': 'Nachricht ändern fehlgeschlagen',
  'toast.edit.authorUpdated': 'Autor aktualisiert',
  'toast.edit.authorFailed': 'Autor ändern fehlgeschlagen',
  'toast.edit.noteRemoved': 'Notiz entfernt',
  'toast.edit.noteRemoveFailed': 'Notiz entfernen fehlgeschlagen',

  'toast.vscode.opened': 'In VS Code geöffnet',
  'toast.vscode.openFailed': 'VS Code konnte nicht geöffnet werden',
  'toast.vscode.mergeEditorOpened': 'Im VS Code merge-Editor geöffnet',
  'toast.vscode.notFound': 'VS Code nicht gefunden',
  'toast.vscode.mergeFailed': 'VS Code merge fehlgeschlagen',
  'toast.vscode.mergeToolCompleted': 'Merge-Tool abgeschlossen',
  'toast.vscode.mergeToolFailed': 'Merge-Tool fehlgeschlagen',

  'toast.conflict.notConflicted': 'Datei hat keine Konflikte',
  'toast.conflict.markersRemain': 'Konfliktmarkierungen vorhanden',
  'toast.conflict.takeOurs': 'Ours übernommen',
  'toast.conflict.takeTheirs': 'Theirs übernommen',
  'toast.conflict.deleted': 'Als gelöst-gelöscht markiert',
  'toast.conflict.failed': 'Fehlgeschlagen',
  'toast.conflict.allResolved': 'Alle Konflikte gelöst',
  'toast.conflict.hunkResolved': 'Hunk {idx}: {resolution}',
  'toast.conflict.searchFailed': 'Suche fehlgeschlagen',

  'toast.repo.settingsSaved': 'Repository-Einstellungen gespeichert',
  'toast.repo.settingsLoadFailed': 'Repository-Einstellungen konnten nicht geladen werden',
  'toast.repo.settingsSaveFailed': 'Einstellungen speichern fehlgeschlagen',

  'toast.bisect.started': 'Bisect gestartet',
  'toast.bisect.headBad': 'HEAD als bad markiert',
  'toast.bisect.headGood': 'HEAD als good markiert',
  'toast.bisect.skipped': 'Commit übersprungen',
  'toast.bisect.finished': 'Bisect abgeschlossen',
  'toast.bisect.failed': 'Bisect fehlgeschlagen',

  'toast.history.loadFailed': 'Verlauf konnte nicht geladen werden',
  'toast.history.loadMoreFailed': 'Weitere Commits konnten nicht geladen werden',
  'toast.history.commitDiffFailed': 'Commit-Diff konnte nicht geladen werden',

  'toast.smartPull.success': 'Smart pull: {strategy}',

  'toast.investigate.copied': 'Kopiert',

  'toast.iRebase.loadFailed': 'Commits konnten nicht geladen werden',
  'toast.iRebase.autoSquashed': 'Auto-squash: {count} Commit(s)',
  'toast.iRebase.noCoalesce': 'Keine benachbarten Commits mit gleichem Subject für Auto-squash',
  'toast.iRebase.coalescing': 'Coalescing: {detail}',
  'toast.iRebase.marked': 'Markiert: {detail}',
  'toast.iRebase.targetRequired': 'Ziel-Branch erforderlich',

  'toast.generic.failed': 'Fehlgeschlagen',
};
