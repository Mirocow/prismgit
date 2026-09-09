# Changelog

All notable changes to PrismGit are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
