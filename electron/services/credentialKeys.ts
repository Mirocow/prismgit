/**
 * Mapping between AppSettings values and the secret vault (secrets.ts).
 *
 * The renderer keeps working with the OLD settings shape (remoteAuth with
 * passwords, aiProviderConfigs with apiKeys, scalar tokens) — it must not
 * know anything about encryption. The main process instead:
 *
 *   settings:set  → splitSettingSecrets() → ciphertext → vault,
 *                   sanitized remainder → prismgit-settings.json
 *   settings:get  → rehydrateSettingSecrets() → original shape in memory
 *
 * Result: plaintext secrets never touch the settings JSON on disk, while
 * every existing reader (git.ts getStoredCredential, AI providers, CI
 * badges, the renderer) keeps its exact API.
 *
 * Pure functions — unit-testable without Electron.
 */
import type { RemoteCredential, AiProviderEntry } from '../types/settings-api.js';

/** Scalar settings keys whose ENTIRE value is a secret. */
export const SECRET_SCALAR_KEYS: readonly string[] = [
  'githubPAT',
  'aiApiKey',
  'jenkinsToken',
  'teamcityToken',
  'gitlabToken',
];

/** Placeholder stored on disk in place of a secret (never a real value). */
export const SECRET_PLACEHOLDER = '';

// ── Vault namespace layout ───────────────────────────────────────────────────
//  tokens            <scalarKey>           → githubPAT/aiApiKey/… value
//  ai                provider:<id>         → apiKey of that provider
//  remoteAuth        <repoPath>|<remote>   → password for that remote
//  github            pat                   → GitHub PAT (prismgit-github store)
//  ssh               pass:<keyId>          → SSH key passphrase

export const NS_TOKENS = 'tokens';
export const NS_AI = 'ai';
export const NS_REMOTE_AUTH = 'remoteAuth';
export const NS_GITHUB = 'github';
export const NS_GITLAB = 'gitlab';
export const NS_SSH = 'ssh';

/** Composite vault key for a per-remote credential. */
export function remoteAuthVaultKey(repoPath: string, remoteName: string): string {
  // | separator — repo paths never contain "|" on win32 (reserved char) and
  // POSIX filenames with | are exotic enough; remote names are [A-Za-z0-9._-].
  return `${repoPath}|${remoteName}`;
}

export interface SplitResult {
  /** Value safe for the settings JSON — secrets replaced by placeholders. */
  sanitized: unknown;
  /** vaultKey (as passed to lookup) → secret value. Empty value = delete. */
  secrets: Record<string, string | undefined>;
}

/**
 * Extract secrets from a settings value before it is persisted.
 * Returns null for keys that carry no secrets (caller persists as-is).
 * `undefined` secret values mean "delete from the vault".
 */
export function splitSettingSecrets(key: string, value: unknown): SplitResult | null {
  // Scalar token keys
  if (SECRET_SCALAR_KEYS.includes(key)) {
    const v = typeof value === 'string' ? value : '';
    return {
      sanitized: SECRET_PLACEHOLDER,
      secrets: v ? { [vaultKeyForScalar(key)]: v } : { [vaultKeyForScalar(key)]: undefined },
    };
  }

  // Per-remote authorization: { repo: { remote: { username?, password? } } }
  if (key === 'remoteAuth') {
    if (value === undefined || value === null) return { sanitized: value, secrets: {} };
    const map = value as Record<string, Record<string, RemoteCredential>>;
    const secrets: Record<string, string | undefined> = {};
    const sanitized: Record<string, Record<string, RemoteCredential>> = {};
    for (const [repoPath, remotes] of Object.entries(map)) {
      if (!remotes || typeof remotes !== 'object') continue;
      const cleanRemotes: Record<string, RemoteCredential> = {};
      for (const [remoteName, cred] of Object.entries(remotes)) {
        if (!cred || typeof cred !== 'object') continue;
        const password = typeof cred.password === 'string' ? cred.password : '';
        const username = cred.username?.trim() || undefined;
        const vk = remoteAuthVaultKey(repoPath, remoteName);
        if (password) secrets[vk] = password;
        else secrets[vk] = undefined; // cleared in UI → delete from vault
        // Keep the placeholder only when a password exists (it was moved to
        // the vault); entries without a password store just the username.
        if (username) {
          cleanRemotes[remoteName] = password
            ? { username, password: SECRET_PLACEHOLDER }
            : { username };
        }
      }
      if (Object.keys(cleanRemotes).length > 0) sanitized[repoPath] = cleanRemotes;
    }
    return { sanitized, secrets };
  }

  // Per-provider AI configs: { providerId: { url?, apiKey?, model? } }
  if (key === 'aiProviderConfigs') {
    if (value === undefined || value === null) return { sanitized: value, secrets: {} };
    const map = value as Record<string, { url?: string; apiKey?: string; model?: string }>;
    const secrets: Record<string, string | undefined> = {};
    const sanitized: Record<string, { url?: string; apiKey?: string; model?: string }> = {};
    for (const [providerId, cfg] of Object.entries(map)) {
      if (!cfg || typeof cfg !== 'object') continue;
      const apiKey = typeof cfg.apiKey === 'string' ? cfg.apiKey : '';
      const vk = `provider:${providerId}`;
      if (apiKey) secrets[vk] = apiKey;
      else secrets[vk] = undefined;
      const { url, model } = cfg;
      sanitized[providerId] = {
        ...(url ? { url } : {}),
        ...(model ? { model } : {}),
        apiKey: SECRET_PLACEHOLDER, // real value lives in the vault
      };
    }
    return { sanitized, secrets };
  }

  // Multi-provider registry: AiProviderEntry[] — each entry's apiKey is
  // vaulted under ns 'ai', key 'provider:<entryId>' (same namespace as the
  // legacy aiProviderConfigs so keys survive legacy→registry migration when
  // the entry id reuses the legacy provider id).
  if (key === 'aiProviders') {
    if (value === undefined || value === null) return { sanitized: value, secrets: {} };
    if (!Array.isArray(value)) return { sanitized: value, secrets: {} };
    const secrets: Record<string, string | undefined> = {};
    const sanitized: AiProviderEntry[] = [];
    for (const entry of value as AiProviderEntry[]) {
      if (!entry || typeof entry !== 'object' || !entry.id) continue;
      const apiKey = typeof entry.apiKey === 'string' ? entry.apiKey : '';
      const vk = `provider:${entry.id}`;
      if (apiKey) secrets[vk] = apiKey;
      else secrets[vk] = undefined;
      sanitized.push({ ...entry, apiKey: SECRET_PLACEHOLDER });
    }
    return { sanitized, secrets };
  }

  return null;
}

