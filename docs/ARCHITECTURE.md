# Architecture

## Overview

SmartGit Electron follows a standard Electron architecture with clear separation between main process, preload script, and renderer process.

```
┌─────────────────────────────────────────────────────────────┐
│                     Main Process                            │
│  (electron/main.ts)                                         │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐     │
│  │ IPC Handlers│  │  Services   │  │  File Watcher   │     │
│  │  (5 modules)│  │ (git, github│  │  (.git/HEAD,    │     │
│  │             │  │  storage)   │  │  index, refs)   │     │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘     │
│         │                │                   │              │
│         └────────────────┴───────────────────┘              │
│                          │                                  │
│                    contextBridge                            │
└──────────────────────────┼──────────────────────────────────┘
                           │
                    window.smartgit API
                           │
┌──────────────────────────┼──────────────────────────────────┐
│                    Renderer Process                        │
│  (src/App.tsx)                                             │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐     │
│  │   Stores    │  │   Pages     │  │   Components    │     │
│  │ (Zustand)   │  │ (18 lazy)   │  │  (DiffViewer,   │     │
│  │             │  │             │  │   ConflictSolver│     │
│  │ - repo      │  │ - Changes   │  │   GitFlowDialog)│     │
│  │ - git       │  │ - History   │  │                 │     │
│  │ - settings  │  │ - Branches  │  │                 │     │
│  │ - auth      │  │ - GitFlow   │  │                 │     │
│  │ - toast     │  │ - Reviews   │  │                 │     │
│  └─────────────┘  └─────────────┘  └─────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## Main Process (electron/)

### Entry Point (`main.ts`)

- Creates BrowserWindow with saved state (position, size, maximized)
- Registers all IPC handlers
- Builds application menu
- Manages file watcher lifecycle
- Provides native context menu API

### IPC Handlers (`ipc/`)

| Module | Responsibility |
|--------|---------------|
| `git.ts` | 80+ Git operations via simple-git |
| `github.ts` | GitHub REST API (auth, repos, PRs) |
| `fs.ts` | File system operations |
| `settings.ts` | Persistent settings via electron-store |
| `window.ts` | Window controls (minimize, maximize, close) |

### Services (`services/`)

#### Git Service (`git.ts`)

Wraps `simple-git` library with:
- **Caching** — SimpleGit instances cached per repo path
- **State detection** — detects merge/rebase/cherry-pick/revert/bisect state
- **Structured output** — converts git output to typed interfaces
- **LFS support** — lfs status/pull/push/fetch/install/track
- **Split commit** — interactive rebase with edit action
- **Line staging** — stage/unstage specific line ranges

#### GitHub Service (`github.ts`)

- HTTPS client for GitHub REST API
- PAT authentication
- OAuth flow (stub)
- Repository listing, PR management

#### Storage Service (`storage.ts`)

- Persistent settings via electron-store
- Repository list management
- Theme, font size, sidebar width preferences

#### Watcher Service (`watcher.ts`)

- Watches `.git/HEAD`, `.git/index`, `.git/MERGE_HEAD`, `.git/refs/`
- Watches working tree for file changes
- Debounced events (300ms) sent to renderer
- Auto-refreshes Git status

## Preload Script (`preload.ts`)

Uses `contextBridge` to expose `window.smartgit` API:

```typescript
window.smartgit = {
  git: { ... },        // 80+ Git operations
  github: { ... },     // GitHub API
  fs: { ... },         // File system
  settings: { ... },   // Persistent settings
  window: { ... },     // Window controls
  app: { ... },        // App info
  watcher: { ... },    // File watcher
  contextMenu: { ... },// Native context menus
  clipboard: { ... },  // Clipboard access
  events: { ... },     // Menu event subscriptions
}
```

**Security**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`.

## Renderer Process (src/)

### State Management (Zustand)

Five independent stores:

| Store | Responsibility |
|-------|---------------|
| `repositoryStore` | Current repo, repo list, open/clone/init |
| `gitStore` | Git status, stage/commit/push/pull operations |
| `settingsStore` | Theme, font size, sidebar width |
| `authStore` | GitHub authentication state |
| `toastStore` | Toast notifications |

