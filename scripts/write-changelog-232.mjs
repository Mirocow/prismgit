import * as fs from 'node:fs';

const L = (s) => s;

const en = L(`## [2.3.2] - 2026-09-29

### Fixed — 3-way merge editor (live-tested on a real conflict)
- **The panes' splitters were dead**: a 1px-wide divider with height 0 inside its sticky wrapper — invisible, ungrabbable (mousedown landed on the neighbouring pane). Now a REAL 6px divider with a visible center grip, ±5px hit area and accent hover; drag verified live (panes resize, headers follow)
- **Pane headers misaligned with the body columns** as soon as a pane was resized (headers were fixed thirds); they now mirror leftPct/rightPct exactly
- The center pane's editing and highlight layers re-verified live on a real conflict fixture (typing, highlight follow, no foreign stripe)

### Added — background fetch PAUSE
- The sidebar's refresh spinner is now a fetch control: click the RUNNING spinner to stop the background fetch cycle; a Play button resumes it. A StatusBar «Фетч» Pause/Play toggle does the same from anywhere
- While paused, every poll cycle is skipped (timer, window-focus resume, initial check); manual «Check now» still works

### Added — VS Code-style panel collapse
- The console now collapses via a chevron in ITS OWN panel header (was: status-bar toggle only, with an ✕); the StatusBar toggle got the matching PanelBottomClose/PanelBottomOpen icons. Left sidebar and the History details pane keep their header-corner chevrons

### Added — Back/Forward remembers tool STATE
- Each history entry carries a snapshot of the global selection (commit, file, branch, tag, path filter). Back/Forward restores it, so returning to History re-selects the commit you were reading; cross-tool jumps mark themselves so the outgoing entry is not polluted with the incoming tool's state

### Added — Search: jump to THE COMMIT that made the change
- Every content hit has a «Коммит» button: blame-lookup finds the commit that introduced the found line, then opens History with that commit selected AND the graph pre-filtered to the file. The Blame/History/Diff buttons are now ALWAYS visible (were hover-only — invisible to the user)

### Added — Settings: favorites are sortable
- Settings → «Сайдбар и навигация» gained an «Избранные инструменты» block: ↑/↓ reorders the sidebar's Favorites section (persisted), ✕ removes an entry; the favorites list moved from Sidebar-local state into a store so Settings and the sidebar share it

### Improved — theme editor zones & text contrast
- Every swatch has a «!» hint explaining WHERE its color lands; hovering a swatch highlights that zone in the live preview
- Text tokens are contrast-checked against the main background: a warning chip with the ratio + a one-click «Читаемо» fix below 4.5:1
- The confusing «Панель» zone renamed to «Панели и консоль» (RU); the preview's button label now uses the same auto-computed readable-on-accent color the compiled theme applies (was the main background color — invisible on light accents)

### Changed — settings rows spacing
- The sidebar-navigation tool rows (and their favorites block) use wider spacing per the «расстояние между строками инструментов» request

`);

