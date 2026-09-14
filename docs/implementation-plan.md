# План внедрения функционала SmartGit в PrismGit

> **Источник требований:** 10 скриншотов SmartGit Preferences (`Commands`, `Log and Working Tree window`, `Log`, `Background Commands`, `Git Executable`, `Authentication`, `User Interface`, `Built-in Text Editors`, `Spell Checker`, `Low-level Properties`).
> **Аудируемая версия:** ветка `feature/smartgit-electron-v1`, коммит `cf3e06a` (PrismGit 2.1.0, Electron 32 + React 18 + TypeScript + simple-git 3.27 + zustand 5).
> **Дата аудита:** 2026-09-14. Методика: статический анализ кода (3 параллельных аудита: настройки/UI, git-операции, auth/редактор) с выборочной верификацией. Все ссылки `файл:строка` проверены.

---

## 1. Легенда

| Обозначение | Значение |
|---|---|
| ✅ ЕСТЬ | Функционал реализован полностью |
| 🟡 ЧАСТИЧНО | Реализовано частично: бэкенд есть без UI, настройка есть без потребителя, или покрытие неполное |
| ❌ НЕТ | Функционал отсутствует |
| ➖ N/A | Неприменимо к архитектуре PrismGit (есть более удачное решение) |

**Приоритеты** (по выбору заказчика приоритет — Git-операции):
- **P0** — git-операции (commit / push / stash / checkout / refresh)
- **P1** — инфраструктура настроек и UI
- **P2** — git executable, аутентификация, фоновые команды
- **P3** — редактор, spell checker, прочее

**Оценки трудоёмкости:** `XS` < 2 ч · `S` 2–8 ч · `M` 1–3 дн · `L` 3–10 дн · `XL` > 10 дн.

---

## 2. Сводная матрица аудита

### 2.1 Страница «Commands»

| Пункт SmartGit | Статус | Доказательство / комментарий |
|---|---|---|
| Show line length guides (50/72) | ❌ | Commit-message `<textarea>` без линеек — `ChangesPage.tsx:2439–2452` |
| Remove leading/trailing whitespace | ✅ | `commitMsg.trim()` — `ChangesPage.tsx:745`; всегда включено, без настройки |
| Comments in Message: as-is / ask / strip | ❌ | `commentChar` — 0 совпадений по коду |
| Allow modifying pushed commits (forced-push) | 🟡 | Настройки `forcePushPolicy`, `protectedBranches`, `allowModifyingPushedCommits` есть (`SettingsPage.tsx:923,1466–1499`); проверки `isForcePushAllowed` (`git.ts:6060`) и `isCommitPushed` (`git.ts:5817`) доступны по IPC (`ipc/git.ts:443,457`), но **не вызываются из рендера** и не встроены в push/amend |
| Push all tags | ✅ | `--tags` — `git.ts:1121`, чекбокс — `Toolbar.tsx:416,470` |
| Detect renames (added/removed) | ✅ | Свой алгоритм + `diff --find-renames` — `git.ts:960–1055, 5784–5811`; настройка `detectRenames` в UI есть, но не подключена |
| Renames for untracked/missing | ✅ | `detectWorkingTreeRenames()` — `git.ts:960–1055` |
| Warn for slow rename detection | ❌ | Порога и предупреждения нет |
| Refresh FS while in background | ✅ | chokidar в main-процессе — `watcher.ts:138–178`, работает при неактивном окне |
| Warn about submodule changes on checkout | ❌ | Submodules-страница есть, предупреждение при checkout — нет |

### 2.2 Страница «Log and Working Tree window»

| Пункт SmartGit | Статус | Доказательство / комментарий |
|---|---|---|
| If nothing is staged: Ask / all except untracked / all including | 🟡 | Только чекбокс «Commit All» → `git add -A` (`ChangesPage.tsx:2334–2341`, `git.ts:436–441`); режимов «Ask» и «except untracked» (`add -u`) нет |
| Suggest to add untracked files | ❌ | Pre-commit-предложений нет (Clean-диалог не связан с коммитом) |
| Suggest to remove missing files | ❌ | — |
| Preselect 'Staged' | ❌ | — |
| Auto setup tracking for new branches | ✅ | Авто `-u` при первом push — `git.ts:1088–1103`, `Toolbar.tsx:441` |
| Auto save stash on common commands | 🟡 | Настройка `autoStashOnCommonCommands` есть (`settings-api.ts:131`), сервисная `autoStash()` (`git.ts:5485–5508`) **не вызывается**; точечные автостэши есть в merge (`MergePanel.tsx:165–186`), checkout (`BranchesPage.tsx:212–225`), abort (`ChangesPage.tsx:1140`) |
| Stash: include untracked files | ✅ | `--include-untracked` — `git.ts:2751–2771`, UI `StashesPage.tsx:288–328` |
| Distinguish content vs EOL-only changes | 🟡 | `isEolOnlyChange()` + IPC (`git.ts:5609–5618`, `ipc/git.ts:419`) — **0 вызовов из рендера**; настройка `distinguishEolChanges` не подключена |

### 2.3 Страница «Log»

| Пункт SmartGit | Статус | Доказательство / комментарий |
|---|---|---|
| Allow all commands on stash/PR commits | 🟡 | Для stash-коммитов apply/pop/drop/branch/diff есть (`StashesPage.tsx`); ограничивающая настройка отсутствует (считать закрытым с оговоркой) |
| Hosting providers integration (PR, comments) | ✅ | GitHub PAT + PR (`ReviewsPage`, `PullRequestsPage`), GitLab MR, CI (`jenkins/teamcity/gitlab`), `bugtraq.ts`, `gerrit.ts`, `distributedReviews.ts` |
| Multiple Log windows for same repo/file | ❌ | Однооконное приложение; отдельного `BrowserWindow` журнала нет |

### 2.4 Страница «Background Commands»

