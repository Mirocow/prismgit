/**
 * Multi-provider AI registry — the model behind Settings → AI → provider
 * grid (unlimited Ollama servers + OpenAI-compatible endpoints).
 *
 * ── Data model ──────────────────────────────────────────────────────────
 *   settings.aiProviders        : AiProviderEntry[]   (the registry)
 *   settings.aiActiveProviderId : string              (active entry id)
 *
 * ── Backward compatibility (legacy flat fields) ─────────────────────────
 * Three call sites build an LLMProvider from the FLAT settings fields
 * (aiProvider/aiUrl/aiApiKey/aiModel): ChangesPage.buildAIProvider,
 * AiChatPage.buildProvider and AiAssistant.buildProvider. Instead of
 * touching all of them (plus electron/services/ai.ts callers), every
 * activation mirrors the active entry into the legacy fields:
 *
 *   aiProvider → entry.kind   (valid LLMProvider['type'])
 *   aiUrl      → entry.url
 *   aiApiKey   → entry.apiKey
 *   aiModel    → entry.model
 *
 * Legacy migration (migrateLegacyProviders): an old install has
 * aiProvider='groq' + aiProviderConfigs={groq:{...}, openai:{...}}.
 * On first read we synthesize one entry per non-empty legacy config
 * (active preset first) and persist the registry. Idempotent.
 */

import type { AppSettings, AiProviderEntry } from '../../electron/types/settings-api';
import type { LLMProvider } from './aiCommitMessages';
import { PROVIDER_PRESETS } from './aiCommitMessages';

/** Protocol kinds offered in the "Add provider" form. */
export type ProviderProtocol = 'ollama' | 'openai-compatible' | 'anthropic';

export interface ProviderTemplate {
  /** Template id — 'ollama' | 'anthropic' | preset id for OpenAI-compatible flavors. */
  id: string;
  label: string;
  protocol: ProviderProtocol;
  defaultUrl: string;
  defaultModel: string;
  description: string;
  freeTier: boolean;
}

/**
 * Templates for the Add-Provider form. Ollama and Anthropic are protocols
 * of their own; every OpenAI-compatible preset (OpenAI, Groq, OpenRouter,
 * Cerebras, Gemini, Mistral, GitHub Models, Z.ai, LM Studio, vLLM, custom)
 * becomes an entry with kind = preset id. Unlimited instances of ANY
 * template can be added.
 */
export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'ollama',
    label: 'Ollama server',
    protocol: 'ollama',
    defaultUrl: 'http://localhost:11434',
    defaultModel: '',
    description: 'Local or remote Ollama server. Add as many as you need — home GPU box, work workstation, cluster.',
    freeTier: true,
  },
  ...PROVIDER_PRESETS.filter(p => p.id !== 'ollama' && p.id !== 'custom').map(p => ({
    id: p.id,
    label: p.label,
    protocol: (p.id === 'anthropic' ? 'anthropic' : 'openai-compatible') as ProviderProtocol,
    defaultUrl: p.defaultUrl,
    defaultModel: p.defaultModel,
    description: p.description,
    freeTier: p.freeTier,
  })),
  {
    id: 'lm-studio',
    label: 'LM Studio (local)',
    protocol: 'openai-compatible' as ProviderProtocol,
    defaultUrl: 'http://localhost:1234/v1',
    defaultModel: '',
    description: 'LM Studio local server (OpenAI-compatible). Start the server in LM Studio first.',
    freeTier: true,
  },
  {
    id: 'vllm',
    label: 'vLLM / self-hosted',
    protocol: 'openai-compatible' as ProviderProtocol,
    defaultUrl: 'http://localhost:8000/v1',
    defaultModel: '',
    description: 'Any self-hosted OpenAI-compatible server: vLLM, text-generation-webui, LiteLLM proxy, corporate gateway.',
    freeTier: true,
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible',
    protocol: 'openai-compatible' as ProviderProtocol,
    defaultUrl: '',
    defaultModel: '',
    description: 'Any other OpenAI-compatible endpoint.',
    freeTier: false,
  },
];

export function getProviderTemplate(id: string): ProviderTemplate {
  return PROVIDER_TEMPLATES.find(t => t.id === id) ?? PROVIDER_TEMPLATES[PROVIDER_TEMPLATES.length - 1];
}

