import { ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, execFile } from 'child_process';

export function registerFsIpc(): void {
  // PERF (v3.7, perf-readiness audit): async FS only — the sync variants
  // blocked the MAIN event loop for as long as the disk took on large files
  // (diff views / large blobs read through this channel).
  ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
    try {
      return await fs.promises.readFile(filePath, 'utf8');
    } catch {
      return '';
    }
  });

  ipcMain.handle('fs:writeFile', async (_e, filePath: string, content: string) => {
    await fs.promises.writeFile(filePath, content, 'utf8');
    return true;
  });

  ipcMain.handle('fs:pathBasename', (_e, p: string) => path.basename(p));
  ipcMain.handle('fs:pathDirname', (_e, p: string) => path.dirname(p));

  // Synchronous existence check — one IPC round-trip, ZERO git subprocesses.
  // PERF (v3.1): used by the renderer to gate expensive scans that are
  // pointless without their config file (e.g. `git submodule summary` on
  // repos without .gitmodules — ~99% of repos — always outputs nothing,
  // but still spawns a git process that scans the worktree).
  ipcMain.handle('fs:exists', (_e, p: string) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });

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
      // Linux: ONE non-blocking `command -v` probe for ALL candidates (v3.7,
      // perf-readiness audit). The old code fired 7 async exec() probes (each
      // spawning a terminal when found — several terminals could open at once)
      // PLUS a 7-command execSync() sweep that blocked the main event loop.
      const candidates: Array<{ cmd: string; args: string[] }> = [
        { cmd: 'x-terminal-emulator', args: [`--working-directory=${dirPath}`] },
        { cmd: 'gnome-terminal', args: [`--working-directory=${dirPath}`] },
        { cmd: 'konsole', args: ['--workdir', dirPath] },
        { cmd: 'xfce4-terminal', args: [`--working-directory=${dirPath}`] },
        { cmd: 'alacritty', args: ['--working-directory', dirPath] },
        { cmd: 'kitty', args: ['--directory', dirPath] },
        { cmd: 'xterm', args: ['-e', `cd "${dirPath}" && exec bash`] },
      ];
      // execFile with our own hardcoded names (no user input in the command
      // string) — no shell wrap around interpolated paths, 2 s timeout.
      const found = await new Promise<Set<string>>((resolve) => {
        const names = candidates.map((c) => c.cmd).join(' ');
        execFile('sh', ['-c', `command -v ${names}`], { timeout: 2000 }, (err, stdout) => {
          const set = new Set<string>();
          if (!err && stdout) {
            for (const line of String(stdout).split('\n')) {
              const name = path.basename(line.trim());
              if (name) set.add(name);
            }
          }
          resolve(set);
        });
      });
      // Open exactly ONE terminal: the first candidate in priority order.
      for (const c of candidates) {
        if (found.has(c.cmd)) {
          spawn(c.cmd, c.args, { detached: true, stdio: 'ignore', cwd: dirPath }).unref();
          return true;
        }
      }
      // None of the known terminals installed — let the OS file manager show it.
      await shell.openPath(dirPath);
      return true;
    } catch {
      return false;
    }
  });
}