const ru = L(`## [2.3.2] - 2026-09-29

### Исправлено — 3-way редактор слияния (протестировано на реальном конфликте)
- **Сплиттеры панелей были мертвы**: разделитель шириной 1px и высотой 0 внутри sticky-обёртки — невидим и не хватае́м (mousedown попадал в соседнюю панель). Теперь настоящий 6px-разделитель с видимым центральным грипом, зоной захвата ±5px и подсветкой; перетаскивание проверено вживую (панели меняют ширину, заголовки следуют)
- **Заголовки панелей расходились с колонками** при изменении ширины (были фиксированными третями); теперь точно повторяют leftPct/rightPct
- Редактирование и подсветка центральной панели перепроверены вживую на реальном конфликте (ввод, синхронная подсветка, лишняя «полоса» отсутствует)

### Добавлено — пауза фоновой выборки (fetch)
- Крутилка обновления в сайдбаре теперь управляет фетчем: клик по ВРАЩАЮЩЕЙСЯ крутилке останавливает фоновый цикл; кнопка Play возобновляет. Тумблер «Фетч» (Pause/Play) в статус-баре делает то же из любого места
- В режиме паузы пропускается каждый цикл (таймер, возобновление по фокусу окна, стартовая проверка); ручная «Проверить сейчас» работает

### Добавлено — сворачивание панелей в стиле VS Code
- Консоль сворачивается шевроном в заголовке САМОЙ панели (раньше — только тумблер в статус-баре с ✕); тумблер статус-бара получил иконки PanelBottomClose/PanelBottomOpen. Левый сайдбар и панель деталей коммита сохраняют шевроны в углах заголовков

### Добавлено — Назад/Вперёд помнит СОСТОЯНИЕ инструмента
- Каждая запись истории несёт снимок глобального выделения (коммит, файл, ветка, тег, фильтр по пути). Назад/Вперёд восстанавливает его: возврат в History снова выбирает коммит, который вы читали; переходы между инструментами помечают себя, чтобы снимок покидаемой записи не загрязнялся

### Добавлено — из Search к КОММИТУ, внёсшему изменение
- У каждой находки — кнопка «Коммит»: blame-поиск определяет коммит, внёсший найденную строку, и открывает History с выбранным коммитом И графом, отфильтрованным по файлу. Кнопки Blame/History/Diff теперь ВСЕГДА видны (были только при наведении)

### Добавлено — сортировка избранных в Settings
- Настройки → «Сайдбар и навигация» получили блок «Избранные инструменты»: ↑/↓ меняет порядок раздела «Избранные» сайдбара (с сохранением), ✕ убирает пункт; список избранного переехал из локального состояния Sidebar в store, которым делятся настройки и сайдбар

### Улучшено — зоны тем и контраст текста
- У каждого цвета — «!»-подсказка, ГДЕ он применяется; наведение на цвет подсвечивает его зону в живом предпросмотре
- Цвета текста проверяются на контраст с основным фоном: предупреждение с коэффициентом + кнопка «Читаемо» одним кликом при < 4.5:1
- Непонятная зона «Панель» переименована в «Панели и консоль»; текст кнопки в предпросмотре теперь использует тот же автовычисляемый readable-on-accent, что и собранная тема (раньше — цвет фона: на светлых акцентах был невидим)

### Изменено — расстояния между строками в настройках
- Строки инструментов навигации (и блок избранных) разнесены шире

`);

const zh = L(`## [2.3.2] - 2026-09-29

### 修复 — 3-way 合并编辑器（在真实冲突上实测）
- **面板分隔条失效**：1px 宽、高度为 0 的分隔条在 sticky 容器里 — 看不见也抓不住（鼠标按下落在相邻面板）。现在是真正的 6px 分隔条，带可见中缝、±5px 命中区与悬停高亮；拖拽实测可用（面板变宽，表头跟随）
- 调整面板宽度后**表头与列错位**（原为固定三等分）；现在精确镜像 leftPct/rightPct
- 中间面板的编辑与高亮层在真实冲突上复验（输入、高亮同步、无多余"条纹"）

### 新增 — 后台 fetch 暂停
- 侧边栏刷新旋钮现在是 fetch 控件：点击正在旋转的旋钮停止后台 fetch 循环；Play 按钮恢复。状态栏「拉取」Pause/Play 开关随处可用
- 暂停时跳过每个周期（定时器、窗口焦点恢复、初始检查）；手动“立即检查”仍可用

### 新增 — VS Code 风格面板折叠
- 控制台可通过自身面板标题栏中的折角折叠（原来只有状态栏开关和 ✕）；状态栏开关改用 PanelBottomClose/PanelBottomOpen 图标。左侧边栏与提交详情面板保留标题栏折角

### 新增 — 后退/前进记住工具状态
- 每条历史记录携带全局选择快照（提交、文件、分支、标签、路径过滤）。后退/前进会恢复它：回到 History 会重新选中你正在看的提交；跨工具跳转会自我标记，避免污染离开条目的快照

### 新增 — 从搜索直达引入更改的提交
- 每条命中都有「提交」按钮：blame 查找引入该行的提交，打开 History 并选中该提交、按文件预过滤图形。Blame/History/Diff 按钮始终可见（原来仅悬停显示）

### 新增 — 设置中可排序收藏
- 设置 → “侧边栏与导航”新增“收藏的工具”区块：↑/↓ 调整侧边栏收藏区顺序（持久化），✕ 移除条目；收藏列表从 Sidebar 局部状态迁入 store，与设置共享

### 改进 — 主题编辑器分区与文字对比度
- 每个色板带「!」提示说明颜色落在哪里；悬停时在预览中高亮对应分区
- 文字色与主背景对比度检查：低于 4.5:1 时显示比值警告 + 一键“可读”修复
- 混淆的“面板”分区更名为“面板与控制台”（中文同步）；预览按钮文字改用与编译主题一致的 readable-on-accent 颜色

### 变更 — 设置行距
- 导航工具行（及收藏区块）间距加宽

`);

