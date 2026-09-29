/**
 * PrismGit secure secret vault.
 *
 * Every secret the app persists (remote passwords/PATs, GitHub PAT, AI API
 * keys, CI tokens, SSH key passphrases) goes through this module instead of
 * being written as plaintext JSON.
 *
 * Encryption: Electron `safeStorage` — the OS credential manager
 *   (Keychain on macOS, DPAPI on Windows, libsecret/KWallet on Linux).
 * Each value is encrypted per-entry and stored base64-encoded in
 * `prismgit-secrets.json` (chmod 0600, secure SimpleStore).
 *
 * Fallback: when the OS keychain is unavailable (headless Linux without a
 * keyring service, some CI environments), values are stored in the SAME file
 * with per-entry `enc: false` and the file is still chmod 0600. The status
 * IPC (`credentials:status`) reports the backend so Settings can warn the
 * user honestly.
 *
 * safeStorage requires the app `ready` event — every entry point here runs
 * from IPC handlers or after `app.whenReady()` in main.ts. In non-Electron
 * contexts (unit tests) `electron.safeStorage` is undefined and the vault
 * degrades to the plaintext fallback, which keeps service modules importable.
 */
import * as electron from 'electron';
import { SimpleStore } from './simpleStore.js';

const safeStorage = (electron as { safeStorage?: electron.SafeStorage }).safeStorage;

/** Separator inside composite vault keys (`<ns><SEP><key>`). Unit separator: never collides with repo paths or remote names. */
const SEP = '\u001f';

interface SecretEntry {
  /** true — `v` is base64 safeStorage ciphertext; false — `v` is plaintext (keychain unavailable). */
  enc: boolean;
  v: string;
}

const store = new SimpleStore({
  name: 'prismgit-secrets',
  defaults: { version: 1, data: {} as Record<string, SecretEntry> },
  secure: true,
});

function data(): Record<string, SecretEntry> {
  return (store.get('data') || {}) as Record<string, SecretEntry>;
}

function writeData(d: Record<string, SecretEntry>): void {
  store.set('data', d);
}

/** Composite vault key for a namespace + key pair. */
export function vaultKey(ns: string, key: string): string {
  return `${ns}${SEP}${key}`;
}

/** True when the OS credential manager can encrypt (app must be ready). */
export function isEncryptionAvailable(): boolean {
  try {
    return !!safeStorage && safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** Human-readable backend name for the Settings → Security status line. */
export function secretsBackend(): 'keychain' | 'file-0600' | 'unavailable' {
  if (!safeStorage) return 'unavailable';
  return isEncryptionAvailable() ? 'keychain' : 'file-0600';
}

/** Store a secret under a namespace. Empty/null value deletes the entry. */
export function setSecret(ns: string, key: string, value: string | undefined | null): void {
  const d = data();
  const id = vaultKey(ns, key);
  if (value === undefined || value === null || value === '') {
    if (id in d) {
      delete d[id];
      writeData(d);
    }
    return;
  }
  try {
    if (isEncryptionAvailable() && safeStorage) {
      d[id] = { enc: true, v: safeStorage.encryptString(value).toString('base64') };
    } else {
      d[id] = { enc: false, v: value };
    }
    writeData(d);
  } catch {
    // encryptString failure (rare) — never lose the value silently, but
    // never write it plaintext either: surface via thrown error to the caller.
    throw new Error(`Failed to encrypt a secret for ${ns}`);
  }
}

/** Read a secret, or undefined. Corrupt ciphertext (keychain reset) → undefined. */
export function getSecret(ns: string, key: string): string | undefined {
  const entry = data()[vaultKey(ns, key)];
  if (!entry) return undefined;
  if (!entry.enc) return entry.v;
  try {
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) return undefined;
    return safeStorage.decryptString(Buffer.from(entry.v, 'base64'));
  } catch {
    // OS keychain entry lost / password changed — treat as deleted.
    return undefined;
  }
}

/** Delete one secret entry. */
export function deleteSecret(ns: string, key: string): void {
  setSecret(ns, key, '');
}

/** All plain keys stored under a namespace (the `key` halves). */
export function listSecretKeys(ns: string): string[] {
  const prefix = vaultKey(ns, '');
  return Object.keys(data())
    .filter((id) => id.startsWith(prefix))
    .map((id) => id.slice(prefix.length));
}

/** Metadata of one stored secret — safe to expose to the renderer (no value). */
export interface SecretEntryMeta {
  /** Namespace: 'tokens' | 'ai' | 'remoteAuth' | 'github' | 'ssh' | … */
  ns: string;
  /** Key inside the namespace (remote name, provider id, scalar key…). */
  key: string;
  /** true — encrypted with the OS keychain; false — 0600-file fallback. */
  encrypted: boolean;
}

/**
 * Every secret in the vault as { ns, key, encrypted } — NO values.
 * Backs the Settings → Security secrets manager (list / copy / replace /
 * delete entries the app has accumulated over its lifetime).
 */
export function listSecretEntries(): SecretEntryMeta[] {
  const d = data();
  return Object.entries(d)
    .map(([id, entry]) => {
      const idx = id.indexOf(SEP);
      if (idx <= 0 || idx === id.length - 1) return null;
      return {
        ns: id.slice(0, idx),
        key: id.slice(idx + 1),
        encrypted: !!entry?.enc,
      } as SecretEntryMeta;
    })
    .filter((e): e is SecretEntryMeta => e !== null)
    .sort((a, b) => a.ns.localeCompare(b.ns) || a.key.localeCompare(b.key));
}

/** Remove every secret under a namespace. */
export function deleteNamespace(ns: string): void {
  const d = data();
  const prefix = vaultKey(ns, '');
  let changed = false;
  for (const id of Object.keys(d)) {
    if (id.startsWith(prefix)) {
      delete d[id];
      changed = true;
    }
  }
  if (changed) writeData(d);
}

/** Number of stored secrets (any namespace) — for the security status line. */
export function secretCount(): number {
  return Object.keys(data()).length;
}

/** Flush pending debounced writes (call on app quit). */
export function flushSecrets(): void {
  store.flush();
}
