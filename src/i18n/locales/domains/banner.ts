/**
 * RepoStateBanner domain translations.
 * Sweep owner: this file is the ONLY dictionary for the 'banner' domain —
 * add every new key to ALL FOUR locales (unit tests assert key parity).
 *
 * Covers: RepoStateBanner.
 * English values are byte-identical to the previously hardcoded strings.
 */
export const en: Record<string, string> = {
  // Footers — short hint shown under the state title per active git state
  'banner.cherryPickingFooter': 'Only Continue / Abort are allowed — Pull, Checkout and Commit would lead to loss of the picked commit. Fetch is still available.',
  'banner.revertingFooter': 'Only Continue / Abort are allowed — Pull, Checkout and Commit would lead to loss of the revert. Fetch is still available.',
  'banner.mergingFooter': 'Resolve conflicts and Commit to complete the merge, or Abort — Pull, Checkout and Reset would discard the merge. Fetch is still available.',
  'banner.rebasingFooter': 'Only Continue / Abort are allowed — Pull, Checkout and Commit would discard the rebase. Fetch is still available.',
  'banner.bisectingFooter': 'HEAD is detached at the bisect candidate — mark it Good / Bad or Abort the bisect. Pull, Checkout and Commit would interfere with the search. Fetch is still available.',

  // Button titles (tooltips) per state
  'banner.cherryPick.continueTitle': 'Finish the cherry-pick: commit the picked changes into the current branch',
  'banner.cherryPick.abortTitle': 'Cancel the cherry-pick and restore the previous state (git cherry-pick --abort)',
  'banner.revert.continueTitle': 'Finish the revert: commit the reverted changes into the current branch',
  'banner.revert.abortTitle': 'Cancel the revert and restore the previous state (git revert --abort)',
  'banner.merge.abortTitle': 'Cancel the merge and restore the pre-merge state (git merge --abort)',
  'banner.rebase.continueTitle': 'Continue the rebase with the resolved conflicts (git rebase --continue)',
  'banner.rebase.abortTitle': 'Cancel the rebase and restore the original branch (git rebase --abort)',
  'banner.bisect.badTitle': 'Mark HEAD as bad — the current revision is broken (git bisect bad)',
  'banner.bisect.goodTitle': 'Mark HEAD as good — the current revision works correctly (git bisect good)',
  'banner.bisect.abortTitle': 'End the bisect session and return to the original branch (git bisect reset)',

  // Button labels
  'banner.continue': 'Continue',
  'banner.abort': 'Abort',
  'banner.markHeadBad': 'Mark HEAD as Bad',
  'banner.markHeadGood': 'Mark HEAD as Good',

  // Detail-line labels per state
  'banner.picking': 'Picking',
  'banner.revertingLabel': 'Reverting',
  'banner.testing': 'Testing',
  'banner.rebaseInProgress': 'Rebase in progress',
  'banner.stepXOfY': 'Step {step} of {total}',

  // ── StatusBar / Sidebar state labels ──
  'banner.mergingLabel': 'Merging',
  'banner.rebasingLabel': 'Rebasing',
  'banner.cherryPickingLabel': 'Cherry-picking',
  'banner.revertingStatusBarLabel': 'Reverting',
  'banner.bisectingLabel': 'Bisecting',
  'banner.stateInProgress': '{label} in progress',
  'banner.stateTooltip': 'Working tree is in {label} state. Click to open Changes and Continue / Skip / Abort.',
  'banner.bisectInProgressTooltip': 'Bisect in progress — see the Bisect page',
  'banner.detachedHeadTooltip': "HEAD is detached — commits won't belong to any branch",
};

