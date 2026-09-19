import { ipcMain } from 'electron';
import { getCachedAvatar } from '../services/avatarCache.js';

/**
 * Avatar cache IPC handlers.
 *
 * Renderer calls `api.avatar.get(url)`. Main process downloads + caches on
 * disk, returns a data URI string (or null).
 *
 * NOTE: the `avatar:getByEmail` handler was removed — the renderer builds
 * the Gravatar URL itself via `src/lib/gravatar.ts` (which supports both
 * MD5 and SHA-256 hashes), so the main-process round-trip was a dead
 * duplicate that only re-implemented the MD5 variant.
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
}
