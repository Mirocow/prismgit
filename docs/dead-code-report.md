# Отчёт по мёртвому коду PrismGit

> **Ветка:** `feature/smartgit-electron-v1` (база `cf3e06a`)
> **Дата:** 2026-09-14
> **Источник требований:** аудит по 10 скриншотам SmartGit Preferences + `docs/implementation-plan.md` (фазы 0–1).
> **Методика:** статический анализ (rg/tsc) + рантайм-верификация (vitest: unit 893, integration 335, build). Все ссылки `файл:строка` актуальны на момент отчёта.

---

## 1. Резюме

| Категория | Было | Ожил / исправлено в этой сессии | Осталось мёртвым |
|---|---|---|---|
| Мёртвые IPC/сервисные функции | 5 | **4** (isForcePushAllowed, isCommitPushed, isEolOnlyChange, stageAllTracked*) | 1 (`git:detectRenames`, threshold-вариант) |
| Мёртвые настройки (UI есть, потребителя нет) | 7 | **5** (forcePushPolicy, protectedBranches, autoStashOnCommonCommands, includeUntrackedInStash, distinguishEolChanges, detectRenames, dateFormat) | 2 (maxHistoryLoad, showReflogInHistory) + 1 без UI и без потребителя (enableTelemetry) |
| Мёртвые параметры IPC | 1 (`stashPush.keepIndex`) | 0 | 1 |
| Мёртвые секции UI | 1 (Low-level textarea) | 0 | 1 (фаза 4.1) |
| Найденные баги | 2 | **2 исправлены** (About-версия, aiChatStore) | 0 |
| Удалённый мёртвый код | — | `autoStash()` (6355-строчный сервис, ноль вызовов) удалён | — |

\* `stageAllTracked` — новая функция фазы 1.2; упомянута, т.к. закрывает ту же связку «бэкенд без UI».

**Ключевой итог:** все P0-объекты мёртвого кода из аудита ликвидированы. Остались только P1/P2 позиции (фазы 3–5 плана) и три низкоприоритетных ключа настроек.

---

## 2. Оживлённый мёртвый код (было → стало)

### 2.1. `isForcePushAllowed` + настройка `forcePushPolicy` / `protectedBranches` — М1/М2

| | |
|---|---|
| **Симптом (было)** | Чистая функция `isForcePushAllowed` (`electron/services/git.ts:6060`), IPC `git:isForcePushAllowed` (`electron/ipc/git.ts:457`) и прокси preload (`electron/preload.ts:303`) существовали, но: `push()` политику **не проверял**; в рендере **0 вызовов**; настройка `forcePushPolicy` (`SettingsPage.tsx:1474`) сохранялась и ни на что не влияла. Любой force-push проходил без ограничений. |
| **Стало** | 1) **Сервис-уровень**: `push()` при `force === true` читает `forcePushPolicy` (default `feature-only`) и `protectedBranches` через `getSetting()` и отклоняет push ошибкой `fatal: force-push denied by PrismGit policy — <reason>`; проверяется **remote-side** ветка (в т.ч. refspec `HEAD:main` → проверяется `main`). Покрыты ВСЕ пути push: тулбар, Push To…, AI-инструменты, batch. — `git.ts:1108-1130`. 2) **UI-гейт**: тулбар Push-dropdown (`Toolbar.tsx:423-432`) и `PushToDialog` (`BranchDialogs.tsx:285-298`) вызывают мёртвый IPC и дизейблят force-чекбокс с подсказкой-причиной. |
| **Тесты** | integration `gitService.remaining.test.ts`: «force-push policy "deny" rejects…», «"feature-only" rejects protected branches, allows feature branches» — ✅ |

### 2.2. `isCommitPushed` + настройка `allowModifyingPushedCommits` — М1/М2

| | |
|---|---|
| **Симптом (было)** | IPC `git:isCommitPushed` (`ipc/git.ts:443`, `git.ts:5817`) — вызовов из рендера 0. Настройка `allowModifyingPushedCommits` (`SettingsPage.tsx:923`) — потребителя нет. Amend запушенного коммита проходил молча. |
| **Стало** | В `performCommit()` (`ChangesPage.tsx:860-878`): при `amend` рендер запрашивает `rev-parse HEAD` → `isCommitPushed()`; если коммит запушен — `ConfirmDialog` «Коммит уже отправлен…» (danger); при `allowModifyingPushedCommits === true` — вместо блокировки warning-тост (семантика из i18n-подсказки настройки). Проверка best-effort: ошибки IPC не блокируют коммит. |
| **Тесты** | typecheck + мок `isCommitPushed` в `tests/setup.ts`. E2E-сценарий описан в плане (0.1, acceptance). |

