import { ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, exec } from 'child_process';

export function registerFsIpc(): void {
  ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return '';
    }
  });

  ipcMain.handle('fs:writeFile', async (_e, filePath: string, content: string) => {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  });

  ipcMain.handle('fs:pathBasename', (_e, p: string) => path.basename(p));
  ipcMain.handle('fs:pathDirname', (_e, p: string) => path.dirname(p));

  // Open a terminal emulator in the given directory (SmartGit "Open in Terminal")
  ipcMain.handle('fs:openTerminal', async (_e, dirPath: string) => {
    try {
      const platform = process.platform;
      if (platform === 'darwin') {
        spawn('open', ['-a', 'Terminal', dirPath], { detached: true, stdio: 'ignore' }).unref();
        return true;
      }
      if (platform === 'win32') {
        spawn('cmd.exe', ['/c', 'start', 'cmd', '/K', `cd /d "${dirPath}"`], { detached: true, stdio: 'ignore', shell: true }).unref();
        return true;
      }
      // Linux: try known terminal emulators in order
      const candidates: Array<{ cmd: string; args: string[] }> = [
        { cmd: 'x-terminal-emulator', args: [`--working-directory=${dirPath}`] },
        { cmd: 'gnome-terminal', args: [`--working-directory=${dirPath}`] },
        { cmd: 'konsole', args: ['--workdir', dirPath] },
        { cmd: 'xfce4-terminal', args: [`--working-directory=${dirPath}`] },
        { cmd: 'alacritty', args: ['--working-directory', dirPath] },
        { cmd: 'kitty', args: ['--directory', dirPath] },
        { cmd: 'xterm', args: ['-e', `cd "${dirPath}" && exec bash`] },
      ];
      for (const c of candidates) {
        try {
          exec(`command -v ${c.cmd}`, (err, stdout) => {
            if (!err && stdout.trim()) {
              spawn(c.cmd, c.args, { detached: true, stdio: 'ignore', cwd: dirPath }).unref();
            }
          });
        } catch { /* try next */ }
      }
      // Best-effort synchronous check so we can report failure
      const which = (() => {
        try {
          return execSyncShort(candidates);
        } catch {
          return null;
        }
      })();
      if (!which) {
        await shell.openPath(dirPath);
        return true;
      }
      return true;
    } catch {
      return false;
    }
  });
}

function execSyncShort(candidates: Array<{ cmd: string }>): string | null {
  const { execSync } = require('child_process') as typeof import('child_process');
  for (const c of candidates) {
    try {
      const out = execSync(`command -v ${c.cmd} 2>/dev/null`, { encoding: 'utf-8' });
      if (out.trim()) return c.cmd;
    } catch { /* next */ }
  }
  return null;
}
