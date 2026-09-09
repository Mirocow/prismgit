import { Menu, type BrowserWindow, shell, app, dialog } from 'electron';
import * as path from 'path';

export function buildAppMenu(getMainWindow: () => BrowserWindow | null): Menu {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Repository...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const win = getMainWindow();
            if (!win) return;
            const result = await dialog.showOpenDialog(win, {
              properties: ['openDirectory'],
              title: 'Open Repository',
            });
            if (!result.canceled && result.filePaths.length > 0) {
              win.webContents.send('menu:openRepository', result.filePaths[0]);
            }
          },
        },
        {
          label: 'Clone Repository...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            getMainWindow()?.webContents.send('menu:cloneRepository');
          },
        },
        {
          label: 'Init New Repository...',
          click: () => {
            getMainWindow()?.webContents.send('menu:initRepository');
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        {
          label: 'Toggle Theme',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => {
            getMainWindow()?.webContents.send('menu:toggleTheme');
          },
        },
      ],
    },
    {
      label: 'Repository',
      submenu: [
        {
          label: 'Commit...',
          accelerator: 'CmdOrCtrl+Enter',
          click: () => getMainWindow()?.webContents.send('menu:commit'),
        },
        {
          label: 'Push...',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => getMainWindow()?.webContents.send('menu:push'),
        },
        {
          label: 'Pull...',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => getMainWindow()?.webContents.send('menu:pull'),
        },
        {
          label: 'Fetch',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => getMainWindow()?.webContents.send('menu:fetch'),
        },
        { type: 'separator' },
        {
          label: 'Git-Flow...',
          accelerator: 'CmdOrCtrl+Shift+G',
          click: () => getMainWindow()?.webContents.send('menu:gitFlow'),
        },
        {
          label: 'Interactive Rebase...',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => getMainWindow()?.webContents.send('menu:interactiveRebase'),
        },
        { type: 'separator' },
        {
          label: 'New Branch...',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => getMainWindow()?.webContents.send('menu:newBranch'),
        },
        {
          label: 'Stash Changes',
          accelerator: 'CmdOrCtrl+Alt+S',
          click: () => getMainWindow()?.webContents.send('menu:stash'),
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://git-scm.com/docs'),
        },
        {
          label: 'SmartGit Electron on GitHub',
          click: () => shell.openExternal('https://github.com'),
        },
        {
          label: 'About',
          click: () => {
            const win = getMainWindow();
            if (!win) return;
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'About SmartGit Electron',
              message: 'SmartGit Electron',
              detail: `Version: ${app.getVersion()}\nElectron-based Git client\n\nPlatform: ${process.platform}\nArchitecture: ${process.arch}`,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
