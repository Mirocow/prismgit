/**
 * i18n patcher — Task 29 («Remotes→Branches, хеш в тосте, Reflog, Blame, Pin»).
 *
 * Adds the new keys and removes the dead ones in ALL FOUR locale blocks of
 * each domain file. Per-locale-block scoping (the Task-28 lesson): the
 * existence/deletion check is scoped to the block between the locale's
 * first key and the next locale's first key, never the whole file.
 *
 * Domains touched: pages (blame), diff (conflicts toast), branches
 * (fetch-all), remotes (dead Remotes-page keys), contextMenus (dead
 * ctx.remote.*), shell (pin/unpin), changes (dead hashDetail).
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LOCALES = ['en', 'ru', 'zh', 'de'];

/** Insert KEYS after ANCHOR, delete DEAD keys — per locale block.
 *  Block boundaries are the `export const <locale>:` HEADER lines (Task-29
 *  bugfix: anchoring deletion scope at a content key made one block's
 *  scope bleed into the NEXT locale and delete ITS keys — 39 keys ×4 went
 *  to the wrong blocks. Headers are unambiguous). */
function patchDomain(file, anchor, addKeys, deadKeys) {
  const full = path.join(ROOT, file);
  const src = fs.readFileSync(full, 'utf8');
  const lines = src.split('\n');

  // Locate the 4 locale block headers (en/ru/zh/de in file order).
  const headerIdxs = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^export const (en|ru|zh|de):/.test(lines[i])) headerIdxs.push(i);
  }
  if (headerIdxs.length !== LOCALES.length) {
    console.error(`ERROR ${file}: expected ${LOCALES.length} locale headers, found ${headerIdxs.length}`);
    process.exit(1);
  }
  for (let li = 0; li < LOCALES.length; li++) {
    const start = headerIdxs[li];
    const end = li + 1 < LOCALES.length ? headerIdxs[li + 1] : lines.length;
    const locale = LOCALES[li];
    const block = lines.slice(start, end);

    // Delete dead keys inside THIS block only.
    let deletedCount = 0;
    for (const dead of deadKeys) {
      const keyStr = `'${dead}':`;
      for (let bi = block.length - 1; bi >= 0; bi--) {
        if (block[bi].includes(keyStr)) {
          block.splice(bi, 1);
          deletedCount++;
          break;
        }
      }
    }

    // Insert new keys after the anchor line (idempotent per block).
    const existing = block.join('\n');
    const additions = [];
    const addPairs = addKeys[locale] ?? [];
    for (const [key, value] of addPairs) {
      if (existing.includes(`'${key}':`)) continue; // scoped to THIS block
      additions.push(`  '${key}': '${value.replace(/'/g, "\\'")}',`);
    }
    if (additions.length || deletedCount) {
      // Insert additions right after the anchor line (must exist in-block).
      const anchorPos = block.findIndex((l) => l.includes(anchor));
      if (anchorPos < 0) {
        console.error(`ERROR ${file} [${locale}]: anchor "${anchor}" not found in block`);
        process.exit(1);
      }
      block.splice(anchorPos + 1, 0, ...additions);
      lines.splice(start, end - start, ...block);
      // headerIdxs for later locales shift by the delta.
      const delta = additions.length - deletedCount;
      for (let lj = li + 1; lj < LOCALES.length; lj++) headerIdxs[lj] += delta;
    }
  }
  fs.writeFileSync(full, lines.join('\n'));
  console.log(`patched ${file}`);
}

