import { useState, useCallback, useEffect, useMemo } from 'react';
import { RefreshCw, Check, AlertCircle, Loader, Search } from './icons';
import { api } from '../lib/api';
import { proxyFetch } from '../lib/aiChat';
import { cn } from '../lib/utils';
import { type ProviderPreset } from '../lib/aiCommitMessages';

/**
 * Cloud model picker — fetches the available models list from a cloud
 * provider's /models endpoint (OpenAI-compatible). Works with:
 *   - OpenAI (https://api.openai.com/v1/models)
 *   - Groq (https://api.groq.com/openai/v1/models)
 *   - Cerebras (https://api.cerebras.ai/v1/models)
 *   - OpenRouter (https://openrouter.ai/api/v1/models)
 *   - Z.ai (https://api.z.ai/api/paas/v4/models)
 *   - Mistral (https://api.mistral.ai/v1/models)
 *   - GitHub Models (https://models.inference.ai.azure.com/models)
 *   - Hugging Face (https://api-inference.huggingface.co/models)
 *
 * All these providers expose an OpenAI-compatible /v1/models endpoint that
 * returns a JSON list of available models. The picker fetches this list
 * via IPC (main process — bypasses CORS) and lets the user select a model
 * from a searchable dropdown instead of typing the model name manually.
 *
 * For Anthropic and Ollama, the picker is NOT shown:
 *   - Anthropic has a different API (no /v1/models endpoint).
 *   - Ollama uses its own OllamaModelPicker with richer metadata.
 */

interface CloudModel {
  id: string;
  owned_by?: string;
}

export function CloudModelPicker({
  preset,
  url,
  apiKey,
  selectedModel,
  onSelect,
}: {
  preset: ProviderPreset;
  url: string;
  apiKey?: string;
  selectedModel: string;
  onSelect: (model: string) => void;
}) {
  const [models, setModels] = useState<CloudModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState(false);
  const [search, setSearch] = useState('');

  // Derive the /models endpoint from the provider's base URL.
  // Most providers use /v1/models or /models appended to the base URL.
  const modelsUrl = useMemo(() => {
    const base = (url || preset.defaultUrl).replace(/\/chat\/completions$/, '').replace(/\/+$/, '');
    // If the URL already ends with /models, use it as-is.
    if (base.endsWith('/models')) return base;
    // Common patterns:
    //   /v1/chat/completions → /v1/models
    //   /api/paas/v4/chat/completions → /api/paas/v4/models
    //   /openai/v1/chat/completions → /openai/v1/models
    if (base.includes('/chat/completions')) {
      return base.replace('/chat/completions', '/models');
    }
    // Fallback: just append /models
    return base + '/models';
  }, [url, preset.defaultUrl]);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Use proxyFetch (IPC proxy) to bypass CORS. Send a GET request
      // to the provider's /models endpoint.
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const result = await proxyFetch(modelsUrl, headers, '', undefined, 'GET');
      if (result.ok) {
        const data = JSON.parse(result.body);
        const modelList: CloudModel[] = (data.data || data.models || data || [])
          .map((m: { id?: string; name?: string; owned_by?: string }) => ({
            id: m.id || m.name || '',
            owned_by: m.owned_by,
          }))
          .filter((m: CloudModel) => m.id);
        setModels(modelList);
        setTested(true);
        if (modelList.length === 0) {
          setError('No models found. Check your API key.');
        }
      } else {
        setModels([]);
        setTested(true);
        if (result.status === 401) {
          setError('Authentication failed — check your API key.');
        } else if (result.status === 0) {
          setError('Cannot connect to the server. Check the URL and your internet connection.');
        } else {
          setError(`HTTP ${result.status}: ${result.statusText}`);
        }
      }
    } catch (e) {
      setModels([]);
      setTested(true);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [modelsUrl, apiKey]);

  // Auto-fetch when URL or API key changes (debounced 1s).
  useEffect(() => {
    if (!url && !preset.defaultUrl) return;
    if (!apiKey && !preset.freeTier) return; // skip if API key needed but missing
    const timer = setTimeout(() => void fetchModels(), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsUrl, apiKey]);

  const filteredModels = useMemo(() => {
    if (!search.trim()) return models;
    const q = search.toLowerCase();
    return models.filter(m => m.id.toLowerCase().includes(q) || (m.owned_by?.toLowerCase().includes(q)));
  }, [models, search]);

  return (
    <div className="pt-3 border-t border-border-subtle">
      <div className="flex items-center justify-between mb-2">
        <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold">
          Available Models {models.length > 0 && `(${models.length})`}
        </div>
        <button
          className={cn(
            'flex items-center gap-1 text-2xs px-2 py-0.5 rounded border transition-colors',
            tested && !error && models.length > 0
              ? 'border-status-added/40 bg-status-added/10 text-status-added'
              : 'border-border-default bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
          )}
          onClick={() => void fetchModels()}
          disabled={loading}
          title="Fetch available models from the provider"
        >
          {loading ? <Loader size={10} className="animate-spin" /> : <RefreshCw size={10} />}
          {tested && !error && models.length > 0 ? `${models.length} models` : 'Test & Fetch Models'}
        </button>
      </div>

      {models.length > 0 && (
        <div className="relative mb-2">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
          <input
            type="text"
            className="w-full text-xs pl-7 pr-2 py-1.5 bg-bg-tertiary border border-border-default rounded outline-none focus:border-accent"
            placeholder="Search models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {models.length > 0 ? (
        filteredModels.length > 0 ? (
          <div className="border border-border-default rounded overflow-hidden max-h-60 overflow-y-auto">
            {filteredModels.map((m) => {
              const isSelected = m.id === selectedModel;
              return (
                <button
                  key={m.id}
                  onClick={() => onSelect(m.id)}
                  className={cn(
                    'w-full text-left px-2.5 py-1.5 border-b border-border-subtle last:border-b-0 transition-colors flex items-center gap-2',
                    isSelected ? 'bg-accent-muted hover:bg-accent-muted' : 'hover:bg-bg-hover'
                  )}
                >
                  <span className="w-4 flex-shrink-0">
                    {isSelected && <Check size={11} className="text-accent" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-text-primary truncate">{m.id}</div>
                    {m.owned_by && (
                      <div className="text-3xs text-text-tertiary">{m.owned_by}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-2xs text-text-tertiary italic px-1 py-2">
            No models match "{search}".
          </div>
        )
      ) : !loading && !error ? (
        <div className="text-2xs text-text-tertiary italic">
          Click "Test & Fetch Models" to load the available models for this provider.
          {!apiKey && !preset.freeTier && ' An API key is required.'}
        </div>
      ) : null}

      {error && (
        <div className="mt-2 flex items-start gap-1.5 text-2xs text-status-error">
          <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {tested && !error && models.length > 0 && (
        <div className="mt-2 flex items-center gap-1 text-2xs text-status-added">
          <Check size={11} />
          <span>Connected — {models.length} models available</span>
        </div>
      )}
    </div>
  );
}