| Пункт SmartGit | Статус | Доказательство / комментарий |
|---|---|---|
| Detect local changes in closed favorites | ✅ | `pollRemoteSummary()` по всем репозиториям списка — `repositoryStore.ts:276–292`; dirty через `status --porcelain` |
| Detect remote changes | ✅ | `useRemotePolling.ts` (базово 120 с, адаптивный boost 15 с после мутаций), индикация ↓N/↑N в `Sidebar.tsx:56–91` |
| Fetch: closed 'favorite' repositories | 🟡 | Полноценный fetch — только открытый репо + opted-in remotes (`backgroundFetch.ts:10–29`); для закрытых — только счётчики |
| Fetch: open repositories when idle | 🟡 | Фоновый fetch каждые 5 мин per-remote opt-in (`useBackgroundFetch.ts:16–49`); логики «when idle» нет |
| Periodically invoke GC when idle | ❌ | Только ручной `git gc` (`git.ts:5321–5328`, меню Query) |

### 2.5 Страница «Git Executable»

| Пункт SmartGit | Статус | Доказательство / комментарий |
|---|---|---|
| Bundled Git / Other Git Executable | ❌ | `binary: 'git'` захардкожен — `git.ts:190–203` |
| Git Version / LFS Version badges | ❌ | `git --version` нигде не вызывается; About показывает **хардкод 2.0.1** (`SettingsPage.tsx:1887`) vs `package.json` 2.1.0 — баг |
| Use app for authentication (ignore credential.helper) | 🟡 | Своя basic-auth через `-c http.extraHeader` (`git.ts:1196–1230`); но при клоне ставится git-овский `credential.helper=store` (`git.ts:5677–5689`) |
| Configure clones to use app as credential helper | 🟡 | Ставится `credential.helper=store`, собственного credential-helper-процесса нет |
| Use pre-installed system Git-Flow | ➖ N/A | Собственная реализация flow (`gitflow.ts`, feature/release/hotfix) — системный бинарник не нужен; не хватает `git flow init`-диалога и support-веток |

### 2.6 Страница «Authentication»

| Пункт SmartGit | Статус | Доказательство / комментарий |
|---|---|---|
| System SSH client / built-in SSH client | ❌ | SSH полностью отдан системному git (`git.ts:1221`), настройки нет |
| Known credentials table | ❌ | Учётки только per-repo/per-remote (`RemotesPage.tsx:40–44`); сводной страницы нет |
| Load All Stored Secrets | ❌ | — |
| (Косвенно) безопасное хранение секретов | ❌ | **Все секреты в plaintext JSON** (`remoteAuth`, `githubPAT`, `aiApiKey`, CI-токены — `settings-api.ts:281–289`); нет `safeStorage`/`keytar` — главный security-гэп |

### 2.7 Страница «User Interface»

| Пункт SmartGit | Статус | Доказательство / комментарий |
|---|---|---|
| Language | ✅ | en/ru/zh/de — `SettingsPage.tsx:277–295` + синхронизация нативного меню (`i18n-menu.ts`) |
| Theme: Auto light/dark | 🟡 | 22 темы + переключатель light/dark (`settingsStore.ts:254–270`); режима **Auto** (`prefers-color-scheme`) нет — 0 совпадений `matchMedia` |
| Welcome dialog setting | ❌ | `WelcomeScreen.tsx` есть, настройки-выключателя нет (ключа `showWelcome*` нет) |
| Double-Clicking Local File | ❌ | Хардкод: conflicted → resolve, иначе → diff (`ChangesPage.tsx:232–245`) |
| File Name Matches (case sensitivity) | ❌ | Всегда case-insensitive (`GlobalSearch.tsx:169,201`); smart-case не реализован |
| Date/Time Format patterns | 🟡 | Ключ `dateFormat` (`relative/absolute/both`) объявлен (`settings-api.ts:77–81`), UI есть, **не потребляется** ни одним компонентом; формата времени и паттернов нет |
| Verbose dates (Yesterday) | ❌ | «Yesterday» захардкожен (`formatDate.ts:65`), настройки порога нет |
| Restore all confirmation dialogs | ❌ | Реестра подтверждений «don't ask again» нет вовсе |

### 2.8 Страница «Built-in Text Editors»

| Пункт SmartGit | Статус | Доказательство / комментарий |
|---|---|---|
| Font Family / Size / fixed-width only | 🟡 | Размеры `fontSize*` (5 шт.) есть; font family и фильтра фиксированных шрифтов нет |
| Foreground/Background colors | ❌ | Только готовые темы (22 шт., `themes.ts`) + contrast-слайдер; color-picker'ов нет |
| Syntax colors per token | ❌ | Подсветка — самописный regex-токенизатор на 13 языков (`syntaxHighlight.ts`), цвета не настраиваются |
| Highlight current line | ❌ | Нет редактора с кареткой; в diff — только мультивыбор строк для staging |
| Behavior / Languages / Preview | 🟡 | MD-превью коммита есть (`CommitMarkdownPreview`); настроек Behavior/Languages нет |
| Редактор с подсветкой при вводе | ❌ | Голая `<textarea>`; CodeMirror/Monaco/Shiki в зависимостях отсутствуют |

### 2.9 Страница «Spell Checker»

| Пункт SmartGit | Статус | Доказательство / комментарий |
|---|---|---|
| Словари, Add/Edit/Remove, подчёркивание ошибок | ❌ | `spell/dictionary/hunspell/nspell` — 0 совпадений; textarea коммита без `spellCheck` |

### 2.10 Страница «Low-level Properties»

