# Docker Build Guide

SmartGit Electron поддерживает сборку в Docker для всех платформ: **Linux, Windows, macOS**.

## Требования

- Docker 20+ с поддержкой BuildKit
- Docker Compose v2+
- ~5GB свободного места для кэша сборки

## Быстрая сборка всех платформ

```bash
# Из корня проекта:
./scripts/docker-build.sh all

# Или через docker compose:
docker compose up --build
```

Артифакты появятся в:
- `release/linux-x64/` — Linux AppImage, .deb, .rpm
- `release/win-x64/` — Windows .exe (NSIS), .msi
- `release/mac-x64/` — macOS .dmg, .zip (x64)
- `release/mac-arm64/` — macOS .dmg, .zip (Apple Silicon)

## Сборка одной платформы

```bash
./scripts/docker-build.sh linux       # Linux
./scripts/docker-build.sh win         # Windows (через Wine)
./scripts/docker-build.sh mac         # macOS Intel
./scripts/docker-build.sh mac-arm64   # macOS Apple Silicon
```

## Как это работает

Multi-stage Dockerfile:
1. **Builder stage** — `node:20-bookworm-slim` с Wine, нативными зависимостями Electron, icnsutils, imagemagick
2. **Runtime stage** — `debian:bookworm-slim` только с собранными артифактами

### Особенности платформ

| Платформа | Механизм | Ограничения |
|-----------|----------|-------------|
| Linux | Нативная сборка в контейнере | Нет |
| Windows | Кросс-компиляция через Wine | Unsigned |
| macOS | electron-builder на Linux | Unsigned .dmg/.zip; для подписи нужен macOS runner |

### Подпись кода (опционально)

```bash
export CSC_LINK="path/to/cert.p12"
export CSC_KEY_PASSWORD="your-password"
# Для macOS notarization:
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="your-team-id"
```

## Troubleshooting

### Wine: failed to initialize
```bash
docker compose build --no-cache build-win
```

### Electron download fails
```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
docker compose up --build
```

### Out of disk space
```bash
docker system prune -a -f
docker builder prune -a -f
```
