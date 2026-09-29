import * as fs from 'node:fs';
const p = 'src/i18n/locales/domains/settings.ts';
let s = fs.readFileSync(p, 'utf8');

// v3.9 — zone hints («!» per swatch), contrast-warning keys, and CLEARER RU
// zone labels: «Панель» → «Панели инструментов» etc. (the user: «с зонами
// тем большая беда, особенно с названием "Панель"»).
const blocks = [
  // ── EN ──
  ["'settings.swatchBgPrimary': 'Background',", [
    "'settings.zoneHintBgPrimary': 'The MAIN background: file lists, commit graphs, editor and diff areas — the largest surface of the app.',",
    "'settings.zoneHintBgSecondary': 'Side panels, the console and in-tool bars: sidebar rows, History details pane, the Output panel background.',",
    "'settings.zoneHintBgTertiary': 'Panel HEADERS and toolbar strips: the top bar of the console, group headers, filter rows.',",
    "'settings.zoneHintBgElevated': 'Pop-ups and floating surfaces: dialogs, context menus, dropdowns, tooltips.',",
    "'settings.zoneHintBgSidebar': 'The LEFT sidebar background only. A dark value + light Background = the VS Code-style dark-sidebar/light-main look; sidebar text is computed automatically.',",
    "'settings.zoneHintTextPrimary': 'Primary text everywhere: subjects, file names, input values. Checked against the main background — a warning appears below 4.5:1.',",
    "'settings.zoneHintTextSecondary': 'Secondary text: descriptions, timestamps, hints.',",
    "'settings.zoneHintTextTertiary': 'Dimmest text: placeholders, group labels, “muted” rows.',",
    "'settings.zoneHintAccent': 'Accent: links, active items, the primary buttons, focus rings, selection highlights.',",
    "'settings.zoneHintBorder': 'Borders and separators between panels and rows.',",
    "'settings.zoneContrastWarning': 'Contrast with the main background is below 4.5:1 — this text will be hard to read.',",
    "'settings.zoneContrastFix': 'Make readable on this background',",
    "'settings.zoneContrastFixLabel': 'Readable',",
  ]],
  // ── RU ──
  ["'settings.swatchBgPrimary': 'Фон',", [
    "'settings.zoneHintBgPrimary': 'ОСНОВНОЙ фон: списки файлов, граф коммитов, области редактора и диффа — самая большая поверхность приложения.',",
    "'settings.zoneHintBgSecondary': 'Боковые панели и консоль: строки сайдбара, панель деталей коммита, фон панели «Вывод».',",
    "'settings.zoneHintBgTertiary': 'ШАПКИ панелей и полосы инструментов: верхняя полоса консоли, заголовки групп, строки фильтров.',",
    "'settings.zoneHintBgElevated': 'Всплывающие поверхности: диалоги, контекстные меню, выпадающие списки, тултипы.',",
    "'settings.zoneHintBgSidebar': 'Фон ТОЛЬКО левого сайдбара. Тёмное значение + светлый «Фон» = стиль VS Code (тёмный сайдбар / светлое окно); цвет текста сайдбара подбирается автоматически.',",
    "'settings.zoneHintTextPrimary': 'Основной текст везде: темы коммитов, имена файлов, значения в полях. Проверяется на контраст с основным фоном — ниже 4.5:1 появится предупреждение.',",
    "'settings.zoneHintTextSecondary': 'Вторичный текст: описания, время, подсказки.',",
    "'settings.zoneHintTextTertiary': 'Самый бледный текст: плейсхолдеры, подписи групп, «приглушённые» строки.',",
    "'settings.zoneHintAccent': 'Акцент: ссылки, активные пункты, главные кнопки, обводка фокуса, подсветка выбора.',",
    "'settings.zoneHintBorder': 'Границы и разделители между панелями и строками.',",
    "'settings.zoneContrastWarning': 'Контраст с основным фоном ниже 4.5:1 — этот текст будет плохо читаться.',",
    "'settings.zoneContrastFix': 'Сделать читаемым на этом фоне',",
    "'settings.zoneContrastFixLabel': 'Читаемо',",
  ]],
  // ── ZH ──
  ["'settings.swatchBgPrimary': '背景',", [
    "'settings.zoneHintBgPrimary': '主背景：文件列表、提交图、编辑器和差异区域——应用最大的表面。',",
    "'settings.zoneHintBgSecondary': '侧面板与控制台：侧边栏行、提交详情面板、输出面板背景。',",
    "'settings.zoneHintBgTertiary': '面板标题栏与工具条：控制台顶栏、分组标题、筛选行。',",
    "'settings.zoneHintBgElevated': '弹出层：对话框、右键菜单、下拉列表、工具提示。',",
    "'settings.zoneHintBgSidebar': '仅左侧边栏的背景。深色值 + 浅色“背景” = VS Code 式深侧栏/浅主窗；侧栏文字颜色自动计算。',",
    "'settings.zoneHintTextPrimary': '主要文本：提交主题、文件名、输入值。会与主背景对比，低于 4.5:1 时显示警告。',",
    "'settings.zoneHintTextSecondary': '次要文本：描述、时间、提示。',",
    "'settings.zoneHintTextTertiary': '最淡的文本：占位符、分组标签、“弱化”行。',",
    "'settings.zoneHintAccent': '强调色：链接、活动项、主按钮、焦点环、选中高亮。',",
    "'settings.zoneHintBorder': '面板与行之间的边框和分隔线。',",
    "'settings.zoneContrastWarning': '与主背景的对比度低于 4.5:1——文字将难以阅读。',",
    "'settings.zoneContrastFix': '在此背景上改为可读颜色',",
    "'settings.zoneContrastFixLabel': '可读',",
  ]],
  // ── DE ──
  ["'settings.swatchBgPrimary': 'Hintergrund',", [
    "'settings.zoneHintBgPrimary': 'Der HAUPT-Hintergrund: Dateilisten, Commit-Graph, Editor- und Diff-Flächen — die größte Fläche der App.',",
    "'settings.zoneHintBgSecondary': 'Seitenpanels und Konsole: Seitenleistenzeilen, Commit-Details-Panel, Hintergrund des Ausgabe-Panels.',",
    "'settings.zoneHintBgTertiary': 'Panel-KOPFZEILEN und Werkzeugleisten: obere Leiste der Konsole, Gruppenköpfe, Filterzeilen.',",
    "'settings.zoneHintBgElevated': 'Erscheinende Flächen: Dialoge, Kontextmenüs, Dropdowns, Tooltips.',",
    "'settings.zoneHintBgSidebar': 'Nur der Hintergrund der LINKEN Seitenleiste. Dunkler Wert + heller Hintergrund = VS Code-Stil (dunkle Seitenleiste / helles Fenster); die Textfarbe wird automatisch berechnet.',",
    "'settings.zoneHintTextPrimary': 'Primärer Text überall: Commit-Betreffs, Dateinamen, Eingabewerte. Wird gegen den Hauptgrund geprüft — unter 4.5:1 erscheint eine Warnung.',",
    "'settings.zoneHintTextSecondary': 'Sekundärer Text: Beschreibungen, Zeitstempel, Hinweise.',",
    "'settings.zoneHintTextTertiary': 'Blassster Text: Platzhalter, Gruppenlabels, „gedimmte“ Zeilen.',",
    "'settings.zoneHintAccent': 'Akzent: Links, aktive Einträge, Hauptbuttons, Fokus-Ringe, Auswahl-Hervorhebungen.',",
    "'settings.zoneHintBorder': 'Rahmen und Trennlinien zwischen Panels und Zeilen.',",
    "'settings.zoneContrastWarning': 'Der Kontrast zum Hauptgrund liegt unter 4.5:1 — dieser Text ist schwer lesbar.',",
    "'settings.zoneContrastFix': 'Auf diesem Grund lesbar machen',",
    "'settings.zoneContrastFixLabel': 'Lesbar',",
  ]],
];

for (const [anchor, lines] of blocks) {
  if (s.includes(anchor) && !s.includes(lines[0])) {
    s = s.replace(anchor, anchor + '\n  ' + lines.join('\n  '));
    console.log('zone hints added for', anchor.slice(0, 45));
  }
}

// Clearer RU zone labels (the «Панель» confusion).
const renames = [
  ["'settings.swatchBgSecondary': 'Панель',", "'settings.swatchBgSecondary': 'Панели и консоль',"],
  ["'settings.swatchBgTertiary': 'Заголовок',", "'settings.swatchBgTertiary': 'Шапки панелей',"],
  ["'settings.swatchBgElevated': 'Поверхность',", "'settings.swatchBgElevated': 'Всплывающие окна',"],
];
for (const [from, to] of renames) {
  if (s.includes(from)) {
    s = s.replace(from, to);
    console.log('renamed', from, '→', to);
  }
}
fs.writeFileSync(p, s);
console.log('done');
