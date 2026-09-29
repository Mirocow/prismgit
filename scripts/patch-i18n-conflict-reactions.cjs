/**
 * i18n patcher — conflict-reaction audit (Task: «проверь всю работу с
 * конфликтами… Надо предоставить пользователю возможность реагировать»).
 *
 * Inserts the new keys AFTER their per-locale anchors in:
 *   - domains/toasts.ts  (rebase / cherry-pick / revert / gitflow conflict reactions)
 *   - domains/stashes.ts (pop / apply conflict reactions)
 *   - domains/dialogs.ts (apply-patch 3-way retry)
 *
 * Idempotent: skips insertion when the key already exists.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LOCALES = ['en', 'ru', 'zh', 'de'];

// [file, anchorKey (same in every locale), new entries for that locale]
const PLAN = {
  'src/i18n/locales/domains/toasts.ts': {
    en: [
      ['toast.git.rebaseConflicts', 'Rebase resulted in conflicts'],
      ['toast.git.rebaseConflictsHint', 'Resolve them in the Changes tool (Continue / Skip / Abort)'],
      ['toast.git.cherryPickConflicts', 'Cherry-pick resulted in conflicts'],
      ['toast.git.cherryPickConflictsHint', 'Resolve them in the Changes tool, then Continue'],
      ['toast.git.revertConflicts', 'Revert resulted in conflicts'],
      ['toast.git.revertConflictsHint', 'Resolve them in the Changes tool, then Continue'],
      ['toast.gitflow.finishConflicts', 'Git-flow finish stopped — merge conflicts'],
      ['toast.gitflow.finishConflictsHint', 'The branch was NOT deleted and nothing was pushed; resolve the conflicts in the Changes tool'],
    ],
    ru: [
      ['toast.git.rebaseConflicts', 'Rebase привёл к конфликтам'],
      ['toast.git.rebaseConflictsHint', 'Разрешите их в инструменте Changes (Продолжить / Пропустить / Прервать)'],
      ['toast.git.cherryPickConflicts', 'Cherry-pick привёл к конфликтам'],
      ['toast.git.cherryPickConflictsHint', 'Разрешите их в инструменте Changes, затем Продолжить'],
      ['toast.git.revertConflicts', 'Revert привёл к конфликтам'],
      ['toast.git.revertConflictsHint', 'Разрешите их в инструменте Changes, затем Продолжить'],
      ['toast.gitflow.finishConflicts', 'Завершение Git-flow остановлено — конфликты слияния'],
      ['toast.gitflow.finishConflictsHint', 'Ветка НЕ удалена и ничего не отправлено; разрешите конфликты в инструменте Changes'],
    ],
    zh: [
      ['toast.git.rebaseConflicts', '变基产生了冲突'],
      ['toast.git.rebaseConflictsHint', '请在更改工具中解决（继续 / 跳过 / 中止）'],
      ['toast.git.cherryPickConflicts', 'Cherry-pick 产生了冲突'],
      ['toast.git.cherryPickConflictsHint', '请在更改工具中解决，然后继续'],
      ['toast.git.revertConflicts', '回退产生了冲突'],
      ['toast.git.revertConflictsHint', '请在更改工具中解决，然后继续'],
      ['toast.gitflow.finishConflicts', 'Git-flow 完成已停止——合并冲突'],
      ['toast.gitflow.finishConflictsHint', '分支未被删除、未推送任何内容；请在更改工具中解决冲突'],
    ],
    de: [
      ['toast.git.rebaseConflicts', 'Rebase führte zu Konflikten'],
      ['toast.git.rebaseConflictsHint', 'Lösen Sie sie im Changes-Werkzeug (Fortsetzen / Überspringen / Abbrechen)'],
      ['toast.git.cherryPickConflicts', 'Cherry-pick führte zu Konflikten'],
      ['toast.git.cherryPickConflictsHint', 'Im Changes-Werkzeug lösen, dann Fortsetzen'],
      ['toast.git.revertConflicts', 'Revert führte zu Konflikten'],
      ['toast.git.revertConflictsHint', 'Im Changes-Werkzeug lösen, dann Fortsetzen'],
      ['toast.gitflow.finishConflicts', 'Git-Flow-Abschluss gestoppt — Merge-Konflikte'],
      ['toast.gitflow.finishConflictsHint', 'Der Branch wurde NICHT gelöscht und nichts gepusht; Konflikte im Changes-Werkzeug lösen'],
    ],
  },
  'src/i18n/locales/domains/stashes.ts': {
    en: [
      ['stashes.popConflicts', 'Stash pop resulted in conflicts'],
      ['stashes.popConflictsHint', 'The stash entry was KEPT. Resolve the conflicts in the Changes tool, then commit (or discard the changes)'],
      ['stashes.applyConflicts', 'Stash apply resulted in conflicts'],
      ['stashes.applyConflictsHint', 'The stash entry was kept. Resolve the conflicts in the Changes tool, then commit (or discard the changes)'],
    ],
    ru: [
      ['stashes.popConflicts', 'Pop stash привёл к конфликтам'],
      ['stashes.popConflictsHint', 'Запись stash сохранена. Разрешите конфликты в инструменте Changes, затем закоммитьте (или отбросьте изменения)'],
      ['stashes.applyConflicts', 'Применение stash привело к конфликтам'],
      ['stashes.applyConflictsHint', 'Запись stash сохранена. Разрешите конфликты в инструменте Changes, затем закоммитьте (или отбросьте изменения)'],
    ],
    zh: [
      ['stashes.popConflicts', '弹出贮藏产生了冲突'],
      ['stashes.popConflictsHint', '贮藏条目已保留。请在更改工具中解决冲突，然后提交（或放弃更改）'],
      ['stashes.applyConflicts', '应用贮藏产生了冲突'],
      ['stashes.applyConflictsHint', '贮藏条目已保留。请在更改工具中解决冲突，然后提交（或放弃更改）'],
    ],
    de: [
      ['stashes.popConflicts', 'Stash pop führte zu Konflikten'],
      ['stashes.popConflictsHint', 'Der Stash-Eintrag wurde BEHALTEN. Konflikte im Changes-Werkzeug lösen, dann committen (oder Änderungen verwerfen)'],
      ['stashes.applyConflicts', 'Stash anwenden führte zu Konflikten'],
      ['stashes.applyConflictsHint', 'Der Stash-Eintrag wurde behalten. Konflikte im Changes-Werkzeug lösen, dann committen (oder Änderungen verwerfen)'],
    ],
  },
  'src/i18n/locales/domains/dialogs.ts': {
    en: [
      ['dialogs.applyPatch3wayRetry', 'Retry with 3-way merge'],
      ['dialogs.applyPatch3wayHint', 'Applies the patch tolerating conflicts: files get conflict markers, resolve them in the Changes tool'],
      ['dialogs.applyPatch3wayDone', 'Patch applied with conflicts — resolve them in the Changes tool'],
    ],
    ru: [
      ['dialogs.applyPatch3wayRetry', 'Повторить с трёхсторонним слиянием'],
      ['dialogs.applyPatch3wayHint', 'Применяет патч, допуская конфликты: файлы получат маркеры конфликтов — разрешите их в инструменте Changes'],
      ['dialogs.applyPatch3wayDone', 'Патч применён с конфликтами — разрешите их в инструменте Changes'],
    ],
    zh: [
      ['dialogs.applyPatch3wayRetry', '以三方合并重试'],
      ['dialogs.applyPatch3wayHint', '在容忍冲突的前提下应用补丁：文件将带有冲突标记，请在更改工具中解决'],
      ['dialogs.applyPatch3wayDone', '补丁已应用但存在冲突——请在更改工具中解决'],
    ],
    de: [
      ['dialogs.applyPatch3wayRetry', 'Mit 3-Wege-Merge erneut versuchen'],
      ['dialogs.applyPatch3wayHint', 'Wendet den Patch konflikttolerant an: Dateien erhalten Konfliktmarker — im Changes-Werkzeug lösen'],
      ['dialogs.applyPatch3wayDone', 'Patch mit Konflikten angewendet — im Changes-Werkzeug lösen'],
    ],
  },
};

// Anchors AFTER which each locale block's entries are inserted. The anchor
// must exist once per locale block.
const ANCHORS = {
  'src/i18n/locales/domains/toasts.ts': "  'toast.git.pullConflicts':",
  'src/i18n/locales/domains/stashes.ts': "  'stashes.popFailed':",
  'src/i18n/locales/domains/dialogs.ts': "  'dialogs.applyPatchFailed':",
};

let total = 0;
for (const [rel, byLocale] of Object.entries(PLAN)) {
  const file = path.join(ROOT, rel);
  let text = fs.readFileSync(file, 'utf8');
  const anchor = ANCHORS[rel];
  for (const locale of LOCALES) {
    const entries = byLocale[locale];
    // Locale block bounds: `export const <locale>: Record<string, string> = {` … `};`
    const blockStart = text.indexOf(`export const ${locale}: Record<string, string> = {`);
    if (blockStart < 0) throw new Error(`${rel}: locale block ${locale} not found`);
    const blockEnd = text.indexOf('\n};', blockStart);
    const blockText = text.slice(blockStart, blockEnd);
    // The LAST anchor occurrence inside the block (guards against the same
    // key substring appearing in earlier blocks).
    const anchorInBlock = text.lastIndexOf(anchor, blockEnd);
    if (anchorInBlock < blockStart) throw new Error(`${rel}: anchor not in ${locale} block`);
    const insertAt = text.indexOf('\n', anchorInBlock) + 1;
    // Idempotency check scoped to THIS locale block (the same key legitimately
    // exists in every other locale's block).
    const lines = entries
      .filter(([k]) => !blockText.includes(`'${k}':`))
      .map(([k, v]) => `  '${k}': ${JSON.stringify(v)},`);
    if (lines.length === 0) continue;
    text = text.slice(0, insertAt) + lines.join('\n') + '\n' + text.slice(insertAt);
    total += lines.length;
    console.log(`${rel} [${locale}] +${lines.length}`);
  }
  fs.writeFileSync(file, text);
}
console.log(`\ninserted ${total} keys`);