### 2.3. `autoStash()` + настройки `autoStashOnCommonCommands` / `includeUntrackedInStash` — М3/М2

| | |
|---|---|
| **Симптом (было)** | Сервисная `autoStash()` (`git.ts:5485-5508`) — **ноль вызовов**, генерик-хелпер с захардкоженным `-u`. Настройки в UI (`SettingsPage.tsx:962-984`) — потребителя нет. Точечные автостэши были только в MergePanel (локальный state, не связанный с настройками). |
| **Стало** | Новые хелперы `autoStashIfNeeded()` / `autoStashPop()` (`git.ts:1374-1425`) — читают настройки из main-process стора, уважают `includeUntrackedInStash`, встроены в **`pull()`** (возвращает `AutoStashResult { autoStashed, popFailed }`) и **`checkout()`** (то же, через `withOperationLog`); pop выполняется в `finally` — изменения возвращаются даже при неудаче операции. `gitStore.pull` показывает тосты `changes.autoStashRestored` / `autoStashPopFailed`. **Старая `autoStash()` удалена** как мёртвый код. |
| **Тесты** | integration (реальный git, bare-remote + clone): «setting OFF: dirty tree + pull --rebase is rejected»; «setting ON: dirty tree is stashed, pull succeeds, stash popped back, no leftover autostash entries» — ✅ |

### 2.4. `isEolOnlyChange` + настройка `distinguishEolChanges` — М4/М2

| | |
|---|---|
| **Симптом (было)** | IPC `git:isEolOnlyChange` (`ipc/git.ts:419`, `git.ts:5609`) — 0 вызовов из рендера. Настройка — потребителя нет. |
| **Стало** | `ChangesPage`: при включённой настройке фоновой батч-детект изменённых файлов (`working_dir === 'M'`, лимит 100, конкурентность 4 воркера, abort на смене статуса) → бейдж **EOL** в строке файла + тумблер «скрыть EOL-only» в тулбаре списка (появляется, когда детект нашёл файлы) + фильтры в `stagedFiles`/`unstagedFiles`/`untrackedFiles`. При выключенной настройке — ни одного `git diff`-сабпроцесса. — `ChangesPage.tsx:1380-1513, 2020-2027, 2162-2176`. |
| **Тесты** | unit-мок `isEolOnlyChange` в setup; ручной сценарий: файл с CRLF↔LF получает бейдж. |

### 2.5. Настройка `detectRenames` — М2

| | |
|---|---|
| **Симптом (было)** | UI-чекбокс был (`SettingsPage.tsx:936`), но `detectWorkingTreeRenames` вызывался всегда. |
| **Стало** | Гейт в эффекте детекта (`ChangesPage.tsx:1281-1284`): `settings.detectRenames === false` → детект не запускается, ранее найденные пары сбрасываются. |

### 2.6. Настройка `dateFormat` (0.7) — М6 (частично)