// ── 1. pages domain: new Blame keys ─────────────────────────────────────────
patchDomain(
  'src/i18n/locales/domains/pages.ts',
  "'pages.blameFileLabel'",
  {
    en: [
      ['pages.blameFilePlaceholder', 'File in the repository — start typing to search'],
      ['pages.blameFilesLoading', 'Loading file list…'],
      ['pages.blameNoFilesMatch', 'No tracked files match'],
      ['pages.blameBlameBefore', 'Blame before this commit'],
      ['pages.blameAtRef', 'Blaming an older version: {ref}'],
      ['pages.blameBackToHead', 'Back to HEAD'],
      ['pages.blameRefLabel', 'Revision to blame (ref)'],
      ['pages.blameGroupHint', 'grouped by commit'],
    ],
    ru: [
      ['pages.blameFilePlaceholder', 'Файл в репозитории — начните вводить для поиска'],
      ['pages.blameFilesLoading', 'Загрузка списка файлов…'],
      ['pages.blameNoFilesMatch', 'Нет подходящих отслеживаемых файлов'],
      ['pages.blameBlameBefore', 'Blame до этого коммита'],
      ['pages.blameAtRef', 'Показана более старая версия: {ref}'],
      ['pages.blameBackToHead', 'Вернуться к HEAD'],
      ['pages.blameRefLabel', 'Версия для blame (ref)'],
      ['pages.blameGroupHint', 'сгруппировано по коммитам'],
    ],
    zh: [
      ['pages.blameFilePlaceholder', '仓库中的文件 — 输入以搜索'],
      ['pages.blameFilesLoading', '正在加载文件列表…'],
      ['pages.blameNoFilesMatch', '没有匹配的跟踪文件'],
      ['pages.blameBlameBefore', '追溯此提交之前'],
      ['pages.blameAtRef', '正在查看旧版本：{ref}'],
      ['pages.blameBackToHead', '返回 HEAD'],
      ['pages.blameRefLabel', '要追溯的版本（ref）'],
      ['pages.blameGroupHint', '按提交分组'],
    ],
    de: [
      ['pages.blameFilePlaceholder', 'Datei im Repository — tippen zum Suchen'],
      ['pages.blameFilesLoading', 'Dateiliste wird geladen…'],
      ['pages.blameNoFilesMatch', 'Keine passenden versionierten Dateien'],
      ['pages.blameBlameBefore', 'Blame vor diesem Commit'],
      ['pages.blameAtRef', 'Ältere Version wird angezeigt: {ref}'],
      ['pages.blameBackToHead', 'Zurück zu HEAD'],
      ['pages.blameRefLabel', 'Zu blame-ende Version (ref)'],
      ['pages.blameGroupHint', 'nach Commits gruppiert'],
    ],
  },
  []
);

// ── 2. diff domain: conflicts-resolved toast (was hardcoded EN) ─────────────
patchDomain(
  'src/i18n/locales/domains/diff.ts',
  "'diff.selectRefs'",
  {
    en: [
      ['diff.conflictsAllResolved', 'All conflicts resolved'],
      ['diff.conflictsAllResolvedHint', 'You can now Continue/Commit to finish.'],
    ],
    ru: [
      ['diff.conflictsAllResolved', 'Все конфликты разрешены'],
      ['diff.conflictsAllResolvedHint', 'Теперь можно продолжить или закоммитить, чтобы завершить операцию.'],
    ],
    zh: [
      ['diff.conflictsAllResolved', '所有冲突已解决'],
      ['diff.conflictsAllResolvedHint', '现在可以继续/提交以完成操作。'],
    ],
    de: [
      ['diff.conflictsAllResolved', 'Alle Konflikte gelöst'],
      ['diff.conflictsAllResolvedHint', 'Sie können jetzt Fortsetzen/Committen, um den Vorgang abzuschließen.'],
    ],
  },
  []
);

// ── 3. branches domain: fetch-all + add-remote tooltips ────────────────────
patchDomain(
  'src/i18n/locales/domains/branches.ts',
  "'branches.noRemotesConfigured'",
  {
    en: [
      ['branches.fetchedAllRemotes', 'Fetched all remotes (with prune)'],
      ['branches.fetchAllRemotesFailed', 'Fetch all remotes failed'],
      ['branches.fetchAllRemotesTooltip', 'Fetch all remotes (git fetch --all --prune)'],
      ['branches.addRemoteTooltip', 'Add remote…'],
    ],
    ru: [
      ['branches.fetchedAllRemotes', 'Изменения получены со всех remote (с очисткой)'],
      ['branches.fetchAllRemotesFailed', 'Не удалось получить изменения со всех remote'],
      ['branches.fetchAllRemotesTooltip', 'Получить изменения со всех remote (git fetch --all --prune)'],
      ['branches.addRemoteTooltip', 'Добавить remote…'],
    ],
    zh: [
      ['branches.fetchedAllRemotes', '已拉取所有远程（含清理）'],
      ['branches.fetchAllRemotesFailed', '拉取所有远程失败'],
      ['branches.fetchAllRemotesTooltip', '从所有远程拉取（git fetch --all --prune）'],
      ['branches.addRemoteTooltip', '添加远程…'],
    ],
    de: [
      ['branches.fetchedAllRemotes', 'Alle Remotes abgerufen (mit Prune)'],
      ['branches.fetchAllRemotesFailed', 'Abruf aller Remotes fehlgeschlagen'],
      ['branches.fetchAllRemotesTooltip', 'Alle Remotes abrufen (git fetch --all --prune)'],
      ['branches.addRemoteTooltip', 'Remote hinzufügen…'],
    ],
  },
  ['branches.manageRemotes']
);