export const ru: Record<string, string> = {
  'banner.cherryPickingFooter': 'Доступны только Continue / Abort — Pull, Checkout и Commit привели бы к потере выбранного коммита. Fetch всё ещё доступен.',
  'banner.revertingFooter': 'Доступны только Continue / Abort — Pull, Checkout и Commit привели бы к потере revert. Fetch всё ещё доступен.',
  'banner.mergingFooter': 'Разрешите конфликты и Commit, чтобы завершить слияние, или Abort — Pull, Checkout и Reset отменили бы слияние. Fetch всё ещё доступен.',
  'banner.rebasingFooter': 'Доступны только Continue / Abort — Pull, Checkout и Commit отменили бы rebase. Fetch всё ещё доступен.',
  'banner.bisectingFooter': 'HEAD отсоединён на кандидате bisect — отметьте его Good / Bad или Abort bisect. Pull, Checkout и Commit мешали бы поиску. Fetch всё ещё доступен.',

  'banner.cherryPick.continueTitle': 'Завершить cherry-pick: закоммитить выбранные изменения в текущую ветку',
  'banner.cherryPick.abortTitle': 'Отменить cherry-pick и восстановить предыдущее состояние (git cherry-pick --abort)',
  'banner.revert.continueTitle': 'Завершить revert: закоммитить отменённые изменения в текущую ветку',
  'banner.revert.abortTitle': 'Отменить revert и восстановить предыдущее состояние (git revert --abort)',
  'banner.merge.abortTitle': 'Отменить слияние и восстановить состояние до слияния (git merge --abort)',
  'banner.rebase.continueTitle': 'Продолжить rebase с разрешёнными конфликтами (git rebase --continue)',
  'banner.rebase.abortTitle': 'Отменить rebase и восстановить исходную ветку (git rebase --abort)',
  'banner.bisect.badTitle': 'Отметить HEAD как плохой — текущая ревизия сломана (git bisect bad)',
  'banner.bisect.goodTitle': 'Отметить HEAD как хороший — текущая ревизия работает корректно (git bisect good)',
  'banner.bisect.abortTitle': 'Завершить сессию bisect и вернуться на исходную ветку (git bisect reset)',

  'banner.continue': 'Продолжить',
  'banner.abort': 'Прервать',
  'banner.markHeadBad': 'Отметить HEAD как плохой',
  'banner.markHeadGood': 'Отметить HEAD как хороший',

  'banner.picking': 'Применяется',
  'banner.revertingLabel': 'Отменяется',
  'banner.testing': 'Проверяется',
  'banner.rebaseInProgress': 'Rebase в процессе',
  'banner.stepXOfY': 'Шаг {step} из {total}',

  // ── StatusBar / Sidebar state labels ──
  'banner.mergingLabel': 'Слияние',
  'banner.rebasingLabel': 'Rebase',
  'banner.cherryPickingLabel': 'Cherry-pick',
  'banner.revertingStatusBarLabel': 'Revert',
  'banner.bisectingLabel': 'Bisect',
  'banner.stateInProgress': '{label} в процессе',
  'banner.stateTooltip': 'Рабочее дерево в состоянии {label}. Нажмите, чтобы открыть Changes и Continue / Skip / Abort.',
  'banner.bisectInProgressTooltip': 'Bisect в процессе — см. страницу Bisect',
  'banner.detachedHeadTooltip': 'HEAD отсоединён — коммиты не будут принадлежать какой-либо ветке',
};

export const zh: Record<string, string> = {
  'banner.cherryPickingFooter': '只允许 Continue / Abort — Pull、Checkout 和 Commit 会导致丢失已拣选的提交。Fetch 仍可用。',
  'banner.revertingFooter': '只允许 Continue / Abort — Pull、Checkout 和 Commit 会导致丢失 revert。Fetch 仍可用。',
  'banner.mergingFooter': '解决冲突并 Commit 以完成合并，或 Abort — Pull、Checkout 和 Reset 会丢弃合并。Fetch 仍可用。',
  'banner.rebasingFooter': '只允许 Continue / Abort — Pull、Checkout 和 Commit 会丢弃变基。Fetch 仍可用。',
  'banner.bisectingFooter': 'HEAD 分离在 bisect 候选上 — 将其标记为 Good / Bad 或 Abort bisect。Pull、Checkout 和 Commit 会干扰搜索。Fetch 仍可用。',

  'banner.cherryPick.continueTitle': '完成 cherry-pick: 将拣选的更改提交到当前分支',
  'banner.cherryPick.abortTitle': '取消 cherry-pick 并恢复之前的状态 (git cherry-pick --abort)',
  'banner.revert.continueTitle': '完成 revert: 将撤销的更改提交到当前分支',
  'banner.revert.abortTitle': '取消 revert 并恢复之前的状态 (git revert --abort)',
  'banner.merge.abortTitle': '取消合并并恢复合并前的状态 (git merge --abort)',
  'banner.rebase.continueTitle': '继续 rebase 并使用已解决的冲突 (git rebase --continue)',
  'banner.rebase.abortTitle': '取消 rebase 并恢复原始分支 (git rebase --abort)',
  'banner.bisect.badTitle': '将 HEAD 标记为 bad — 当前修订版本已损坏 (git bisect bad)',
  'banner.bisect.goodTitle': '将 HEAD 标记为 good — 当前修订版本工作正常 (git bisect good)',
  'banner.bisect.abortTitle': '结束 bisect 会话并返回原始分支 (git bisect reset)',

  'banner.continue': '继续',
  'banner.abort': '中止',
  'banner.markHeadBad': '将 HEAD 标记为 Bad',
  'banner.markHeadGood': '将 HEAD 标记为 Good',

  'banner.picking': '正在拣选',
  'banner.revertingLabel': '正在撤销',
  'banner.testing': '正在测试',
  'banner.rebaseInProgress': '变基进行中',
  'banner.stepXOfY': '第 {step} 步，共 {total} 步',

  // ── StatusBar / Sidebar state labels ──
  'banner.mergingLabel': '合并中',
  'banner.rebasingLabel': '变基中',
  'banner.cherryPickingLabel': '优选',
  'banner.revertingStatusBarLabel': '撤销',
  'banner.bisectingLabel': '二分查找',
  'banner.stateInProgress': '{label} 进行中',
  'banner.stateTooltip': '工作树处于 {label} 状态。点击打开 Changes 并 继续 / 跳过 / 中止。',
  'banner.bisectInProgressTooltip': '二分查找进行中 — 见 Bisect 页面',
  'banner.detachedHeadTooltip': 'HEAD 已分离 — 提交将不属于任何分支',
};

