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

  // Native "Browse…" for a private key file (returns an absolute path).
  ipcMain.handle('ssh:pickKeyFile', () => sshService.pickSshKeyFile());

  // ── SSH connection profiles (DBeaver-style SSH configuration) ──────────────
  // Host/port/user/auth-method are plain settings; the passphrase or account
  // password goes ONLY into the encrypted vault (ns 'ssh', conn:<id>:secret).
  ipcMain.handle('ssh:listProfiles', () => sshService.getSshProfiles());

  ipcMain.handle('ssh:saveProfile', (_e, input: { id?: string; label?: string; host: string; port?: number; user: string; authMethod: 'publickey' | 'password'; keyId?: string; secret?: string }) =>
    sshService.saveSshProfile(input)
  );

  ipcMain.handle('ssh:deleteProfile', (_e, id: string) => sshService.deleteSshProfile(id));

  ipcMain.handle('ssh:testProfile', (_e, id: string) => sshService.testSshProfile(id));

  ipcMain.handle('ssh:testParams', (_e, params: { host: string; port?: number; user?: string; authMethod?: 'publickey' | 'password'; keyId?: string; secret?: string }) =>
    sshService.testSshParams(params)
  );

  // Credential storage status for Settings → Security.
  ipcMain.handle('credentials:status', () => ({
    safeStorageAvailable: secrets.isEncryptionAvailable(),
    backend: secrets.secretsBackend(),
    secretCount: secrets.secretCount(),
  }));

  // ── Secrets manager (Settings → Security → Stored secrets) ────────────────
  // Values are never listed in bulk; the renderer gets { ns, key, encrypted }
  // metadata and must explicitly reveal/copy a single value.
  ipcMain.handle('credentials:list', () => secrets.listSecretEntries());

  ipcMain.handle('credentials:set', (_e, ns: string, key: string, value: string) => {
    if (typeof ns !== 'string' || !ns.trim() || typeof key !== 'string' || !key.trim()) {
      throw new Error('credentials:set requires a namespace and a key');
    }
    secrets.setSecret(ns.trim(), key.trim(), typeof value === 'string' ? value : '');
  });

  ipcMain.handle('credentials:delete', (_e, ns: string, key: string) => {
    secrets.deleteSecret(ns, key);
  });

  ipcMain.handle('credentials:reveal', (_e, ns: string, key: string) =>
    secrets.getSecret(ns, key)
  );
}
