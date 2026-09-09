import { app, BrowserWindow, Menu, ipcMain, dialog, shell, nativeImage } from 'electron';
import * as path from 'path';
import { registerGitIpc } from './ipc/git.js';
import { registerFsIpc } from './ipc/fs.js';
import { registerGithubIpc } from './ipc/github.js';
import { registerWindowIpc } from './ipc/window.js';
import { registerSettingsIpc } from './ipc/settings.js';
import { registerWatcherIpc, stopAllWatchers } from './services/watcher.js';
import { SimpleStore } from './services/simpleStore.js';
import { buildAppMenu } from './menu.js';

const isDev = !!process.env.VITE_DEV_SERVER_URL;

// Window state persistence
interface WindowState {
  bounds?: { x: number; y: number; width: number; height: number };
  isMaximized?: boolean;
  isFullScreen?: boolean;
}

const windowStateStore = new SimpleStore({
  name: 'smartgit-window-state',
  defaults: {},
});

let mainWindow: BrowserWindow | null = null;

function getWindowState(): WindowState {
  if (!mainWindow) return {};
  const bounds = mainWindow.getBounds();
  return {
    bounds,
    isMaximized: mainWindow.isMaximized(),
    isFullScreen: mainWindow.isFullScreen(),
  };
}

function saveWindowState(): void {
  if (!mainWindow) return;
  windowStateStore.set('windowState', getWindowState());
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
    backgroundColor: '#0b0e14',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    title: 'SmartGit Electron',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
    show: false,
    trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 14 } : undefined,
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
    if (!mainWindow) return null;
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
    if (mainWindow) {
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
  registerWindowIpc();
  registerSettingsIpc();
  registerWatcherIpc();
  registerContextMenuIpc();

  // Build app menu
  Menu.setApplicationMenu(buildAppMenu(() => mainWindow));

  mainWindow = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

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
  if (!mainWindow) return null;
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
