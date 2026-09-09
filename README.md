# SmartGit Electron

A modern, cross-platform Git client built on Electron + React + TypeScript, inspired by SmartGit 20-24 with **Ollama-code** design language (Ayu Dark palette).

## v2.0 — Lightweight & Fast

### Optimizations
- **-30% bundle size** (205KB main bundle, 64KB gzipped)
- **Lazy-loaded pages** — only load what you need
- **Custom SVG icons** (15KB) instead of lucide-react (1MB)
- **No Monaco editor** — uses native textarea for messages
- **No @electron/remote** — pure IPC
- **No diff library** — custom parser
- **Auto-refresh** every 30s when repo is open
- **Reduced-motion support** for accessibility

### Design — Ollama-code (Ayu Dark)
- Background: `#0b0e14` (deep blue-black)
- Foreground: `#bfbdb6` (warm gray)
- Accent Blue: `#39BAE6`
- Accent Green: `#AAD94C` (diff additions)
- Accent Red: `#F26D78` (diff deletions)
- Mono font: JetBrains Mono

### Features

#### Working Tree
- **Changes** — stage/unstage/restore/ignore/delete/reveal with file actions
- **History** — commit log with **graph visualization**, search, file tree per commit
- **Blame** — line-by-line authorship with commit colors

#### Refs
- Branches, Tags, **Worktrees**, **Reflog**, Stashes, Submodules
- Each with full CRUD operations

#### SmartGit-like Merge & Rebase
- **MergePanel** — bottom panel showing conflicts, continue/abort/skip
- **RebasePanel** — same UX as SmartGit for in-progress rebases
- Conflict resolver with file open action
- Auto-detected state indicators in toolbar

#### Commit Operations
- Cherry Pick, Revert, Edit Commit Message, Split Off Files, Reset

#### Repository State Detection
- Merge / Rebase / Cherry-Pick / Revert / Bisect indicators
- Auto-show panels when operation is in progress

#### Network
- Fetch (prune, tags), Fetch All, Pull (rebase, no-ff), Push (force, tags, upstream)
- Synchronize (fetch + pull + push)

#### Integrations
- GitHub (PAT/OAuth, repository browser, PRs)
- Open in Browser, Reveal in File Manager

## Tech Stack
- Electron 32, React 18, TypeScript 5.6, Vite 5
- Tailwind CSS 3, Zustand, simple-git, electron-store
- Custom SVG icons (no icon library dependency)

## Getting Started

```bash
npm install
npm run dev          # development
npm run build        # production build
npm run package      # current OS
npm run package:win  # Windows
npm run package:mac  # macOS
npm run package:linux # Linux
```

## Project Structure

```
├── electron/         # Main process (35KB compiled)
│   ├── main.ts
│   ├── preload.ts    # 7.5KB compiled — context bridge
│   ├── ipc/          # 5 IPC modules
│   ├── services/     # git, github, storage
│   └── types/        # API contracts
├── src/              # Renderer (205KB main + lazy chunks)
│   ├── App.tsx       # Root with lazy routes
│   ├── components/   # UI components + icons.tsx
│   ├── pages/        # Lazy-loaded pages
│   ├── stores/       # Zustand stores
│   ├── lib/          # API + utils
│   └── styles/       # globals.css (Ollama-code theme)
└── package.json
```

## Keyboard Shortcuts

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
| Ctrl+Shift+T | Toggle Theme |

## License

MIT
