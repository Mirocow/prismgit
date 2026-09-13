import { useState, useCallback, useEffect, useMemo } from 'react';
import { RefreshCw, Check, AlertCircle, Loader, Search, Cpu, HardDrive, Zap } from './icons';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

/**
 * Ollama model picker — LM Studio-style list with search + metadata.
 *
 * Fetches /api/tags from the Ollama server via IPC (main process, to bypass
 * CORS — Ollama doesn't send CORS headers).
 *
 * Features (matching the user's reference screenshot):
 *   - Search field at the top — filters models by name (case-insensitive).
 *   - Each model row shows:
 *       • model name (large)
 *       • parameter size (e.g. 11.9B) with a CPU icon
 *       • file size on disk (e.g. 7.0 GB) with a hard-drive icon
 *       • quantization (e.g. Q4_K_M) and family (e.g. llama3) as small badges
 *       • a "loaded" Zap badge if the model is currently warm in memory
 *   - Selected model has a Check badge.
 *   - Auto-warms the selected model via /api/generate keep_alive=30m so the
 *     first chat request responds instantly (otherwise Ollama unloads
 *     after 5 min inactivity and reload takes 5-60s).
 *
 * The "Test Connection" button re-fetches the model list. The list also
 * auto-refreshes when the URL changes (500ms debounce).
 */

interface OllamaModel {
  name: string;
  size?: number;
  family?: string;
  parameterSize?: string;
  quantization?: string;
  format?: string;
}

interface LoadedModel {
  name: string;
  expiresAt?: string;
  sizeVram?: number;
}