| Пункт SmartGit | Статус | Доказательство / комментарий |
|---|---|---|
| Таблица key/value + фильтр + редактирование | ❌ | Только textarea `key=value` (`SettingsPage.tsx:1029–1065`), **не парсится и ни на что не влияет** |
| Пометка изменённых + «нужен рестарт» | 🟡 | Подпись «requires restart» есть; маркировки и фильтра изменённых нет |
| (Git-часть) таблица git config | ✅ | Секция «Git Config» с фильтром и скоупами local/global/system (`SettingsPage.tsx:789–913`) — покрывает git-конфиг, но не properties приложения |

### 2.11 Итоговая статистика

| Статус | Кол-во пунктов | Доля |
|---|---|---|
| ✅ ЕСТЬ | 14 | 26% |
| 🟡 ЧАСТИЧНО | 13 | 25% |
| ❌ НЕТ | 25 | 47% |
| ➖ N/A | 1 | 2% |

**Ключевой вывод аудита:** большая часть «частично» — это **мёртвые настройки и бэкенд без UI**: код уже написан (`isForcePushAllowed`, `isCommitPushed`, `autoStash()`, `isEolOnlyChange`), но не подключён к интерфейсу. Фаза 0 плана оживляет их с минимальными затратами.

---

## 3. Архитектурные конвенции для внедрения

Все новые задачи следуют одному и тому же пути изменения файлов. **Чек-лист добавления новой настройки:**

1. **Тип** — `electron/types/settings-api.ts`: ключ в интерфейс `AppSettings` (+ значение по умолчанию в `storage.ts`).
2. **Бэкенд** (если нужен) — `electron/services/git.ts` + обработчик `ipcMain.handle` в `electron/ipc/git.ts` + прокси в `electron/preload.ts` + тип в `electron/types/git-api.ts`.
3. **Рендер** — чтение через `useSettingsStore(s => s.settings.key)`, запись через `setSetting('key', value)`.
4. **UI** — секция в `src/pages/SettingsPage.tsx` (Commands-секция для git-настроек, Appearance для UI-настроек).
5. **i18n** — строки `settings.*` во **всех 4 локалях**: `src/i18n/locales/{en,ru,zh,de}.ts`.
6. **Тесты** — unit в `tests/unit/`, компонентные в `tests/components/`, e2e в `tests/e2e/07-settings-workflow.spec.ts`.

**Как вызывается git:** рендер (`src/lib/api.ts`) → preload (contextBridge, `ipcRenderer.invoke`) → `electron/ipc/git.ts` (~170 обработчиков в обёртке `wrap()`) → `electron/services/git.ts` (6355 строк, simple-git + spawnGitCapture для сетевых команд). Фоновые события — `watcher:changed` из main в рендер.

---

## 4. Детальное ТЗ

### ФАЗА 0 — «Оживление мёртвых настроек» + найденные баги (P0)

> Самая дешёвая фаза: код проверок и сервисов уже написан и протестирован, нужно связать его с UI. Рекомендуется выполнить первой.

#### 0.1. Подключить политику force-push и предупреждение о запушенных коммитах
- **Статус:** 🟡. **Оценка: S (4–6 ч).**
- **Сейчас:** `isForcePushAllowed` (`git.ts:6060`) и `isCommitPushed` (`git.ts:5817`) выставлены по IPC (`ipc/git.ts:443,457`, `preload.ts:292,303`), но: `push()` (`git.ts:1080+`) политику не проверяет; в рендере 0 вызовов; настройка `allowModifyingPushedCommits` (`SettingsPage.tsx:923`) сохраняется, но не enforced.
- **Сделать:**
  1. Серверная часть: в `push()` при `force === true` вызвать `isForcePushAllowed(branch, policy, protectedBranches)` (настройки передавать из IPC-слоя); при отказе — возврат ошибки `error:force-push-denied: <reason>`.
  2. UI: в `PushToDialog` (`BranchDialogs.tsx:378–383`) при запрещённом force — блокировать чекбокс с тултипом причины; в `Toolbar.tsx` — дизейбл force при deny-политике на protected-ветке.
  3. Предупреждение о модификации запушенных коммитов: перед amend / interactive rebase / drop (`HistoryPage`, `InteractiveRebaseDialog.tsx`, `commitMenu.ts`) вызывать `api.git.isCommitPushed(repoPath, hash)`; если pushed и `allowModifyingPushedCommits === false` → `ConfirmDialog` «Коммит уже отправлен на сервер…».
- **Acceptance:** force-push в protected-ветку (`main/master/develop/release/*`) отклоняется с понятной ошибкой; amend запушенного коммита спрашивает подтверждение; сценарий покрыт e2e.

#### 0.2. Подключить авто-стэш по общей настройке
- **Статус:** 🟡. **Оценка: S (4–6 ч).**
- **Сейчас:** `autoStashOnCommonCommands` + `includeUntrackedInStash` в UI (`SettingsPage.tsx:962`), сервисная `autoStash()` (`git.ts:5485–5508`) — мёртвая; точечные автостэши есть только в merge/checkout/abort.
- **Сделать:** встроить автостэш в `pull()` и `checkout()` на уровне сервиса: при ошибке `local changes would be overwritten` и включённой настройке — `stash push [--include-untracked]` → операция → `stash pop` в `finally`; в результат добавить `{ autoStashed: boolean; popFailed: boolean }` и показать существующие тосты `changes.autoStashing/Restored/PopFailed`.
- **Acceptance:** с включённой настройкой `pull`/`checkout` при грязном дереве завершается успешно, изменения возвращаются; при `popFailed` — тост об ошибке и stash сохранён.

#### 0.3. Подключить различение EOL-only изменений
- **Статус:** 🟡. **Оценка: S (4–6 ч).**
- **Сейчас:** `isEolOnlyChange()` (`git.ts:5609–5618`) + IPC (`ipc/git.ts:419`) — не вызываются; настройка `distinguishEolChanges` не подключена.
- **Сделать:** в `ChangesPage` после загрузки статуса, если настройка включена: батч-проверка изменённых файлов (лимит 50–100, параллельно 4) → файлам с EOL-only добавить бейдж `EOL` в списке (`LazyFileList`/`CommitFileTree`) + фильтр «скрыть EOL-only»; в `DiffViewer` — индикатор «Only line endings changed».
- **Acceptance:** файл с изменёнными только CRLF помечается бейджем; выключение настройки убирает проверки.

