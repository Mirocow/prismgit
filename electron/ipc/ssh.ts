import { ipcMain } from 'electron';
import * as sshService from '../services/ssh.js';
import * as secrets from '../services/secrets.js';

/**
 * SSH key management IPC (Settings → Security → SSH keys) and the
 * credential-storage status line. Handlers are wrapped in try/catch so a
 * failing ssh-keygen surfaces as a renderer-visible error message instead
 * of an unhandled IPC exception.
 */
export function registerSshIpc(): void {
  ipcMain.handle('ssh:list', () => sshService.getSshKeys());

  ipcMain.handle(
    'ssh:generate',
    async (_e, options: { label: string; comment?: string; type?: 'ed25519' | 'rsa'; passphrase?: string }) =>
      sshService.generateSshKey(options)
  );

  ipcMain.handle(
    'ssh:importKey',
    async (_e, options: { label: string; sourcePath: string; passphrase?: string }) =>
      sshService.importSshKey(options)
  );

  ipcMain.handle('ssh:remove', async (_e, id: string) => sshService.deleteSshKey(id));

  ipcMain.handle('ssh:copyPublicKey', (_e, id: string) => sshService.getPublicKeyText(id));

  ipcMain.handle(
    'ssh:test',
    async (_e, id: string, opts?: { host?: string; user?: string }) => sshService.testSshKey(id, opts)
  );

  ipcMain.handle('ssh:listSystemKeys', () => sshService.listSystemPublicKeys());

  // Credential storage status for Settings → Security.
  ipcMain.handle('credentials:status', () => ({
    safeStorageAvailable: secrets.isEncryptionAvailable(),
    backend: secrets.secretsBackend(),
    secretCount: secrets.secretCount(),
  }));
}
