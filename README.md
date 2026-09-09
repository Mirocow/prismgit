# SmartGit Electron

A modern, cross-platform Git client built on Electron + React + TypeScript, inspired by SmartGit 20-24 with **Ollama-code** design language (Ayu Dark/Light palettes).

## v3.0 — Docker Builds + SmartGit 24 Features

### Docker-сборка для всех платформ

Все сборки выполняются **только в Docker контейнерах**, поддерживая:

| Платформа | Механизм | Артифакты |
|-----------|----------|-----------|
| Linux | Нативная сборка | AppImage, .deb, .rpm |
| Windows | Кросс-компиляция через Wine | .exe (NSIS), .msi |
| macOS Intel | electron-builder на Linux | .dmg, .zip (unsigned) |
| macOS Apple Silicon | electron-builder на Linux | .dmg, .zip (unsigned) |

```bash
# Сборка всех платформ:
./scripts/docker-build.sh all

# Или через docker compose:
docker compose up --build
```

Подробности в [docs/DOCKER-BUILD.md](docs/DOCKER-BUILD.md).

### 2 темы (как в ollama-code)

- **Dark** (по умолчанию) — Ayu Dark: `#0b0e14` фон, `#bfbdb6` текст, `#39BAE6` акцент
- **Light** — Ayu Light: `#f8f9fa` фон, `#5c6166` текст, `#399ee6` акцент

Переключение:
- Кнопка в тулбаре (Sun/Moon иконка)
- Кнопка внизу sidebar
- Горячая клавиша **Ctrl+Shift+T**
- Автосохранение в localStorage + настройках приложения

### SmartGit 24 функции

**新增新增新增 Новые функции:**

- **Investigate** (File Log) — история файла с follow renames, как в SmartGit 24
- **Journal** — журнал операций с фильтрами (commit/checkout/merge/rebase/reset/other)
- **Find Object** (Ctrl+F) — поиск по branch/tag/remote refs с навигацией стрелками
- **Tolerant Clone URL** — автонормализация URL (strip "git clone ", кавычек, авто-имя папки)
- **Edit Commit Message** с inline editor
- **Cherry Pick / Revert** с conflict detection
- **Reset to ref** из Journal
- **Open in Browser** для коммитов, веток, репозитория
- **Drag file to external app** — через reveal in file manager

**SmartGit-подобный UI для Merge & Rebase:**

- `RebasePanel` — автоматически показывается при rebase в процессе
  - Список конфликтующих файлов с кнопкой "Open"
  - Continue / Skip / Abort кнопки
- `MergePanel` — то же для merge, с опциями No-FF / Squash
- Индикаторы состояния в тулбаре: MERGING / REBASING / CHERRY-PICKING / REVERTING / BISECTING

### Оптимизации (сохранены из v2.0)

- **Main bundle: 211KB** (gzip 65KB)
- **Lazy-loaded pages** — все страницы загружаются по требованию
- **Custom SVG icons** (15KB) вместо lucide-react (1MB)
- **No Monaco editor, no @electron/remote, no diff library**
- **Auto-refresh** статуса каждые 30s
- **prefers-reduced-motion** поддержка

## Технологии

- Electron 32, React 18, TypeScript 5.6, Vite 5
- Tailwind CSS 3, Zustand, simple-git, electron-store
- Custom SVG icons (без icon library)
- Docker + Wine для кросс-платформенной сборки

## Структура проекта

```
├── Dockerfile                # Multi-stage сборка (Linux + Wine для Windows)
├── docker-compose.yml        # 4 сервиса: linux, win, mac, mac-arm64
├── scripts/
│   ├── docker-build.sh       # Оркестратор сборки
│   ├── replace-icons.py      # Миграция иконок (dev)
│   └── replace-icon-usage.py # Миграция иконок (dev)
├── docs/
│   └── DOCKER-BUILD.md       # Подробная документация по Docker-сборке
├── electron/                 # Main process
│   ├── main.ts
│   ├── preload.ts
│   ├── ipc/                  # 5 IPC модулей
│   ├── services/             # git, github, storage
│   └── types/                # API контракты
├── src/                      # Renderer
│   ├── App.tsx               # Root с lazy routes + global hotkeys
│   ├── components/
│   │   ├── icons.tsx         # 50+ SVG иконок
│   │   ├── Sidebar.tsx       # Навигация + theme toggle
│   │   ├── Toolbar.tsx       # Actions + Find + Theme
│   │   ├── RebasePanel.tsx   # SmartGit-like rebase UI
│   │   ├── MergePanel.tsx    # SmartGit-like merge UI
│   │   ├── FindObjectDialog.tsx  # SmartGit 24 Find Object
│   │   └── ...
│   ├── pages/
│   │   ├── ChangesPage.tsx
│   │   ├── HistoryPage.tsx       # Graph visualization
│   │   ├── InvestigatePage.tsx   # SmartGit 24 File Log
│   │   ├── JournalPage.tsx       # SmartGit 24 Journal
│   │   ├── BlamePage.tsx
│   │   ├── BranchesPage.tsx
│   │   ├── TagsPage.tsx
│   │   ├── WorktreesPage.tsx
│   │   ├── ReflogPage.tsx
│   │   ├── StashesPage.tsx
│   │   ├── SubmodulesPage.tsx
│   │   └── SettingsPage.tsx
│   ├── stores/               # Zustand stores
│   ├── lib/                  # API + utils
│   └── styles/globals.css    # Ollama-code dark + light themes
└── package.json
```

## Горячие клавиши

| Shortcut | Action |
|----------|--------|
| Ctrl+O | Open Repository |
| Ctrl+Shift+O | Clone Repository |
| Ctrl+Enter | Commit |
| Ctrl+Shift+P | Push |
| Ctrl+Shift+L | Pull |
| Ctrl+Shift+F | Fetch |
| Ctrl+Shift+N | New Branch |
| Ctrl+Alt+S | Stash |
| **Ctrl+Shift+T** | **Toggle Theme** |
| **Ctrl+F** | **Find Object** |
| Esc | Close dialog |

## Запуск локально (без Docker)

```bash
npm install
npm run dev          # development
npm run build        # production build
```

## Сборка в Docker

```bash
# Все платформы:
./scripts/docker-build.sh all

# Конкретная платформа:
./scripts/docker-build.sh linux
./scripts/docker-build.sh win
./scripts/docker-build.sh mac
./scripts/docker-build.sh mac-arm64
```

## GitHub Integration

1. Settings → GitHub Integration
2. Создать PAT на github.com/settings/tokens (scopes: repo, read:user)
3. Вставить токен и нажать Connect

## Лицензия

MIT
