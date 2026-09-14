import { describe, it, expect } from 'vitest';
import {
  splitSettingSecrets,
  rehydrateSettingSecrets,
  classifyRemoteUrl,
  remoteAuthVaultKey,
} from '../../electron/services/credentialKeys';

describe('splitSettingSecrets — scalar token keys', () => {
  it('extracts a scalar token and leaves a placeholder', () => {
    const r = splitSettingSecrets('githubPAT', 'ghp_secret123');
    expect(r).not.toBeNull();
    expect(r!.sanitized).toBe('');
    expect(r!.secrets).toEqual({ githubPAT: 'ghp_secret123' });
  });

  it('marks an empty value for deletion', () => {
    const r = splitSettingSecrets('aiApiKey', '');
    expect(r!.secrets).toEqual({ aiApiKey: undefined });
    expect(r!.sanitized).toBe('');
  });

  it('returns null for non-secret keys', () => {
    expect(splitSettingSecrets('theme', 'dark')).toBeNull();
    expect(splitSettingSecrets('fontSize', 14)).toBeNull();
    expect(splitSettingSecrets('enableTelemetry', true)).toBeNull();
  });
});

describe('splitSettingSecrets — remoteAuth', () => {
  const map = {
    '/home/u/project': {
      origin: { username: 'user', password: 'secret-pass' },
      fork: { username: 'other' },
    },
  };

  it('extracts passwords and keeps usernames', () => {
    const r = splitSettingSecrets('remoteAuth', map);
    expect(r!.sanitized).toEqual({
      '/home/u/project': {
        origin: { username: 'user', password: '' },
        fork: { username: 'other' },
      },
    });
    expect(r!.secrets[remoteAuthVaultKey('/home/u/project', 'origin')]).toBe('secret-pass');
    expect(r!.secrets[remoteAuthVaultKey('/home/u/project', 'fork')]).toBeUndefined();
  });

  it('drops entries that become empty', () => {
    const r = splitSettingSecrets('remoteAuth', {
      '/repo': { origin: { password: 'p' } },
    });
    // No username → no entry in sanitized output
    expect(r!.sanitized).toEqual({});
    expect(r!.secrets[remoteAuthVaultKey('/repo', 'origin')]).toBe('p');
  });
});

describe('splitSettingSecrets — aiProviderConfigs', () => {
  it('splits apiKeys per provider', () => {
    const r = splitSettingSecrets('aiProviderConfigs', {
      openai: { url: 'https://api.openai.com', apiKey: 'sk-123', model: 'gpt-4o-mini' },
      ollama: { url: 'http://localhost:11434', model: 'llama3.2' },
    });
    const sanitized = r!.sanitized as Record<string, { apiKey?: string; url?: string; model?: string }>;
    expect(sanitized.openai).toEqual({ url: 'https://api.openai.com', model: 'gpt-4o-mini', apiKey: '' });
    expect(sanitized.ollama.model).toBe('llama3.2');
    expect(r!.secrets['provider:openai']).toBe('sk-123');
    expect(r!.secrets['provider:ollama']).toBeUndefined();
  });
});

describe('rehydrateSettingSecrets', () => {
  it('restores a scalar token from the vault', () => {
    const out = rehydrateSettingSecrets('githubPAT', '', (vk) =>
      vk === 'githubPAT' ? 'ghp_restored' : undefined
    );
    expect(out).toBe('ghp_restored');
  });

  it('restores remoteAuth passwords', () => {
    const sanitized = {
      '/repo': { origin: { username: 'u', password: '' } },
    };
    const out = rehydrateSettingSecrets('remoteAuth', sanitized, (vk) =>
      vk === remoteAuthVaultKey('/repo', 'origin') ? 'pass-restored' : undefined
    ) as typeof sanitized;
    expect(out['/repo'].origin).toEqual({ username: 'u', password: 'pass-restored' });
  });

  it('drops remote entries without username and without stored secret', () => {
    const sanitized = {
      '/repo': {
        ghost: { password: '' },
        alive: { username: 'u', password: '' },
      },
    };
    const out = rehydrateSettingSecrets('remoteAuth', sanitized, () => undefined) as typeof sanitized;
    expect(out['/repo'].ghost).toBeUndefined();
    expect(out['/repo'].alive).toEqual({ username: 'u' });
  });

  it('restores aiProviderConfigs apiKeys', () => {
    const sanitized = { openai: { url: 'x', apiKey: '' } };
    const out = rehydrateSettingSecrets('aiProviderConfigs', sanitized, (vk) =>
      vk === 'provider:openai' ? 'sk-1' : undefined
    ) as Record<string, { apiKey?: string }>;
    expect(out.openai.apiKey).toBe('sk-1');
  });
});

describe('classifyRemoteUrl', () => {
  it('detects scp-like ssh urls', () => {
    expect(classifyRemoteUrl('git@github.com:owner/repo.git')).toBe('ssh');
    expect(classifyRemoteUrl('mirocow@178.140.10.58:web/git/repo.git')).toBe('ssh');
  });

  it('detects ssh:// urls', () => {
    expect(classifyRemoteUrl('ssh://git@host:22/owner/repo.git')).toBe('ssh');
    expect(classifyRemoteUrl('SSH://host/path')).toBe('ssh');
  });

  it('detects http(s) urls', () => {
    expect(classifyRemoteUrl('https://github.com/owner/repo.git')).toBe('http');
    expect(classifyRemoteUrl('http://mirocow:token@host:8082/web/git/repo.git')).toBe('http');
  });

  it('leaves local paths and windows drive letters alone', () => {
    expect(classifyRemoteUrl('/home/user/project')).toBe('other');
    expect(classifyRemoteUrl('C:\\repos\\project')).toBe('other');
    expect(classifyRemoteUrl(undefined)).toBe('other');
    expect(classifyRemoteUrl('')).toBe('other');
  });
});