#### 0.4. Подключить настройку detectRenames
- **Статус:** 🟡. **Оценка: XS (1–2 ч).**
- **Сделать:** гейт вызова `detectWorkingTreeRenames()` в `ChangesPage.tsx:1263–1332` по `settings.detectRenames`; при `false` added/removed показываются как есть. Порог similarity (`--find-renames=<n>%`) вынести в low-level property (см. 4.1).

#### 0.5. Баг: версия приложения в About
- **Статус:** баг. **Оценка: XS (1 ч).**
- **Сейчас:** `SettingsPage.tsx:1887` — хардкод `2.0.1`, тогда как `package.json` → `2.1.0`.
- **Сделать:** IPC `app:versions` → `{ app: app.getVersion(), electron: process.versions.electron }` из main; в той же задаче 5.1 расширить `{ git, lfs }`.

#### 0.6. Баг: aiChatStore читает несуществующий ключ localStorage
- **Статус:** баг. **Оценка: XS (1 ч).**
- **Сейчас:** `aiChatStore.ts:148` читает `localStorage['prismgit-settings']` — ключа не существует (настройки живут в IPC-сторе), лимит истории всегда дефолтный.
- **Сделать:** читать `useSettingsStore.getState().settings.aiChatHistoryLimit`.

#### 0.7. Подключить dateFormat к спискам истории
- **Статус:** 🟡. **Оценка: S (3–5 ч).**
- **Сейчас:** ключ `dateFormat: 'relative'|'absolute'|'both'` объявлен (`settings-api.ts:77–81`), UI есть (`SettingsPage.tsx:1784–1808`) — не потребляется.
- **Сделать:** хук `useDateFormat()` в `src/lib` + параметр mode в `formatDate.ts:49–109`; подключить `HistoryPage`, `ReflogPage`, `JournalPage`, `StashesPage`, `BranchesPage`.

**Итого фаза 0: ~2–3.5 дня.**

---

### ФАЗА 1 — Git-операции: Commit (P0, приоритет заказчика)

#### 1.1. Обработка комментариев в commit message (core.commentChar)
- **Статус:** ❌. **Оценка: M (1–2 дня).**
- **Поведение SmartGit:** «Use message as-is» / «Ask if potential comments are detected» / «Strip comments (lines starting with core.commentChar)».
- **Сделать:**
  1. Настройка `commitCommentsMode: 'as-is' | 'ask' | 'strip'` (default `ask`, как на скриншоте) → `AppSettings`, Commands-секция `SettingsPage` (рядом с trim-настройкой).
  2. Чтение `core.commentChar` из git config (кэш в `gitStore`, дефолт `#`).
  3. Перед коммитом (`ChangesPage.handleCommit`, ~`:725–768`): детект строк, начинающихся с commentChar после `trimStart()`; режимы: `strip` — удалить строки; `ask` — `ConfirmDialog` «Сообщение содержит N строк с '#'. Удалить их?» [Strip / Keep as-is / Cancel]; `as-is` — ничего.
  4. Чистая функция `stripCommitComments(msg, commentChar)` в `src/lib/commitMessage.ts` + unit-тесты (включая `commentChar: ';'`, пустые строки, строки-разделители).
- **Acceptance:** три режима работают; i18n ×4; unit + компонентный тест диалога.

#### 1.2. Поведение «If nothing is staged»
- **Статус:** 🟡 (есть только «всё включая untracked»). **Оценка: S–M (1 день).**
- **Сделать:**
  1. Настройка `commitNothingStaged: 'ask' | 'all-except-untracked' | 'all-including-untracked'` (default `ask`).
  2. В `handleCommit`: если staged пуст и есть unstaged/untracked → по настройке: `ask` → диалог с 3 кнопками; `all-except-untracked` → новый метод `stageAllTracked()` (→ `git add -u`, добавить в `git.ts:436–441` рядом с `stageAll`); `all-including-untracked` → существующий `stageAll()`.
  3. Кнопка Commit активна, если есть любые изменения (сейчас дизейбл при пустом staged — `ChangesPage.tsx:2408`).
- **Acceptance:** три сценария; e2e: коммит «всё кроме untracked» не добавляет новый файл.

#### 1.3. Предложения Commit Dialog: add untracked / remove missing
- **Статус:** ❌. **Оценка: S–M (1 день).**
- **Сделать:**
  1. Настройки `commitSuggestAddUntracked: boolean` (default false) и `commitSuggestRemoveMissing: boolean` (default true) — как на скриншоте.
  2. Не блокирующий inline-banner в панели коммита (`ChangesPage`): «N untracked files — Add all?» / «N missing files — Stage deletions?» с кнопкой-действием и dismiss на сессию (state, не persist).
  3. Действия: `stageAll()` / выборочный `git rm` для missing (метод `stageMissingFiles()` в `git.ts`).
- **Acceptance:** баннеры по настройкам; кнопки выполняют staging; i18n ×4.

#### 1.4. Line length guides в редакторе коммита (50/72)
- **Статус:** ❌. **Оценка: S (3–4 ч).**
- **Сделать:** настройка `commitLineGuides: 'none' | '50' | '72' | '50+72'` (default `none`, как на скриншоте выключено). В `ChangesPage.tsx:2439–2452` поверх textarea — декоративный overlay-слой (`pointer-events: none`) с вертикальными линиями на позициях N·ch при monospace-шрифте (font-mono класс на textarea обязателен); пересчёт при resize (ResizeObserver).
- **Acceptance:** линии совпадают с колонками текста; настройка в Commands-секции.

