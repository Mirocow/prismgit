# Architecture

## Overview

PrismGit follows a standard Electron architecture with clear separation between main process, preload script, and renderer process.

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

#### Background Git Worker (`gitPollCore.ts` / `gitStatusCore.ts` / `gitStatsCore.ts` / `childTracker.ts` / `gitPollWorker.ts` / `gitPollProcess.ts`)

The app's BACKGROUND git work runs in a **dedicated `utilityProcess`**, not
on the main event loop — one OS process serving THREE job kinds:

- **`poll`** — the repository-list remote check (the sidebar's `git fetch` +
  incoming/outgoing/dirty counters);
- **`status`** — the watcher-driven working-tree refresh (the exact
  `gitService.status()` computation: porcelain parse + repo-state reads) that
  used to pump/parse git output on the main loop on every IDE auto-save /
  build churn (renderer asks via `git:statusBackground` →
  `gitService.statusBackground`);
- **`stats`** — the sidebar metadata sweep (`storage.refreshRepoStats` /
  `refreshAllRepoStats`): `git log -1` + branch list + remotes +
  `rev-list --count` per repo — 4 spawns × N repos that used to run on the
  MAIN loop on every repo open and on every "Check all repositories" click
  (the reported full-UI freeze; the fetch half of that button was already in
  this worker — the stats half joined it in v3.4).

Modules:
- `gitPollCore.ts` — electron-free poll job core (fetch + 4 local reads);
  also the in-process fallback for non-Electron hosts (vitest) and for a
  sick worker (crash / failed fork / protocol timeout → job re-runs
  in-process, so the sidebar never blanks).
- `gitStatusCore.ts` — electron-free status job core (the full StatusResult
  computation, `runStatusJob(req, git?)`); `gitService.status()` delegates
  to it with its SHARED instance (keeps read coalescing + command log), the
  worker runs it with a private instance. `resolveHeadSha` /
  `detectRepoStateFromGitDir` (pure fs probes) live here too.
- `gitStatsCore.ts` — electron-free stats job core (`runStatsJob(req)`,
  `isRepo` flag included) + the in-process fallback; the metadata WRITE
  stays in main (`storage.setRepoMetadata`).
- `childTracker.ts` — worker-side `child_process.spawn` wrapper that tracks
  every git child; `disposeGitPollWorker()` sends `{kind:'shutdown'}` so the
  worker kills its in-flight git children BEFORE it exits — otherwise an
  orphaned `git fetch` keeps the network/AV busy for up to the OS TCP
  timeout after the app is gone (the "closing the app leaves the machine
  sluggish" report). Hard kill follows after a 500 ms grace window.
- `gitPollWorker.ts` — the utilityProcess entry (`dist-electron/
  gitPollWorker.js`); plain-data protocol
  `{kind:'poll'|'status'|'stats',id,request}` →
  `{kind:'poll-result'|'status-result'|'stats-result',id,result}`, `ready`
  handshake on boot; malformed messages ignored.
- `gitPollProcess.ts` — main-side manager: lazy fork, request buffering
  until `ready`, crash-storm cooldown (no fork per tick), per-kind job
  watchdogs (poll 10 min, status/stats 5 min), graceful-then-hard
  `disposeGitPollWorker()` on app quit.
- Settings and secrets (SSH askpass, HTTP auth args) are resolved in the
  MAIN process and passed as plain serializable data — the worker never
  imports electron/settings/storage. The status job's `gitDir` is resolved
  main-side through the session cache (zero extra subprocesses).
- Verification: `scripts/verify-checkall-quit.mjs` re-runs the whole story
  (main pings during the check, spawn attribution, quit time, orphan scan).

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