// ── 4. remotes domain: drop the keys only the deleted Remotes page used ─────
const REMOTES_DEAD = [
  'remotes.title', 'remotes.count', 'remotes.empty', 'remotes.emptyDesc',
  'remotes.add', 'remotes.addFailed', 'remotes.added', 'remotes.nameAndUrlRequired',
  'remotes.nameLabel', 'remotes.urlLabel',
  'remotes.loadFailed', 'remotes.defaultBadge', 'remotes.authBadge', 'remotes.authTooltip',
  'remotes.authLabel', 'remotes.authHint', 'remotes.usernamePlaceholder', 'remotes.passwordPlaceholder',
  'remotes.showPassword', 'remotes.hidePassword',
  'remotes.autoBadge', 'remotes.autoTooltip', 'remotes.backgroundToggle', 'remotes.backgroundHint',
  'remotes.editTitle', 'remotes.editTooltip', 'remotes.fetchUrlLabel', 'remotes.pushUrlLabel',
  'remotes.pushUrlHint', 'remotes.pushUrlDesc', 'remotes.pushPrefix',
  'remotes.updated', 'remotes.updateFailed',
  'remotes.removed', 'remotes.removeFailed', 'remotes.removeTitle', 'remotes.removeMessage', 'remotes.removeTooltip',
  'remotes.renamed', 'remotes.renameFailed', 'remotes.renameTooltip',
  'remotes.fetched', 'remotes.fetchFailed', 'remotes.fetchPruneTooltip',
  'remotes.fetchAll', 'remotes.fetchedAll', 'remotes.fetchAllFailed', 'remotes.fetchAllTooltip',
  'remotes.lsRemoteFailed', 'remotes.previewTooltip', 'remotes.refsHeader', 'remotes.noRefs',
  'remotes.selectRefTooltip', 'remotes.browseBranchesTooltip', 'remotes.repoSettingsTooltip',
];
patchDomain('src/i18n/locales/domains/remotes.ts', "'remotes.pullTitle'", {}, REMOTES_DEAD);

// ── 5. contextMenus domain: drop ctx.remote.* (only remoteContextMenu.ts used them) ──
const CTX_REMOTE_DEAD = [
  'ctx.remote.fetchWithPrune', 'ctx.remote.previewRemoteRefs', 'ctx.remote.hideRemoteRefs',
  'ctx.remote.copyFetchUrl', 'ctx.remote.copyPushUrl', 'ctx.remote.browseBranches',
  'ctx.remote.edit', 'ctx.remote.rename', 'ctx.remote.backgroundPollOrFetch',
  'ctx.remote.repositorySettings', 'ctx.remote.removeRemote',
];
patchDomain('src/i18n/locales/domains/contextMenus.ts', "'ctx.group.copy'", {}, CTX_REMOTE_DEAD);

// ── 6. shell domain: drop pin/unpin (pin button removed from the repo tree) ─
patchDomain('src/i18n/locales/domains/shell.ts', "'shell.removeFromList'", {}, [
  'shell.pin', 'shell.unpin',
]);

// ── 7. changes domain: hashDetail text dead (toast now renders a hash chip) ─
patchDomain('src/i18n/locales/domains/changes.ts', "'changes.commitButton'", {}, [
  'changes.hashDetail',
]);

console.log('ALL DOMAINS PATCHED');
