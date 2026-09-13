# Changelog

All notable changes to PrismGit are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-09-13

### Added — AI Assistant overhaul
- **12 LLM providers** — OpenAI, Anthropic, Z.ai (GLM-4-Flash free), OpenRouter (free aggregator), Groq (ultra-fast), Cerebras (1M free tokens/day), Google Gemini, Hugging Face, Mistral, GitHub Models, Ollama (local), Custom
- **Conversation memory** — AI remembers previous messages in the same chat session (priorHistory parameter)
- **Context compression** — old messages auto-compressed into a summary when history exceeds 20 messages, keeping the context window manageable
- **Token usage display** — shows input/output/context token counts after each LLM response; warns when context > 50K tokens
- **Stop button** — aborts the in-flight LLM call instantly via AbortSignal + Promise.race
- **LM Studio-style model picker** for Ollama — search, metadata (params, size, quantization, family), "loaded" badge via /api/ps, keep-alive via /api/generate
- **Provider presets** — auto-fills URL + model + API-key hint when selecting a provider
- **AI tools: discard_changes, sync_with_remote, abort_operation** — atomic stash+pull+pop, reset to origin, abort merge/rebase
- **Pull with auto-stash** — `pull --rebase` with automatic stash/unstash
- **get_log collapsed by default** — summary + last 5 commits; verbose=true for full list
- **get_status summary mode** — counts by category + first 10 files; verbose=true for full list
- **get_diff stat mode** — file names + line counts by default; full=true for content
- **Export chat log** as Markdown — full conversation for debugging/sharing
- **Markdown rendering** in assistant answers — code blocks, inline code, bold, lists
- **Copy buttons** on tool results and assistant messages
- **Tool results collapsed by default** — expandable with chevron + line-count badge
- **Starter prompt chips** — one-click common questions ("What changed?", "Pull latest", etc.)
- **Configurable AI request timeout** (default 300s) in Settings → AI
- **Streaming AI responses** (SSE parser for OpenAI/Anthropic/Ollama)
- **AI Branch Name Suggester** in New Branch dialog

### Added — History page
- **Lazy-loading commits** — infinite scroll, no hard cap, reach the first commit
- **Head+Upstream default filter** — shows only current branch + origin (was --all)
- **Sync indicator** — PlugZap icon when in sync, ArrowUp/Down when ahead/behind
- **Faster first paint** — PAGE_SIZE=50, parallel rev-list, non-blocking incoming-hash computation

### Added — Changes page
- **Instant file grid on folder switch** — scroll reset + fixed useMemo deps
- **Instant right-click context menu** — default index flags, no IPC wait
- **Diff tool async read + 1.5s cache** — parallel git show + fs.promises.readFile
- **Auto-stash pull** — stash → pull --rebase → pop (no "unstaged changes" error)

### Added — Tour / Onboarding
- **Tour "Don't show again" checkbox** — persists to settings store (survives localStorage wipes)
- **Configurable AI request timeout** — 300s default, user-adjustable

### Added — i18n
- **2 new domains**: toasts (110 keys) + actions (50 keys) — ~140 hardcoded strings localized
- **4 locales**: English, Russian, Chinese, German — full parity

### Fixed
- **Tour re-shows on every launch** — flag now persisted in settings store, not just localStorage
- **'no submodule mapping found' console spam** — git:raw IPC filters benign errors
- **Diff tool slow on large files** — async readFile + 1MB cap + 1.5s cache
- **History limited to 500 commits** — now lazy-loads indefinitely
- **Right-click context menu slow** — show menu immediately with default flags
- **'Detecting renames...' spinner** — removed; detection runs silently in background
- **File grid stale on folder switch** — scroll reset + fixed useMemo deps

### Performance
- **Diff cache** — 1.5s LRU cache (64 entries) on git diff results
- **History PAGE_SIZE** reduced from 100→50 for faster first paint
- **Submodule count** via `git config --file .gitmodules` instead of `git submodule status`
- **Context menu** — 10s LRU cache on index flags + instant menu with defaults

## [2.0.1] - 2026-09-13

