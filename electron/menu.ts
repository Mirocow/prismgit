import { Menu, type BrowserWindow, shell, app, dialog } from 'electron';
import * as path from 'path';
import { openAboutWindow } from './about.js';
import { menuT as m } from './i18n-menu.js';

export function buildAppMenu(getMainWindow: () => BrowserWindow | null): Menu {
  const isMac = process.platform === 'darwin';

  const send = (channel: string, ...args: unknown[]) => {
    getMainWindow()?.webContents.send(channel, ...args);
  };

  const infoBox = (title: string, message: string) => {
    const win = getMainWindow();
    if (!win) return;
    dialog.showMessageBox(win, { type: 'info', title, message: title, detail: message.slice(0, 4000), buttons: [m('common.ok')] });
  };

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            {
              label: m('menu.help.about'),
              click: () => openAboutWindow(),
            },
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
      label: m('menu.repository'),
      submenu: [
        {
          label: m('menu.repository.open'),
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const win = getMainWindow();
            if (!win) return;
            const result = await dialog.showOpenDialog(win, {
              properties: ['openDirectory'],
              title: m('menu.repository.openTitle'),
            });
            if (!result.canceled && result.filePaths.length > 0) {
              send('menu:openRepository', result.filePaths[0]);
            }
          },
        },
        {
          label: m('menu.repository.clone'),
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => send('menu:cloneRepository'),
        },
        {
          label: m('menu.repository.addOrCreate'),
          click: () => send('menu:initRepository'),
        },
        { type: 'separator' },
        {
          label: m('menu.repository.settings'),
          click: () => send('menu:repoSettings'),
        },
        {
          label: m('menu.repository.editGitConfig'),
          click: () => send('menu:editGitConfig'),
        },
        { type: 'separator' },
        {
          label: m('menu.repository.openTerminal'),
          click: () => send('menu:openTerminal'),
        },
        {
          label: m('menu.repository.openVscode'),
          click: () => send('menu:openInVscode'),
        },
        { type: 'separator' },
        {
          label: m('menu.repository.commit'),
          accelerator: 'CmdOrCtrl+Enter',
          click: () => send('menu:commit'),
        },
        {
          label: m('menu.repository.push'),
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => send('menu:push'),
        },
        {
          label: m('menu.repository.pull'),
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => send('menu:pull'),
        },
        {
          label: m('menu.repository.fetch'),
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => send('menu:fetch'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    {
      label: m('menu.edit'),
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
          label: m('menu.edit.preferences'),
          accelerator: 'CmdOrCtrl+,',
          click: () => send('menu:preferences'),
        },
      ],
    },
    {
      label: m('menu.view'),
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
          label: m('menu.view.toggleTheme'),
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => send('menu:toggleTheme'),
        },
        {
          label: m('menu.view.toggleOutput'),
          accelerator: 'CmdOrCtrl+Shift+U',
          click: () => send('menu:commandLog'),
        },
        {
          label: m('menu.view.keyboardShortcuts'),
          accelerator: 'CmdOrCtrl+/',
          click: () => send('menu:showShortcuts'),
        },
        { type: 'separator' },
        {
          label: m('menu.view.goDeepLink'),
          // Was Ctrl+Shift+L — collides with Pull (Repository menu); one
          // keystroke could dispatch BOTH items (duplicate accelerator).
          accelerator: 'CmdOrCtrl+Shift+K',
          click: () => send('menu:goDeepLink'),
        },
        {
          label: m('menu.view.copyDeepLink'),
          click: () => send('menu:copyDeepLink'),
        },
      ],
    },
    {
      label: m('menu.branch'),
      submenu: [
        { label: m('menu.branch.checkout'), accelerator: 'CmdOrCtrl+G', click: () => send('menu:checkout') },
        { type: 'separator' },
        { label: m('menu.branch.merge'), click: () => send('menu:merge') },
        { label: m('menu.branch.rebase'), accelerator: 'CmdOrCtrl+D', click: () => send('menu:rebase') },
        { label: m('menu.branch.interactiveRebase'), accelerator: 'CmdOrCtrl+Shift+R', click: () => send('menu:interactiveRebase') },
        { label: m('menu.branch.cherryPick'), click: () => send('menu:cherryPick') },
        { label: m('menu.branch.revert'), click: () => send('menu:revert') },
        { type: 'separator' },
        { label: m('menu.branch.addBranch'), accelerator: 'F7', click: () => send('menu:newBranch') },
        { label: m('menu.branch.addTag'), accelerator: 'Shift+F7', click: () => send('menu:addTag') },
        { type: 'separator' },
        { label: m('menu.branch.setTracked'), click: () => send('menu:setTracked') },
        { label: m('menu.branch.stopTracking'), click: () => send('menu:stopTracking') },
        { type: 'separator' },
        {
          label: m('menu.branch.bisect'),
          submenu: [
            { label: m('menu.branch.bisect.start'), click: () => send('menu:bisectStart') },
            { label: m('menu.branch.bisect.markBad'), click: () => send('menu:bisectBad') },
            { label: m('menu.branch.bisect.markGood'), click: () => send('menu:bisectGood') },
            { label: m('menu.branch.bisect.skip'), click: () => send('menu:bisectSkip') },
            { type: 'separator' },
            { label: m('menu.branch.bisect.reset'), click: () => send('menu:bisectReset') },
            { label: m('menu.branch.bisect.log'), click: () => send('menu:bisectLog') },
          ],
        },
        {
          label: m('menu.branch.gitFlow'),
          submenu: [
            { label: m('menu.branch.gitFlow.configure'), accelerator: 'CmdOrCtrl+Shift+G', click: () => send('menu:gitFlow') },
            { type: 'separator' },
            { label: m('menu.branch.gitFlow.startFeature'), click: () => send('menu:gitFlowStartFeature') },
            { label: m('menu.branch.gitFlow.finishFeature'), click: () => send('menu:gitFlowFinishFeature') },
            { label: m('menu.branch.gitFlow.integrateDevelop'), click: () => send('menu:gitFlowIntegrateDevelop') },
            { type: 'separator' },
            { label: m('menu.branch.gitFlow.startRelease'), click: () => send('menu:gitFlowStartRelease') },
            { label: m('menu.branch.gitFlow.finishRelease'), click: () => send('menu:gitFlowFinishRelease') },
            { label: m('menu.branch.gitFlow.startHotfix'), click: () => send('menu:gitFlowStartHotfix') },
            { label: m('menu.branch.gitFlow.finishHotfix'), click: () => send('menu:gitFlowFinishHotfix') },
          ],
        },
        { type: 'separator' },
        { label: m('menu.branch.abort'), click: () => send('menu:abortSequence') },
        { label: m('menu.branch.continue'), click: () => send('menu:continueSequence') },
        { label: m('menu.branch.skipSequence'), click: () => send('menu:skipSequence') },
      ],
    },
    {
      label: m('menu.local'),
      submenu: [
        { label: m('menu.local.stage'), accelerator: 'CmdOrCtrl+Shift+A', click: () => send('menu:stage') },
        { label: m('menu.local.unstage'), click: () => send('menu:unstage') },
        { label: m('menu.local.stageAll'), click: () => send('menu:stageAll') },
        { label: m('menu.local.discard'), click: () => send('menu:discard') },
        { type: 'separator' },
        { label: m('menu.local.editLastMessage'), click: () => send('menu:editLastCommitMessage') },
        { label: m('menu.local.editAuthor'), click: () => send('menu:editCommitAuthor') },
        { label: m('menu.local.undoLastCommit'), click: () => send('menu:undoLastCommit') },
        { type: 'separator' },
        { label: m('menu.local.stashAll'), accelerator: 'CmdOrCtrl+Alt+S', click: () => send('menu:stash') },
        { label: m('menu.local.stashSelection'), click: () => send('menu:stashSelection') },
        { label: m('menu.local.applyStash'), click: () => send('menu:applyStash') },
        { type: 'separator' },
        { label: m('menu.local.indexEditor'), click: () => send('menu:indexEditor') },
        { type: 'separator' },
        { label: m('menu.local.ignore'), click: () => send('menu:ignore') },
        { label: m('menu.local.editIgnoreFile'), click: () => send('menu:editIgnoreFile') },
        { label: m('menu.local.assumeUnchanged'), click: () => send('menu:assumeUnchanged') },
        { label: m('menu.local.skipWorktree'), click: () => send('menu:skipWorktree') },
        { type: 'separator' },
        { label: m('menu.local.moveRename'), accelerator: 'F6', click: () => send('menu:moveRename') },
        { label: m('menu.local.delete'), click: () => send('menu:deleteFile') },
        { label: m('menu.local.removeKeepWT'), click: () => send('menu:removeFile') },
        { type: 'separator' },
        {
          label: m('menu.local.resolve'),
          submenu: [
            { label: m('menu.local.resolve.solver'), accelerator: 'CmdOrCtrl+Alt+M', click: () => send('menu:conflictSolver') },
            { label: m('menu.local.resolve.theirs'), click: () => send('menu:resolveTheirs') },
            { label: m('menu.local.resolve.ours'), click: () => send('menu:resolveOurs') },
            { label: m('menu.local.resolve.markResolved'), click: () => send('menu:markResolved') },
          ],
        },
        { type: 'separator' },
        {
          label: m('menu.local.lfs'),
          submenu: [
            { label: m('menu.local.lfs.install'), click: () => send('menu:lfsInstall') },
            { label: m('menu.local.lfs.track'), click: () => send('menu:lfsTrack') },
            { label: m('menu.local.lfs.lock'), click: () => send('menu:lfsLock') },
            { label: m('menu.local.lfs.unlock'), click: () => send('menu:lfsUnlock') },
            { type: 'separator' },
            { label: m('menu.local.lfs.openPage'), click: () => send('menu:navigate', '/lfs') },
          ],
        },
      ],
    },
    {
      label: m('menu.remote'),
      submenu: [
        // No accelerator: Ctrl+Shift+P belongs to Push (Repository menu) —
        // a duplicate here made one keystroke trigger both items.
        { label: m('menu.remote.pushTo'), click: () => send('menu:pushTo') },
        { label: m('menu.remote.pullOptions'), accelerator: 'CmdOrCtrl+Down', click: () => send('menu:pullOptions') },
        { label: m('menu.remote.fetchAllRemotes'), click: () => send('menu:fetchAll') },
        { label: m('menu.remote.fetchMore'), click: () => send('menu:fetchMore') },
        { label: m('menu.remote.setDepth'), click: () => send('menu:setDepth') },
        { type: 'separator' },
        { label: m('menu.remote.add'), click: () => send('menu:remoteAdd') },
        { label: m('menu.remote.rename'), click: () => send('menu:remoteRename') },
        { label: m('menu.remote.delete'), click: () => send('menu:remoteDelete') },
        { label: m('menu.remote.properties'), click: () => send('menu:remoteProperties') },
        { type: 'separator' },
        {
          label: m('menu.remote.subtree'),
          submenu: [
            { label: m('menu.remote.subtree.add'), click: () => send('menu:navigate', '/subtrees') },
            { label: m('menu.remote.subtree.openPage'), click: () => send('menu:navigate', '/subtrees') },
          ],
        },
        { label: m('menu.remote.managePage'), click: () => send('menu:navigate', '/remotes') },
      ],
    },
    {
      label: m('menu.query'),
      submenu: [
        { label: m('menu.query.log'), accelerator: 'CmdOrCtrl+L', click: () => send('menu:navigate', '/history') },
        { label: m('menu.query.blame'), click: () => send('menu:navigate', '/blame') },
        { label: m('menu.query.investigate'), click: () => send('menu:navigate', '/search') },
        { label: m('menu.query.journal'), click: () => send('menu:navigate', '/journal') },
        { label: m('menu.query.reflog'), click: () => send('menu:navigate', '/reflog') },
        { label: m('menu.query.notes'), click: () => send('menu:navigate', '/notes') },
        { type: 'separator' },
        { label: m('menu.query.findObject'), accelerator: 'CmdOrCtrl+F', click: () => send('menu:findObject') },
        { label: m('menu.query.solver'), click: () => send('menu:conflictSolver') },
        { type: 'separator' },
        { label: m('menu.query.verifyDatabase'), click: () => send('menu:verifyDatabase') },
        { label: m('menu.query.garbageCollect'), click: () => send('menu:garbageCollect') },
      ],
    },
    {
      label: m('menu.tools'),
      submenu: [
        { label: m('menu.tools.openTerminal'), click: () => send('menu:openTerminal') },
        // No accelerator: Ctrl+Shift+U belongs to View → Toggle Output Panel
        // (same menu:commandLog event — two registrations fired it twice).
        { label: m('menu.tools.openCommandLog'), click: () => send('menu:commandLog') },
        { type: 'separator' },
        { label: m('menu.tools.applyPatch'), click: () => send('menu:applyPatch') },
        { label: m('menu.tools.formatPatch'), click: () => send('menu:formatPatch') },
      ],
    },
    {
      label: m('menu.window'),
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ type: 'separator' as const }, { role: 'close' as const }]),
        { type: 'separator' },
        {
          label: m('menu.window.style'),
          submenu: [
            { label: m('menu.window.style.standard'), accelerator: 'CmdOrCtrl+Shift+1', click: () => send('menu:windowStyle', 'standard') },
            { label: m('menu.window.style.log'), accelerator: 'CmdOrCtrl+Shift+2', click: () => send('menu:windowStyle', 'log') },
            { label: m('menu.window.style.workingTree'), accelerator: 'CmdOrCtrl+Shift+3', click: () => send('menu:windowStyle', 'working-tree') },
          ],
        },
        {
          label: m('menu.window.resetPerspective'),
          click: () => send('menu:resetPerspective'),
        },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: m('menu.help.documentation'),
          click: () => shell.openExternal('https://git-scm.com/docs'),
        },
        {
          label: m('menu.help.smartgitManual'),
          click: () => shell.openExternal('https://docs.syntevo.com/SmartGit/Latest/Manual/'),
        },
        { type: 'separator' },
        {
          id: 'help-about',
          label: m('menu.help.about'),
          click: () => {
            openAboutWindow();
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