### Pages (18 lazy-loaded)

All pages use `React.lazy` + `Suspense` for code splitting:

**Working Tree**: Changes, History, Annotate, Investigate, Blame, Journal
**Workflows**: Git-Flow, Pull Requests, Reviews
**Refs**: Branches, Tags, Worktrees, Reflog, Stashes, Submodules, LFS
**Settings**: Settings page

### Key Components

- **DiffViewer** — unified/split view, syntax highlighting, Apply Selection
- **ConflictSolver** — 3-pane (Base/Ours/Theirs) with 4 layouts
- **GitFlowDialog** — Feature/Release/Hotfix start/finish
- **InteractiveRebaseDialog** — visual todo editor
- **RebasePanel** — auto-shows during rebase with conflict list
- **MergePanel** — merge with options and conflict resolution
- **FindObjectDialog** — search refs with keyboard navigation
- **WindowStyleSwitcher** — Standard/Log/Working Tree modes

### Business Logic (lib/)

- `api.ts` — window.smartgit type wrapper
- `utils.ts` — cn, formatDate, status colors
- `gitflow.ts` — Git-Flow engine (Feature/Release/Hotfix)
- `conflictParser.ts` — parse conflict markers
- `diffParser.ts` — parse unified diff
- `distributedReviews.ts` — offline code review in git notes
- `smartViews.ts` — preset Graph filters
- `overlap.ts` — commit overlap analysis
- `useContextMenu.ts` — native context menu hook

## Data Flow

### Git Status Auto-Refresh

```
File change in .git/index
  → watcher.ts detects (fs.watch)
  → debounce 300ms
  → IPC: watcher:changed event
  → App.tsx receives event
  → gitStore.refreshStatus()
  → git.status() IPC call
  → gitService.status() runs simple-git
  → StatusResult returned
  → Components re-render
```

### Conflict Resolution

```
User clicks "Resolve" on conflicted file
  → setConflictFile(path)
  → ConflictSolver opens
  → Loads :1 (base), :2 (ours), :3 (theirs) via git show
  → Parses conflict markers from working tree file
  → User selects resolution (ours/theirs/both)
  → buildResolvedContent() merges
  → fs.writeFileSync() saves to working tree
  → git add() stages resolved file
  → refreshStatus() updates UI
```

### Interactive Rebase

```
User opens InteractiveRebaseDialog
  → Loads last N commits via git log
  → User reorders/changes actions (pick/squash/edit/drop)
  → User clicks "Start Rebase"
  → Builds todo file
  → git rebase -i with GIT_SEQUENCE_EDITOR=cp
  → If conflicts: RebasePanel auto-shows
  → User resolves via ConflictSolver
  → git rebase --continue
```

## Performance Optimizations

1. **Lazy Loading** — all 18 pages lazy-loaded, only loaded when navigated to
2. **Custom Icons** — 50+ SVG icons in 15KB vs lucide-react's 1MB
3. **Debounced Watcher** — 300ms debounce prevents status refresh spam
4. **Git Instance Caching** — SimpleGit instances cached per repo path
5. **Window State Persistence** — saves bounds/maximized to avoid reflow
6. **Code Splitting** — main bundle 240KB, pages 3-12KB each

## Security

- `contextIsolation: true` — renderer cannot access Node.js APIs directly
- `nodeIntegration: false` — no direct require() in renderer
- `sandbox: false` — required for preload script (electron-store)
- CSP in `index.html` — restricts script/style/img sources
- All Git operations go through IPC → main process → simple-git

## Build Pipeline

```
Source (TS/TSX)
  → Vite build
    → Renderer: dist/ (HTML, JS chunks, CSS)
    → Main: dist-electron/main.js (bundled)
    → Preload: dist-electron/preload.js (bundled)
  → electron-builder
    → Linux: AppImage, .deb, .rpm
    → Windows: .exe (NSIS), .msi (via Wine)
    → macOS: .dmg, .zip (unsigned on Linux)
```
