/**
 * Unit tests for the multi-provider AI registry:
 *   - vault splitting / rehydration of settings.aiProviders (main process)
 *   - migration, activation mirroring and CRUD helpers (src/lib/aiProviders)
 */
import { describe, it, expect, vi } from 'vitest';
import { splitSettingSecrets, rehydrateSettingSecrets } from '../../electron/services/credentialKeys';
import {
  migrateLegacyProviders,
  getAiProviders,
  getEnabledAiProviders,
  getActiveAiProvider,
  buildProviderFromActiveEntry,
  upsertAiProvider,
  removeAiProvider,
  toggleAiProviderEnabled,
  newProviderId,
  getProviderTemplate,
} from '../../src/lib/aiProviders';
import type { AppSettings, AiProviderEntry } from '../../electron/types/settings-api';

// ── Test fixtures ──────────────────────────────────────────────────────────

function entry(partial: Partial<AiProviderEntry>): AiProviderEntry {
  return {
    id: 'prov-test',
    kind: 'ollama',
    name: 'Test Ollama',
    url: 'http://localhost:11434',
    model: 'llama3.2',
    enabled: true,
    ...partial,
  };
}

/** Minimal setSetting mock: writes into a settings object like the store does. */
function makeSetter(settings: Record<string, unknown>) {
  return vi.fn(async (key: string, value: unknown) => {
    settings[key] = value;
  }) as unknown as <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
}

// ── Vault splitting (main process) ────────────────────────────────────────

describe('splitSettingSecrets — aiProviders registry', () => {
  it('vaults each entry apiKey and leaves placeholders on disk', () => {
    const list = [
      entry({ id: 'prov-1', apiKey: 'sk-secret-1' }),
      entry({ id: 'prov-2', kind: 'openai', apiKey: 'sk-secret-2' }),
      entry({ id: 'prov-3', apiKey: undefined }),
    ];
    const r = splitSettingSecrets('aiProviders', list);
    expect(r).not.toBeNull();
    const sanitized = r!.sanitized as AiProviderEntry[];
    expect(sanitized).toHaveLength(3);
    expect(sanitized[0].apiKey).toBe('');
    expect(sanitized[1].apiKey).toBe('');
    expect(r!.secrets['provider:prov-1']).toBe('sk-secret-1');
    expect(r!.secrets['provider:prov-2']).toBe('sk-secret-2');
    // No key → marked for deletion (undefined), not stored
    expect(r!.secrets['provider:prov-3']).toBeUndefined();
  });

  it('preserves the other entry fields verbatim', () => {
    const e = entry({ id: 'prov-x', name: 'Home box', url: 'http://192.168.1.50:11434', model: 'qwen2.5:32b' });
    const r = splitSettingSecrets('aiProviders', [e]);
    const sanitized = (r!.sanitized as AiProviderEntry[])[0];
    expect(sanitized).toMatchObject({ id: 'prov-x', name: 'Home box', url: 'http://192.168.1.50:11434', model: 'qwen2.5:32b', enabled: true });
  });

  it('tolerates null/undefined/non-array values', () => {
    expect(splitSettingSecrets('aiProviders', undefined)!.sanitized).toBeUndefined();
    expect(splitSettingSecrets('aiProviders', null)!.sanitized).toBeNull();
    expect(splitSettingSecrets('aiProviders', 'garbage')!.sanitized).toBe('garbage');
  });

  it('round-trips through rehydrateSettingSecrets', () => {
    const list = [
      entry({ id: 'prov-1', apiKey: 'sk-aaa' }),
      entry({ id: 'prov-2', kind: 'openai', apiKey: '' }),
    ];
    const r = splitSettingSecrets('aiProviders', list)!;
    const restored = rehydrateSettingSecrets('aiProviders', r.sanitized, (vk) =>
      vk === 'provider:prov-1' ? 'sk-aaa' : undefined
    ) as AiProviderEntry[];
    expect(restored[0].apiKey).toBe('sk-aaa');
    // No stored secret → the empty placeholder is kept as-is (falsy).
    expect(restored[1].apiKey).toBe('');
  });
});

// ── Legacy migration ───────────────────────────────────────────────────────

describe('migrateLegacyProviders', () => {
  it('returns null when the registry already exists', () => {
    const s = { aiProviders: [entry({})] } as Partial<AppSettings>;
    expect(migrateLegacyProviders(s)).toBeNull();
  });

  it('returns null for a fresh install (no legacy data)', () => {
    expect(migrateLegacyProviders({})).toEqual([]);
  });

  it('converts the active preset + flat fields into the first entry', () => {
    const s = {
      aiProvider: 'groq',
      aiUrl: 'https://api.groq.com/openai/v1/chat/completions',
      aiModel: 'llama-3.1-8b-instant',
      aiApiKey: 'gsk_test',
      aiProviderConfigs: {
        groq: { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.1-8b-instant', apiKey: '' },
        openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', apiKey: 'sk-old' },
      },
    } as Partial<AppSettings>;
    const entries = migrateLegacyProviders(s)!;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: 'groq', url: s.aiUrl, model: s.aiModel, apiKey: 'gsk_test', enabled: true });
    expect(entries[0].id).toBe('prov-legacy-groq');
    expect(entries[1]).toMatchObject({ kind: 'openai', apiKey: 'sk-old' });
  });

  it('skips empty legacy config slots', () => {
    const s = {
      aiProvider: 'ollama',
      aiUrl: 'http://localhost:11434',
      aiModel: 'llama3.2',
      aiProviderConfigs: { empty: {} },
    } as Partial<AppSettings>;
    const entries = migrateLegacyProviders(s)!;
    expect(entries).toHaveLength(1);
  });
});

