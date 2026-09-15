import { app, BrowserWindow, Menu, ipcMain, dialog, shell, nativeImage } from 'electron';
import * as path from 'path';
import { registerGitIpc } from './ipc/git.js';
import { registerFsIpc } from './ipc/fs.js';
import { registerGithubIpc } from './ipc/github.js';
import { registerAiIpc } from './ipc/ai.js';
import { registerWindowIpc } from './ipc/window.js';
import { registerSettingsIpc } from './ipc/settings.js';
import { registerCommandLogIpc } from './ipc/commandLog.js';
import { registerVscodeIpc } from './ipc/vscode.js';
import { registerSshIpc } from './ipc/ssh.js';
import { cleanupTempCopies } from './services/vscode.js';
import { installGitCommandLogger } from './services/commandLog.js';
import { registerWatcherIpc, stopAllWatchers } from './services/watcher.js';
import { SimpleStore } from './services/simpleStore.js';
import { migratePlaintextSecrets } from './services/storage.js';
import { migrateLegacyGithubToken } from './services/github.js';
import { flushSecrets } from './services/secrets.js';
import { buildAppMenu } from './menu.js';
import { setMenuLocale, normalizeMenuLocale } from './i18n-menu.js';
import { resolveResourceIcon } from './appIcons.js';

const isDev = !!process.env.VITE_DEV_SERVER_URL;

// Memory optimizations — applied BEFORE app.whenReady() so they take
// effect during Chromium init.
//
// `--max-old-space-size=512` caps the V8 old-generation heap to 512MB. Without
// this, the heap can balloon to several GB on long sessions (large diffs,
// multi-thousand-commit histories) before GC kicks in. 512MB is well above
// the steady-state working set (~150MB) but caps the worst-case spike.
// `--expose-gc` exposes `global.gc()` so we can force a collection after
// big operations (e.g. closing a repo, dropping a large diff) to return
// memory to the OS sooner rather than waiting for the next idle GC.
//
// Note: We do NOT add `disable-background-timer-throttling` — Chromium's
// default throttling of background tabs (~1Hz) is fine for a git client
// whose background work is mostly a 2-minute remote poll. Allowing the
// throttling saves CPU and battery when the user switches away.
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512 --expose-gc');

// ── Suppress Chromium/Electron console errors ────────────────────────────
//
// PrismGit is a plain 2D UI (no WebGL, no GPU, no Autofill). The following
// switches eliminate ALL known Chromium noise that clutters stderr during
// `make dev` and production:
//
// 1. disableHardwareAcceleration() — kills EGL/GL driver errors:
//      "EGL Driver message (Error) eglQueryDeviceAttribEXT: Bad attribute."
//    (observed on Linux/NVIDIA and macOS/ANGLE)
//
// 2. --disable-features=AutofillServerCommunication — kills:
//      "Request Autofill.enable failed. 'Autofill.enable' wasn't found"
//      "Request Autofill.setAddresses failed. 'Autofill.setAddresses' wasn't found"
//    These appear when DevTools is open — Chromium DevTools tries to enable
//    the Autofill CDP domain, but Electron doesn't implement it. Disabling
//    the feature entirely prevents DevTools from even trying.
//
// 3. --disable-gpu / --disable-software-rasterizer — kills:
//      "SharedImageManager::ProduceMemory: Trying to Produce a Memory
//       representation from a non-existent mailbox."
//    These GPU compositing errors appear when DevTools opens/closes or
//    when a BrowserWindow is recreated. Disabling GPU compositing entirely
//    (we already use software rendering) prevents SharedImageManager from
//    being involved.
//
// 3b. --disable-gpu-compositing — Electron 32 (Chromium 128) STILL runs
//     the Viz display compositor's SharedImageManager for SOFTWARE frames,
//     so the mailbox message can leak through --disable-gpu alone (observed
//     2026-09 on window recreate / panel resize). The switch forces plain
//     software compositing end-to-end. Zero cost here: hardware
//     acceleration is already off, so no GPU-composited path existed.
//
// 4. --disable-dev-shm-usage — prevents /dev/shm exhaustion warnings on
//    Linux containers (Docker/CI). Forces Chromium to use /tmp instead.
//
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,Translate,MediaRouter');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-dev-shm-usage');

// Window state persistence
interface WindowState {
  bounds?: { x: number; y: number; width: number; height: number };
  isMaximized?: boolean;
  isFullScreen?: boolean;
}

const windowStateStore = new SimpleStore({
  name: 'prismgit-window-state',
  defaults: {},
});

let mainWindow: BrowserWindow | null = null;

function getWindowState(): WindowState {
  // Guard: mainWindow may be null OR already destroyed by the time the
  // 'close' / 'before-quit' event fires. Calling getBounds() on a
  // destroyed window throws "TypeError: Object has been destroyed".
  if (!mainWindow || mainWindow.isDestroyed()) return {};
  try {
    const bounds = mainWindow.getBounds();
    return {
      bounds,
      isMaximized: mainWindow.isMaximized(),
      isFullScreen: mainWindow.isFullScreen(),
    };
  } catch {
    // Window was destroyed between the isDestroyed() check and the
    // getBounds() call — return empty state (use defaults next launch).
    return {};
  }
}

function saveWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    windowStateStore.set('windowState', getWindowState());
  } catch {
    // Window destroyed between checks — ignore.
  }
}

function createWindow(): BrowserWindow {
  const savedState = (windowStateStore.get('windowState') || {}) as WindowState;
  const bounds = savedState.bounds || { width: 1440, height: 900, x: undefined, y: undefined };

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#f8f9fa',
    frame: false,
    title: 'PrismGit',
    icon: resolveResourceIcon('icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
    show: false,
  });
  let shown = false;

  // Restore maximized/fullscreen state
  if (savedState.isMaximized) {
    win.maximize();
  }
  if (savedState.isFullScreen) {
    win.setFullScreen(true);
  }

  win.once('ready-to-show', () => {
    shown = true;
    win.show();
  });
  // Safety net: on some platforms/GPU paths 'ready-to-show' can be delayed
  // long after the page is actually usable (or never fire), leaving the user
  // with a running app but NO visible window — perceived as "the app opens
  // very slowly". Never wait more than 3s to become visible.
  setTimeout(() => {
    if (!shown && !win.isDestroyed()) {
      shown = true;
      win.show();
    }
  }, 3000);

  // Save window state on changes
  const saveDebounced = (() => {
    let timer: NodeJS.Timeout | null = null;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        saveWindowState();
        timer = null;
      }, 500);
    };
  })();

  win.on('resize', saveDebounced);
  win.on('move', saveDebounced);
  win.on('maximize', saveDebounced);
  win.on('unmaximize', saveDebounced);
  win.on('enter-full-screen', saveDebounced);
  win.on('leave-full-screen', saveDebounced);
  win.on('close', saveWindowState);
  win.on('closed', () => {
    mainWindow = null;
    // The keep-alive About window can outlive the main window — on Windows /
    // Linux 'window-all-closed' would then never fire and the app would keep
    // running with no visible window. Quit explicitly, as before.
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Open external links in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  return win;
}

// Context menu IPC
function registerContextMenuIpc() {
  ipcMain.handle('context-menu:show', async (_e, items: Array<{ label?: string; type?: 'separator' | 'normal' | 'checkbox' | 'radio'; checked?: boolean; enabled?: boolean; accelerator?: string; clickId?: string; title?: string; submenu?: any[] }>) => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const buildItem = (item: any): Electron.MenuItemConstructorOptions => ({
      label: item.label,
      type: item.type,
      checked: item.checked,
      enabled: item.enabled !== false,
      accelerator: item.accelerator,
      // Electron's Menu doesn't expose per-item tooltips on the renderer side,
      // so we fold `title` into the label as a subtle suffix when present.
      submenu: item.submenu ? item.submenu.map(buildItem) : undefined,
      click: () => {
        mainWindow?.webContents.send('context-menu:click', item.clickId);
      },
    });
    const menu = Menu.buildFromTemplate(items.map(buildItem));
    if (mainWindow && !mainWindow.isDestroyed()) {
      menu.popup({ window: mainWindow });
    }
    return true;
  });
}

app.whenReady().then(() => {
  // Menu language: OS locale until the renderer reports the user's choice
  // via 'app:setLocale' (Settings → Language). Rebuilds the menu on change.
  setMenuLocale(app.getLocale());
  ipcMain.on('app:setLocale', (_e, locale: string) => {
    const next = normalizeMenuLocale(locale);
    setMenuLocale(next);
    Menu.setApplicationMenu(buildAppMenu(() => mainWindow));
  });

  // Raw git command logger — MUST be installed before any IPC registration:
  // it wraps child_process.spawn so every git process spawned afterwards
  // (simple-git, push/pull helpers, background polls) is captured with its
  // full stdout/stderr and exit code for the Output panel's Commands tab.
  installGitCommandLogger({
    onEntry: (entry) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('command-log:entry', entry);
      }
    },
  });

  // Register IPC handlers
  // Legacy secret migration FIRST — before any IPC handler can read or
  // write settings: plaintext tokens/passwords from old installs move into
  // the encrypted vault (OS keychain via safeStorage) and are stripped
  // from the JSON files. Both calls are idempotent.
  migratePlaintextSecrets();
  migrateLegacyGithubToken();

  registerGitIpc();
  registerFsIpc();
  registerGithubIpc();
  registerAiIpc();
  registerWindowIpc();
  registerSettingsIpc();
  registerCommandLogIpc();
  registerWatcherIpc();
  registerContextMenuIpc();
  registerVscodeIpc();
  registerSshIpc();
  // Stale VS Code temp copies (HEAD/stage snapshots for --diff/--merge) from
  // previous sessions — new ones are written on demand.
  cleanupTempCopies();

  // Build app menu
  Menu.setApplicationMenu(buildAppMenu(() => mainWindow));

  mainWindow = createWindow();

  // ── Filter benign Chromium console messages ─────────────────────────────
  // Even with --disable-features and --disable-gpu, some Chromium internals
  // still log to the renderer console. These are caught here and suppressed
  // before they reach the DevTools console output.
  mainWindow.webContents.on('console-message', (_event, _level, message) => {
    // Suppress known-benign Chromium noise:
    //   - Autofill CDP errors (already disabled via --disable-features, but
    //     some Electron versions still log them)
    //   - SharedImageManager GPU errors (already disabled via --disable-gpu,
    //     but some Chromium versions still log them)
    //   - Deprecation warnings from Chromium internals
    const benign = /Autofill\.|SharedImageManager|ProduceMemory|non-existent mailbox|deprecated/i;
    if (benign.test(message)) {
      _event.preventDefault();
    }
  });

  // SmartGit Manual: Command-Line Options
  // Parse process.argv for --open, --log, --blame, --anchor-commit, etc.
  handleCliArgs(process.argv.slice(1));

  app.on('activate', () => {
    // The keep-alive About window may keep getAllWindows() non-empty even
    // when the main window is gone — track the main window explicitly.
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Dock icon clicked: restore/focus the existing window.
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
    } else {
      mainWindow = createWindow();
    }
  });
});

