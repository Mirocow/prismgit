/**
 * i18n patcher — v2.3 zones + recursive folder repositories.
 *
 * Task: user pixel-diffed 2 extreme test themes across 8 themes and found
 * (1) zone tokens: «зоны не соответствуют, настраиваешь одно, а цвета
 * меняются в других окнах/областях» → zone-scoped tokens + ThemeZoneEditor;
 * (2) «репозитории из папок должны добавляться рекурсивно, образуя группы
 * по названию папок» → folder scan IPC + sidebar/welcome entry points.
 *
 * Inserts new keys AFTER their per-locale anchors in:
 *   - domains/settings.ts (zone editor labels/hints)
 *   - domains/shell.ts   (folder scan dialog + toasts + menu labels)
 *
 * Idempotent: skips insertion when the key already exists.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const SETTINGS = {
  en: [
    ['settings.zoneColorsTitle', 'Zone Colors'],
    ['settings.zoneColorsHint', 'Each zone is colored independently — a change here never repaints other areas. Works on top of the selected theme.'],
    ['settings.zoneCustomized', 'customized'],
    ['settings.zoneResetOne', 'Reset this zone to the theme value'],
    ['settings.zoneResetAll', 'Reset all ({count})'],
    ['settings.zonePreviewHint', 'Live preview — hover a row to see which area it is'],
    ['settings.zoneCommonGroup', 'Shared'],
    ['settings.zoneTitlebar', 'Toolbar (title bar)'],
    ['settings.zoneTitlebarHint', 'Top application bar: logo, repo buttons, push/pull'],
    ['settings.zoneGitbar', 'Git toolbar'],
    ['settings.zoneGitbarHint', 'Second row under the title bar: branch, fetch/pull/push'],
    ['settings.zoneSidebar', 'Sidebar'],
    ['settings.zoneSidebarHint', 'Left panel: repository tree and navigation'],
    ['settings.zoneMain', 'Main window'],
    ['settings.zoneMainHint', 'Page canvas under the panels (History, Changes, …)'],
    ['settings.zonePanel', 'Panels'],
    ['settings.zonePanelHint', 'Cards and sections inside pages'],
    ['settings.zonePanelHeader', 'Panel headers'],
    ['settings.zonePanelHeaderHint', 'Titled strips on top of each panel'],
    ['settings.zonePopover', 'Menus & popups'],
    ['settings.zonePopoverHint', 'Dropdowns, context menus, floating panels'],
    ['settings.zoneStatusbar', 'Status bar'],
    ['settings.zoneStatusbarHint', 'Bottom strip: state, branch, counters'],
    ['settings.zoneCommonAccent', 'Accent'],
    ['settings.zoneCommonAccentHint', 'Buttons, links, active states — shared by all zones'],
  ],
  ru: [
    ['settings.zoneColorsTitle', 'Цвета зон'],
    ['settings.zoneColorsHint', 'Каждая зона окрашивается независимо — изменение здесь больше не перекрашивает другие области. Применяется поверх выбранной темы.'],
    ['settings.zoneCustomized', 'изменено'],
    ['settings.zoneResetOne', 'Вернуть значение темы для этой зоны'],
    ['settings.zoneResetAll', 'Сбросить все ({count})'],
    ['settings.zonePreviewHint', 'Живое превью — наведите на строку, чтобы увидеть область'],
    ['settings.zoneCommonGroup', 'Общие'],
    ['settings.zoneTitlebar', 'Панель инструментов (заголовок)'],
    ['settings.zoneTitlebarHint', 'Верхняя полоса приложения: логотип, кнопки репозитория, push/pull'],
    ['settings.zoneGitbar', 'Git-панель'],
    ['settings.zoneGitbarHint', 'Вторая строка под заголовком: ветка, fetch/pull/push'],
    ['settings.zoneSidebar', 'Боковая панель'],
    ['settings.zoneSidebarHint', 'Левая колонка: дерево репозиториев и навигация'],
    ['settings.zoneMain', 'Главное окно'],
    ['settings.zoneMainHint', 'Полотно страницы под панелями (История, Изменения, …)'],
    ['settings.zonePanel', 'Панели'],
    ['settings.zonePanelHint', 'Карточки и секции внутри страниц'],
    ['settings.zonePanelHeader', 'Заголовки панелей'],
    ['settings.zonePanelHeaderHint', 'Полосы с названием сверху каждой панели'],
    ['settings.zonePopover', 'Меню и всплывающие окна'],
    ['settings.zonePopoverHint', 'Выпадающие списки, контекстные меню, плавающие панели'],
    ['settings.zoneStatusbar', 'Строка состояния'],
    ['settings.zoneStatusbarHint', 'Нижняя полоса: состояние, ветка, счётчики'],
    ['settings.zoneCommonAccent', 'Акцент'],
    ['settings.zoneCommonAccentHint', 'Кнопки, ссылки, активные состояния — общий для всех зон'],
  ],
  zh: [
    ['settings.zoneColorsTitle', '区域颜色'],
    ['settings.zoneColorsHint', '每个区域独立着色——在这里修改不会影响其他区域。叠加在所选主题之上。'],
    ['settings.zoneCustomized', '已自定义'],
    ['settings.zoneResetOne', '将此区域重置为主题值'],
    ['settings.zoneResetAll', '全部重置（{count}）'],
    ['settings.zonePreviewHint', '实时预览——悬停某行查看对应区域'],
    ['settings.zoneCommonGroup', '共享'],
    ['settings.zoneTitlebar', '工具栏（标题栏）'],
    ['settings.zoneTitlebarHint', '应用顶栏： logo、仓库按钮、push/pull'],
    ['settings.zoneGitbar', 'Git 工具栏'],
    ['settings.zoneGitbarHint', '标题栏下方第二行： 分支、fetch/pull/push'],
    ['settings.zoneSidebar', '侧边栏'],
    ['settings.zoneSidebarHint', '左栏： 仓库树和导航'],
    ['settings.zoneMain', '主窗口'],
    ['settings.zoneMainHint', '面板之下的页面画布（历史、更改等）'],
    ['settings.zonePanel', '面板'],
    ['settings.zonePanelHint', '页面内的卡片和分区'],
    ['settings.zonePanelHeader', '面板标题'],
    ['settings.zonePanelHeaderHint', '每个面板顶部的标题条'],
    ['settings.zonePopover', '菜单与弹窗'],
    ['settings.zonePopoverHint', '下拉列表、上下文菜单、浮动面板'],
    ['settings.zoneStatusbar', '状态栏'],
    ['settings.zoneStatusbarHint', '底栏： 状态、分支、计数'],
    ['settings.zoneCommonAccent', '强调色'],
    ['settings.zoneCommonAccentHint', '按钮、链接、激活态——所有区域共用'],
  ],
  de: [
    ['settings.zoneColorsTitle', 'Zonenfarben'],
    ['settings.zoneColorsHint', 'Jede Zone wird unabhängig gefärbt — eine Änderung hier streicht keine anderen Bereiche um. Wirkt zusätzlich zum gewählten Theme.'],
    ['settings.zoneCustomized', 'angepasst'],
    ['settings.zoneResetOne', 'Diese Zone auf den Theme-Wert zurücksetzen'],
    ['settings.zoneResetAll', 'Alle zurücksetzen ({count})'],
    ['settings.zonePreviewHint', 'Live-Vorschau — Zeile überfahren, um den Bereich zu sehen'],
    ['settings.zoneCommonGroup', 'Gemeinsam'],
    ['settings.zoneTitlebar', 'Symbolleiste (Titelleiste)'],
    ['settings.zoneTitlebarHint', 'Obere App-Leiste: Logo, Repo-Schaltflächen, Push/Pull'],
    ['settings.zoneGitbar', 'Git-Leiste'],
    ['settings.zoneGitbarHint', 'Zweite Zeile unter der Titelleiste: Branch, Fetch/Pull/Push'],
    ['settings.zoneSidebar', 'Seitenleiste'],
    ['settings.zoneSidebarHint', 'Linke Spalte: Repository-Baum und Navigation'],
    ['settings.zoneMain', 'Hauptfenster'],
    ['settings.zoneMainHint', 'Seitenfläche unter den Panels (History, Changes, …)'],
    ['settings.zonePanel', 'Panels'],
    ['settings.zonePanelHint', 'Karten und Abschnitte innerhalb der Seiten'],
    ['settings.zonePanelHeader', 'Panel-Köpfe'],
    ['settings.zonePanelHeaderHint', 'Titelstreifen oben auf jedem Panel'],
    ['settings.zonePopover', 'Menüs & Popups'],
    ['settings.zonePopoverHint', 'Dropdowns, Kontextmenüs, schwebende Panels'],
    ['settings.zoneStatusbar', 'Statusleiste'],
    ['settings.zoneStatusbarHint', 'Untere Leiste: Status, Branch, Zähler'],
    ['settings.zoneCommonAccent', 'Akzent'],
    ['settings.zoneCommonAccentHint', 'Schaltflächen, Links, aktive Zustände — für alle Zonen gemeinsam'],
  ],
};

const SHELL = {
  en: [
    ['shell.addFolder', 'Add folder…'],
    ['shell.addFolderHint', 'Scan a folder recursively — every repository inside it and its subfolders, grouped by folder name'],
    ['shell.scanningFolder', 'Scanning folder…'],
    ['shell.scanFolderNoneTitle', 'No repositories found'],
    ['shell.scanFolderNoneBody', 'No Git repositories were found in\n{folder}\n(or its subfolders).'],
    ['shell.scanFolderConfirmTitle', 'Add {count} repositories?'],
    ['shell.scanFolderConfirmBody', 'Found in "{folder}":\n\n{list}\n\nGroups will mirror the folder structure. Repositories already in the list only move into their group.'],
    ['shell.scanFolderAddedTitle', 'Folder added'],
    ['shell.scanFolderAddedBody', '{added} new repositories, {existing} already in the list, {groups} groups created.'],
    ['shell.scanFolderFailed', 'Folder scan failed'],
    ['shell.scanFolderTooDeep', 'Scan stopped at depth {depth}'],
  ],
  ru: [
    ['shell.addFolder', 'Добавить папку…'],
    ['shell.addFolderHint', 'Рекурсивно просканировать папку — все репозитории в ней и подпапках, группами по именам папок'],
    ['shell.scanningFolder', 'Сканирование папки…'],
    ['shell.scanFolderNoneTitle', 'Репозитории не найдены'],
    ['shell.scanFolderNoneBody', 'В папке\n{folder}\n(и её подпапках) Git-репозиториев не найдено.'],
    ['shell.scanFolderConfirmTitle', 'Добавить репозиториев: {count}?'],
    ['shell.scanFolderConfirmBody', 'Найдено в «{folder}»:\n\n{list}\n\nГруппы повторят структуру папок. Уже добавленные репозитории просто переместятся в свои группы.'],
    ['shell.scanFolderAddedTitle', 'Папка добавлена'],
    ['shell.scanFolderAddedBody', 'Новых репозиториев: {added}, уже было в списке: {existing}, создано групп: {groups}.'],
    ['shell.scanFolderFailed', 'Не удалось просканировать папку'],
    ['shell.scanFolderTooDeep', 'Сканирование остановлено на глубине {depth}'],
  ],
  zh: [
    ['shell.addFolder', '添加文件夹…'],
    ['shell.addFolderHint', '递归扫描文件夹——其中的所有仓库及子文件夹，按文件夹名称分组'],
    ['shell.scanningFolder', '正在扫描文件夹…'],
    ['shell.scanFolderNoneTitle', '未找到仓库'],
    ['shell.scanFolderNoneBody', '在\n{folder}\n（及其子文件夹）中未找到 Git 仓库。'],
    ['shell.scanFolderConfirmTitle', '添加 {count} 个仓库？'],
    ['shell.scanFolderConfirmBody', '在“{folder}”中找到：\n\n{list}\n\n分组将镜像文件夹结构。已在列表中的仓库只会移入相应分组。'],
    ['shell.scanFolderAddedTitle', '文件夹已添加'],
    ['shell.scanFolderAddedBody', '新增仓库 {added} 个，已在列表 {existing} 个，创建分组 {groups} 个。'],
    ['shell.scanFolderFailed', '文件夹扫描失败'],
    ['shell.scanFolderTooDeep', '扫描在深度 {depth} 处停止'],
  ],
  de: [
    ['shell.addFolder', 'Ordner hinzufügen…'],
    ['shell.addFolderHint', 'Ordner rekursiv scannen — alle Repositories darin und in Unterordnern, gruppiert nach Ordnername'],
    ['shell.scanningFolder', 'Ordner wird gescannt…'],
    ['shell.scanFolderNoneTitle', 'Keine Repositories gefunden'],
    ['shell.scanFolderNoneBody', 'In\n{folder}\n(und Unterordnern) wurden keine Git-Repositories gefunden.'],
    ['shell.scanFolderConfirmTitle', '{count} Repositories hinzufügen?'],
    ['shell.scanFolderConfirmBody', 'Gefunden in „{folder}“:\n\n{list}\n\nGruppen spiegeln die Ordnerstruktur. Bereits gelistete Repositories wandern nur in ihre Gruppe.'],
    ['shell.scanFolderAddedTitle', 'Ordner hinzugefügt'],
    ['shell.scanFolderAddedBody', '{added} neue Repositories, {existing} bereits in der Liste, {groups} Gruppen erstellt.'],
    ['shell.scanFolderFailed', 'Ordner-Scan fehlgeschlagen'],
    ['shell.scanFolderTooDeep', 'Scan bei Tiefe {depth} gestoppt'],
  ],
};

function patch(file, plan, anchorKey) {
  const p = path.join(ROOT, file);
  let src = fs.readFileSync(p, 'utf8');
  let inserted = 0;
  for (const [locale, entries] of Object.entries(plan)) {
    // Locale block span: `export const <locale>: ... {` … the NEXT `^};`
    const blockStartRe = new RegExp(`export const ${locale}: Record<string, string> = \\{`);
    const startMatch = src.match(blockStartRe);
    if (!startMatch) {
      console.error(`[${file}] ${locale} block not found`);
      process.exitCode = 1;
      continue;
    }
    const blockStart = src.indexOf(startMatch[0], 0);
    const blockEnd = src.indexOf('\n};', blockStart);
    const block = src.slice(blockStart, blockEnd);
    // Insertion point: the line AFTER the anchor key's line (either quote
    // style — upstream reformatted some domains to double quotes).
    const anchorRe = new RegExp(`(\\n[ \\t]+['"]${anchorKey}['"][^\\n]*\\n)`);
    const anchorMatch = block.match(anchorRe);
    if (!anchorMatch) {
      console.error(`[${file}] anchor '${anchorKey}' not found in ${locale} block`);
      process.exitCode = 1;
      continue;
    }
    const insertAt = blockStart + block.indexOf(anchorMatch[1]) + anchorMatch[1].length;
    // Idempotency: skip entries whose key already exists in the LOCALE block
    // (either quote style — upstream reformatted some domains to double quotes).
    const pending = entries.filter(([k]) => !block.includes(`'${k}'`) && !block.includes(`"${k}"`));
    if (pending.length === 0) continue;
    const lines = pending.map(([k, v]) => `  "${k}": ${JSON.stringify(v)},`).join('\n');
    src = src.slice(0, insertAt) + lines + '\n' + src.slice(insertAt);
    inserted += pending.length;
  }
  fs.writeFileSync(p, src);
  console.log(`[${file}] inserted ${inserted} keys`);
}

patch('src/i18n/locales/domains/settings.ts', SETTINGS, 'settings.themeOverridesNote');
patch('src/i18n/locales/domains/shell.ts', SHELL, 'shell.noGitReposFound');