/** Composite vault key for a scalar token setting. */
function vaultKeyForScalar(key: string): string {
  return key;
}

/**
 * Rebuild the original settings shape by re-reading secrets from the vault.
 * `lookup(vaultKey)` returns the stored secret or undefined.
 */
export function rehydrateSettingSecrets(
  key: string,
  value: unknown,
  lookup: (vaultKey: string) => string | undefined
): unknown {
  // Scalar token keys
  if (SECRET_SCALAR_KEYS.includes(key)) {
    const secret = lookup(vaultKeyForScalar(key));
    // Placeholder (or missing key) → substitute the real secret if present.
    if ((value === undefined || value === SECRET_PLACEHOLDER) && secret) return secret;
    return value;
  }

  // remoteAuth
  if (key === 'remoteAuth') {
    if (!value || typeof value !== 'object') return value;
    const map = value as Record<string, Record<string, RemoteCredential>>;
    const out: Record<string, Record<string, RemoteCredential>> = {};
    for (const [repoPath, remotes] of Object.entries(map)) {
      const cleanRemotes: Record<string, RemoteCredential> = {};
      for (const [remoteName, cred] of Object.entries(remotes)) {
        const secret = lookup(remoteAuthVaultKey(repoPath, remoteName));
        // Drop the remote entry entirely when neither username nor a stored
        // password exists (mirrors the renderer's "clear when empty" rule).
        if (!cred?.username?.trim() && !secret) continue;
        cleanRemotes[remoteName] = {
          ...(cred.username?.trim() ? { username: cred.username.trim() } : {}),
          ...(secret ? { password: secret } : {}),
        };
      }
      if (Object.keys(cleanRemotes).length > 0) out[repoPath] = cleanRemotes;
    }
    return out;
  }

  // aiProviderConfigs
  if (key === 'aiProviderConfigs') {
    if (!value || typeof value !== 'object') return value;
    const map = value as Record<string, { url?: string; apiKey?: string; model?: string }>;
    const out: Record<string, { url?: string; apiKey?: string; model?: string }> = {};
    for (const [providerId, cfg] of Object.entries(map)) {
      const secret = lookup(`provider:${providerId}`);
      out[providerId] = { ...cfg, ...(secret ? { apiKey: secret } : {}) };
    }
    return out;
  }

  // aiProviders registry — rehydrate each entry's apiKey from the vault.
  if (key === 'aiProviders') {
    if (!value || !Array.isArray(value)) return value;
    const out: AiProviderEntry[] = [];
    for (const entry of value as AiProviderEntry[]) {
      if (!entry || typeof entry !== 'object' || !entry.id) continue;
      const secret = lookup(`provider:${entry.id}`);
      out.push({ ...entry, ...(secret ? { apiKey: secret } : {}) });
    }
    return out;
  }

  return value;
}

/** Git remote URL classification used by the SSH integration. */
export type RemoteUrlKind = 'ssh' | 'http' | 'other';

/**
 * Classify a git remote URL. Recognizes:
 *   - scp-like:  git@github.com:owner/repo.git
 *   - ssh://     ssh://git@host:22/owner/repo.git, ssh://host/path
 *   - http(s):// https://github.com/owner/repo.git
 */
export function classifyRemoteUrl(url: string | undefined | null): RemoteUrlKind {
  if (!url) return 'other';
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return 'http';
  if (/^ssh:\/\//i.test(u)) return 'ssh';
  // scp-like syntax: user@host:path (no scheme, single colon not followed by //)
  if (/^[^/]+@[^/:]+:[^/].*$/.test(u) && !/^[a-zA-Z]:[\\/]/.test(u)) return 'ssh';
  return 'other';
}
