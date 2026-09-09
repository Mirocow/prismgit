import { ipcMain } from 'electron';
import * as storage from '../services/storage.js';

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', (_e, key: string) => storage.getSetting(key));
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) =>
    storage.setSetting(key, value)
  );
  ipcMain.handle('settings:getAll', () => storage.getAllSettings());
  ipcMain.handle('settings:getRepos', () => storage.getRepos());
  ipcMain.handle('settings:addRepo', (_e, repo: { path: string; name: string }) =>
    storage.addRepo(repo)
  );
  ipcMain.handle('settings:removeRepo', (_e, path: string) => storage.removeRepo(path));
  ipcMain.handle('settings:updateRepo', (_e, path: string, updates: Record<string, unknown>) =>
    storage.updateRepo(path, updates)
  );
}