### Fixed
- **History/Reflog вечный рефреш** — watcher → lastRefresh → loadHistory loop
- **tauri.conf.json** — removed `digestHashingAlgorithm` (Tauri v2 schema violation)
- **CSP** — added sha256 hash for inline boot-screen script
- **Merge in progress** — `blockedByRepoState` with inline Abort button
- **Tags in History** — RefBadges max=5 + "Tagged" quick-filter chip
- **E0255** — moved `#[tauri::command]` functions to `commands` submodule (tauri-apps/tauri#10340 workaround)
- **notify v6 API** — `notify::recommended()` → `RecommendedWatcher::new()`
- **tauri-plugin-dialog v2.7** — `.blocking_confirm()` → `.show(callback)` + mpsc channel
- **Missing icons** — created 32×32 / 128×128 / 256×256 / 512×512 PNG + ICO
- **CSS comment** — PostCSS parser broke on backtick with `*/` in globals.css
- **`require('electron')`** — replaced with preload bridge for Vite ESM compatibility
- **operationLogStore dynamic/static import mismatch** — converted to static import
- **FsEventWatcher** — replaced with `RecommendedWatcher` in WatcherState struct

### Added
- **PR search filter** — title / #number / head/base branch / author
- **Tauri parity: 41 git methods** — add/commit/push/pull/fetch/checkout/branch/remote/reset/diff/commitFiles/trackedFiles/settings
- **Bundle optimization** — lazy-load 8 rarely-used components (CommandPalette, GlobalSearch, AiAssistant, TourOverlay, KeyboardShortcutsOverlay, RefActionDialog, FindObjectDialog, CommandLogPanel)
- **manualChunks** — tauri-vendor, git-utils (shared diffParser+gitGraph)
- **DataGrid in RecyclablePage** — sortable + resizable columns

### Changed
- Main bundle: 726 KB → 672 KB (-7.4%, gzip 218 → 203 KB)
- Tauri coverage: 11 → 41 git API methods

## [4.1.0] - 2026-09-09

### Added
- **Annotate view** — inline commit annotations with overlap analysis (SmartGit 24)
- **Distributed Reviews** — offline code review stored in git notes (SmartGit add-on)
  - Add/delete/resolve comments per commit
  - Severity levels: info, suggestion, warning, critical
  - Push/fetch reviews to share with team
- **Smart Views** — preset filters for Graph (All, Current Branch, My Commits, Recent 7d, Unpushed, Merged, Tagged)
- **Overlap Column** — visualization of related commits by shared files
- **Test suite** — 161 tests with Vitest + Testing Library
  - Unit tests: utils, gitflow, conflictParser, diffParser, languageDetection, stores
  - Integration tests: gitService with mocked simple-git
  - Component tests: DiffViewer, ToastContainer, WelcomeScreen
- **Documentation** — README, ARCHITECTURE.md, API.md, CONTRIBUTING.md, CHANGELOG.md, TESTING.md
- `make test`, `make test:watch`, `make test:coverage` targets

### Changed
- README rewritten with comprehensive feature list and links to docs
- Coverage thresholds configured (60% statements, 50% branches)

## [4.0.0] - 2026-09-09

### Added — P0 (Critical)
- **File Watcher** — auto-refresh Git status on `.git/HEAD`, `index`, `MERGE_HEAD`, `refs/` changes
- **Window State Persistence** — saves position, size, maximized, fullscreen state
- **Context Menus** — native right-click menus via Electron Menu API
- **Diff Viewer Rewrite** — side-by-side (split) view, Apply Selection, syntax highlighting (10 languages)
- **Conflict Solver Fix** — uses `git show :1/:2/:3` for real 3-way merge, 4 layout modes

### Added — P1 (Important)
- **Pull Request UI** — list open/closed/all, create PR, open in browser
- **Split Commit** — interactive rebase with edit action
- **Search/Filter in Changes** — file path filter
- **Stage/Unstage Lines** — `git:stageLines` / `git:unstageLines` IPC

### Added — P2 (Polish)
- **Three Window Styles** — Standard, Log, Working Tree (Ctrl+Shift+1/2/3)
- **Drag & Drop** — files between staged/unstaged sections
- **External Tools Config** — diff/merge tool commands with $LOCAL/$REMOTE/$BASE/$MERGED
- **Git LFS Support** — install, pull, push, fetch, track, list
- **Spell Check** — native spellcheck in commit message

## [3.1.0] - 2026-09-09

### Added
- **Git-Flow** — Feature/Release/Hotfix with start/finish workflows
- **Interactive Rebase Editor** — visual todo with pick/reword/edit/squash/fixup/drop
- **Conflict Solver** — 3-pane view (Ours/Working/Theirs)
- **Makefile** — 25+ targets for dev, build, test, docker, clean

## [3.0.0] - 2026-09-09

### Added
- **Docker multi-platform builds** — Linux, Windows (via Wine), macOS
- **Two themes** — Ayu Dark (default) and Ayu Light (Ollama-code palette)
- **Investigate** — file history with rename following
- **Journal** — operation history with filters
- **Find Object** — search branch/tag/remote refs (Ctrl+F)
- **Tolerant Clone URL** — strips "git clone " prefix, auto-derives folder name

## [2.0.0] - 2026-09-09

### Changed — Lightweight Optimizations
- Removed: lucide-react (~1MB), monaco-editor (~40MB), @electron/remote, diff library
- Added: custom SVG icons.tsx (15KB, tree-shakeable)
- All pages lazy-loaded via React.lazy + Suspense
- Main bundle reduced from 294KB to 211KB (-30%)

### Added
- **Ollama-code design** — Ayu Dark palette
- **RebasePanel** — auto-shows during rebase with conflict list
- **MergePanel** — merge with options and conflict resolution
- Auto-refresh status every 30s
- `prefers-reduced-motion` support

## [1.0.0] - 2026-09-09

### Added
- Initial release
- Electron 32 + React 18 + TypeScript 5.6 + Vite 5
- 13 pages: Changes, History, Blame, Branches, Tags, Stashes, Submodules, Worktrees, Reflog, Settings
- Git operations via simple-git: status, add, commit, push, pull, fetch, log, branches, merge, diff, stash, tags, submodules, clone, init
- Cherry Pick, Revert, Edit Commit Message, Reset
- Repository state detection: Merge, Rebase, Cherry-Pick, Revert, Bisect
- GitHub integration: PAT auth, repository browser
- Cross-platform: Windows, macOS, Linux
