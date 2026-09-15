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
  // Refresh metadata (last commit, branch count, commit count, provider) for
  // every configured repo. Used by the Sidebar's "refresh" button so the
  // user can force-reload the whole list (previously the button only ran the
  // remote check — incoming/outgoing — but never recomputed the cached stats,
  // which made the rows look "stuck" after a push/pull).
  ipcMain.handle('settings:refreshAllRepoStats', () => storage.refreshAllRepoStats());

  // Repository groups (tree in the sidebar)
  ipcMain.handle('settings:getRepoGroups', () => storage.getRepoGroups());
  ipcMain.handle('settings:createRepoGroup', (_e, name: string, parentId?: string | null) =>
    storage.createRepoGroup(name, parentId ?? null)
  );
  ipcMain.handle('settings:renameRepoGroup', (_e, id: string, name: string) =>
    storage.renameRepoGroup(id, name)
  );
  ipcMain.handle('settings:deleteRepoGroup', (_e, id: string) => storage.deleteRepoGroup(id));
  ipcMain.handle('settings:moveRepoGroup', (_e, id: string, newParentId: string | null) =>
    storage.moveRepoGroup(id, newParentId)
  );
  ipcMain.handle('settings:setRepoGroupExpanded', (_e, id: string, expanded: boolean) =>
    storage.setRepoGroupExpanded(id, expanded)
  );
  ipcMain.handle('settings:setRepoGroup', (_e, path: string, groupId: string | null) =>
    storage.setRepoGroup(path, groupId)
  );
}