// ── Registry accessors ─────────────────────────────────────────────────────

describe('registry accessors', () => {
  it('getAiProviders returns [] when unset', () => {
    expect(getAiProviders(undefined)).toEqual([]);
    expect(getAiProviders({})).toEqual([]);
  });

  it('getEnabledAiProviders filters disabled entries', () => {
    const s = {
      aiProviders: [entry({ id: 'a' }), entry({ id: 'b', enabled: false })],
    } as Partial<AppSettings>;
    expect(getEnabledAiProviders(s).map(e => e.id)).toEqual(['a']);
  });

  it('getActiveAiProvider resolves by aiActiveProviderId', () => {
    const s = {
      aiProviders: [entry({ id: 'a' }), entry({ id: 'b' })],
      aiActiveProviderId: 'b',
    } as Partial<AppSettings>;
    expect(getActiveAiProvider(s)?.id).toBe('b');
  });

  it('buildProviderFromActiveEntry maps the entry to LLMProvider', () => {
    const s = {
      aiProviders: [entry({ id: 'prov-9', kind: 'openai', name: 'My OpenAI', url: 'https://x/v1', model: 'gpt-4o-mini', apiKey: 'sk-k' })],
      aiActiveProviderId: 'prov-9',
    } as Partial<AppSettings>;
    const p = buildProviderFromActiveEntry(s);
    expect(p).toMatchObject({ id: 'prov-9', name: 'My OpenAI', type: 'openai', url: 'https://x/v1', model: 'gpt-4o-mini', apiKey: 'sk-k' });
  });

  it('buildProviderFromActiveEntry returns null without a model', () => {
    const s = {
      aiProviders: [entry({ id: 'p', model: '' })],
      aiActiveProviderId: 'p',
    } as Partial<AppSettings>;
    expect(buildProviderFromActiveEntry(s)).toBeNull();
  });

  it('generates unique ids', () => {
    const a = newProviderId();
    const b = newProviderId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^prov-/);
  });

  it('falls back to the custom template for unknown ids', () => {
    const tpl = getProviderTemplate('does-not-exist');
    expect(tpl.protocol).toBe('openai-compatible');
  });
});

// ── CRUD + legacy mirroring ────────────────────────────────────────────────

describe('upsertAiProvider', () => {
  it('adds the first entry and auto-activates it (mirrors legacy fields)', async () => {
    const settings: Record<string, unknown> = {};
    const setSetting = makeSetter(settings);
    const e = entry({ id: 'prov-1', kind: 'ollama', url: 'http://localhost:11434', model: 'llama3.2' });
    await upsertAiProvider({} as Partial<AppSettings>, setSetting, e);

    expect((settings.aiProviders as AiProviderEntry[])).toHaveLength(1);
    expect(settings.aiActiveProviderId).toBe('prov-1');
    // Legacy mirror — the contract every existing reader depends on.
    expect(settings.aiProvider).toBe('ollama');
    expect(settings.aiUrl).toBe('http://localhost:11434');
    expect(settings.aiModel).toBe('llama3.2');
  });

  it('updates an existing entry in place without re-activating', async () => {
    const base = {
      aiProviders: [entry({ id: 'p1' }), entry({ id: 'p2' })],
      aiActiveProviderId: 'p2',
    } as Partial<AppSettings>;
    const settings: Record<string, unknown> = { ...base };
    const setSetting = makeSetter(settings);
    await upsertAiProvider(base, setSetting, entry({ id: 'p1', name: 'Renamed' }));
    const list = settings.aiProviders as AiProviderEntry[];
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('Renamed');
    expect(settings.aiActiveProviderId).toBe('p2'); // unchanged
  });
});

describe('removeAiProvider', () => {
  it('activates another enabled entry when removing the active one', async () => {
    const base = {
      aiProviders: [entry({ id: 'p1' }), entry({ id: 'p2' })],
      aiActiveProviderId: 'p1',
    } as Partial<AppSettings>;
    const settings: Record<string, unknown> = { ...base };
    const setSetting = makeSetter(settings);
    await removeAiProvider(base, setSetting, 'p1');
    expect((settings.aiProviders as AiProviderEntry[]).map(e => e.id)).toEqual(['p2']);
    expect(settings.aiActiveProviderId).toBe('p2');
    expect(settings.aiProvider).toBe('ollama');
  });

  it('clears the active provider when the registry becomes empty', async () => {
    const base = {
      aiProviders: [entry({ id: 'p1' })],
      aiActiveProviderId: 'p1',
    } as Partial<AppSettings>;
    const settings: Record<string, unknown> = { ...base };
    const setSetting = makeSetter(settings);
    await removeAiProvider(base, setSetting, 'p1');
    expect(settings.aiProviders).toEqual([]);
    expect(settings.aiActiveProviderId).toBe('');
    expect(settings.aiProvider).toBe('');
  });
});

describe('toggleAiProviderEnabled', () => {
  it('falls back to another entry when the active one is disabled', async () => {
    const base = {
      aiProviders: [entry({ id: 'p1' }), entry({ id: 'p2' })],
      aiActiveProviderId: 'p1',
    } as Partial<AppSettings>;
    const settings: Record<string, unknown> = { ...base };
    const setSetting = makeSetter(settings);
    await toggleAiProviderEnabled(base, setSetting, 'p1', false);
    expect((settings.aiProviders as AiProviderEntry[])[0].enabled).toBe(false);
    expect(settings.aiActiveProviderId).toBe('p2');
  });
});