**Итого фаза 1: ~4–6 дней.**

---

### ФАЗА 2 — Git-операции: Checkout, renames, stash (P0–P1)

#### 2.1. Предупреждение об изменении .gitmodules при checkout
- **Статус:** ❌. **Оценка: S (4–6 ч).**
- **Сделать:**
  1. Настройка `warnSubmoduleChangesOnCheckout: boolean` (default true, как на скриншоте).
  2. Метод `hasSubmoduleConfigChanges(repoPath, target)` в `git.ts`: `git diff HEAD..<target> -- .gitmodules` (для удалённых веток — через `origin/<name>`), непустой вывод → true.
  3. В checkout-flow (`BranchesPage.tsx:1110,1352,1502`): перед checkout показать `ConfirmDialog` «Submodule configuration will change…» с чекбоксом «Don't ask again» (связать с реестром подтверждений 4.5).
- **Acceptance:** переключение между ветками с разным `.gitmodules` предупреждает; с одинаковым — молчит.

#### 2.2. Предупреждение о медленном определении renames
- **Статус:** ❌. **Оценка: S (2–4 ч).**
- **Сделать:** в `detectWorkingTreeRenames` (`git.ts:960–1055`) замерять elapsed; порог — low-level key `renames.warnMs` (default 3000); настройка `warnSlowRenameDetection: boolean` (default true). При превышении — одноразовый тост «Rename detection took Xs — consider disabling Detect renames» (throttle 1/сессию).
- **Acceptance:** на большом репо с тысячами untracked появляется тост; отключается настройкой.

#### 2.3. Stash: показать keep-index в UI (мелочь, опционально)
- **Статус:** 🟡 (бэкенд есть). **Оценка: XS (1 ч).**
- **Сделать:** чекбокс «Keep index» в StashesPage/контекст-меню stash → параметр `keepIndex` (`git.ts:2751–2771` — сейчас всегда false из UI).

**Итого фаза 2: ~2–3 дня.**

---

### ФАЗА 3 — Background Commands (P2)

#### 3.1. Периодический garbage collection при простое
- **Статус:** ❌ (ручной GC есть). **Оценка: M (1–2 дня).**
- **Сделать:**
  1. Настройки: `gcWhenIdle: boolean` (default false, как на скриншоте), low-level `gc.idleDays` (default 7), `gc.idleMinutes` (default 15).
  2. Новый сервис `electron/services/gcScheduler.ts` в main: таймер каждые 5 мин; условия запуска — окно не в фокусе/нет сетевой активности, commandLog пуст (нет активных git-операций), с момента `lastGcAt` репозитория прошло > `gc.idleDays`.
  3. `lastGcAt` — в `repoMetadata` (persist уже есть); запись операции в CommandLogPanel как системная; после gc — обновление recyclable-счётчиков.
- **Acceptance:** gc не запускается во время активной работы; повторный запуск ранее N дней исключён; операция видна в Output.

#### 3.2. Fetch закрытых favorites и fetch при простое
- **Статус:** 🟡. **Оценка: M (1–2 дня).**
- **Сейчас:** `useRemotePolling` опрашивает все репо (счётчики), полноценный fetch — только открытый репо + opted-in remotes каждые 5 мин.
- **Сделать:**
  1. Глобальные флаги в настройках: `backgroundFetchClosedFavorites: boolean` (default false), `backgroundFetchOpenWhenIdle: boolean` (default false) — повторяют семантику скриншота.
  2. В `useBackgroundFetch`/`useRemotePolling`: для closed-favorites при включённом флаге выполнять `fetch --prune` их opted-in remotes по расписанию `repoRemoteCheckIntervalSec`; только для remotes без интерактивного prompt (`GIT_TERMINAL_PROMPT=0` уже ставится — `git.ts:1955–2040`).
- **Acceptance:** закрытые favorites обновляют remote-tracking refs в фоне; без сохранённых учёток ошибки тихо логируются (сейчас так и есть).

**Итого фаза 3: ~3–4 дня.**

### ФАЗА 4 — Настройки UI (P1)

#### 4.1. Low-level Properties: таблица key/value с фильтром
- **Статус:** ❌ (сейчас — нерабочая textarea). **Оценка: M (2–3 дня).**
- **Сделать:**
  1. Модель: `src/lib/lowLevelProps.ts` — реестр известных ключей: `{ key, type: 'boolean'|'number'|'string', default, restart?: boolean, description }`. Первые ключи реестра (закрывают потребности фаз 0–3): `renames.warnMs`, `renames.similarityThreshold`, `gc.idleDays`, `gc.idleMinutes`, `backgroundFetch.intervalMin`, `ai.*` (лимиты), `avatar.size`, `annotate.maxTooltipWidth`.
  2. Хранение: `settings.lowLevelProperties: Record<string, unknown>` + миграция старой textarea (parse `key=value` построчно) в `loadSettings()`.
  3. UI: замена textarea на таблицу по образцу секции «Git Config» (`SettingsPage.tsx:789–913`): фильтр-поиск, inline-редактирование, кнопка «Reset to defaults», пометка изменённых (•) и `*` для restart-required, ссылка-фильтр «Changed properties».
  4. Потребление: `getLowLevelProp(key)` хелпер в рендере; для restart-ключей — тост «Restart required».
- **Acceptance:** фильтр работает; изменение `renames.similarityThreshold` реально влияет на `--find-renames`; старые значения textarea мигрируют.

#### 4.2. Тема Auto (light/dark по системе)
- **Статус:** 🟡. **Оценка: S (3–4 ч).**
- **Сделать:** настройка `themeMode: 'light' | 'dark' | 'auto'` (default `auto`, как на скриншоте «Automatically select light/dark»); в `settingsStore` при `auto` — `matchMedia('(prefers-color-scheme: dark)')` + listener → выбор парной темы через существующую логику `toggleTheme` (`settingsStore.ts:254–270`); в `theme-init.ts` — fallback по media query до загрузки стора (anti-FOUC). Селект в Appearance: Auto/Light/Dark.

