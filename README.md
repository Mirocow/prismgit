# SmartGit Electron

A modern, cross-platform Git client built on Electron + React + TypeScript, inspired by SmartGit 20-24.

## Features

### Working Tree
- **Changes** — staged/unstaged file list with stage, unstage, restore, ignore, delete, reveal
- **History** — commit log with **graph visualization**, search, file tree per commit
- **Blame** — line-by-line authorship with commit colors

### Refs
- **Branches** — local/remote, checkout, create, rename, delete (local & remote), merge, push, open in browser
- **Tags** — annotated/lightweight, create, delete, push, delete remote
- **Worktrees** — add, remove, prune, manage multiple working trees
- **Reflog** — view reflog entries for any ref, delete entries
- **Stashes** — push, pop, apply, drop, branch from stash
- **Submodules** — init, update, sync, deinit, add

### Commit Operations (SmartGit 20+)
- **Cherry Pick** — apply commits from any branch
- **Revert** — create revert commits
- **Edit Commit Message** — modify commit messages
- **Split Off Files** — split commits (via interactive rebase)
- **Reset** — soft / mixed / hard / keep modes
- **File Restore** — restore files to specific ref

### Repository State Detection
- Merge / Rebase / Cherry-Pick / Revert / Bisect indicators with abort/continue

### Network
- Fetch (with prune, tags) / Fetch All / Pull (rebase, no-ff) / Push (force-with-lease, tags, upstream) / Synchronize

### Integrations
- **GitHub** — PAT/OAuth, repository browser, pull requests
- **Open in Browser** — open repo, branches, commits
- **Reveal in File Manager** — open file location in OS file manager
- **External Diff/Merge Tools** — configurable via git config

### Configuration
- Git Config (system/global/local)
- .gitignore editor (local/global)
- Dark/Light themes
- Repository pinning

## Tech Stack

- Electron 32, React 18, TypeScript 5.6, Vite 5, Tailwind CSS 3
- Zustand (state), simple-git (Git ops), electron-store (settings)
- lucide-react (icons)

## Getting Started

### Prerequisites
- Node.js 18+ and npm
- Git installed and available in PATH

### Installation
```bash
npm install
```

### Development
```bash
npm run dev
```

### Build
```bash
npm run build
npm run package          # current OS
npm run package:win      # Windows
npm run package:mac      # macOS
npm run package:linux    # Linux
```

## Project Structure

```
smartgit-electron/
├── electron/                # Main process
│   ├── main.ts             # Electron entry
│   ├── preload.ts          # Context bridge
│   ├── menu.ts             # App menu
│   ├── ipc/                # IPC handlers
│   ├── services/           # Business logic
│   │   ├── git.ts          # Git service
│   │   ├── github.ts       # GitHub API
│   │   └── storage.ts      # Persistent storage
│   └── types/              # TypeScript types
├── src/                    # Renderer
│   ├── App.tsx
│   ├── components/         # UI components
│   ├── pages/              # Route pages
│   ├── stores/             # Zustand stores
│   ├── lib/                # Utilities
│   └── styles/             # CSS
├── index.html
├── vite.config.ts
├── tailwind.config.js
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

## GitHub Integration

1. Settings → GitHub Integration
2. Create PAT at github.com/settings/tokens (scopes: repo, read:user)
3. Paste token and Connect

## License

MIT
