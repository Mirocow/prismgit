import { ipcMain } from 'electron';
import { getCachedAvatar, gravatarUrlFromEmail } from '../services/avatarCache.js';

/**
 * Avatar cache IPC handlers.
 *
 * Renderer calls `api.avatar.get(url)` or `api.avatar.getByEmail(email)`.
 * Main process downloads + caches on disk, returns a data URI string (or null).
 */
export function registerAvatarIpc(): void {
  /**
   * Get a cached avatar by direct URL (GitHub avatar_url, GitLab avatar_url).
   * Returns a data URI string if available, null otherwise.
   */
  ipcMain.handle('avatar:get', async (_e, url: string) => {
    if (!url || typeof url !== 'string') return null;
    try {
      return await getCachedAvatar(url);
    } catch {
      return null;
    }
  });

  /**
   * Get a cached avatar by email (computes Gravatar URL internally).
   * Returns a data URI string if available, null otherwise.
   */
  ipcMain.handle('avatar:getByEmail', async (_e, email: string, size?: number) => {
    if (!email || typeof email !== 'string') return null;
    try {
      const url = gravatarUrlFromEmail(email, size ?? 48);
      if (!url) return null;
      return await getCachedAvatar(url);
    } catch {
      return null;
    }
  });
}