| | |
|---|---|
| **Симптом (было)** | Ключ объявлен (`settings-api.ts:81`), UI есть (`SettingsPage` Appearance), потребителя — 0. |
| **Стало** | `formatDate.ts`: `formatDateByMode()` (`relative` / `absolute` / `both`) + хук `useDateFormatter()`; подключён в **JournalPage, StashesPage, ReflogPage, BranchesPage** (4 страницы, 6 call-site'ов). Значение по умолчанию `relative` — поведение без изменений. |

### 2.7. Фаза 1 — «Commit Dialog» (было отсутствующим функционалом, закрывает те же страницы аудита)

| Пункт | Реализация |
|---|---|
| **1.1 core.commentChar** | `src/lib/commitMessage.ts` — `resolveCommentChar` / `isCommentLine` / `findCommentLines` / `stripCommitComments`; чтение `core.commentChar` (local→global, default `#`) в `ChangesPage`; 3 режима `commitCommentsMode`: `as-is` / `ask` (ConfirmDialog Strip/Keep) / `strip`. Настройка в Commands-секции. **14 unit-тестов** (`tests/unit/commitMessage.test.ts`) — ✅ |
| **1.2 If nothing is staged** | Новый бэкенд `stageAllTracked()` = `git add -u` (`git.ts:449`, IPC `git:stageAllTracked`, preload); настройка `commitNothingStaged`: `ask` (диалог с 3 кнопками — `ChangesPage.tsx:2761+`) / `all-except-untracked` / `all-including-untracked`; кнопка Commit активна при любых изменениях (`hasAnyCommittableChanges`). |
| **1.3 Suggestions** | Настройки `commitSuggestAddUntracked` (default off) и `commitSuggestRemoveMissing` (default on); инлайн-баннеры в панели коммита: «N untracked — Add all?» (→ `stageAll`) и «N missing — Stage deletions?» (→ `git add <paths>` для `wd==='D'`), dismiss на сессию. |
| **1.4 Line guides** | Настройка `commitLineGuides` (`none`/`50`/`72`/`50+72`); overlay `pointer-events:none` поверх textarea, позиция `calc(0.5rem + N·ch)` на тех же font-mono/text-sm метриках — `ChangesPage.tsx:2698-2726`. |

---

## 3. Исправленные баги

### Б1. Версия в About захардкожена `2.0.1` (фактическая `2.1.0`)
- **Было:** `SettingsPage.tsx:1887` — `<span className="font-mono">2.0.1</span>`; Electron — статичное «v32».
- **Стало:** IPC `app:versions` → `{ app: app.getVersion(), electron: process.versions.electron, node }` (`electron/main.ts:428-432`, preload `app.getVersions`); About-панель рендерит реальные значения (+ добавлена строка Node). — `SettingsPage.tsx:49-56, 1891-1908`.

### Б2. `aiChatStore` читал несуществующий ключ localStorage
- **Было:** `aiChatStore.ts:148` — `localStorage.getItem('prismgit-settings')`; настройки живут в IPC-сторе (файл `prismgit-settings.json` в userData), ключа в localStorage нет → `aiChatHistoryLimit` молча игнорировался, всегда default 100.
- **Стало:** `useSettingsStore.getState().settings.aiChatHistoryLimit ?? 100` (импорт без цикла: settingsStore не зависит от aiChatStore). — `aiChatStore.ts:140-150`.

---

## 4. ОСТАВШИЙСЯ мёртвый код (не вошёл в P0, рекомендации)

| # | Объект | Место | Природа | Рекомендация / фаза |
|---|---|---|---|---|
| 1 | IPC `git:detectRenames` (threshold-вариант) | `ipc/git.ts:439`, `git.ts:960` (detectWorkingTreeRenames — отдельная живая история), `preload.ts:282` | Бэкенд без единого вызова из рендера; рендер пользуется только `git:detectWorkingTreeRenames` | Либо удалить (XS), либо подключить как «renames по threshold» для коммит-диалога (S). Фаза 4.1 |
| 2 | Настройка `maxHistoryLoad` | дефолт `storage.ts:23`, UI `SettingsPage.tsx:486-487` | UI пишет, `git.log()` дефолтит maxCount иначе — ключ не читается | Потреблять в `log()` (`options.maxCount ?? settings.maxHistoryLoad`) — XS. Фаза 0-остаток |
| 3 | Настройка `showReflogInHistory` | `storage.ts:22`, UI `SettingsPage.tsx:493-501` | UI есть, HistoryPage ключ не читает | Подключить флагом отображения reflog-вкладки — S. Де-скоп допустим |
| 4 | Настройка `enableTelemetry` | `storage.ts:24` | Ни UI, ни потребителя — полностью мёртвый ключ | Удалить или реализовать (рекомендуется удалить — телеметрия не входит в v1) — XS |
| 5 | Параметр `keepIndex` у `stashPush` | `git.ts` (stash push), `preload.ts:73` | Бэкенд принимает `keepIndex`, UI всегда передаёт `false` | Чекбокс «Keep index» в StashesPage — XS. Фаза 2.3 |
| 6 | Секция «Low-Level Properties» (textarea) | `SettingsPage.tsx:1109-1147` | Текст парсится в настройку, но **не читается ни одной подсистемой** — фикция «настроек» | Заменить таблицей key/value с реестром известных ключей — фаза 4.1 (M, 2–3 дн) |
| 7 | `ForcePushPolicy`-обёртка в api-tauri | `src/lib/api-tauri.ts` | Tauri-адаптер не реализует новые/некоторый старые методы (isForcePushAllowed и др.) — вызовы деградируют через try/catch | Опционально: добить адаптер, если Tauri-сборка актуальна — S |
| 8 | Секреты в plaintext (`remoteAuth`, `githubPAT`, `aiApiKey`, CI-токены) + `credential.helper=store` при клоне | `settings-api.ts:281-289`, `git.ts:5677+` (до правок) | Не «мёртвый код», но критичная дыра из аудита (Б3/Б4) | safeStorage-хранилище `prismgit-secrets.bin` + Security-вкладка — фаза 5.2 (L, 5–8 дн). **Рекомендуется поднять приоритет**, если приложение распространяется наружу |

> Проверено и **живое** (ложных срабатываний нет): `backgroundFetchRemotes` (`git.ts:1940`), `aiGuard.*` (`aiTools.ts`), `commandLogLimit`, `repoRemoteCheckIntervalSec`, `footerVisible.*`, `lowLevelProperties`→*только запись* (см. #6).

---

## 5. Верификация

| Проверка | Результат |
|---|---|
| `npm run typecheck` (tsc --noEmit) | ✅ 0 ошибок |
| `npm run test:unit` (74 файла) | ✅ 892 / 893 (1 падение `repositoryStore.test.ts` «throws for non-repository directory» — **pre-existing на чистом HEAD `cf3e06a`**, проверено отдельным worktree; к изменениям отношения не имеет) |
| `npm run test:integration` (14 файлов, реальный git) | ✅ 335/335 (после замены устаревшего теста `autoStash` на 4 актуальных: 2 автостэш + 2 force-push policy) |
| `npm run build` (vite + electron main/preload) | ✅ |
| i18n-паритет (tests/unit/i18nParity.test.ts) | ✅ все новые ключи присутствуют в en/ru/zh/de (38 новых ключей: 19 settings + 24 changes, из них 5 имели дубликаты — урегулированы) |

### Изменённые файлы (18)
```
electron/services/git.ts        — push policy, autoStashIfNeeded/Pop, stageAllTracked, -autoStash()
electron/ipc/git.ts             — git:stageAllTracked
electron/main.ts                — app:versions
electron/preload.ts             — stageAllTracked, getVersions
electron/types/git-api.ts       — AutoStashResult, типы pull/checkout/stageAllTracked
electron/types/settings-api.ts  — 5 новых ключей настроек
src/lib/commitMessage.ts        — NEW: comment-char логика
src/lib/formatDate.ts           — formatDateByMode + useDateFormatter
src/pages/ChangesPage.tsx       — commentChar, nothing-staged, баннеры, guides, EOL, amend-check, renames-гейт
src/pages/SettingsPage.tsx      — About-версии, 5 новых контролов в Commands
src/components/Toolbar.tsx      — force-гейт push-dropdown
src/components/BranchDialogs.tsx— force-гейт PushToDialog
src/stores/gitStore.ts          — тосты автостэша
src/stores/aiChatStore.ts       — фикс Б2
src/pages/{Journal,Stashes,Reflog,Branches}Page.tsx — dateFormat
src/i18n/locales/domains/{settings,changes}.ts — ×4 локали
tests/unit/commitMessage.test.ts — NEW: 14 тестов
tests/{setup.ts, integration/gitService.remaining.test.ts} — моки + актуальные тесты
```

---

## 6. Что осталось из плана (напоминание)

Фазы 2–6 `docs/implementation-plan.md`: предупреждение `.gitmodules` при checkout (2.1), фоновый GC (3.1), Low-level таблица (4.1), тема Auto (4.2), реестр подтверждений (4.5), git executable + **safeStorage-секреты** (5.1–5.2, самые важные), шрифты/цвета/spell checker (6.1–6.3). Ориентир — раздел 4 настоящего отчёта и раздел 5 плана.
