/**
 * i18n patcher — remote-conflict reactions (Task: «расширь сам список
 * проработав все случаи возникающие при работе с git и Remote сессиями
 * (gitlab, github)»).
 *
 * Inserts the new keys AFTER their per-locale anchors in:
 *   - domains/dialogs.ts (PushRejectionDialog: titles / bodies / actions)
 *   - domains/pages.ts   (PR conflict badge + merge-blocked tooltips)
 *
 * Idempotent: skips insertion when the key already exists.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LOCALES = ['en', 'ru', 'zh', 'de'];

// [file, anchorKey (same in every locale), new entries for that locale]
const PLAN = {
  'src/i18n/locales/domains/dialogs.ts': {
    en: [
      ['dialogs.pushRejection.nonFFTitle', 'Push rejected — the remote branch moved ahead'],
      ['dialogs.pushRejection.nonFFBody', 'The remote branch "{branch}" has commits you do not have locally. Pull them (merge or rebase) and the push retries automatically, or overwrite the remote branch.'],
      ['dialogs.pushRejection.leaseTitle', 'Force push rejected — stale lease'],
      ['dialogs.pushRejection.leaseBody', '--force-with-lease refused the push: the remote branch "{branch}" changed since your last fetch. Fetch to refresh the lease and retry, or confirm the overwrite.'],
      ['dialogs.pushRejection.protectedTitle', 'Push rejected — branch is protected'],
      ['dialogs.pushRejection.protectedBody', 'The server refuses direct pushes to "{branch}" (protected branch). Route the change through a Merge/Pull Request — the creation page opens with the branch pre-filled.'],
      ['dialogs.pushRejection.policyTitle', 'Force push denied by policy'],
      ['dialogs.pushRejection.policyBody', "PrismGit's local force-push policy denies this branch. Settings: Preferences → Commands → Force Push Policy / Protected Branches."],
      ['dialogs.pushRejection.branchLabel', 'Branch:'],
      ['dialogs.pushRejection.rawLabel', 'git output:'],
      ['dialogs.pushRejection.pullAndMerge', 'Pull and merge'],
      ['dialogs.pushRejection.pullMergeHint', 'git pull (merge) → resolve conflicts if any → the push retries automatically'],
      ['dialogs.pushRejection.pullAndRebase', 'Pull with rebase'],
      ['dialogs.pushRejection.pullRebaseHint', 'git pull --rebase → your commits replay on top → the push retries automatically'],
      ['dialogs.pushRejection.forceLease', 'Overwrite (--force-with-lease)'],
      ['dialogs.pushRejection.forceHint', 'Overwrites the remote branch; still refuses if it moved again'],
      ['dialogs.pushRejection.fetchAndRetry', 'Fetch and retry push'],
      ['dialogs.pushRejection.fetchRetryHint', 'Refreshes the remote-tracking ref so the lease check passes'],
      ['dialogs.pushRejection.createMr', 'Create Merge Request / Pull Request'],
      ['dialogs.pushRejection.createMrHint', 'Opens the MR/PR creation page with the source branch pre-filled'],
      ['dialogs.pushRejection.copyBranch', 'Copy branch name'],
      ['dialogs.pushRejection.branchCopied', 'Branch name copied'],
      ['dialogs.pushRejection.recovered', 'Push completed after recovery'],
    ],
    ru: [
      ['dialogs.pushRejection.nonFFTitle', 'Push отклонён — удалённая ветка ушла вперёд'],
      ['dialogs.pushRejection.nonFFBody', 'Удалённая ветка «{branch}» содержит коммиты, которых нет локально. Стяните их (merge или rebase) — push повторится автоматически, либо перезапишите удалённую ветку.'],
      ['dialogs.pushRejection.leaseTitle', 'Force push отклонён — устаревшая аренда'],
      ['dialogs.pushRejection.leaseBody', '--force-with-lease отклонил push: удалённая ветка «{branch}» изменилась после последнего fetch. Обновите remote-tracking ссылку и повторите — или подтвердите перезапись.'],
      ['dialogs.pushRejection.protectedTitle', 'Push отклонён — ветка защищена'],
      ['dialogs.pushRejection.protectedBody', 'Сервер запрещает прямой push в «{branch}» (protected branch). Проведите изменения через Merge/Pull Request — страница создания откроется с уже заполненной веткой.'],
      ['dialogs.pushRejection.policyTitle', 'Force push запрещён политикой'],
      ['dialogs.pushRejection.policyBody', 'Локальная политика PrismGit запрещает force push в эту ветку. Настройка: Preferences → Commands → Force Push Policy / Protected Branches.'],
      ['dialogs.pushRejection.branchLabel', 'Ветка:'],
      ['dialogs.pushRejection.rawLabel', 'Вывод git:'],
      ['dialogs.pushRejection.pullAndMerge', 'Стянуть и слить'],
      ['dialogs.pushRejection.pullMergeHint', 'git pull (merge) → разрешить конфликты при появлении → push повторится автоматически'],
      ['dialogs.pushRejection.pullAndRebase', 'Стянуть с rebase'],
      ['dialogs.pushRejection.pullRebaseHint', 'git pull --rebase → ваши коммиты лягут поверх удалённых → push повторится автоматически'],
      ['dialogs.pushRejection.forceLease', 'Перезаписать (--force-with-lease)'],
      ['dialogs.pushRejection.forceHint', 'Перезаписывает удалённую ветку; откажет, если она снова изменится'],
      ['dialogs.pushRejection.fetchAndRetry', 'Fetch и повторить push'],
      ['dialogs.pushRejection.fetchRetryHint', 'Обновляет remote-tracking ссылку, после чего проверка аренды проходит'],
      ['dialogs.pushRejection.createMr', 'Создать Merge Request / Pull Request'],
      ['dialogs.pushRejection.createMrHint', 'Открывает страницу создания MR/PR с заполненной исходной веткой'],
      ['dialogs.pushRejection.copyBranch', 'Копировать имя ветки'],
      ['dialogs.pushRejection.branchCopied', 'Имя ветки скопировано'],
      ['dialogs.pushRejection.recovered', 'Push выполнен после восстановления синхронизации'],
    ],
    zh: [
      ['dialogs.pushRejection.nonFFTitle', '推送被拒绝——远端分支已前进'],
      ['dialogs.pushRejection.nonFFBody', '远端分支 “{branch}” 包含本地没有的提交。请先拉取（合并或变基），推送将自动重试；或覆盖远端分支。'],
      ['dialogs.pushRejection.leaseTitle', '强推被拒绝——租约过期'],
      ['dialogs.pushRejection.leaseBody', '--force-with-lease 拒绝了推送：自上次 fetch 后远端分支 “{branch}” 已变化。请 fetch 刷新租约后重试，或确认覆盖。'],
      ['dialogs.pushRejection.protectedTitle', '推送被拒绝——分支受保护'],
      ['dialogs.pushRejection.protectedBody', '服务器拒绝直接推送到 “{branch}”（受保护分支）。请通过 Merge/Pull Request 提交变更——创建页面将预填分支。'],
      ['dialogs.pushRejection.policyTitle', '强推被策略禁止'],
      ['dialogs.pushRejection.policyBody', 'PrismGit 本地强推策略禁止此分支。设置：Preferences → Commands → Force Push Policy / Protected Branches。'],
      ['dialogs.pushRejection.branchLabel', '分支：'],
      ['dialogs.pushRejection.rawLabel', 'git 输出：'],
      ['dialogs.pushRejection.pullAndMerge', '拉取并合并'],
      ['dialogs.pushRejection.pullMergeHint', 'git pull（合并）→ 如有冲突先解决 → 自动重试推送'],
      ['dialogs.pushRejection.pullAndRebase', '拉取并变基'],
      ['dialogs.pushRejection.pullRebaseHint', 'git pull --rebase → 本地提交重放在远端之上 → 自动重试推送'],
      ['dialogs.pushRejection.forceLease', '覆盖（--force-with-lease）'],
      ['dialogs.pushRejection.forceHint', '覆盖远端分支；若远端再次变化仍会拒绝'],
      ['dialogs.pushRejection.fetchAndRetry', 'Fetch 并重试推送'],
      ['dialogs.pushRejection.fetchRetryHint', '刷新 remote-tracking 引用，使租约检查通过'],
      ['dialogs.pushRejection.createMr', '创建 Merge Request / Pull Request'],
      ['dialogs.pushRejection.createMrHint', '打开 MR/PR 创建页面并预填源分支'],
      ['dialogs.pushRejection.copyBranch', '复制分支名'],
      ['dialogs.pushRejection.branchCopied', '分支名已复制'],
      ['dialogs.pushRejection.recovered', '恢复同步后推送完成'],
    ],
    de: [
      ['dialogs.pushRejection.nonFFTitle', 'Push abgelehnt — Remote-Branch ist weiter'],
      ['dialogs.pushRejection.nonFFBody', 'Der Remote-Branch „{branch}“ enthält Commits, die lokal fehlen. Pullen (Merge oder Rebase) — der Push wird automatisch wiederholt — oder den Remote-Branch überschreiben.'],
      ['dialogs.pushRejection.leaseTitle', 'Force-Push abgelehnt — veraltete Lease'],
      ['dialogs.pushRejection.leaseBody', '--force-with-lease hat den Push verweigert: Der Remote-Branch „{branch}“ hat sich seit dem letzten Fetch geändert. Fetch aktualisiert die Lease — dann erneut versuchen oder Überschreiben bestätigen.'],
      ['dialogs.pushRejection.protectedTitle', 'Push abgelehnt — Branch ist geschützt'],
      ['dialogs.pushRejection.protectedBody', 'Der Server verweigert direkte Pushes auf „{branch}“ (geschützter Branch). Bringen Sie die Änderung über einen Merge/Pull Request ein — die Erstellungsseite öffnet sich mit vorausgefülltem Branch.'],
      ['dialogs.pushRejection.policyTitle', 'Force-Push durch Richtlinie verweigert'],
      ['dialogs.pushRejection.policyBody', 'PrismGits lokale Force-Push-Richtlinie untersagt diesen Branch. Einstellung: Preferences → Commands → Force Push Policy / Protected Branches.'],
      ['dialogs.pushRejection.branchLabel', 'Branch:'],
      ['dialogs.pushRejection.rawLabel', 'git-Ausgabe:'],
      ['dialogs.pushRejection.pullAndMerge', 'Pullen und mergen'],
      ['dialogs.pushRejection.pullMergeHint', 'git pull (Merge) → Konflikte lösen → Push wird automatisch wiederholt'],
      ['dialogs.pushRejection.pullAndRebase', 'Pullen mit Rebase'],
      ['dialogs.pushRejection.pullRebaseHint', 'git pull --rebase → eigene Commits oben → Push wird automatisch wiederholt'],
      ['dialogs.pushRejection.forceLease', 'Überschreiben (--force-with-lease)'],
      ['dialogs.pushRejection.forceHint', 'Überschreibt den Remote-Branch; verweigert weiterhin, wenn er sich erneut ändert'],
      ['dialogs.pushRejection.fetchAndRetry', 'Fetch und Push wiederholen'],
      ['dialogs.pushRejection.fetchRetryHint', 'Aktualisiert den Remote-Tracking-Ref, sodass die Lease-Prüfung besteht'],
      ['dialogs.pushRejection.createMr', 'Merge Request / Pull Request erstellen'],
      ['dialogs.pushRejection.createMrHint', 'Öffnet die MR/PR-Erstellungsseite mit vorausgefülltem Quell-Branch'],
      ['dialogs.pushRejection.copyBranch', 'Branch-Namen kopieren'],
      ['dialogs.pushRejection.branchCopied', 'Branch-Name kopiert'],
      ['dialogs.pushRejection.recovered', 'Push nach Wiederherstellung abgeschlossen'],
    ],
  },
  'src/i18n/locales/domains/pages.ts': {
    en: [
      ['pages.prConflictsBadge', 'Conflicts'],
      ['pages.prConflictsTooltip', 'The branches conflict — merging is blocked until the conflicts are resolved'],
      ['pages.prMergeConflictBlocked', 'PR has merge conflicts — resolve them before merging'],
    ],
    ru: [
      ['pages.prConflictsBadge', 'Конфликты'],
      ['pages.prConflictsTooltip', 'Ветки конфликтуют — слияние невозможно до разрешения конфликтов'],
      ['pages.prMergeConflictBlocked', 'PR содержит конфликты слияния — сначала разрешите их'],
    ],
    zh: [
      ['pages.prConflictsBadge', '冲突'],
      ['pages.prConflictsTooltip', '分支存在冲突——解决前无法合并'],
      ['pages.prMergeConflictBlocked', 'PR 存在合并冲突——请先解决后再合并'],
    ],
    de: [
      ['pages.prConflictsBadge', 'Konflikte'],
      ['pages.prConflictsTooltip', 'Die Branches kollidieren — Mergen erst nach Konfliktlösung möglich'],
      ['pages.prMergeConflictBlocked', 'PR hat Merge-Konflikte — bitte zuerst lösen'],
    ],
  },
};

// Anchors AFTER which each locale block's entries are inserted. The anchor
// must exist once per locale block.
const ANCHORS = {
  'src/i18n/locales/domains/dialogs.ts': "  'dialogs.applyPatchFailed':",
  'src/i18n/locales/domains/pages.ts': "  'pages.prMergeDraftBlocked':",
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
