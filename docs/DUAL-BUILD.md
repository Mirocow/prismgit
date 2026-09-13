# PrismGit — Dual-Build (Electron + Tauri)

PrismGit supports two independent build targets:

| Build | Backend | Installer size | RAM (idle) | Status |
|---|---|---|---|---|
| **Electron** (default) | Node.js + simple-git + chokidar | ~80-120 MB | ~150 MB | ✅ Full feature set |
| **Tauri** | Rust + notify + git CLI | ~5-8 MB | ~35 MB | 🚧 Subset of features (incremental) |

Both builds share the **same React + Vite + Tailwind + TypeScript frontend**.
The runtime detects which backend is hosting the app and delegates IPC
calls accordingly (see `src/lib/api.ts`).

## Quick start — Electron (default, unchanged)

```bash
make install
make dev          # http://localhost:5173
make build        # produces dist/ + dist-electron/
make package      # produces release/ for current OS
```

## Quick start — Tauri (new)

### Prerequisites

1. **Rust toolchain** (one-time):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **System dependencies** (one-time):
   - **macOS**: `xcode-select --install`
   - **Linux (Debian/Ubuntu)**: `sudo apt install libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`
   - **Windows**: Microsoft Visual C++ Build Tools + WebView2 runtime (preinstalled on Win11)

3. **Tauri CLI** (one-time):
   ```bash
   make tauri-install
   ```

### Development

```bash
make tauri-dev
```

This starts:
- Vite dev server on `http://localhost:5173` (via `tauri.conf.json → beforeDevCommand`)
- Rust backend (cargo run) with hot-reload on Rust file changes
- Native Tauri window pointing at the Vite dev URL

### Production build

```bash
make tauri-build
```

This produces a native installer in `src-tauri/target/release/bundle/`:
- **macOS**: `.dmg` + `.app` (universal binary: Intel + Apple Silicon)
- **Linux**: `.deb` + `.AppImage`
- **Windows**: `.msi` + `.exe` (NSIS)

## Feature parity

The Tauri backend (`src-tauri/src/lib.rs`) currently implements these
IPC commands (matching the Electron `api.*` shape):

| Frontend call | Tauri command | Status |
|---|---|---|
| `api.git.raw(repoPath, args)` | `git_raw` | ✅ |
| `api.git.status(repoPath)` | `git_status` | ✅ (returns raw porcelain — frontend parser TODO) |
| `api.git.branches(repoPath)` | `git_branches` | ✅ |
| `api.git.tags(repoPath)` | `git_tags` | ✅ |
| `api.git.stashList(repoPath)` | `git_stash_list` | ✅ |
| `api.git.log(repoPath, opts)` | `git_log` | ✅ |
| `api.git.reflog(repoPath, ref, n)` | `git_reflog` | ✅ |
| `api.fs.openRepositoryPicker()` | `open_repo_picker` | ✅ |
| `api.watcher.start(path) / stop(path)` | `watch_repo` / `unwatch_repo` | ✅ |
| `api.app.openExternal(url)` | via `tauri-plugin-shell` | ✅ |
| `api.git.diff / stageLines / unstageLines` | — | 🚧 TODO (needs Rust impl) |
| `api.git.commit / push / pull / fetch` | — | 🚧 TODO (can use `git_raw` directly) |
| `api.git.createBranch / deleteBranch / checkout` | — | 🚧 TODO |
| `api.github.*` | — | 🚧 TODO (needs Tauri HTTP plugin + OAuth) |
| `api.settings.*` | — | 🚧 TODO (needs Tauri storage) |
| `api.contextMenu.*` | — | 🚧 TODO (needs Tauri Menu API) |

When a feature isn't yet wired in the Tauri backend, the frontend
gracefully degrades — the call throws, the calling code's catch
handler shows an "unsupported in Tauri build" message.

## Architecture

```
prismgit/
├── electron/                 # Electron backend (Node.js + simple-git + chokidar)
│   ├── main.ts
│   ├── preload.ts            # Exposes window.smartgit = { git, fs, watcher, ... }
│   └── services/
│
├── src-tauri/                # Tauri backend (Rust + notify + git CLI)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── capabilities/
│   └── src/
│       ├── main.rs           # Entry point — calls prismgit_tauri_lib::run()
│       └── lib.rs            # All IPC commands (git_raw, git_status, ...)
│
├── src/                      # Shared React frontend
│   ├── lib/
│   │   ├── api.ts            # Runtime-agnostic api: Tauri ↔ Electron
│   │   └── api-tauri.ts      # Tauri adapter (invoke → IPC commands)
│   ├── components/
│   └── pages/
│
├── package.json              # Both Electron and Tauri scripts
└── Makefile                  # Both `make dev` and `make tauri-dev`
```

## Why two builds?

- **Electron** — full feature parity, fastest path to new features
  (Node.js ecosystem, npm packages, simple-git is rock-solid).
  Trade-off: ~150 MB RAM, ~100 MB installer.

- **Tauri** — tiny installer (~6 MB), low RAM (~35 MB), native feel.
  Trade-off: requires Rust toolchain, fewer features wired (yet).

The intent is to incrementally port features from Electron to Tauri
until Tauri reaches feature parity and becomes the recommended build
for end users. Until then, both builds are maintained.

## Detection in frontend

```typescript
import { isTauri } from './lib/api';

if (isTauri()) {
  // Running under Tauri — disable features not yet wired.
} else {
  // Running under Electron — all features available.
}
```

The `isTauri()` check inspects `window.__TAURI_INTERNALS__` which Tauri
2.x sets at runtime.
