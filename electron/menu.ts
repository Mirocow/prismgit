import { Menu, type BrowserWindow, shell, app, dialog } from 'electron';
import * as path from 'path';

export function buildAppMenu(getMainWindow: () => BrowserWindow | null): Menu {
  const isMac = process.platform === 'darwin';

  const send = (channel: string, ...args: unknown[]) => {
    getMainWindow()?.webContents.send(channel, ...args);
  };

  const infoBox = (title: string, message: string) => {
    const win = getMainWindow();
    if (!win) return;
    dialog.showMessageBox(win, { type: 'info', title, message: title, detail: message.slice(0, 4000), buttons: ['OK'] });
  };

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
      label: 'Repository',
      submenu: [
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const win = getMainWindow();
            if (!win) return;
            const result = await dialog.showOpenDialog(win, {
              properties: ['openDirectory'],
              title: 'Open Repository',
            });
            if (!result.canceled && result.filePaths.length > 0) {
              send('menu:openRepository', result.filePaths[0]);
            }
          },
        },
        {
          label: 'Clone...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => send('menu:cloneRepository'),
        },
        {
          label: 'Add or Create...',
          click: () => send('menu:initRepository'),
        },
        { type: 'separator' },
        {
          label: 'Settings...',
          click: () => send('menu:repoSettings'),
        },
        {
          label: 'Edit Git Config',
          click: () => send('menu:editGitConfig'),
        },
        { type: 'separator' },
        {
          label: 'Open in Terminal',
          click: () => send('menu:openTerminal'),
        },
        { type: 'separator' },
        {
          label: 'Commit...',
          accelerator: 'CmdOrCtrl+Enter',
          click: () => send('menu:commit'),
        },
        {
          label: 'Push...',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => send('menu:push'),
        },
        {
          label: 'Pull...',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => send('menu:pull'),
        },
        {
          label: 'Fetch',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => send('menu:fetch'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
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
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'CmdOrCtrl+,',
          click: () => send('menu:preferences'),
        },
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
          click: () => send('menu:toggleTheme'),
        },
        {
          label: 'Toggle Output Panel',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: () => send('menu:commandLog'),
        },
        {
          label: 'Keyboard Shortcuts...',
          accelerator: 'CmdOrCtrl+/',
          click: () => send('menu:showShortcuts'),
        },
      ],
    },
    {
      label: 'Branch',
      submenu: [
        { label: 'Check Out...', accelerator: 'CmdOrCtrl+G', click: () => send('menu:checkout') },
        { type: 'separator' },
        { label: 'Merge...', click: () => send('menu:merge') },
        { label: 'Rebase...', accelerator: 'CmdOrCtrl+D', click: () => send('menu:rebase') },
        { label: 'Interactive Rebase...', accelerator: 'CmdOrCtrl+Shift+R', click: () => send('menu:interactiveRebase') },
        { label: 'Cherry-Pick...', click: () => send('menu:cherryPick') },
        { label: 'Revert...', click: () => send('menu:revert') },
        { type: 'separator' },
        { label: 'Add Branch...', accelerator: 'F7', click: () => send('menu:newBranch') },
        { label: 'Add Tag...', accelerator: 'Shift+F7', click: () => send('menu:addTag') },
        { type: 'separator' },
        { label: 'Set Tracked Branch...', click: () => send('menu:setTracked') },
        { label: 'Stop Tracking', click: () => send('menu:stopTracking') },
        { type: 'separator' },
        {
          label: 'Bisect',
          submenu: [
            { label: 'Start (Bad HEAD)', click: () => send('menu:bisectStart') },
            { label: 'Mark HEAD as Bad', click: () => send('menu:bisectBad') },
            { label: 'Mark HEAD as Good', click: () => send('menu:bisectGood') },
            { label: 'Skip current commit', click: () => send('menu:bisectSkip') },
            { type: 'separator' },
            { label: 'Reset (finish bisect)', click: () => send('menu:bisectReset') },
            { label: 'Show Bisect Log', click: () => send('menu:bisectLog') },
          ],
        },
        {
          label: 'Git-Flow',
          submenu: [
            { label: 'Configure...', accelerator: 'CmdOrCtrl+Shift+G', click: () => send('menu:gitFlow') },
            { type: 'separator' },
            { label: 'Start Feature...', click: () => send('menu:gitFlowStartFeature') },
            { label: 'Finish Feature...', click: () => send('menu:gitFlowFinishFeature') },
            { label: 'Integrate Develop', click: () => send('menu:gitFlowIntegrateDevelop') },
            { type: 'separator' },
            { label: 'Start Release...', click: () => send('menu:gitFlowStartRelease') },
            { label: 'Finish Release...', click: () => send('menu:gitFlowFinishRelease') },
            { label: 'Start Hotfix...', click: () => send('menu:gitFlowStartHotfix') },
            { label: 'Finish Hotfix...', click: () => send('menu:gitFlowFinishHotfix') },
          ],
        },
        { type: 'separator' },
        { label: 'Abort (merge/rebase/cherry-pick/revert)', click: () => send('menu:abortSequence') },
        { label: 'Continue (resolve conflicts first)', click: () => send('menu:continueSequence') },
      ],
    },
    {
      label: 'Local',
      submenu: [
        { label: 'Stage', accelerator: 'CmdOrCtrl+Shift+A', click: () => send('menu:stage') },
        { label: 'Unstage', click: () => send('menu:unstage') },
        { label: 'Stage All', click: () => send('menu:stageAll') },
        { label: 'Discard...', click: () => send('menu:discard') },
        { type: 'separator' },
        { label: 'Edit Last Commit Message', click: () => send('menu:editLastCommitMessage') },
        { label: 'Edit Commit Author...', click: () => send('menu:editCommitAuthor') },
        { label: 'Undo Last Commit', click: () => send('menu:undoLastCommit') },
        { type: 'separator' },
        { label: 'Stash All...', accelerator: 'CmdOrCtrl+Alt+S', click: () => send('menu:stash') },
        { label: 'Stash Selection...', click: () => send('menu:stashSelection') },
        { label: 'Apply Stash...', click: () => send('menu:applyStash') },
        { type: 'separator' },
        { label: 'Index Editor...', click: () => send('menu:indexEditor') },
        { type: 'separator' },
        { label: 'Ignore', click: () => send('menu:ignore') },
        { label: 'Edit Ignore File (.gitignore)', click: () => send('menu:editIgnoreFile') },
        { label: "Toggle 'Assume Unchanged'", click: () => send('menu:assumeUnchanged') },
        { label: "Toggle 'Skip Worktree'", click: () => send('menu:skipWorktree') },
        { type: 'separator' },
        { label: 'Move or Rename...', accelerator: 'F6', click: () => send('menu:moveRename') },
        { label: 'Delete...', click: () => send('menu:deleteFile') },
        { label: 'Remove (keep in Working Tree)', click: () => send('menu:removeFile') },
        { type: 'separator' },
        {
          label: 'Resolve',
          submenu: [
            { label: 'Conflict Solver...', accelerator: 'CmdOrCtrl+Alt+M', click: () => send('menu:conflictSolver') },
            { label: 'Take Theirs', click: () => send('menu:resolveTheirs') },
            { label: 'Take Ours', click: () => send('menu:resolveOurs') },
            { label: 'Mark Resolved', click: () => send('menu:markResolved') },
          ],
        },
        { type: 'separator' },
        {
          label: 'LFS',
          submenu: [
            { label: 'Install', click: () => send('menu:lfsInstall') },
            { label: 'Track...', click: () => send('menu:lfsTrack') },
            { label: 'Lock...', click: () => send('menu:lfsLock') },
            { label: 'Unlock...', click: () => send('menu:lfsUnlock') },
            { type: 'separator' },
            { label: 'Open LFS Page', click: () => send('menu:navigate', '/lfs') },
          ],
        },
      ],
    },
    {
      label: 'Remote',
      submenu: [
        { label: 'Push To...', accelerator: 'Shift+CmdOrCtrl+P', click: () => send('menu:pushTo') },
        { label: 'Pull Options...', accelerator: 'CmdOrCtrl+Down', click: () => send('menu:pullOptions') },
        { label: 'Fetch All Remotes', click: () => send('menu:fetchAll') },
        { label: 'Fetch More...', click: () => send('menu:fetchMore') },
        { label: 'Set Depth...', click: () => send('menu:setDepth') },
        { type: 'separator' },
        { label: 'Add...', click: () => send('menu:remoteAdd') },
        { label: 'Rename...', click: () => send('menu:remoteRename') },
        { label: 'Delete', click: () => send('menu:remoteDelete') },
        { label: 'Properties...', click: () => send('menu:remoteProperties') },
        { type: 'separator' },
        {
          label: 'Subtree',
          submenu: [
            { label: 'Add...', click: () => send('menu:navigate', '/subtrees') },
            { label: 'Open Subtrees Page', click: () => send('menu:navigate', '/subtrees') },
          ],
        },
        { label: 'Manage Remotes Page', click: () => send('menu:navigate', '/remotes') },
      ],
    },
    {
      label: 'Query',
      submenu: [
        { label: 'Log', accelerator: 'CmdOrCtrl+L', click: () => send('menu:navigate', '/history') },
        { label: 'Blame...', click: () => send('menu:navigate', '/blame') },
        { label: 'Investigate (Search)', click: () => send('menu:navigate', '/search') },
        { label: 'Journal', click: () => send('menu:navigate', '/journal') },
        { label: 'Reflog', click: () => send('menu:navigate', '/reflog') },
        { label: 'Notes', click: () => send('menu:navigate', '/notes') },
        { type: 'separator' },
        { label: 'Find Object...', accelerator: 'CmdOrCtrl+F', click: () => send('menu:findObject') },
        { label: 'Conflict Solver...', click: () => send('menu:conflictSolver') },
        { type: 'separator' },
        { label: 'Verify Database...', click: () => send('menu:verifyDatabase') },
        { label: 'Garbage Collect', click: () => send('menu:garbageCollect') },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        { label: 'Open Terminal', click: () => send('menu:openTerminal') },
        { label: 'Open Command Log', accelerator: 'CmdOrCtrl+Shift+U', click: () => send('menu:commandLog') },
        { type: 'separator' },
        { label: 'Apply Patch...', click: () => send('menu:applyPatch') },
        { label: 'Format Patch...', click: () => send('menu:formatPatch') },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ type: 'separator' as const }, { role: 'close' as const }]),
        { type: 'separator' },
        {
          label: 'Window Style',
          submenu: [
            { label: 'Standard Window', accelerator: 'CmdOrCtrl+Shift+1', click: () => send('menu:windowStyle', 'standard') },
            { label: 'Log Window', accelerator: 'CmdOrCtrl+Shift+2', click: () => send('menu:windowStyle', 'log') },
            { label: 'Working Tree Window', accelerator: 'CmdOrCtrl+Shift+3', click: () => send('menu:windowStyle', 'working-tree') },
          ],
        },
        {
          label: 'Reset Perspective',
          click: () => send('menu:resetPerspective'),
        },
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
          label: 'SmartGit Manual (feature reference)',
          click: () => shell.openExternal('https://docs.syntevo.com/SmartGit/Latest/Manual/'),
        },
        { type: 'separator' },
        {
          label: 'About',
          click: () => {
            const win = getMainWindow();
            if (!win) return;
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'About PrismGit',
              message: 'PrismGit',
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
