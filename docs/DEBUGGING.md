# Debugging Guide

PrismGit has full VS Code debugging support for both the main process and renderer process.

## Quick Start

### Full Debug (Main + Renderer)

1. Press `F5` or go to **Run and Debug** panel
2. Select **"Electron: Main + Renderer (Full Debug)"**
3. VS Code will:
   - Build the project (`npm run build`)
   - Start Electron with `--remote-debugging-port=9223`
   - Attach debugger to both main and renderer processes
4. Set breakpoints in `electron/**/*.ts` and `src/**/*.tsx`
5. Use the Debug Console to evaluate expressions

### Debug Configurations

| Configuration | Use Case |
|--------------|----------|
| **Electron: Main + Renderer (Full Debug)** | Default — debug both processes |
| **Electron: Main Process Only** | Debug only Node.js main process |
| **Electron: Attach to Renderer** | Attach to already-running Electron renderer |
| **Electron: Attach to Main Process** | Attach to already-running main process |
| **Vitest: Current File** | Debug tests in the current file |
| **Vitest: All Tests** | Debug all tests |
| **Vitest: Watch Mode** | Debug tests in watch mode with UI |
| **TypeScript Server** | Run `tsc --watch` for type checking |

### Compound Configurations

| Compound | Description |
|----------|-------------|
| **Electron: Main + Renderer (Attach)** | Attach to both processes of a running Electron app |

## Setting Breakpoints

### Main Process (electron/)

Breakpoints in `electron/main.ts`, `electron/ipc/*.ts`, `electron/services/*.ts` will be hit when:
- App starts (main.ts)
- IPC handlers are called (git operations, settings, etc.)
- File watcher events fire
- Menu items are clicked

### Renderer Process (src/)

Breakpoints in `src/components/*.tsx`, `src/pages/*.tsx`, `src/stores/*.ts` will be hit when:
- User interacts with UI
- React components render
- Zustand store actions are called

**Important**: For renderer debugging, source maps must be enabled. Vite generates them automatically in dev mode.

## Debugging Common Scenarios

### Debug Git Operations

1. Set breakpoint in `electron/ipc/git.ts` (e.g., `git:status` handler)
2. Set breakpoint in `electron/services/git.ts` (e.g., `status()` function)
3. Trigger from UI (e.g., open repository, refresh status)
4. Inspect `repoPath` argument and returned `StatusResult`

### Debug IPC Communication

1. Set breakpoint in preload.ts to see what's being sent
2. Set breakpoint in IPC handler to see what's received
3. Use Debug Console to inspect arguments

### Debug React Components

1. Set breakpoint in component function body
2. Component will pause when it renders
3. Inspect props, state, hooks via Variables panel
4. Use React DevTools extension for component tree

### Debug Zustand Stores

1. Set breakpoint in store action (e.g., `refreshStatus`)
2. Inspect `get()` and `set()` calls
3. Watch specific state values in Watch panel

### Debug Tests

1. Open a test file (e.g., `tests/unit/utils.test.ts`)
2. Select **"Vitest: Current File"** configuration
3. Press `F5`
4. Breakpoints in test files and source files will be hit

## Debug Console

Use the Debug Console (Ctrl+Shift+Y) to:
- Evaluate expressions in the current scope
- Call functions
- Inspect objects

Examples:
```javascript
// In main process
app.getVersion()
process.platform

// In renderer
window.smartgit.git.status('/path/to/repo')
useRepositoryStore.getState().currentRepo
```

## Watch Panel

Add expressions to watch:
- `this` — current context
- `repoPath` — current repository path
- `status` — Git status result
- `selectedFile` — currently selected file in UI

## Conditional Breakpoints

Right-click a breakpoint → Edit Breakpoint:
- **Expression**: `repoPath === '/path/to/repo'`
- **Hit Count**: `= 5` (pause on 5th hit)
- **Log Message**: `Status: ${status.current}` (log without pausing)

## Launch Configuration Details

### `Electron: Main + Renderer (Full Debug)`

```
Runtime: electron (from node_modules/.bin)
Args: --remote-debugging-port=9223 .
Pre-launch task: build:dev (npm run build)
Post-debug task: kill:vite (kill Vite dev server)
Console: integratedTerminal
Source maps: enabled
```

### `Electron: Attach to Renderer`

```
Type: chrome
Port: 9223
URL filter: http://localhost:5173/*
Web root: ${workspaceFolder}/src
```

## Troubleshooting

### Breakpoints not hitting

1. Ensure source maps are generated: check `dist-electron/` has `.js.map` files
2. Verify `outFiles` in launch.json matches your build output
3. Try `Rebuild` via Command Palette → `Developer: Reload Window`
4. Check if breakpoint is in a file that's actually loaded

### "Cannot connect to runtime"

1. Ensure port 9223 is not in use: `lsof -i :9223`
2. Kill stale Electron processes: `killall electron` (Linux/Mac) or `taskkill /F /IM electron.exe` (Windows)
3. Restart VS Code

### Renderer debugging not working

1. Ensure Vite dev server is running on port 5173
2. Check `VITE_DEV_SERVER_URL` env var is set
3. Open `http://localhost:5173` in browser to verify Vite works
4. Use Chrome DevTools (`Ctrl+Shift+I`) as fallback

### Electron won't start

1. Check `dist-electron/main.js` exists (run `npm run build` first)
2. Verify Electron is installed: `npx electron --version`
3. Check console for errors

## Recommended Extensions

VS Code will prompt to install recommended extensions (see `.vscode/extensions.json`):

- **ESLint** — JavaScript/TypeScript linting
- **Prettier** — Code formatting
- **Tailwind CSS IntelliSense** — Autocomplete for Tailwind classes
- **Vitest** — Test explorer and runner
- **GitLens** — Git superpowers
- **Docker** — Container management

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| F5 | Start debugging |
| Shift+F5 | Stop debugging |
| F10 | Step over |
| F11 | Step into |
| Shift+F11 | Step out |
| Ctrl+Shift+Y | Debug Console |
| Ctrl+Shift+D | Run and Debug panel |
| F9 | Toggle breakpoint |
| Shift+F9 | Toggle conditional breakpoint |