export const de: Record<string, string> = {
  'banner.cherryPickingFooter': 'Nur Continue / Abort erlaubt — Pull, Checkout und Commit würden den gepickten Commit verlieren. Fetch ist weiterhin verfügbar.',
  'banner.revertingFooter': 'Nur Continue / Abort erlaubt — Pull, Checkout und Commit würden den Revert verlieren. Fetch ist weiterhin verfügbar.',
  'banner.mergingFooter': 'Konflikte auflösen und Commit, um den Merge abzuschließen, oder Abort — Pull, Checkout und Reset würden den Merge verwerfen. Fetch ist weiterhin verfügbar.',
  'banner.rebasingFooter': 'Nur Continue / Abort erlaubt — Pull, Checkout und Commit würden den Rebase verwerfen. Fetch ist weiterhin verfügbar.',
  'banner.bisectingFooter': 'HEAD ist beim Bisect-Kandidaten abgetrennt — als Good / Bad markieren oder Bisect abbrechen. Pull, Checkout und Commit würden die Suche stören. Fetch ist weiterhin verfügbar.',

  'banner.cherryPick.continueTitle': 'Cherry-pick abschließen: gepickte Änderungen in den aktuellen Branch committen',
  'banner.cherryPick.abortTitle': 'Cherry-pick abbrechen und vorherigen Zustand wiederherstellen (git cherry-pick --abort)',
  'banner.revert.continueTitle': 'Revert abschließen: rückgängig gemachte Änderungen in den aktuellen Branch committen',
  'banner.revert.abortTitle': 'Revert abbrechen und vorherigen Zustand wiederherstellen (git revert --abort)',
  'banner.merge.abortTitle': 'Merge abbrechen und Zustand vor dem Merge wiederherstellen (git merge --abort)',
  'banner.rebase.continueTitle': 'Rebase mit aufgelösten Konflikten fortsetzen (git rebase --continue)',
  'banner.rebase.abortTitle': 'Rebase abbrechen und ursprünglichen Branch wiederherstellen (git rebase --abort)',
  'banner.bisect.badTitle': 'HEAD als bad markieren — aktuelle Revision ist defekt (git bisect bad)',
  'banner.bisect.goodTitle': 'HEAD als good markieren — aktuelle Revision funktioniert korrekt (git bisect good)',
  'banner.bisect.abortTitle': 'Bisect-Sitzung beenden und zum ursprünglichen Branch zurückkehren (git bisect reset)',

  'banner.continue': 'Fortsetzen',
  'banner.abort': 'Abbrechen',
  'banner.markHeadBad': 'HEAD als Bad markieren',
  'banner.markHeadGood': 'HEAD als Good markieren',

  'banner.picking': 'Pickt',
  'banner.revertingLabel': 'Kehrt zurück',
  'banner.testing': 'Testet',
  'banner.rebaseInProgress': 'Rebase läuft',
  'banner.stepXOfY': 'Schritt {step} von {total}',

  // ── StatusBar / Sidebar state labels ──
  'banner.mergingLabel': 'Mergen',
  'banner.rebasingLabel': 'Rebasen',
  'banner.cherryPickingLabel': 'Cherry-Pick',
  'banner.revertingStatusBarLabel': 'Revert',
  'banner.bisectingLabel': 'Bisect',
  'banner.stateInProgress': '{label} läuft',
  'banner.stateTooltip': 'Arbeitsbaum ist im {label}-Zustand. Klicken, um Changes zu öffnen und Continue / Skip / Abort.',
  'banner.bisectInProgressTooltip': 'Bisect läuft — siehe Bisect-Seite',
  'banner.detachedHeadTooltip': 'HEAD ist detached — Commits gehören zu keinem Branch',
};
