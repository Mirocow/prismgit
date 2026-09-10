import { app, BrowserWindow, Menu, ipcMain, dialog, shell, nativeImage } from 'electron';
import * as path from 'path';
import { registerGitIpc } from './ipc/git.js';
import { registerFsIpc } from './ipc/fs.js';
import { registerGithubIpc } from './ipc/github.js';
import { registerAiIpc } from './ipc/ai.js';
import { registerWindowIpc } from './ipc/window.js';
import { registerSettingsIpc } from './ipc/settings.js';
import { registerWatcherIpc, stopAllWatchers } from './services/watcher.js';
import { SimpleStore } from './services/simpleStore.js';
import { buildAppMenu } from './menu.js';

const isDev = !!process.env.VITE_DEV_SERVER_URL;

// Suppress the EGL/GL driver error:
//   ERROR:gl_display.cc(497) EGL Driver message (Error) eglQueryDeviceAttribEXT: Bad attribute.
// This is a known Chromium/Electron issue with certain GPU drivers — observed on
// Linux (NVIDIA) as well as on macOS (ANGLE/Metal EGL device query). The error
// is cosmetic (doesn't affect functionality) but clutters stderr on every launch.
// Disabling hardware acceleration eliminates the EGL init path that triggers it.
// PrismGit is a plain 2D UI (no WebGL/GPU usage anywhere), so software rendering
// has no noticeable impact on this app.
// NOTE: must be applied on ALL platforms (not only Linux) — the macOS ANGLE/EGL
// path produces the same message; keep this call unconditional.
app.disableHardwareAcceleration();

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
    show: false,
  });

  // Restore maximized/fullscreen state
  if (savedState.isMaximized) {
    win.maximize();
  }
  if (savedState.isFullScreen) {
    win.setFullScreen(true);
  }

  win.once('ready-to-show', () => {
    win.show();
  });

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
  ipcMain.handle('context-menu:show', async (_e, items: Array<{ label?: string; type?: 'separator' | 'normal' | 'checkbox' | 'radio'; checked?: boolean; enabled?: boolean; accelerator?: string; clickId?: string }>) => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const menu = Menu.buildFromTemplate(items.map((item) => ({
      label: item.label,
      type: item.type,
      checked: item.checked,
      enabled: item.enabled !== false,
      accelerator: item.accelerator,
      click: () => {
        mainWindow?.webContents.send('context-menu:click', item.clickId);
      },
    })));
    if (mainWindow && !mainWindow.isDestroyed()) {
      menu.popup({ window: mainWindow });
    }
    return true;
  });
}

app.whenReady().then(() => {
  // Register IPC handlers
  registerGitIpc();
  registerFsIpc();
  registerGithubIpc();
  registerAiIpc();
  registerWindowIpc();
  registerSettingsIpc();
  registerWatcherIpc();
  registerContextMenuIpc();

  // Build app menu
  Menu.setApplicationMenu(buildAppMenu(() => mainWindow));

  mainWindow = createWindow();

  // SmartGit Manual: Command-Line Options
  // Parse process.argv for --open, --log, --blame, --anchor-commit, etc.
  handleCliArgs(process.argv.slice(1));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
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
ipcMain.handle('app:getPlatform', () => process.platform);
