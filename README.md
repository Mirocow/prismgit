# PrismGit

A modern, cross-platform Git client built on Electron + React + TypeScript, inspired by SmartGit 20–24 with **Ollama-code** design language (Ayu Dark/Light palettes).

![PrismGit — Light Theme](docs/screenshot-light.png)

[![Version](https://img.shields.io/badge/version-2.1.0-blue)](#) [![Tests](https://img.shields.io/badge/tests-1009%20passing-brightgreen)](tests/) [![License](https://img.shields.io/badge/license-MIT-green)](LICENSE) [![AI](https://img.shields.io/badge/AI%20Assistant-12%20providers-purple)](#)

## Quick Start

```bash
# Clone and install
git clone <repo-url>
cd prismgit-electron
npm install

# Development
npm run dev        # or: make dev

# Build for current platform
npm run package

# Run tests
npm test           # or: make test

# Cross-platform build via Docker
make docker-all
```

## Features

### Working Tree
- **Changes** — stage/unstage/restore/ignore/delete/reveal with drag & drop; configurable commit journal (`git log -N` cadence + count in Settings)
- **Diff** — lazy-loaded with 20-entry LRU cache, 150ms debounce, editable (open in external editor → prompt to stage)
- **History** — commit log with graph visualization, search, file tree per commit, author/date/path filters, multi-branch selection
- **Annotate** — inline annotations with overlap analysis (SmartGit 24)
- **Investigate** — file history with rename following
- **Blame** — line-by-line authorship with commit colors

### Workflows
- **Git-Flow** — Feature/Release/Hotfix/Fix/Support with start/finish workflows; AVH-style prefix configuration; init banner
- **Pull Requests** — unified GitHub PR + GitLab MR management (list, create, open, approve, merge, close)
- **Reviews** — full code review surface for selected PR/MR with 4 tabs:
  - **Overview** — description (markdown rendered), summary stats (files/commits/comments)
  - **Commits** — list of commits in the PR with sha, message, author, date
  - **Files** — changed files with status badges, +/- counts, unified diff patch viewer
  - **Discussion** — issue-style comments + comment input (Cmd/Ctrl+Enter to post)
- **Distributed Reviews** — offline code review stored in git notes (`refs/notes/reviews`), push/fetch for team sharing

### Provider Integration
- **Unified provider store** — single shared selection between Pull Requests and Reviews pages
- **GitHub** — PAT auth, list/create/merge/close PRs, get PR detail/files/commits/comments
- **GitLab** — PAT auth (cloud + self-hosted), list/create/merge MRs, get MR detail/changes/notes/commits; direct project lookup by path_with_namespace (no pagination needed)
- **Provider chip** — dropdown switcher in page headers (AI Assistant style); auto-detects from remote URL; manual override persists across pages
- **API call logging** — all GitHub/GitLab HTTP requests visible in the Output panel with method, path, status code, duration

### Refs
- **Branches** — local/remote, checkout, create, rename, delete, merge, push; warning indicators (gone, local-only, dirty)
- **Tags** — annotated/lightweight, create, delete, push; tag grouping by RegEx
- **Remotes** — add/remove/edit, credential management, background fetch opt-in per remote
- **Worktrees** — add, remove, prune
- **Reflog** — view, delete entries
- **Stashes** — push, pop, apply, drop, branch, rename
- **Submodules** — init, update, sync, deinit, add
- **Git LFS** — install, pull, push, fetch, track, list, lock/unlock
- **Recyclable** — recover unreachable commits before they expire (90 days)

### SmartGit 24 Features
- **Interactive Rebase** — visual todo editor (pick/reword/edit/squash/fixup/drop)
- **Conflict Solver** — 3-pane view (Base | Ours | Theirs) with 4 layouts; take ours/theirs per-file
- **Smart Views** — preset filters for Graph (All, Current Branch, My Commits, Recent, etc.)
- **Overlap Column** — visualization of related commits
- **Find Object** — search branch/tag/remote refs (Ctrl+F)
- **Split Commit** — split via interactive rebase
- **Edit Commit Message** — inline editor
- **Cherry Pick / Revert** — with conflict detection and state management
- **Tolerant Clone URL** — strips "git clone " prefix, auto-derives folder name

### AI Assistant (v2.1+)
- **12+ LLM providers** — Z.ai (GLM-4-Flash free), OpenRouter (free models), Groq (ultra-fast), Cerebras (1M free tokens/day), Google Gemini, Hugging Face, Mistral, OpenAI, Anthropic, GitHub Models, Ollama (local), LM Studio, vLLM, Custom OpenAI-compatible
- **Unlimited provider registry** — add as many instances of any provider type as you need
- **Provider switcher** — switch mid-conversation; history preserved
- **Conversation memory** — AI remembers previous messages in the same chat session
- **Context compression** — old messages auto-compressed (configurable max context size)
- **Token usage display** — input/output/context token counts after each response
- **Stop button** — aborts the in-flight LLM call instantly
- **AI Guard** — configurable allow/confirm/deny for destructive git actions (reset --hard, force push, clean, amend, stash drop)
- **Tool limits** — configurable max log commits, diff files, context size, request timeout
- **Tool-use agent loop** — 24+ tools: get_status, get_log, get_diff, stage, commit, push, pull, checkout, merge, stash, discard_changes, sync_with_remote, abort_operation, list_repos, clone_repo, init_repo, open_repo, and more
- **Export chat log** as Markdown for debugging/sharing
- **Markdown rendering** in assistant answers — code blocks, inline code, bold, lists
- **Starter prompt chips** — one-click common questions
- **AI Commit Messages** — `@ai` placeholder in commit message → AI-generated
- **AI Branch Name Suggester** — suggests kebab-case branch names from changed files
- **Streaming AI responses** — SSE parser for all 3 LLM provider families
- **Favorites** — save and reuse parts of conversations

### Three Window Styles
- **Standard** — full sidebar + all pages
- **Log** — History-focused (sidebar hidden)
- **Working Tree** — Changes-focused

Switch with Ctrl+Shift+1/2/3 or toolbar button.

### Themes (20+ palettes)
- **Ayu** Dark/Light (default), GitHub Light/Dark, Dracula, Monokai, Solarized, Nord, Tokyo Night, Catppuccin Mocha, One Dark, Gruvbox, Slack Dark, Discord, Material, Designer Light, Purple, Simple Light

Toggle with Ctrl+Shift+T.

### Performance & Settings
- **Git performance** — `feature.manyFiles`, `core.fsmonitor`, `fetch.writeCommitGraph` configurable in Settings → Git (applied via GIT_CONFIG env override, no global config changes)
- **Configurable journal** — Changes page commit journal count (5–100) and refresh interval (0–300s) to control `git log -N` frequency
- **History auto-refresh** — opt-in periodic `git log` with configurable interval (min 30s)
- **Auto-push** — opt-in periodic push of outgoing commits
- **Per-remote background fetch** — opt-in per remote via checkbox in Repository Settings
- **Adaptive polling** — boost mode (30s) after git mutations, baseline (120s) otherwise; pauses when window blurred

## Internationalization

4 locales with full parity across all 24 i18n domains:
- **English** (en) — default
- **Русский** (ru)
- **中文** (zh)
- **Deutsch** (de)

The i18n parity test (`tests/unit/i18nParity.test.ts`) enforces that all 4 locales have identical key sets. Any new `t('key')` call must have a corresponding entry in all 4 locale files.

## Output Panel

The Output panel (Command Log) captures:
- **Git commands** — every `git <args>` child process with stdout/stderr, exit code, duration
- **API calls** — GitHub/GitLab HTTP requests logged as synthetic entries (`api gitlab GET /projects/12/merge_requests/5`)
- **User vs System filter** — only user-initiated commands shown by default; toggle "System" to see background polling
- **Search** — filter by command text, stdout, or stderr

## Tech Stack

- Electron 32, React 18, TypeScript 5.6, Vite 5
- Tailwind CSS 3, Zustand, simple-git, electron-store
- Custom SVG icons (no icon library)
- Vitest + Testing Library for tests (1009 tests)
- Docker + Wine for cross-platform builds

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — system design and data flow
- [API Reference](docs/API.md) — all Git operations and IPC channels
- [Contributing](docs/CONTRIBUTING.md) — development setup and guidelines
- [Changelog](docs/CHANGELOG.md) — version history
- [Docker Build](docs/DOCKER-BUILD.md) — multi-platform build guide
- [Testing](docs/TESTING.md) — test suite documentation

## Project Structure

```
├── electron/                 # Main process
│   ├── main.ts               # Entry, window state, context menu
│   ├── preload.ts            # Context bridge API
│   ├── menu.ts               # Application menu
│   ├── ipc/                  # IPC handlers (6 modules)
│   ├── services/             # Business logic
│   │   ├── git.ts            # Git operations (simple-git, 6900+ lines)
│   │   ├── github.ts         # GitHub API client
│   │   ├── gitlab.ts         # GitLab API client (self-hosted + cloud)
│   │   ├── commandLog.ts     # Git command + API call logger
│   │   ├── storage.ts        # Persistent settings
│   │   └── watcher.ts        # File watcher for auto-refresh
│   └── types/                # TypeScript API contracts
├── src/                      # Renderer process
│   ├── App.tsx               # Root with lazy routes + hotkeys
│   ├── components/           # UI components (55+ files)
│   ├── pages/                # 18 lazy-loaded pages
│   ├── stores/               # Zustand state management (12 stores)
│   ├── lib/                  # Utilities and business logic
│   └── styles/               # Ayu Dark/Light + 20 themes
├── tests/                    # Vitest test suite (1009 tests)
│   ├── unit/                 # Unit tests (i18n parity, gitflow, etc.)
│   ├── integration/          # Service integration tests (real git)
│   └── components/           # React component tests
├── scripts/                  # Build + utility scripts
├── Dockerfile                # Multi-platform Docker build
├── docker-compose.yml        # 4 build services
├── Makefile                  # All-in-one task runner
└── vitest.config.ts          # Test configuration
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+O | Open Repository |
| Ctrl+Shift+O | Clone Repository |
| Ctrl+Enter | Commit |
| Ctrl+Shift+P | Push |
| Ctrl+Shift+L | Pull |
| Ctrl+Shift+F | Fetch / Global Search |
| Ctrl+Shift+G | Git-Flow dialog |
| Ctrl+Shift+R | Interactive Rebase |
| Ctrl+Shift+N | New Branch |
| Ctrl+Alt+S | Stash |
| Ctrl+Shift+T | Toggle Theme |
| Ctrl+Shift+A | Toggle AI Assistant |
| Ctrl+Shift+1/2/3 | Window Style (Standard/Log/Working Tree) |
| Ctrl+F | Find Object |
| Ctrl+K | Command Palette |
| Esc | Close dialog |

## Docker Build

All builds happen in Docker containers:

```bash
make docker-all          # All platforms
make docker-linux        # Linux only
make docker-win          # Windows (via Wine)
make docker-mac          # macOS Intel
make docker-mac-arm64    # macOS Apple Silicon
```

See [docs/DOCKER-BUILD.md](docs/DOCKER-BUILD.md) for details.

## License

MIT
