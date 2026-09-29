# Building PrismGit release packages

Everything below is also automated: run `npm run pkg:check` to diagnose your
environment before any build (Node version, build artifacts, icons, download
mirror reachability, wine availability).

## Requirements

| Requirement           | Version      | Why                                                        |
| --------------------- | ------------ | ---------------------------------------------------------- |
| Node.js               | **>= 22.12** | hard requirement of Vite 8 and Electron 44 (checked at build time) |
| npm                   | >= 10        | lockfile v3 support                                        |
| Network access        | to npmmirror **or** github.com | Electron dist + packaging tooling are downloaded at build time |

Check your Node version first — this is the #1 cause of failed builds:

```bash
node -v   # must be v22.12.0 or newer
```

On Node 20/21 `vite build` dies with a cryptic `crypto.hash is not a function`.

## Setup

```bash
git clone <repo-url> gitclient
cd gitclient
npm ci          # installs exactly the committed package-lock.json
```

> If `npm ci` skips Electron's postinstall (new npm install-scripts policy),
> the packaged app is NOT affected — electron-builder downloads its own copy.
> Only `npm run dev` needs it: fix with `npm install-scripts approve electron`
> or `node node_modules/electron/install.js`.

## Linux

```bash
npm run package:linux    # AppImage + deb  → release/
npm run package          # same (host defaults)
```

Artifacts: `release/PrismGit-2.1.0.AppImage`, `release/PrismGit_2.1.0_amd64.deb`.

## Windows

### On a Windows machine (recommended)

```bash
npm run package:win      # NSIS installer → release/PrismGit Setup 2.1.0.exe
```

No extra tools needed — NSIS tooling is downloaded automatically.

### From a Linux machine

The **NSIS installer needs wine** on Linux/macOS. The **portable ZIP does not**:

```bash
npm run package:win:zip  # portable zip, works WITHOUT wine
npm run package:win      # auto-falls back to zip with a warning when wine is missing;
                         # install wine (sudo apt install wine64) to get the real installer
```

The zip contains the same unpacked app (`PrismGit.exe` + resources) — unzip
anywhere and run, no installation required.

## macOS

```bash
npm run package:mac      # dmg (x64 + arm64) — build on macOS
```

## Corporate / throttled networks (github.com blocked)

The project `.npmrc` already points Electron downloads at the npmmirror CDN
(`https://npmmirror.com/mirrors/electron/`), which usually bypasses blocked or
throttled GitHub. If you need a different mirror, override per machine:

```bash
export ELECTRON_MIRROR=https://your-mirror/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://your-mirror/electron-builder-binaries/
```

`npm run package*` probes reachability itself and reports which source it uses.

## Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `crypto.hash is not a function` during `vite build` | Node < 22.12 | install Node 22 LTS+ |
| `electron-builder` hangs / times out on download | github.com unreachable | `.npmrc` mirror (default) or `ELECTRON_MIRROR` |
| `spawn wine ENOENT` building win from Linux | wine missing | `sudo apt install wine64`, or `npm run package:win:zip` (no wine) |
| deb build: "Please specify author 'email'" | old commit (pre `a338649`) | `git pull` — fixed in the repo metadata |
| `node_modules/electron-builder not found` | deps not installed | `npm ci` |
| nsis installer icon/version wrong | — | icons live in `build/`, committed to git |

## Verifying a package

The packaged binary can be smoke-tested end-to-end (boot → repo open →
history navigation → clean quit, 0 orphaned git processes):

```bash
npm run package:linux
node scripts/pkg-smoke-e2e.mjs
```

## Quick start (по-русски)

```bash
node -v                  # нужно >= 22.12
npm ci
npm run package:linux    # AppImage + deb
npm run package:win      # на Windows — инсталлятор; из Linux без wine — портативный zip
npm run pkg:check        # диагностика окружения перед сборкой
```

Если GitHub недоступен из вашей сети — закачки Electron уже идут через зеркало
npmmirror (файл `.npmrc`); своё зеркало задаётся переменной `ELECTRON_MIRROR`.
