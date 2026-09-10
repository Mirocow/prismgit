import { ipcMain } from 'electron';
import * as storage from '../services/storage.js';

export function registerSettingsIpc(): void {
  // Settings
  ipcMain.handle('settings:get', (_e, key: string) => storage.getSetting(key));
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) =>
    storage.setSetting(key, value)
  );
  ipcMain.handle('settings:getAll', () => storage.getAllSettings());

  // Repository list
  ipcMain.handle('settings:getRepos', () => storage.getRepos());
  ipcMain.handle('settings:addRepo', (_e, repo: { path: string; name: string }) =>
    storage.addRepo(repo)
  );
  ipcMain.handle('settings:removeRepo', (_e, path: string) => storage.removeRepo(path));
  ipcMain.handle('settings:updateRepo', (_e, path: string, updates: Record<string, unknown>) =>
    storage.updateRepo(path, updates)
  );

  // Repository metadata
  ipcMain.handle('settings:getRepoMetadata', (_e, path: string) => storage.getRepoMetadata(path));
  ipcMain.handle('settings:getRepoMetadataAll', () => storage.getRepoMetadataAll());
  ipcMain.handle('settings:setRepoMetadata', (_e, path: string, metadata) =>
    storage.setRepoMetadata(path, metadata)
  );
  ipcMain.handle('settings:updateRepoMetadata', (_e, path: string, updates) =>
    storage.updateRepoMetadata(path, updates)
  );
  ipcMain.handle('settings:deleteRepoMetadata', (_e, path: string) =>
    storage.deleteRepoMetadata(path)
  );
  ipcMain.handle('settings:toggleFavorite', (_e, path: string) => storage.toggleFavorite(path));
  ipcMain.handle('settings:addTag', (_e, path: string, tag: string) => storage.addTag(path, tag));
  ipcMain.handle('settings:removeTag', (_e, path: string, tag: string) => storage.removeTag(path, tag));
  ipcMain.handle('settings:refreshRepoStats', (_e, path: string) => storage.refreshRepoStats(path));
}