/** Protocol for an arbitrary entry kind (legacy preset ids included). */
export function kindToProtocol(kind: string): ProviderProtocol {
  if (kind === 'ollama') return 'ollama';
  if (kind === 'anthropic') return 'anthropic';
  return 'openai-compatible';
}

/** Short badge label for a kind. */
export function kindBadge(kind: string): string {
  const protocol = kindToProtocol(kind);
  if (protocol === 'ollama') return 'OLLAMA';
  if (protocol === 'anthropic') return 'ANTHROPIC';
  return 'OPENAI-COMPAT';
}

let idCounter = 0;
export function newProviderId(): string {
  idCounter += 1;
  return `prov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${idCounter > 1 ? `-${idCounter}` : ''}`;
}

// ── Legacy migration ──────────────────────────────────────────────────────

/**
 * Build the registry from legacy settings (aiProvider + aiProviderConfigs).
 * Returns null when there is nothing to migrate (no legacy data or the
 * registry already exists).
 */
export function migrateLegacyProviders(settings: Partial<AppSettings> | undefined): AiProviderEntry[] | null {
  if (!settings) return null;
  if (Array.isArray(settings.aiProviders)) return null; // already migrated / new install
  const legacyActive = settings.aiProvider || '';
  const configs = settings.aiProviderConfigs || {};
  const entries: AiProviderEntry[] = [];

  // Active preset first (it has url/model in the flat fields — the most
  // recently edited values, possibly newer than aiProviderConfigs).
  if (legacyActive) {
    const flatUrl = settings.aiUrl || '';
    const flatModel = settings.aiModel || '';
    const legacy = configs[legacyActive] || {};
    entries.push({
      id: `prov-legacy-${legacyActive}`,
      kind: legacyActive,
      name: getProviderTemplate(legacyActive).label,
      url: flatUrl || legacy.url || '',
      apiKey: settings.aiApiKey || legacy.apiKey || '',
      model: flatModel || legacy.model || '',
      enabled: true,
      createdAt: Date.now(),
    });
  }
  // Remaining legacy configs (skip the one already converted).
  for (const [presetId, cfg] of Object.entries(configs)) {
    if (presetId === legacyActive) continue;
    if (!cfg || (!cfg.url && !cfg.model && !cfg.apiKey)) continue;
    entries.push({
      id: `prov-legacy-${presetId}`,
      kind: presetId,
      name: getProviderTemplate(presetId).label,
      url: cfg.url || '',
      apiKey: cfg.apiKey || '',
      model: cfg.model || '',
      enabled: true,
      createdAt: Date.now(),
    });
  }
  return entries;
}

/**
 * One-shot migration + persistence. Call from a Settings/Chat component
 * mount effect: if the registry is missing but legacy data exists, write
 * the synthesized entries. Returns true when a migration was written.
 */
export async function ensureAiProvidersMigrated(
  settings: Partial<AppSettings> | undefined,
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
): Promise<boolean> {
  if (!settings || Array.isArray(settings.aiProviders)) return false;
  const entries = migrateLegacyProviders(settings);
  if (!entries || entries.length === 0) return false;
  await setSetting('aiProviders', entries);
  await setSetting('aiActiveProviderId', entries[0].id);
  return true;
}

// ── Registry accessors ────────────────────────────────────────────────────

/** All entries (empty array when the registry is not initialized yet). */
export function getAiProviders(settings: Partial<AppSettings> | undefined): AiProviderEntry[] {
  const list = settings?.aiProviders;
  return Array.isArray(list) ? list : [];
}

/** Entries offered to the user (enabled only). */
export function getEnabledAiProviders(settings: Partial<AppSettings> | undefined): AiProviderEntry[] {
  return getAiProviders(settings).filter(e => e.enabled);
}

/** Active entry — by id, falling back to the entry matching legacy flat fields. */
export function getActiveAiProvider(settings: Partial<AppSettings> | undefined): AiProviderEntry | null {
  const list = getAiProviders(settings);
  if (list.length === 0) return null;
  const activeId = settings?.aiActiveProviderId;
  if (activeId) {
    const byId = list.find(e => e.id === activeId);
    if (byId) return byId;
  }
  // Legacy fallback: match flat fields (migration not persisted yet).
  const flatUrl = settings?.aiUrl || '';
  const flatModel = settings?.aiModel || '';
  return list.find(e => e.url === flatUrl && e.model === flatModel) ?? null;
}