/**
 * SmartGit Manual: Command-Line Options
 * Supported flags:
 *   --open <path>             Open repository at path
 *   --cwd <path>              Set current working directory (affects --log/--blame path resolution)
 *   --log <path>              Open History view for repository/file
 *   --blame <path>            Open Blame view for file (append :lineNumber to scroll)
 *   --anchor-commit=<sha>     Preselect commit in History/Blame view
 *   --investigate <path>      Open DeepGit-style investigation (History view with file filter)
 *
 * These flags send IPC events to the renderer, which handles navigation.
 */
function handleCliArgs(args: string[]) {
  if (!mainWindow) return;
  let cwd = '';
  let anchorCommit: string | undefined;
  // Parse all args first to find anchor-commit + cwd before navigation
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--cwd' && args[i + 1]) {
      cwd = args[i + 1];
      i++;
    } else if (arg.startsWith('--anchor-commit=')) {
      anchorCommit = arg.substring('--anchor-commit='.length);
    }
  }

  // After the window is ready, send navigation commands
  mainWindow.webContents.once('did-finish-load', () => {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--open' && args[i + 1]) {
        const repoPath = args[i + 1];
        i++;
        mainWindow?.webContents.send('cli:open', { path: repoPath });
      } else if (arg === '--log' && args[i + 1]) {
        const target = args[i + 1];
        i++;
        // Resolve relative to --cwd if given
        const fullPath = cwd && !target.startsWith('/') ? `${cwd}/${target}`.replace(/\/+/g, '/') : target;
        mainWindow?.webContents.send('cli:log', { path: fullPath, anchorCommit });
      } else if (arg === '--blame' && args[i + 1]) {
        const target = args[i + 1];
        i++;
        // Optional :lineNumber suffix
        let line: number | undefined;
        let filePath = target;
        const colonIdx = target.lastIndexOf(':');
        if (colonIdx > 0) {
          const maybeLine = parseInt(target.substring(colonIdx + 1), 10);
          if (!isNaN(maybeLine) && maybeLine > 0) {
            line = maybeLine;
            filePath = target.substring(0, colonIdx);
          }
        }
        const fullPath = cwd && !filePath.startsWith('/') ? `${cwd}/${filePath}`.replace(/\/+/g, '/') : filePath;
        mainWindow?.webContents.send('cli:blame', { path: fullPath, line, anchorCommit });
      } else if (arg === '--investigate' && args[i + 1]) {
        const target = args[i + 1];
        i++;
        const fullPath = cwd && !target.startsWith('/') ? `${cwd}/${target}`.replace(/\/+/g, '/') : target;
        mainWindow?.webContents.send('cli:investigate', { path: fullPath, anchorCommit });
      }
    }
  });
}

app.on('window-all-closed', () => {
  stopAllWatchers();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  saveWindowState();
  stopAllWatchers();
  // Flush the debounced secret vault (and settings) write — otherwise a
  // quit within 100ms of a secret write could lose it.
  flushSecrets();
});

// Expose dialog for renderer
ipcMain.handle('dialog:openDirectory', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:openRepository', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Open Repository',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:showSaveDialog', async (_event, opts: Electron.SaveDialogOptions) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, opts);
  if (result.canceled) return null;
  return result.filePath;
});

// Clipboard
ipcMain.handle('clipboard:writeText', (_e, text: string) => {
  const { clipboard } = require('electron');
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('app:getVersion', () => app.getVersion());
// Full version info for the About panel (Settings → About) — replaces the
// previously hardcoded "2.0.1" string that drifted from package.json.
ipcMain.handle('app:versions', () => ({
  app: app.getVersion(),
  electron: process.versions.electron || '',
  node: process.versions.node || '',
}));
ipcMain.handle('app:getPlatform', () => process.platform);
