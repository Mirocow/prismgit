/**
 * CHANGELOG [2.3.1] writer + version bump — run once.
 */
import * as fs from 'node:fs';

const L = (s) => s.replace(/\\"/g, '"');

const en = L(`## [2.3.1] - 2026-09-29

### Fixed — the «app lags on every tool» report (measured, then fixed)
- **All read-only git commands now execute in the dedicated git worker process** instead of the Electron main loop. The main process is the IPC broker for every renderer call — while it streamed git output, every tool's clicks and refreshes queued behind it. Measured on a 20k-commit/31-branch fixture: opening History blocked the main loop for 119ms on Linux (multiplied ×3-5 on macOS process spawns); after the router, no tool blocks it longer than 2.4ms. In-flight coalescing and the 1s meta TTL are unchanged; vitest keeps the in-process path, so all 2017 tests observe identical behaviour
- **Worker-origin git spawns are reported back to the Operations console** — the command log shows ALL git activity with durations regardless of which process ran it (39 of 47 commands on the fixture ran in the worker)
- \`git remote -v\` (the slowest command in the History-open burst, 384ms) is now 60s-cached — the remote set only changes through observed git writes
- **PR/Reviews GitLab projectId heal watchdog** backed off: a rejected token or unreachable GitLab used to retry the network every 1.5s for as long as the page was open (~40 requests/minute); failures now double the delay up to 30s, success resets it
- **Bisect page 3s polling** runs only while a bisect is actually in progress (was: every 3s whenever the tool was open)

### Added — Search results navigate to the commit that made the change
- Every content hit (git grep) row gained per-line actions: **Blame at that line** (scrolls to and flash-highlights the found line, shows who introduced it), **History of the file** (pre-filtered to it — «фильтровать сразу по файлу»), and **Diff**; the file-group header carries the full Changes/Diff/Blame/History set
- History-from-Search now filters the graph by the file (path-filter chip) and can pre-select the commit
- One-shot \`blameFocusLine\` in the selection store powers the focused blame jump (consumed once, cleared on repo switch)

### Added — AI assistant learned the Search and Blame tools
- New \`search_code\` tool (git grep — the Search tool's content engine) and \`blame_file\` tool (line-annotated blame grouped into commit blocks) — registered in the chat toolset with selection guidance («кто внёс эту строку?» → blame_file; «где используется X?» → search_code → read_file)

### Fixed — History filters vs. search interplay
- Activating a chip/author/date filter while a text search is active now **clears the search** — the filter operates over ALL commits instead of intersecting with the found subset («нет возможности отфильтровать за все коммиты»)
- Every filter input (History, Branches, Changes) gained a **✕ clear button** + Esc-to-clear — the search no longer feels stuck

### Changed — breathing room in dialogs and settings
- Dialog form groups and settings rows/list rows use wider spacing (space-y-4, taller list rows)

`);

const ru = L(`## [2.3.1] - 2026-09-29

### Исправлено — «приложение тупит на всех инструментах» (замерено, затем исправлено)
- **Все читающие git-команды выполняются в выделенном git-воркере** вместо главного процесса Electron. Главный процесс — брокер всего IPC рендерера: пока он качал вывод git, клики и обновления всех инструментов стояли в очереди. Замер на репозитории 20k коммитов / 31 ветка: открытие History блокировало main-loop на 119ms (на macOS спавны в 3-5 раз дороже); после роутера ни один инструмент не блокирует дольше 2.4ms. Коалесцирование in-flight и meta-TTL 1s не изменились; в vitest команды идут in-process — все 2017 тестов видят прежнее поведение
- **Спавны воркера репортятся в Консоль операций** — журнал команд показывает ВСЮ git-активность с длительностями независимо от процесса (39 из 47 команд на фикуре выполнились в воркере)
- \`git remote -v\` (самая медленная команда в burst открытия History, 384ms) теперь кешируется 60с — набор ремоутов меняется только через наблюдаемые записи git
- **GitLab projectId heal watchdog в PR/Ревью** получил бэкофф: отвергнутый токен или недоступный GitLab раньше дёргали сеть каждые 1.5с, пока открыта страница (~40 запросов/мин); теперь задержка удваивается до 30с, успех сбрасывает
- **3-секундный полл Bisect** работает только при активном bisect (раньше — каждые 3с, пока открыт инструмент)

### Добавлено — из Search к коммиту, внёсшему изменение
- Каждая строка находки (git grep) получила действия: **Blame на этой строке** (скролл + подсветка найденной строки, видно кто внёс), **История файла** (сразу отфильтрованная по нему — «фильтровать сразу по файлу»), **Diff**; заголовок группы файла — полный набор Changes/Diff/Blame/History
- Переход History-из-Search фильтрует граф по файлу (чип path-filter) и может сразу выбрать коммит
- Одноразовый \`blameFocusLine\` в selection store питает фокусированный переход (потребляется один раз, чистится при смене репозитория)

### Добавлено — ИИ-ассистент освоил инструменты Search и Blame
- Новые инструменты \`search_code\` (git grep — движок вкладки «Содержимое» Поиска) и \`blame_file\` (построчный blame, сгруппированный в блоки коммитов) — зарегистрированы в чате с подсказками выбора («кто внёс эту строку?» → blame_file; «где используется X?» → search_code → read_file)

### Исправлено — взаимодействие фильтров и поиска в History
- Активация чипа/автора/даты при активном текстовом поиске теперь **сбрасывает поиск** — фильтр работает по ВСЕМ коммитам, а не по пересечению с найденным
- У каждого фильтра (History, Branches, Changes) появился **✕ — сброс** + Esc — поиск больше не «застревает»

### Изменено — воздух в диалогах и настройках
- Группы полей диалогов и строки настроек/списков разнесены шире (space-y-4, выше строки списков)

`);

const zh = L(`## [2.3.1] - 2026-09-29

### 修复 — «所有工具都卡顿」（先测量，后修复）
- **所有只读 git 命令改为在专用 git worker 进程执行**，不再占用 Electron 主进程事件循环。主进程是渲染进程全部 IPC 的中介——它忙于搬运 git 输出时，所有工具的点击与刷新都在排队。在 20k 提交 / 31 分支的测试仓库上实测：打开 History 阻塞主循环 119ms（macOS 进程开销再乘 3-5）；路由改造后没有任何工具超过 2.4ms。in-flight 合并与 1s meta TTL 不变；vitest 仍走进程内路径——全部 2017 个测试行为不变
- **worker 的 git 子进程回报到操作控制台**——命令日志显示所有 git 活动及其耗时（测试中 47 条命令有 39 条在 worker 执行）
- \`git remote -v\`（History 打开风暴中最慢的命令，384ms）缓存 60 秒
- **PR/评审页 GitLab projectId 看门狗退避**：令牌被拒或 GitLab 不可达时不再每 1.5s 重试网络（每分钟约 40 次请求）；失败后延迟翻倍至 30s，成功即复位
- **Bisect 页 3 秒轮询**仅在进行中的 bisect 时运行

### 新增 — 从搜索结果直达引入更改的提交
- 每条内容命中（git grep）行新增：**定位到该行的 Blame**（滚动并高亮，显示谁引入）、**该文件的 History**（已按文件过滤）、**Diff**；文件组头部提供 Changes/Diff/Blame/History 全套
- 从搜索进入 History 时按文件过滤图（路径过滤 chip），并可预选提交
- selection store 的一次性 \`blameFocusLine\` 驱动聚焦跳转

### 新增 — AI 助手学会了 Search 与 Blame 工具
- 新工具 \`search_code\`（git grep——Search 工具内容引擎）与 \`blame_file\`（按提交分组的逐行 blame）已注册进聊天工具集，并附选择指南

### 修复 — History 过滤与搜索的交互
- 文本搜索激活时点击 chip/作者/日期过滤现在会**清空搜索**——过滤器作用于全部提交而非与搜索结果的交集
- 每个过滤输入框（History、Branches、Changes）都有 **✕ 清除按钮** + Esc 清除

### 变更 — 对话框与设置的行距
- 对话框表单组与设置/列表行使用更宽松的间距

`);

const de = L(`## [2.3.1] - 2026-09-29

### Behoben — der Bericht «App hängt in jedem Werkzeug» (gemessen, dann behoben)
- **Alle schreibgeschützten git-Befehle laufen jetzt im dedizierten git-worker-Prozess** statt im Electron-Main-Loop. Der Main-Prozess ist der IPC-Broker jedes Renderer-Aufrufs — während er git-Ausgaben pumpte, warteten Klicks und Refreshes aller Werkzeuge. Gemessen an einem 20k-Commit/31-Branch-Fixture: History-Öffnen blockierte den Main-Loop 119ms (auf macOS ×3-5 teurer); nach dem Router blockiert kein Werkzeug länger als 2.4ms. In-Flight-Coalescing und 1s-Meta-TTL unverändert; vitest läuft weiter in-process — alle 2017 Tests beobachten identisches Verhalten
- **Worker-seitige git-Spawns werden an die Operations-Konsole gemeldet** — das Befehlsprotokoll zeigt ALLE git-Aktivitäten mit Dauer (39 von 47 Befehlen liefen im Worker)
- \`git remote -v\` (langsamster Befehl im History-Öffnungs-Burst, 384ms) ist jetzt 60s gecacht
- **GitLab-projectId-Heal-Watchdog (PR/Reviews)** mit Backoff: abgelehnter Token oder unerreichbares GitLab wiederholte zuvor alle 1,5s (~40 Anfragen/Minute); Ausfälle verdoppeln die Verzögerung bis 30s
- **Bisect-3s-Polling** läuft nur während einer aktiven Bisect-Sitzung

### Hinzugefügt — von der Suche zum Commit, der die Änderung einbrachte
- Jede Trefferzeile (git grep) erhielt Aktionen: **Blame an dieser Zeile** (scrollt + blinkt, zeigt wer es einbrachte), **History der Datei** (bereits darauf gefiltert), **Diff**; der Dateigruppen-Kopf bietet Changes/Diff/Blame/History komplett
- Der History-Sprung aus der Suche filtert den Graphen nach der Datei (Pfad-Filter-Chip) und kann den Commit vorauswählen
- Einmaliges \`blameFocusLine\` im Selection-Store treibt den fokussierten Sprung

### Hinzugefügt — der KI-Assistent beherrscht Search und Blame
- Neue Tools \`search_code\` (git grep — die Inhalts-Engine des Search-Werkzeugs) und \`blame_file\` (zeilenannotierter Blame, gruppiert in Commit-Blöcke) mit Auswahlhinweisen

### Behoben — History-Filter vs. Suche
- Aktivierung eines Chip/Autor/Datum-Filters bei aktiver Textsuche **löscht jetzt die Suche** — der Filter wirkt auf ALLE Commits
- Jedes Filterfeld (History, Branches, Changes) hat einen **✕-Löschen-Button** + Esc

### Geändert — Luft in Dialogen und Einstellungen
- Dialog-Formulargruppen und Einstellungs-/Listenzeilen mit größerem Abstand

`);

const files = [
  ['docs/CHANGELOG.md', en],
  ['docs/CHANGELOG.ru.md', ru],
  ['docs/CHANGELOG.zh.md', zh],
  ['docs/CHANGELOG.de.md', de],
];
for (const [p, section] of files) {
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes('[2.3.1]')) {
    s = s.replace('## [2.3.0]', section + '\n## [2.3.0]');
    fs.writeFileSync(p, s);
    console.log(p + ' updated');
  } else {
    console.log(p + ' already has 2.3.1');
  }
}
let pkg = fs.readFileSync('package.json', 'utf8');
pkg = pkg.replace('"version": "2.3.0"', '"version": "2.3.1"');
fs.writeFileSync('package.json', pkg);
console.log('package.json → 2.3.1');
