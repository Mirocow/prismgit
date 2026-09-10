import { ipcMain } from 'electron';
import { listEntries, clearEntries } from '../services/commandLog.js';
import type { CommandLogEntry } from '../types/command-log-api.js';

/**
 * IPC surface for the raw git command log (Output panel → "Commands" tab).
 * The ring buffer lives in the main process; the renderer pulls the initial
 * list via command-log:list and receives live entries via the
 * 'command-log:entry' broadcast (sent by main.ts on every recorded entry).
 */
export function registerCommandLogIpc(): void {
  ipcMain.handle('command-log:list', (): CommandLogEntry[] => listEntries());
  ipcMain.handle('command-log:clear', (): void => {
    clearEntries();
  });
}
