import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export function registerFsIpc(): void {
  ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return '';
    }
  });

  ipcMain.handle('fs:pathBasename', (_e, p: string) => path.basename(p));
  ipcMain.handle('fs:pathDirname', (_e, p: string) => path.dirname(p));
}
