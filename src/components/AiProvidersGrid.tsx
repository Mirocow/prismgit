/**
 * AI Providers Grid (Settings → AI).
 *
 * COMPLETE REWRITE of the old "one config per preset" dropdown UI:
 * providers are now an UNLIMITED registry rendered as a responsive grid
 * of cards. The user can:
 *   - Add any number of Ollama servers (home box, work GPU rig, cluster…)
 *   - Add any number of OpenAI-compatible endpoints (OpenAI, Groq,
 *     OpenRouter, Cerebras, Gemini, Mistral, GitHub Models, Z.ai,
 *     LM Studio, vLLM, corporate gateways, …)
 *   - Edit every field of every entry (name, URL, key, model)
 *   - Test connectivity per card (latency + model count, error details)
 *   - Pick fetched models from a dropdown (Ollama /api/tags or /models)
 *   - Activate one entry (mirrored into legacy flat fields), enable/disable
 *     without deleting, delete with confirmation.
 *
 * API keys are stored in the encrypted vault (safeStorage) — the settings
 * JSON only ever sees empty placeholders (see credentialKeys.ts).
 */

import { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastActions } from '../stores/toastStore';
import { useI18n } from '../lib/i18n';
import { api } from '../lib/api';
import { proxyFetch } from '../lib/aiChat';
import { cn } from '../lib/utils';
import {
  PROVIDER_TEMPLATES, getProviderTemplate, kindToProtocol, kindBadge,
  newProviderId, getAiProviders, getActiveAiProvider,
  ensureAiProvidersMigrated, activateAiProvider, upsertAiProvider,
  removeAiProvider, toggleAiProviderEnabled,
  type ProviderTemplate,
} from '../lib/aiProviders';
import type { AiProviderEntry } from '../../electron/types/settings-api';
import {
  Cpu, Plus, Trash, Pencil, CheckCircle, AlertCircle, Loader, X, Power,
  KeyRound, RefreshCw, ChevronDown, Zap, Lock, Search,
} from './icons';

interface ProviderModelInfo {
  id: string;
  size?: number;
  family?: string;
  parameterSize?: string;
  quantization?: string;
}

interface TestResult {
  loading: boolean;
  ok?: boolean;
  error?: string | null;
  latencyMs?: number;
  modelCount?: number;
}

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

/** Kind badge — colour-coded by protocol. */
function KindBadge({ kind }: { kind: string }) {
  const protocol = kindToProtocol(kind);
  const cls = protocol === 'ollama'
    ? 'bg-status-added/15 text-status-added'
    : protocol === 'anthropic'
      ? 'bg-status-modified/15 text-status-modified'
      : 'bg-accent/15 text-accent';
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-3xs font-bold uppercase tracking-wider shrink-0', cls)}>
      {kindBadge(kind)}
    </span>
  );
}

// ═════════════════════════ Editor modal ═══════════════════════════════════

interface EditorProps {
  /** null → create mode */
  initial: AiProviderEntry | null;
  onClose: () => void;
}