#### 4.3. Поведение двойного клика по локальному файлу
- **Статус:** ❌. **Оценка: XS–S (2–3 ч).**
- **Сделать:** настройка `doubleClickLocalFile: 'diff' | 'stage'` (default `diff`, как на скриншоте); в `handleFileDoubleClick` (`ChangesPage.tsx:232–245`): при `stage` — toggle stage/unstage файла (conflicted → resolve всегда, как сейчас).

#### 4.4. Настройка welcome-диалога
- **Статус:** ❌. **Оценка: XS (1–2 ч).**
- **Сделать:** настройка `showWelcomeIfNoneReopened: boolean` (default false — как на скриншоте выключено); в `App.tsx:1419` при отсутствии репо: если настройка выключена — показывать упрощённый empty-state с кнопкой «Open Repository» вместо автопоказа `WelcomeScreen`.

#### 4.5. Restore all confirmation dialogs (реестр подтверждений)
- **Статус:** ❌. **Оценка: M (2–3 дня).**
- **Сделать:**
  1. Модуль `src/lib/confirmations.ts`: реестр id подтверждений (`stash.drop`, `changes.discard`, `push.force`, `clean.run`, `branch.delete`, `reset.hard`, `checkout.submoduleChange` из 2.1, `commit.pushedModify` из 0.1…) + `confirmWithRemember(id, opts)` — обёртка над `ConfirmDialog` с чекбоксом «Don't ask again».
  2. Persist: `settings.confirmations: Record<id, 'ask' | 'always' | 'never'>`.
  3. Миграция ключевых вызовов `confirmDialog(...)` на новую обёртку.
  4. Кнопка «Restore all confirmation dialogs» в Appearance → сброс `settings.confirmations = {}` + тост.
- **Acceptance:** «не спрашивать» персистится; кнопка сброса возвращает все вопросы; тест на 2–3 диалога.

#### 4.6. Форматы даты/времени + verbose-даты
- **Статус:** 🟡 (см. 0.7). **Оценка: S–M (1–1.5 дня).**
- **Сделать:** настройки `dateFormatPattern: string` (пресеты `MM/dd/yyyy`, `dd.MM.yyyy`, `yyyy-MM-dd` + произвольная строка токенов), `timeFormatPattern: string` (`HH:mm`, `hh:mm a`, `HH:mm:ss`), `verboseRecentDates: boolean` (default true, как на скриншоте); мини-токенизатор в `formatDate.ts` (`yyyy/MM/dd/HH/mm/ss/a`) + live-примеры «Example:» под полями (как в SmartGit); verbose: при возрасте ≤ 7 дней — «Today/Yesterday/N days ago» по локали; порог — low-level `dates.verboseDays`.

#### 4.7. File Name Matches (чувствительность к регистру)
- **Статус:** ❌. **Оценка: S (0.5–1 день).**
- **Сделать:** настройка `fileNameMatch: 'exact' | 'ignore-case' | 'smart-upper'` (default `ignore-case`, как на скриншоте); параметризовать сравнение в `GlobalSearch.tsx:169,201`, `searchUtils.ts:39`, `FilterInput`; `smart-upper` — сопоставление с учётом «каждое слово с заглавной» (нормализация lowercase + initials-совпадение `FoB` → `FooBar`).

#### 4.8. Настройка accelerators (горячих клавиш) — опционально
- **Статус:** ❌ (палитра и overlay есть, редактирования нет). **Оценка: L (3–5 дней), можно отложить.**
- **Сделать:** ключи `accelerators.*` в `AppSettings` (по реестру команд CommandPalette); UI-секция Keymap: список команд + запись хоткея (capture keydown) + конфликт-детект; применение: нативное меню перестраивается через `menu.ts` (динамические accelerators), рендер-хоткеи — через централизованный реестр `App.tsx:1079–1091`.

**Итого фаза 4: ~8–12 дней (без 4.8 — 5–8 дней).**

---

### ФАЗА 5 — Git Executable и аутентификация (P2)

#### 5.1. Выбор git executable + отображение версий
- **Статус:** ❌. **Оценка: M (2–3 дня).**
- **Сделать:**
  1. Настройки `gitExecutable: 'system' | 'custom'` (default `system`; «bundled» появится после включения git в `extraResources` electron-builder — отдельная сборочная задача), `gitCustomPath: string`.
  2. `electron/services/git.ts`: `resolveGitBinary()` (кэш, invalidation по `settings:set`); заменить захардкоженный `binary: 'git'` (`git.ts:190–203`) и ad-hoc вызовы (`:286,459,1984,5671`, `execFileSync` `:4055`) на резолвер.
  3. IPC `git:getVersions` → `{ git, lfs }` через `<bin> --version` / `<bin> lfs version`; проверка существования файла.
  4. UI: новая секция в Settings → Application: радио System/Custom + path-picker (electron dialog), бейджи версий с зелёной/красной отметкой (как на скриншоте); расширить About (0.5) этими данными.
- **Acceptance:** при указании несуществующего пути — красный бейдж и понятная ошибка операций; при system — версии отображаются.

