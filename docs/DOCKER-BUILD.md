# Docker Build Guide

PrismGit поддерживает сборку в Docker для всех платформ: **Linux, Windows, macOS**.

## Требования

- Docker 20+ с поддержкой BuildKit
- Docker Compose v2+
- ~5GB свободного места для кэша сборки

## Архитектура сборки

Каждая платформа использует **отдельный Dockerfile** для надёжности и лучшего кэширования:

| Платформа | Dockerfile | Wine | Артефакты |
|-----------|------------|------|-----------|
| Linux | `Dockerfile.linux` | Не нужен | AppImage, .deb, .rpm |
| Windows | `Dockerfile.win` | Да (i386 + amd64) | .exe (NSIS), .msi |
| macOS Intel | `Dockerfile.mac` (ARCH=x64) | Не нужен | .dmg, .zip (unsigned) |
| macOS ARM64 | `Dockerfile.mac` (ARCH=arm64) | Не нужен | .dmg, .zip (unsigned) |

## Быстрая сборка

```bash
# Все платформы:
make docker-all

# Или через docker compose:
docker compose up --build
```

Артифакты появятся в:
- `release/linux/` — Linux AppImage, .deb, .rpm
- `release/win/` — Windows .exe (NSIS), .msi
- `release/mac/` — macOS .dmg, .zip (x64)
- `release/mac-arm64/` — macOS .dmg, .zip (Apple Silicon)

## Сборка одной платформы

```bash
# Через Makefile:
make docker-linux
make docker-win
make docker-mac
make docker-mac-arm64

# Или через скрипт:
./scripts/docker-build.sh linux
./scripts/docker-build.sh win
./scripts/docker-build.sh mac
./scripts/docker-build.sh mac-arm64
```

## Прямая сборка через docker build (без compose)

Если docker compose не работает, можно собирать напрямую:

```bash
# Linux
docker build -t smartgit-electron:linux -f Dockerfile.linux .
docker create --name tmp smartgit-electron:linux
docker cp tmp:/release/. release/linux/
docker rm tmp

# Windows
docker build -t smartgit-electron:win -f Dockerfile.win .
docker create --name tmp smartgit-electron:win
docker cp tmp:/release/. release/win/
docker rm tmp

# macOS Intel
docker build -t smartgit-electron:mac -f Dockerfile.mac --build-arg ARCH=x64 .
docker create --name tmp smartgit-electron:mac
docker cp tmp:/release/. release/mac/
docker rm tmp

# macOS ARM64
docker build -t smartgit-electron:mac-arm64 -f Dockerfile.mac --build-arg ARCH=arm64 .
docker create --name tmp smartgit-electron:mac-arm64
docker cp tmp:/release/. release/mac-arm64/
docker rm tmp
```

Или через скрипт:

```bash
./scripts/docker-build.sh direct-linux
./scripts/docker-build.sh direct-win
./scripts/docker-build.sh direct-mac
./scripts/docker-build.sh direct-mac-arm64
```

## Как это работает

Каждый Dockerfile использует multi-stage build:

1. **Builder stage** — `node:20-bookworm-slim` с установленными:
   - Нативные библиотеки для Electron (libgtk, libnss, libxtst и т.д.)
   - ImageMagick и icnsutils для иконок
   - Wine (только для Windows — в `Dockerfile.win`)
   - Для Linux: rpm для генерации .rpm пакетов

2. **Runtime stage** — `debian:bookworm-slim` только с собранными артифактами

### Особенности платформ

| Платформа | Механизм | Ограничения |
|-----------|----------|-------------|
| Linux | Нативная сборка в контейнере | Нет |
| Windows | Кросс-компиляция через Wine | Unsigned (нет подписи) |
| macOS | electron-builder на Linux | Unsigned .dmg/.zip; для подписи нужен macOS runner |

## Решение проблем

### Wine: failed to initialize

Если Wine не работает при сборке Windows:

```bash
# Пересоберите с флагом --no-cache
docker compose build --no-cache build-win
```

### Ошибка "winetricks not found"

В Debian Bookworm пакет `winetricks` недоступен. В новых Dockerfile он **не используется** — electron-builder не требует его для NSIS.

### macOS build fails with "cannot find codesign"

Это нормально — Linux-контейнер не может подписать macOS-бинарь. Сборка продолжается без подписи, получается unsigned .dmg/.zip.

### Electron download fails

Установите переменную `ELECTRON_MIRROR`:

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
docker compose up --build
```

### Volume mount не работает (artifacts не копируются)

Скрипт `docker-build.sh` автоматически копирует артифакты из образа через `docker cp`, если volume mount не сработал:

```bash
# Если автоматическое копирование не сработало, вручную:
docker create --name tmp smartgit-electron:linux
docker cp tmp:/release/. release/linux/
docker rm tmp
```

### Out of disk space

Очистите кэш Docker:

```bash
docker system prune -a -f
docker builder prune -a -f
```

### Ошибка "Package X has no installation candidate"

Обновите apt cache перед установкой:

```bash
docker compose build --no-cache build-linux
```

## Подпись кода (опционально)

Для подписанных сборок установите переменные окружения:

```bash
# Windows (Authenticode)
export CSC_LINK="path/to/cert.p12"
export CSC_KEY_PASSWORD="your-password"

# macOS (Apple Developer ID)
export CSC_LINK="path/to/cert.p12"
export CSC_KEY_PASSWORD="your-password"
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="your-team-id"
```

## Очистка

```bash
# Удалить все артифакты
rm -rf release/

# Удалить Docker-образы
docker rmi smartgit-electron:linux smartgit-electron:win smartgit-electron:mac smartgit-electron:mac-arm64

# Очистить Docker-кэш
docker builder prune -f
docker system prune -a -f
```