function ProviderEditorModal({ initial, onClose }: EditorProps) {
  const { t } = useI18n();
  const settings = useSettingsStore(s => s.settings);
  const setSetting = useSettingsStore(s => s.setSetting);
  const toast = useToastActions();

  const [templateId, setTemplateId] = useState<string>(initial?.kind ?? 'ollama');
  const [name, setName] = useState(initial?.name ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<ProviderModelInfo[]>([]);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<TestResult | null>(null);

  const template: ProviderTemplate = getProviderTemplate(templateId);
  const protocol = template.protocol;
  const isOllama = protocol === 'ollama';

  // Apply template defaults when the user picks a template in create mode.
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    if (initial) return; // editing — kind is fixed, only defaults change
    const tpl = getProviderTemplate(id);
    setUrl(tpl.defaultUrl);
    setModel(tpl.defaultModel);
    if (!name.trim() || PROVIDER_TEMPLATES.some(tp => tp.label === name.trim())) {
      setName(tpl.label);
    }
  };

  const fetchModels = useCallback(async () => {
    setFetching(true);
    setModelsOpen(true);
    const started = Date.now();
    try {
      // Derive the models URL in the RENDERER (same as CloudModelPicker),
      // then use proxyFetch (IPC → ai:chat handler → Node.js fetch).
      // This is the SAME path that worked before the provider rewrite.
      const connectUrl = (url || '').trim().replace(/\/+$/, '');
      if (!connectUrl) {
        setFetchResult({ loading: false, ok: false, error: 'URL is not configured', modelCount: 0 });
        return;
      }

      // Derive models URL (clone, never modify original).
      let modelsUrl: string;
      if (isOllama) {
        const b = connectUrl.replace(/\/api\/chat$/, '').replace(/\/chat\/completions$/, '');
        modelsUrl = `${b}/api/tags`;
      } else if (protocol === 'anthropic') {
        const b = connectUrl.replace(/\/v1\/messages$/, '');
        modelsUrl = `${b}/v1/models`;
      } else {
        const modelsBase = connectUrl.replace(/\/chat\/completions$/, '');
        modelsUrl = modelsBase.endsWith('/models') ? modelsBase : `${modelsBase}/models`;
      }

      // Build headers.
      const headers: Record<string, string> = {};
      if (apiKey) {
        if (protocol === 'anthropic') {
          headers['x-api-key'] = apiKey;
          headers['anthropic-version'] = '2023-06-01';
        } else {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
      }

      // Use proxyFetch (same path as the old CloudModelPicker that WORKED).
      // proxyFetch sends through the 'ai:chat' IPC handler which uses
      // Node.js fetch() in the main process.
      const result = await proxyFetch(modelsUrl, headers, '', undefined, 'GET');
      if (result.ok) {
        const data = JSON.parse(result.body) as any;
        const rawList: Array<any> = Array.isArray(data) ? data : (data.data || data.models || data || []);
        const modelList: ProviderModelInfo[] = rawList.map((m: any) => ({
          id: m.id || m.name || '',
          ...(m.size ? { size: m.size } : {}),
          ...(m.details?.family ? { family: m.details.family } : {}),
          ...(m.details?.parameter_size ? { parameterSize: m.details.parameter_size } : {}),
          ...(m.details?.quantization_level ? { quantization: m.details.quantization_level } : {}),
          ...(m.details?.format ? { format: m.details.format } : {}),
        })).filter((m: ProviderModelInfo) => m.id);
        setModels(modelList);
        setFetchResult({ loading: false, ok: true, error: null, latencyMs: Date.now() - started, modelCount: modelList.length });
      } else {
        setModels([]);
        const errMsg = result.status === 401
          ? 'Authentication failed — check your API key.'
          : result.status === 0
            ? `Cannot connect to ${modelsUrl}. Check the URL and network.`
            : `HTTP ${result.status}: ${result.statusText}`;
        setFetchResult({ loading: false, ok: false, error: errMsg, latencyMs: Date.now() - started, modelCount: 0 });
      }
    } catch (e) {
      setFetchResult({ loading: false, ok: false, error: String(e), modelCount: 0 });
      setModels([]);
    } finally {
      setFetching(false);
    }
  }, [protocol, url, apiKey, isOllama]);

  const handleSave = async () => {
    const finalName = name.trim() || template.label;
    const finalUrl = url.trim();
    if (!finalUrl && protocol !== 'openai-compatible') {
      toast.error(t('settings.aiGridUrlRequired') || 'URL is required', t('settings.aiGridUrlRequiredHint') || 'Point the provider at its server address.');
      return;
    }
    if (!model.trim() && !isOllama) {
      // Ollama can pick a model later (grid card shows a hint); others need one.
      toast.error(t('settings.aiGridModelRequired') || 'Model is required', 'Enter a model name or fetch the list from the server.');
      return;
    }
    setSaving(true);
    try {
      const entry: AiProviderEntry = {
        id: initial?.id ?? newProviderId(),
        kind: templateId,
        name: finalName,
        url: finalUrl,
        apiKey: apiKey || undefined,
        model: model.trim(),
        enabled,
        createdAt: initial?.createdAt ?? Date.now(),
      };
      await upsertAiProvider(settings, setSetting, entry, { activate: !initial && enabled });
      toast.success(
        (t('settings.aiGridSaved') || 'Provider saved') + `: ${finalName}`,
        !initial ? (t('settings.aiGridSavedHint') || 'It is now available in the AI provider switcher.') : undefined,
      );
      onClose();
    } catch (e) {
      toast.error(t('settings.aiGridSaveFailed') || 'Failed to save provider', String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="panel w-[640px] max-w-[95vw] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle sticky top-0 bg-bg-elevated z-10">
          <h3 className="text-base font-medium">
            {initial
              ? (t('settings.aiGridEditTitle') || 'Edit provider')
              : (t('settings.aiGridAddTitle') || 'Add AI provider')}
          </h3>
          <button className="btn btn-ghost !px-1.5 !py-1" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          {/* Template picker — only meaningful in create mode */}
          {!initial && (
            <div>
              <label className="text-xs text-text-tertiary block mb-1.5 font-medium">
                {t('settings.aiGridTemplate') || 'Type'}
              </label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 max-h-44 overflow-y-auto p-0.5">
                {PROVIDER_TEMPLATES.map(tpl => (
                  <button
                    key={tpl.id}
                    className={cn(
                      'text-left px-2 py-1.5 rounded border text-xs transition-colors flex items-center gap-1.5',
                      templateId === tpl.id
                        ? 'border-accent bg-accent-muted text-accent'
                        : 'border-border-subtle bg-bg-tertiary hover:border-accent/50',
                    )}
                    onClick={() => applyTemplate(tpl.id)}
                    title={tpl.description}
                  >
                    {tpl.protocol === 'ollama' ? <Cpu size={12} className="shrink-0" /> : <Zap size={12} className="shrink-0" />}
                    <span className="truncate">{tpl.label}</span>
                    {tpl.freeTier && templateId !== tpl.id && (
                      <span className="ml-auto text-3xs px-1 rounded bg-status-added/15 text-status-added shrink-0">FREE</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="text-2xs text-text-tertiary mt-1.5">{template.description}</div>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="text-xs text-text-tertiary block mb-1 font-medium">
              {t('settings.aiGridName') || 'Display name'}
            </label>
            <input
              type="text"
              className="w-full text-sm bg-bg-tertiary border border-border-default rounded px-2 py-1.5"
              placeholder={template.label}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="text-2xs text-text-tertiary mt-1">
              {t('settings.aiGridNameHint') || 'Shown in the provider switcher — e.g. "Home Ollama", "Work GPU server".'}
            </div>
          </div>

          {/* URL + API key */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-tertiary block mb-1 font-medium">
                {isOllama ? (t('settings.aiGridServerUrl') || 'Server URL') : (t('settings.apiUrl'))}
              </label>
              <input
                type="text"
                className="w-full text-sm font-mono bg-bg-tertiary border border-border-default rounded px-2 py-1.5"
                placeholder={isOllama ? 'http://localhost:11434' : 'https://api.example.com/v1'}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-text-tertiary block mb-1 font-medium flex items-center gap-1">
                {t('settings.apiKey')}
                {isOllama && <span className="text-3xs normal-case">({t('settings.aiGridKeyOptional') || 'optional'})</span>}
              </label>
              <div className="relative">
                <input
                  type="password"
                  autoComplete="new-password"
                  className="w-full text-sm font-mono bg-bg-tertiary border border-border-default rounded px-2 py-1.5 pr-7"
                  placeholder="sk-…"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                {apiKey && (
                  <Lock size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-status-added" />
                )}
              </div>
              <div className="text-2xs text-text-tertiary mt-1 flex items-center gap-1">
                <Lock size={9} />
                {t('settings.aiGridKeyVaultHint') || 'Stored encrypted in the OS keychain (safeStorage).'}
              </div>
            </div>
          </div>

          {/* Model + fetch button */}
          <div>
            <label className="text-xs text-text-tertiary block mb-1 font-medium">
              {t('settings.model') || 'Model'}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 text-sm font-mono bg-bg-tertiary border border-border-default rounded px-2 py-1.5"
                placeholder={isOllama ? 'llama3.2' : 'gpt-4o-mini'}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
              <button
                className="btn btn-secondary text-xs flex items-center gap-1 shrink-0"
                onClick={() => void fetchModels()}
                disabled={fetching}
                title={isOllama
                  ? 'Fetch the installed models from this Ollama server (/api/tags)'
                  : 'Fetch the model list from this endpoint (GET /models)'}
              >
                {fetching ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {t('settings.aiGridFetchModels') || 'Fetch models'}
              </button>
            </div>

            {/* Fetched models dropdown with search */}
            {modelsOpen && (
              <div className="mt-2 border border-border-default rounded bg-bg-elevated max-h-72 overflow-hidden flex flex-col">
                {fetching && (
                  <div className="px-3 py-2 text-2xs text-text-tertiary flex items-center gap-2">
                    <Loader size={11} className="animate-spin" />
                    {t('settings.aiGridFetching') || 'Contacting server…'}
                  </div>
                )}
                {!fetching && fetchResult && !fetchResult.ok && (
                  <div className="px-3 py-2 text-2xs text-status-error flex items-start gap-1.5">
                    <AlertCircle size={12} className="shrink-0 mt-0.5" />
                    <span className="break-all">{fetchResult.error}</span>
                  </div>
                )}
                {!fetching && fetchResult?.ok && models.length === 0 && (
                  <div className="px-3 py-2 text-2xs text-text-tertiary">
                    {t('settings.aiGridNoModels') || 'Server reachable, but no models found. Pull/install a model first.'}
                  </div>
                )}
                {!fetching && fetchResult?.ok && models.length > 0 && (
                  <>
                    {/* Search field — filters models by name (case-insensitive) */}
                    <div className="relative px-2 py-1.5 border-b border-border-subtle shrink-0">
                      <Search size={11} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                      <input
                        type="text"
                        autoFocus
                        className="w-full text-xs pl-6 pr-2 py-1 bg-bg-tertiary border border-border-default rounded outline-none focus:border-accent"
                        placeholder={t('settings.aiGridSearchModels') || 'Search models...'}
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                      />
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {models
                        .filter(m => !modelSearch.trim() || m.id.toLowerCase().includes(modelSearch.toLowerCase()))
                        .map(m => (
                        <button
                          key={m.id}
                          className={cn(
                            'w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hover transition-colors flex items-center gap-2',
                            model === m.id && 'bg-accent-muted text-accent',
                          )}
                          onClick={() => { setModel(m.id); setModelsOpen(false); setModelSearch(''); }}
                        >
                          <span className="truncate flex-1 font-mono">{m.id}</span>
                          {m.parameterSize && <span className="text-3xs text-text-tertiary shrink-0">{m.parameterSize}</span>}
                          {m.quantization && <span className="text-3xs text-text-tertiary shrink-0">{m.quantization}</span>}
                          {m.size && <span className="text-3xs text-text-tertiary shrink-0">{formatSize(m.size)}</span>}
                        </button>
                      ))}
                      {models.filter(m => !modelSearch.trim() || m.id.toLowerCase().includes(modelSearch.toLowerCase())).length === 0 && (
                        <div className="px-3 py-2 text-2xs text-text-tertiary italic">
                          {t('settings.aiGridNoMatch') || 'No models match'} "{modelSearch}"
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Enabled toggle */}
          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-xs">
              {t('settings.aiGridEnabled') || 'Enabled'}
              <span className="text-text-tertiary"> — {t('settings.aiGridEnabledHint') || 'disabled entries stay configured but are hidden from the switcher'}</span>
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border-subtle sticky bottom-0 bg-bg-elevated">
          <button className="btn btn-secondary text-xs" onClick={onClose}>
            {t('common.cancel') || 'Cancel'}
          </button>
          <button className="btn btn-primary text-xs flex items-center gap-1.5" onClick={() => void handleSave()} disabled={saving}>
            {saving && <Loader size={12} className="animate-spin" />}
            {t('common.save') || 'Save provider'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════ Grid (main component) ══════════════════════════

interface CardTestState extends TestResult {
  /** Show the detailed error block. */
  expanded?: boolean;
}

export function AiProvidersGrid() {
  const { t } = useI18n();
  const settings = useSettingsStore(s => s.settings);
  const setSetting = useSettingsStore(s => s.setSetting);
  const toast = useToastActions();

  const entries = getAiProviders(settings);
  const active = getActiveAiProvider(settings);

  const [editorFor, setEditorFor] = useState<AiProviderEntry | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, CardTestState>>({});
  const [activating, setActivating] = useState<string | null>(null);

  // One-shot legacy → registry migration (idempotent, no-op for new installs).
  useEffect(() => {
    void ensureAiProvidersMigrated(settings, setSetting);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const testProvider = useCallback(async (entry: AiProviderEntry) => {
    setTests(prev => ({ ...prev, [entry.id]: { loading: true } }));
    const started = Date.now();
    try {
      // Derive models URL in renderer (same as fetchModels above),
      // then use proxyFetch (same path as old CloudModelPicker).
      const connectUrl = (entry.url || '').trim().replace(/\/+$/, '');
      if (!connectUrl) {
        setTests(prev => ({ ...prev, [entry.id]: { loading: false, ok: false, error: 'URL not configured' } }));
        return;
      }
      const isOllama = entry.kind === 'ollama';
      const isAnthropic = entry.kind === 'anthropic';
      let modelsUrl: string;
      if (isOllama) {
        const b = connectUrl.replace(/\/api\/chat$/, '').replace(/\/chat\/completions$/, '');
        modelsUrl = `${b}/api/tags`;
      } else if (isAnthropic) {
        const b = connectUrl.replace(/\/v1\/messages$/, '');
        modelsUrl = `${b}/v1/models`;
      } else {
        const modelsBase = connectUrl.replace(/\/chat\/completions$/, '');
        modelsUrl = modelsBase.endsWith('/models') ? modelsBase : `${modelsBase}/models`;
      }
      const headers: Record<string, string> = {};
      if (entry.apiKey) {
        if (isAnthropic) { headers['x-api-key'] = entry.apiKey; headers['anthropic-version'] = '2023-06-01'; }
        else { headers['Authorization'] = `Bearer ${entry.apiKey}`; }
      }
      const result = await proxyFetch(modelsUrl, headers, '', undefined, 'GET');
      const modelCount = result.ok ? (JSON.parse(result.body || '[]') as any[]).length : 0;
      setTests(prev => ({
        ...prev,
        [entry.id]: {
          loading: false,
          ok: result.ok,
          error: result.ok ? null : (result.status === 401 ? 'Auth failed' : `HTTP ${result.status}`),
          latencyMs: Date.now() - started,
          modelCount,
        },
      }));
    } catch (e) {
      setTests(prev => ({ ...prev, [entry.id]: { loading: false, ok: false, error: String(e) } }));
    }
  }, []);

  const handleActivate = useCallback(async (entry: AiProviderEntry) => {
    setActivating(entry.id);
    try {
      await activateAiProvider(settings, setSetting, entry.id);
      toast.success(
        (t('settings.aiGridActivated') || 'Active provider') + `: ${entry.name}`,
        entry.model ? `${entry.model} · ${entry.url}` : entry.url,
      );
    } catch (e) {
      toast.error(t('settings.aiGridActivateFailed') || 'Failed to activate provider', String(e));
    } finally {
      setActivating(null);
    }
  }, [settings, setSetting, toast, t]);

  const handleDelete = useCallback(async (entry: AiProviderEntry) => {
    try {
      await removeAiProvider(settings, setSetting, entry.id);
      if (entry.apiKey) {
        // Best-effort hint that the key was removed from the vault too.
        toast.info((t('settings.aiGridDeleted') || 'Provider removed') + `: ${entry.name}`,
          t('settings.aiGridKeyRemovedHint') || 'Its API key was removed from the encrypted vault.');
      } else {
        toast.info((t('settings.aiGridDeleted') || 'Provider removed') + `: ${entry.name}`);
      }
    } catch (e) {
      toast.error(t('settings.aiGridDeleteFailed') || 'Failed to remove provider', String(e));
    } finally {
      setConfirmDeleteId(null);
    }
  }, [settings, setSetting, toast, t]);

  const openEditor = (entry: AiProviderEntry | null) => {
    setEditorFor(entry);
    setEditorOpen(true);
  };

  const isActive = (entry: AiProviderEntry) => active?.id === entry.id;

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold">
          {t('settings.aiGridSection') || 'AI providers'}{' '}
          <span className="normal-case font-normal">
            ({entries.length}{entries.length === 1 ? '' : ` · ${t('settings.aiGridUnlimited') || 'unlimited — add as many as you need'}`})
          </span>
        </div>
        <button
          className="btn btn-secondary text-xs flex items-center gap-1"
          onClick={() => openEditor(null)}
        >
          <Plus size={12} />
          {t('settings.aiGridAdd') || 'Add provider'}
        </button>
      </div>

      {/* Grid of cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {entries.map(entry => {
          const test = tests[entry.id];
          const entryActive = isActive(entry);
          return (
            <div
              key={entry.id}
              className={cn(
                'panel !mb-0 flex flex-col border transition-colors',
                entryActive ? 'border-accent' : 'border-border-subtle',
                !entry.enabled && 'opacity-60',
              )}
            >
              {/* Card header */}
              <div className="flex items-center gap-2 px-3 pt-3">
                {entry.kind === 'ollama' ? <Cpu size={14} className="text-status-added shrink-0" /> : <Zap size={14} className="text-accent shrink-0" />}
                <span className="text-sm font-medium truncate flex-1" title={entry.name}>{entry.name}</span>
                {entryActive && (
                  <span className="px-1.5 py-0.5 rounded bg-accent text-white text-3xs font-bold uppercase shrink-0">
                    {t('settings.aiGridActive') || 'Active'}
                  </span>
                )}
                {!entry.enabled && (
                  <span className="px-1.5 py-0.5 rounded bg-bg-tertiary text-text-tertiary text-3xs uppercase shrink-0">
                    {t('settings.aiGridOff') || 'Off'}
                  </span>
                )}
              </div>

              {/* Kind + connection info */}
              <div className="px-3 pt-1.5 space-y-1 flex-1">
                <div className="flex items-center gap-1.5">
                  <KindBadge kind={entry.kind} />
                  {entry.apiKey && (
                    <span className="flex items-center gap-0.5 text-3xs text-status-added" title={t('settings.aiGridKeySaved') || 'API key saved in the encrypted vault'}>
                      <KeyRound size={9} />
                      {t('settings.aiGridKeySavedShort') || 'key'}
                    </span>
                  )}
                </div>
                <div className="text-2xs font-mono text-text-tertiary truncate" title={entry.url}>
                  {entry.url || <span className="italic">{t('settings.aiGridNoUrl') || 'no URL'}</span>}
                </div>
                <div className="text-2xs font-mono text-text-secondary truncate" title={entry.model}>
                  {entry.model || <span className="italic text-text-tertiary">{t('settings.aiGridNoModel') || 'pick a model →'}</span>}
                </div>
              </div>

              {/* Test result */}
              {test && !test.loading && test.ok !== undefined && (
                <div className="px-3 pt-1.5">
                  {test.ok ? (
                    <div className="text-2xs text-status-added flex items-center gap-1">
                      <CheckCircle size={11} className="shrink-0" />
                      {t('settings.aiGridTestOk') || 'Connected'} · {test.latencyMs} ms · {test.modelCount} {t('settings.aiGridModelsWord') || 'models'}
                    </div>
                  ) : (
                    <div className="text-2xs text-status-error">
                      <button
                        className="flex items-center gap-1 text-left w-full"
                        onClick={() => setTests(prev => ({ ...prev, [entry.id]: { ...test, expanded: !test.expanded } }))}
                      >
                        <AlertCircle size={11} className="shrink-0" />
                        <span className="truncate flex-1">{t('settings.aiGridTestFail') || 'Connection failed'}</span>
                        <ChevronDown size={10} className={cn('transition-transform shrink-0', test.expanded && 'rotate-180')} />
                      </button>
                      {test.expanded && test.error && (
                        <div className="mt-1 p-1.5 rounded bg-bg-tertiary break-all font-mono text-3xs text-text-secondary">
                          {test.error}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-1 px-3 py-2.5 mt-auto">
                {!entryActive && (
                  <button
                    className="btn btn-secondary !px-2 !py-1 text-2xs flex items-center gap-1 flex-1 min-w-0"
                    onClick={() => void handleActivate(entry)}
                    disabled={activating === entry.id || !entry.enabled}
                    title={t('settings.aiGridActivateHint') || 'Make this the active provider for commits and chat'}
                  >
                    {activating === entry.id ? <Loader size={10} className="animate-spin" /> : <Power size={10} />}
                    <span className="truncate">{t('settings.aiGridActivate') || 'Use'}</span>
                  </button>
                )}
                <button
                  className="btn btn-ghost !px-1.5 !py-1 text-2xs"
                  onClick={() => void testProvider(entry)}
                  title={t('settings.aiGridTest') || 'Test connection'}
                >
                  {test?.loading ? <Loader size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                </button>
                <button
                  className="btn btn-ghost !px-1.5 !py-1 text-2xs"
                  onClick={() => openEditor(entry)}
                  title={t('settings.aiGridEdit') || 'Edit'}
                >
                  <Pencil size={11} />
                </button>
                <button
                  className="btn btn-ghost !px-1.5 !py-1 text-2xs"
                  onClick={() => void toggleAiProviderEnabled(settings, setSetting, entry.id, !entry.enabled)}
                  title={entry.enabled ? (t('settings.aiGridDisable') || 'Disable') : (t('settings.aiGridEnable') || 'Enable')}
                >
                  <Power size={11} className={entry.enabled ? 'text-status-added' : 'text-text-tertiary'} />
                </button>
                {confirmDeleteId === entry.id ? (
                  <div className="flex items-center gap-1 ml-auto">
                    <button
                      className="btn !px-1.5 !py-1 text-2xs bg-status-error/15 text-status-error hover:bg-status-error/25"
                      onClick={() => void handleDelete(entry)}
                      title={t('settings.aiGridConfirmDelete') || 'Confirm delete'}
                    >
                      {t('common.yes') || 'Yes'}
                    </button>
                    <button
                      className="btn btn-ghost !px-1.5 !py-1 text-2xs"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn-ghost !px-1.5 !py-1 text-2xs ml-auto"
                    onClick={() => setConfirmDeleteId(entry.id)}
                    title={t('settings.aiGridDelete') || 'Delete'}
                  >
                    <Trash size={11} />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Add-provider card */}
        <button
          className="panel !mb-0 border-dashed border-2 border-border-default hover:border-accent transition-colors flex flex-col items-center justify-center gap-2 py-8 text-text-tertiary hover:text-accent min-h-40"
          onClick={() => openEditor(null)}
        >
          <Plus size={22} />
          <span className="text-xs font-medium">{t('settings.aiGridAdd') || 'Add provider'}</span>
          <span className="text-2xs text-center px-4">
            {t('settings.aiGridAddHint') || 'Ollama server or OpenAI-compatible endpoint — unlimited'}
          </span>
        </button>
      </div>

      {/* Hint line */}
      <div className="text-2xs text-text-tertiary mt-2">
        {t('settings.aiGridHint') || 'API keys are encrypted via the OS keychain and never touch the settings file in plain text. Disabled entries stay configured but are hidden from the switcher.'}
      </div>

      {/* Editor modal */}
      {editorOpen && (
        <ProviderEditorModal
          initial={editorFor}
          onClose={() => { setEditorOpen(false); setEditorFor(null); }}
        />
      )}
    </div>
  );
}
