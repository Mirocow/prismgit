/**
 * SSH key management API (Settings → Security → SSH keys).
 * Registered in electron/ipc/ssh.ts, exposed via window.api.ssh (preload).
 */

/** Metadata for one managed SSH key (never contains secrets). */
export interface SshKeyMeta {
  id: string;
  /** User-visible name. */
  label: string;
  /** Absolute path of the PRIVATE key (app-managed dir, chmod 600). */
  privateKeyPath: string;
  publicKeyPath?: string;
  /** One-line OpenSSH public key (`ssh-ed25519 AAAA... comment`). */
  publicKey?: string;
  /** `ssh-keygen -lf` output, e.g. "256 SHA256:xxx comment (ED25519)". */
  fingerprint?: string;
  comment?: string;
  type: 'ed25519' | 'rsa';
  addedAt: number;
  /** Passphrase exists — stored in the encrypted vault, never here. */
  hasPassphrase: boolean;
  /** Private key lives inside the app-managed ssh-keys directory. */
  managed: boolean;
}

export interface SshTestResult {
  /** Authentication accepted (most git servers exit 1 on success — matched by output text). */
  ok: boolean;
  /** Raw ssh -T output for diagnostics. */
  output: string;
}

/** A public key found in ~/.ssh (import suggestion list). */
export interface SshSystemKey {
  path: string;
  label: string;
  privateKeyPath: string;
  existsPrivate: boolean;
}

/**
 * Environment for ONE network git command over SSH
 * (services/ssh.ts buildSshEnv). Empty env = nothing to inject.
 */
export interface SshEnvResult {
  /** Extra env for the git child process (GIT_SSH_COMMAND, SSH_ASKPASS, …). */
  env: Record<string, string>;
  /** Must be called after the command finishes (deletes the askpass temp). */
  cleanup: () => void;
  usedKeyId?: string;
}

export interface SshApi {
  list: () => Promise<SshKeyMeta[]>;
  generate: (options: { label: string; comment?: string; type?: 'ed25519' | 'rsa'; passphrase?: string }) => Promise<SshKeyMeta>;
  importKey: (options: { label: string; sourcePath: string; passphrase?: string }) => Promise<SshKeyMeta>;
  remove: (id: string) => Promise<void>;
  copyPublicKey: (id: string) => Promise<string>;
  test: (id: string, opts?: { host?: string; user?: string }) => Promise<SshTestResult>;
  listSystemKeys: () => Promise<SshSystemKey[]>;
}

export interface CredentialsStatus {
  /** OS credential manager usable — secrets are encrypted at rest. */
  safeStorageAvailable: boolean;
  /** 'keychain' | 'file-0600' | 'unavailable'. */
  backend: string;
  /** Number of secrets currently in the vault. */
  secretCount: number;
}

/** One vault entry as seen by the secrets manager — NEVER carries a value. */
export interface SecretEntryMeta {
  /** Namespace: 'tokens' | 'ai' | 'remoteAuth' | 'github' | 'ssh' | … */
  ns: string;
  /** Key inside the namespace (remote name, provider id, scalar key…). */
  key: string;
  /** true — OS keychain encryption; false — 0600-file fallback. */
  encrypted: boolean;
}

export interface CredentialsApi {
  status: () => Promise<CredentialsStatus>;
  /** List every stored secret (metadata only — values are never bulk-exposed). */
  list: () => Promise<SecretEntryMeta[]>;
  /** Create or replace one secret. Empty value deletes the entry. */
  set: (ns: string, key: string, value: string) => Promise<void>;
  /** Remove one secret. */
  delete: (ns: string, key: string) => Promise<void>;
  /** Reveal one secret value — used by the explicit "copy" action. */
  reveal: (ns: string, key: string) => Promise<string | undefined>;
}