export function OllamaModelPicker({
  url,
  selectedModel,
  onSelect,
}: {
  url: string;
  selectedModel: string;
  onSelect: (model: string) => void;
}) {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [loadedModels, setLoadedModels] = useState<LoadedModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [warming, setWarming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState(false);
  const [search, setSearch] = useState('');

  // Fetch models from Ollama /api/tags via IPC (main process, no CORS).
  const fetchModels = useCallback(async (serverUrl: string) => {
    setLoading(true);
    setError(null);
    try {
      const base = serverUrl.trim().replace(/\/$/, '') || 'http://localhost:11434';
      const result = await api.ai.ollamaListModels(base);
      if (result.ok) {
        setModels(result.models as OllamaModel[]);
        setTested(true);
        if (result.models.length === 0) {
          setError('No models found. Run "ollama pull llama3.2" to download a model.');
        }
      } else {
        setModels([]);
        setTested(true);
        setError(result.error || 'Unknown error');
      }
      // Also fetch /api/ps — which models are currently loaded in memory?
      // (best-effort — old Ollama versions don't have /api/ps; we just
      // skip the "loaded" badge in that case.)
      try {
        const ps = await api.ai.ollamaListLoadedModels(base);
        if (ps.ok) setLoadedModels(ps.models as LoadedModel[]);
        else setLoadedModels([]);
      } catch {
        setLoadedModels([]);
      }
    } catch (e) {
      setModels([]);
      setLoadedModels([]);
      setTested(true);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fetch when the URL changes (debounced 500ms)
  useEffect(() => {
    if (!url) return;
    const timer = setTimeout(() => void fetchModels(url), 500);
    return () => clearTimeout(timer);
  }, [url, fetchModels]);

  // Filter models by search query (case-insensitive, matches name or family).
  const filteredModels = useMemo(() => {
    if (!search.trim()) return models;
    const q = search.toLowerCase().trim();
    return models.filter(m =>
      m.name.toLowerCase().includes(q) ||
      (m.family && m.family.toLowerCase().includes(q))
    );
  }, [models, search]);

  // Set of currently-loaded model names (for the "loaded" Zap badge).
  const loadedNames = useMemo(() => new Set(loadedModels.map(m => m.name)), [loadedModels]);

  // Select a model + warm it up so the next chat request is instant.
  // Without this, Ollama unloads the model after 5 min of inactivity and
  // the user has to wait 5-60s for the model to reload on the next message
  // — which the user explicitly complained about ("Модель надо /ps иначе
  // она выкидывает модель и потом долго приходится ждать ее загрузки").
  const handleSelect = useCallback(async (modelName: string) => {
    onSelect(modelName);
    // Warm up the model — send a no-op generate request with keep_alive=30m.
    // This loads the model into memory and resets the inactivity timer so
    // it stays resident for the next 30 minutes.
    setWarming(modelName);
    try {
      const base = (url || 'http://localhost:11434').trim().replace(/\/$/, '');
      await api.ai.ollamaKeepAlive(base, modelName, '30m');
      // Refresh /api/ps so the "loaded" badge appears next to this model.
      const ps = await api.ai.ollamaListLoadedModels(base);
      if (ps.ok) setLoadedModels(ps.models as LoadedModel[]);
    } catch {
      // Warm-up failed — the model will still work, just slower on the
      // first message. Don't surface an error; the user can retry by
      // clicking the model again.
    } finally {
      setWarming(null);
    }
  }, [onSelect, url]);

  return (
    <div className="pt-3 border-t border-border-subtle">
      <div className="flex items-center justify-between mb-2">
        <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold">
          Ollama Models {loadedModels.length > 0 && (
            <span className="ml-1 text-status-added normal-case">· {loadedModels.length} loaded</span>
          )}
        </div>
        <button
          className={cn(
            'flex items-center gap-1 text-2xs px-2 py-0.5 rounded border transition-colors',
            tested && !error && models.length > 0
              ? 'border-status-added/40 bg-status-added/10 text-status-added'
              : 'border-border-default bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
          )}
          onClick={() => void fetchModels(url)}
          disabled={loading}
          title={t_action_refreshModels()}
        >
          {loading ? <Loader size={10} className="animate-spin" /> : <RefreshCw size={10} />}
          {tested && !error && models.length > 0 ? `${models.length} models` : 'Test Connection'}
        </button>
      </div>

      {/* Search field — appears only when there are models to filter. */}
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

      {/* Model list — LM Studio-style rows with metadata. */}
      {models.length > 0 ? (
        filteredModels.length > 0 ? (
          <div className="border border-border-default rounded overflow-hidden max-h-72 overflow-y-auto">
            {filteredModels.map((m) => {
              const isSelected = m.name === selectedModel;
              const isLoaded = loadedNames.has(m.name);
              const isWarming = warming === m.name;
              // Extract parameter count from Ollama's "details.parameter_size"
              // (e.g. "11.9B", "7B") — fall back to "—" if missing.
              const paramCount = m.parameterSize || '—';
              const sizeGb = m.size ? `${(m.size / 1e9).toFixed(1)} GB` : '';
              return (
                <button
                  key={m.name}
                  onClick={() => void handleSelect(m.name)}
                  className={cn(
                    'w-full text-left px-2.5 py-1.5 border-b border-border-subtle last:border-b-0 transition-colors flex items-center gap-2',
                    isSelected ? 'bg-accent-muted hover:bg-accent-muted' : 'hover:bg-bg-hover'
                  )}
                >
                  {/* Selected / warming indicator */}
                  <span className="w-4 flex-shrink-0 flex items-center justify-center">
                    {isWarming ? (
                      <Loader size={11} className="animate-spin text-accent" />
                    ) : isSelected ? (
                      <Check size={11} className="text-accent" />
                    ) : null}
                  </span>

                  {/* Name + badges */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-text-primary truncate">{m.name}</span>
                      {isLoaded && (
                        <span className="flex items-center gap-0.5 text-3xs px-1 py-0 rounded bg-status-added/15 text-status-added" title="Model is currently loaded in memory (warm) — responds instantly">
                          <Zap size={9} />
                          loaded
                        </span>
                      )}
                    </div>
                    {/* Metadata row */}
                    <div className="flex items-center gap-2 text-2xs text-text-tertiary mt-0.5">
                      {paramCount !== '—' && (
                        <span className="flex items-center gap-0.5" title="Parameter count">
                          <Cpu size={9} />
                          {paramCount}
                        </span>
                      )}
                      {sizeGb && (
                        <span className="flex items-center gap-0.5" title="File size on disk">
                          <HardDrive size={9} />
                          {sizeGb}
                        </span>
                      )}
                      {m.quantization && (
                        <span className="px-1 py-0 rounded bg-bg-tertiary text-text-tertiary" title="Quantization">
                          {m.quantization}
                        </span>
                      )}
                      {m.family && (
                        <span className="px-1 py-0 rounded bg-bg-tertiary text-text-tertiary" title="Model family">
                          {m.family}
                        </span>
                      )}
                    </div>
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
      ) : (
        <div className="text-2xs text-text-tertiary italic">
          No models loaded. Click "Test Connection" or run <code className="mono bg-bg-tertiary px-1 rounded">ollama pull llama3.2</code>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mt-2 flex items-start gap-1.5 text-2xs text-status-error">
          <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Success indicator */}
      {tested && !error && models.length > 0 && (
        <div className="mt-2 flex items-center gap-1 text-2xs text-status-added">
          <Check size={11} />
          <span>Connected to {url || 'http://localhost:11434'}</span>
        </div>
      )}
    </div>
  );
}

// Local helper — the parent SettingsPage already has a t() for this string,
// but this component is also used standalone so we fall back to English.
function t_action_refreshModels(): string {
  return 'Refresh model list from Ollama server';
}