/**
 * Build an LLMProvider for the AI chat/commit-message stack from the
 * ACTIVE registry entry. Returns null when nothing is usable. This is the
 * preferred builder — the legacy flat-field path in the components stays
 * as a fallback only.
 */
export function buildProviderFromActiveEntry(settings: Partial<AppSettings> | undefined): LLMProvider | null {
  const entry = getActiveAiProvider(settings);
  if (!entry || !entry.enabled) return null;
  if (!entry.model) return null;
  return {
    id: entry.id,
    name: entry.name,
    type: entry.kind as LLMProvider['type'],
    url: entry.url,
    apiKey: entry.apiKey,
    model: entry.model,
  };
}

// ── Mutations (write registry + mirror legacy fields atomically) ─────────

/**
 * Activate an entry: set aiActiveProviderId AND mirror url/apiKey/model
 * into the legacy flat fields so every existing reader keeps working.
 * Also refreshes the legacy aiProviderConfigs slot for the entry's kind.
 */
export async function activateAiProvider(
  settings: Partial<AppSettings> | undefined,
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>,
  entryId: string
): Promise<void> {
  const entry = getAiProviders(settings).find(e => e.id === entryId);
  if (!entry) return;
  const configs = { ...(settings?.aiProviderConfigs || {}) };
  if (entry.kind) {
    configs[entry.kind] = {
      url: entry.url,
      ...(entry.apiKey ? { apiKey: entry.apiKey } : {}),
      model: entry.model,
    };
  }
  await Promise.all([
    setSetting('aiActiveProviderId', entryId),
    setSetting('aiProvider', entry.kind),
    setSetting('aiUrl', entry.url),
    setSetting('aiApiKey', entry.apiKey || ''),
    setSetting('aiModel', entry.model),
    setSetting('aiProviderConfigs', configs),
  ]);
}

/** Upsert (add or replace) an entry, keeping the rest of the registry intact. */
export async function upsertAiProvider(
  settings: Partial<AppSettings> | undefined,
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>,
  entry: AiProviderEntry,
  opts?: { activate?: boolean }
): Promise<void> {
  const list = [...getAiProviders(settings)];
  const idx = list.findIndex(e => e.id === entry.id);
  const isFirst = list.length === 0;
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  await setSetting('aiProviders', list);
  // First entry ever → auto-activate so the user is immediately usable.
  const shouldActivate = opts?.activate || (isFirst && entry.enabled);
  if (shouldActivate) {
    await activateAiProvider({ ...settings, aiProviders: list }, setSetting, entry.id);
  }
}

/** Remove an entry; if it was active, activate another enabled entry (or none). */
export async function removeAiProvider(
  settings: Partial<AppSettings> | undefined,
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>,
  entryId: string
): Promise<void> {
  const list = getAiProviders(settings).filter(e => e.id !== entryId);
  await setSetting('aiProviders', list);
  const wasActive = settings?.aiActiveProviderId === entryId;
  if (wasActive) {
    const next = list.find(e => e.enabled);
    if (next) {
      await activateAiProvider({ ...settings, aiProviders: list }, setSetting, next.id);
    } else {
      await setSetting('aiActiveProviderId', '');
      await setSetting('aiProvider', '');
    }
  }
}

/** Toggle the enabled flag of an entry. */
export async function toggleAiProviderEnabled(
  settings: Partial<AppSettings> | undefined,
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>,
  entryId: string,
  enabled: boolean
): Promise<void> {
  const list = getAiProviders(settings).map(e => (e.id === entryId ? { ...e, enabled } : e));
  await setSetting('aiProviders', list);
  // Deactivating the active entry → fall back to another enabled entry.
  if (!enabled && settings?.aiActiveProviderId === entryId) {
    const next = list.find(e => e.enabled);
    if (next) await activateAiProvider({ ...settings, aiProviders: list }, setSetting, next.id);
    else {
      await setSetting('aiActiveProviderId', '');
      await setSetting('aiProvider', '');
    }
  }
}