const de = L(`## [2.3.2] - 2026-09-29

### Behoben — 3-Wege-Merge-Editor (an echtem Konflikt getestet)
- **Die Pane-Splitter waren tot**: ein 1px breiter Trenner mit Höhe 0 im Sticky-Wrapper — unsichtbar, nicht greifbar (Mousedown traf die Nachbarpane). Jetzt ein echter 6px-Trenner mit sichtbarem Mittelgriff, ±5px-Trefffläche und Akzent-Hover; Ziehen live verifiziert (Panes ändern die Breite, Header folgen)
- **Pane-Header liefen aus dem Ruder**, sobald eine Pane breiter gezogen wurde (feste Drittel); sie spiegeln jetzt exakt leftPct/rightPct
- Bearbeitung und Hervorhebungs-Layer der Mittelpane live auf einem echten Konflikt verifiziert (Tippen, Sync, kein fremder Streifen)

### Hinzugefügt — Hintergrund-Fetch PAUSE
- Der Aktualisierungs-Spinner der Seitenleiste ist jetzt eine Fetch-Steuerung: Klick auf den LAUFENDEN Spinner stoppt den Hintergrundzyklus; ein Play-Button setzt fort. Ein „Fetch“-Pause/Play-Schalter in der Statusleiste macht dasselbe von überall
- Während der Pause wird jeder Zyklus übersprungen (Timer, Fokus-Wiederaufnahme, Erstcheck); manuelles „Jetzt prüfen“ funktioniert weiterhin

### Hinzugefügt — VS Code-artiges Panel-Einklappen
- Die Konsole klappt jetzt über einen Chevron in IHREM eigenen Panel-Header zu (zuvor nur Statusleisten-Schalter mit ✕); der Statusleisten-Schalter erhielt PanelBottomClose/PanelBottomOpen-Icons. Linke Seitenleiste und Commit-Details-Pane behalten ihre Header-Chevrons

### Hinzugefügt — Zurück/Vorwärts merkt sich den WERKZEUGZUSTAND
- Jeder Verlaufseintrag trägt einen Snapshot der globalen Auswahl (Commit, Datei, Branch, Tag, Pfadfilter). Zurück/Vorwärms stellt ihn wieder her; Cross-Tool-Sprünge markieren sich, damit der Austrittseintrag nicht verschmutzt wird

### Hinzugefügt — aus der Suche zum Commit, der die Änderung einbrachte
- Jeder Treffer hat einen „Commit“-Button: Blame-Lookup findet den einführenden Commit und öffnet History mit ausgewähltem Commit UND nach Datei vorgefiltertem Graphen. Blame/History/Diff-Buttons sind jetzt IMMER sichtbar (zuvor nur bei Hover)

### Hinzugefügt — Favoriten sortierbar in den Einstellungen
- Einstellungen → „Seitenleiste & Navigation“ hat einen Favoriten-Block: ↑/↓ sortiert die Favoriten-Sektion der Seitenleiste (persistent), ✕ entfernt Einträge; die Favoritenliste zog aus dem Sidebar-Lokalzustand in einen Store

### Verbessert — Theme-Editor-Zonen & Textkontrast
- Jede Farbfläche hat einen «!»-Hinweis, WO die Farbe wirkt; Hover hebt die Zone in der Vorschau hervor
- Textfarben werden auf Kontrast geprüft: Warnung mit Verhältnis + Ein-Klick „Lesbar“ unter 4.5:1
- Die verwirrende Zone „Panel“ heißt jetzt „Panels und Konsole“ (RU); der Button-Text der Vorschau nutzt die gleiche Auto-Farbe wie das kompilierte Theme

### Geändert — Zeilenabstände in den Einstellungen
- Navigations-Werkzeugzeilen (und der Favoriten-Block) weiter auseinander

`);

const files = [
  ['docs/CHANGELOG.md', en],
  ['docs/CHANGELOG.ru.md', ru],
  ['docs/CHANGELOG.zh.md', zh],
  ['docs/CHANGELOG.de.md', de],
];
for (const [p, section] of files) {
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes('[2.3.2]')) {
    s = s.replace('## [2.3.1]', section + '\n## [2.3.1]');
    fs.writeFileSync(p, s);
    console.log(p + ' updated');
  } else {
    console.log(p + ' already has 2.3.2');
  }
}
let pkg = fs.readFileSync('package.json', 'utf8');
pkg = pkg.replace('"version": "2.3.1"', '"version": "2.3.2"');
fs.writeFileSync('package.json', pkg);
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
lock.version = '2.3.2';
lock.packages[''].version = '2.3.2';
fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2));
console.log('package.json → 2.3.2');