#### 5.2. Known credentials + шифрование секретов (safeStorage)
- **Статус:** ❌ (сейчас plaintext). **Оценка: L (5–8 дней). Самая важная security-задача.**
- **Сейчас:** `remoteAuth`, `githubPAT`, `aiApiKey`, `jenkins/teamcity/gitlab` токены — plaintext в `prismgit-settings.json`; при клоне ставится git-овский `credential.helper=store` (тоже plaintext, `~/.git-credentials`).
- **Сделать:**
  1. `electron/services/secrets.ts`: обёртка над Electron `safeStorage` (encrypt/decrypt, `isEncryptionAvailable()`); файл `prismgit-secrets.bin` (зашифрованные blob'и, ключ `remoteAuth:<repoPath>:<remote>` / `githubPAT` / `aiApiKey` / `ci:<provider>`); fallback — plaintext с warning-логом (Linux без keyring).
  2. Миграция: при первом запуске перенести все секреты из settings.json в secrets.bin и вычистить из JSON.
  3. IPC `secrets:get(masked) / set / delete / list`; **полные значения не покидают main-процесс** — `buildHttpAuthArgs` (`git.ts:1196–1230`) уже выполняется в main, что идеально ложится на схему.
  4. UI: новая вкладка «Security» в SettingsPage: таблица known credentials (Type / Scope / User / Masked secret / Actions), кнопка **«Load All Stored Secrets…»** с reveal per-row (глазок), как на скриншоте; удаление `credential.helper=store` из clone-flow (или опция).
  5. Перевести `RemotesPage` edit-URLs диалог и `remoteAuth.ts` на secrets API.
- **Acceptance:** в settings.json нет ни одного секрета; таблица показывает все сохранённые учётки; push/pull работают без повторного ввода; тест миграции.

#### 5.3. Настройки SSH
- **Статус:** ❌. **Оценка: M–L (3–5 дней).**
- **Сделать (прагматичный вариант — без встроенного SSH-клиента):**
  1. Настройки `sshClient: 'system' | 'custom'`, `sshCommand: string` (→ env `GIT_SSH_COMMAND`), `sshKeyPath`, `sshKeyPassphrase` (в secrets.bin).
  2. В сетевых операциях (`spawnGitCapture` push/fetch/ls-remote) при custom — прокинуть env; при system — как сейчас.
  3. UI в Security-вкладке: радио (с пояснениями как на скриншоте), проверка доступности (`ssh -V`, `ssh-add -l` — spawn), статус-agent.
  4. Полноценный встроенный SSH-клиент (own transport, как SmartGit SSH) — **вне плана v1** (XL): system + custom command покрывает 90% сценариев.

#### 5.4. Git-Flow: init-диалог и support-ветки (опционально)
- **Статус:** ➖ (собственная реализация полнее системного бинарника). **Оценка: S (0.5–1 день).**
- **Сделать:** диалог «Initialize Git-Flow» (запись `gitflow.branch.*` / `gitflow.prefix.*` в repo config — формат уже читается `detectGitFlowConfig`, `gitflow.ts:29–44`); поддержка ветки `support` в `listFlowBranches`.

**Итого фаза 5: ~10–16 дней (без 5.4).**

---

### ФАЗА 6 — Редактор и Spell Checker (P3)

#### 6.1. Настройки шрифта (family + fixed-width фильтр)
- **Статус:** 🟡 (размеры есть). **Оценка: S (0.5–1 день).**
- **Сделать:** настройки `fontFamilyMonospace: string` (default стек `ui-monospace, Menlo, Consolas, monospace`), `fontFamilyUi: string`; применение — CSS-переменные `--font-mono`/`--font-ui` в `settingsStore` apply-цепочке; UI: селект из пресетов + «Show only fixed-width fonts» (фильтр пресетов; динамический перечень системных шрифтов через `queryLocalFonts` недоступен без разрешения — фиксированный список: Monaco, Menlo, Consolas, SF Mono, JetBrains Mono, Fira Code, DejaVu Sans Mono, Courier New).

#### 6.2. Пользовательские цвета (syntax + per-line)
- **Статус:** ❌ (сейчас 22 темы + contrast). **Оценка: M–L (3–5 дней).**
- **Сделать:**
  1. Настройки `customLineColors?: Record<'added'|'removed'|'modified'|'conflict', string>` (этап 1 — важнее для diff) и `customSyntaxColors?: Record<'comment'|'keyword'|'string'|'identifier'|'literal'|'punctuation'|'invalid'|'type'|'annotation', string>` (этап 2).
  2. Применение: `style.setProperty('--diff-added', …)` поверх темы в apply-цепочке; токенизатор (`syntaxHighlight.ts`) уже использует CSS-классы `tok-*` — переметрить классы на переменные.
  3. UI: подсекция «Editor Colors» на вкладке Themes: color-picker'ы (`input type=color`) с превью (мини-snippet из DiffViewer) и reset per-color — по образцу скриншота 12-55_2 (группы Foreground/Background/Syntax).

#### 6.3. Spell checker (commit message)
- **Статус:** ❌. **Оценка: M (1–2 дня).**
- **Сделать (на встроенных механизмах Electron, без новых зависимостей):**
  1. `webPreferences.spellCheck: true` в main-окне; `session.setSpellCheckerLanguages(['en-US', ...])` + `session.setSpellCheckerEnabled`.
  2. Настройки: `spellCheckerEnabled: boolean` (default true), `spellCheckerLanguage: string` (список доступных словарей Electron), user-dictionary (`session.addWords`) с UI-очисткой.
  3. Включить `spellCheck` на textarea коммита (`ChangesPage.tsx:2439`); контекст-меню с вариантами замены — Electron отдаёт через событие `context-menu` (`webContents`), добавить пункты в существующее контекст-меню.
  4. UI-страница «Spell Checker» (по образцу скриншота): список языков + Add/Remove.
  - Альтернатива (если нужна полная офлайн-независимость от Electron-словарей): пакет `nspell` + hunspell-словари в resources — +0.5 дня.

#### 6.4. Highlight current line / полноценный редактор
- **Статус:** ❌. **Оценка: XL (вне плана v1).**
- Прагматика: с `<textarea>` подсветка строки под кареткой невозможна. Внедрение CodeMirror 6 в commit-message и Index Editor даёт: подсветку при вводе, current line, guides,spellcheck-интеграцию — оформить отдельной эпикой, когда фазы 0–5 закрыты. В матрице помечено как осознанный де-скоп.

**Итого фаза 6: ~5–8 дней.**

---

## 5. Сводный roadmap

| Фаза | Содержание | Приоритет | Оценка | Зависимости |
|---|---|---|---|---|
| **0** ✅ | Оживление мёртвых настроек + 2 бага (0.1–0.7) | **P0** | **2–3.5 дн** | нет |
| **1** ✅ | Commit: commentChar, nothing-staged, suggestions, guides (1.1–1.4) | **P0** | **4–6 дн** | нет |
| **2** ✅ | Checkout .gitmodules warning, slow renames, keep-index (2.1–2.3) | P0–P1 | 2–3 дн | 4.5 (для «don't ask») |
| **4.5** ✅ | Реестр подтверждений + Restore all (+ модель low-level ключей для 4.1) | P1 | 2–3 дн | — |
| **4** ⏳ | UI-настройки: Low-level таблица, theme auto, double-click, welcome, даты, case (4.1–4.4, 4.6–4.7) | P1 | 5–8 дн | частично 0.x |
| **3** | Background: периодический GC, fetch closed favorites (3.1–3.2) | P2 | 3–4 дн | 4.1 (low-level ключи) |
| **5** | Git executable + версии, secrets/safeStorage, SSH (5.1–5.3) | P2 | 10–16 дн | 0.5 |
| **6** | Шрифты, цвета, spell checker (6.1–6.3) | P3 | 5–8 дн | 4.1 |

> Статус: ✅ фазы 0, 1, 2 и 4.5 реализованы (см. коммиты `8132d74` и текущий; детали — раздел 7 `docs/dead-code-report.md`). Следующие по порядку: 4.1/4.2 (Low-level таблица, тема Auto) → 3 → 5 → 6.

**Суммарно: ~31–48 рабочих дней** одного разработчика. Рекомендуемый порядок: **0 → 1 → 2 → 4.1/4.2/4.5 → 3 → 5 → 6** (фаза 5.2 — secrets — стоит поднять в приоритете, если приложение распространяется наружу).

---

## 6. Найденные баги и мёртвый код (ликвидируются фазой 0)

| # | Проблема | Место | Оценка |
|---|---|---|---|
| Б1 | Версия в About захардкожена `2.0.1` (в package.json — `2.1.0`) | `SettingsPage.tsx:1887` | XS |
| Б2 | Чтение несуществующего ключа `localStorage['prismgit-settings']` | `aiChatStore.ts:148` | XS |
| М1 | `isForcePushAllowed` / `isCommitPushed` — IPC есть, вызовов из рендера нет | `ipc/git.ts:443,457` | фаза 0.1 |
| М2 | Настройки `allowModifyingPushedCommits`, `autoStashOnCommonCommands`, `detectRenames`, `distinguishEolChanges` — UI есть, потребителя нет | `settings-api.ts:125–131` | фаза 0.1–0.4 |
| М3 | Сервисная `autoStash()` не вызывается | `git.ts:5485–5508` | фаза 0.2 |
| М4 | IPC `isEolOnlyChange` не вызывается | `git.ts:5609–5618` | фаза 0.3 |
| М5 | Параметр `keepIndex` у stashPush всегда false из UI | `git.ts:2751–2771` | фаза 2.3 |
| М6 | Ключи `dateFormat`, `maxHistoryLoad`, `showReflogInHistory`, `enableTelemetry` объявлены, не потребляются | `settings-api.ts` | фаза 0.7 / де-скоп |
| М7 | `lowLevelProperties` (textarea) не парсится и ни на что не влияет | `SettingsPage.tsx:1029–1065` | фаза 4.1 |
| Б3 | Секреты в plaintext JSON (remoteAuth, PAT, AI/CI-токены) | `settings-api.ts:281–289` | фаза 5.2 |
| Б4 | Clone ставит `credential.helper=store` (plaintext `~/.git-credentials`) | `git.ts:5677–5689` | фаза 5.2 |

---

## 7. Де-скоп (осознанно не переносим в v1)

| Пункт SmartGit | Причина |
|---|---|
| Bundled Git в дистрибутиве | Сборочная эпика (extraResources + CI под 3 ОС); сначала `system`/`custom` (5.1) |
| Встроенный SSH-клиент (own transport) | XL; system + custom GIT_SSH_COMMAND покрывает потребности (5.3) |
| CodeMirror/Monaco-редактор с current-line и Behavior/Languages-вкладками | XL; отдельная эпика после фаз 0–5 (6.4) |
| Несколько окон Log | Однооконная архитектура; альтернатива — floating panel; спрос низкий |
| Per-цвет Review Comment / Compact Display | Закрывается темами и 6.2 частично |
| «Allow all commands on stash/PR commits» как ограничение | Команды уже доступны; ограничивать не требуется |

---

## 8. Приложение: карта соответствия «скриншот → задачи плана»

| Скриншот (файл) | Покрывающие задачи |
|---|---|
| `12-53.png` Commands | 1.1, 1.4, 0.1, 0.4, 2.2, 0.4, 2.1 |
| `12-54.png` Log and Working Tree | 1.2, 1.3, 0.2, 0.3 |
| `12-54_1.png` Log | де-скоп (multiple windows), hosting-интеграция уже есть |
| `12-54_2.png` Background Commands | 3.2, 3.1 |
| `12-54_3.png` Git Executable | 5.1, 5.2, 5.4, 0.5 |
| `12-55.png` Authentication | 5.2, 5.3 |
| `12-55_1.png` User Interface | 4.2, 4.4, 4.3, 4.7, 4.6, 4.5 |
| `12-55_2.png` Built-in Text Editors | 6.1, 6.2, 6.4 (де-скоп) |
| `12-56.png` Spell Checker | 6.3 |
| `12-57.png` Low-level Properties | 4.1 |

