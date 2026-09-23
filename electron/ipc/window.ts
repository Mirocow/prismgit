import { ipcMain, BrowserWindow } from 'electron';

export function registerWindowIpc(): void {
  ipcMain.on('window:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });

  // BUGFIX "тёмные темы не адаптированы": keep the NATIVE window background
  // in sync with the active theme (dark themes must not flash/resize through
  // a white frame). Color is validated — only #rrggbb hex is accepted.
  ipcMain.on('window:setBackgroundColor', (e, color: unknown) => {
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return;
    try {
      BrowserWindow.fromWebContents(e.sender)?.setBackgroundColor(color);
    } catch {
      /* window may already be destroyed — ignore */
    }
  });

  ipcMain.on('window:maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.on('window:close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close();
  });

  ipcMain.handle('window:isMaximized', (e) => {
    return BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false;
  });

  ipcMain.on('app:openExternal', (_e, url: string) => {
    const { shell } = require('electron');
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url);
    }
  });

  // Listen for maximize changes
  ipcMain.on('window:subscribeMaximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    win.on('maximize', () => {
      win.webContents.send('window:maximizeChanged', true);
    });
    win.on('unmaximize', () => {
      win.webContents.send('window:maximizeChanged', false);
    });
  });
}
