import { useState, useCallback, useEffect } from 'react';
import { RefreshCw, Check, AlertCircle, Loader } from './icons';
import { cn } from '../lib/utils';

/**
 * Ollama model picker — fetches /api/tags from the Ollama server and
 * presents a dropdown of available models. The user can select instead
 * of typing the model name manually.
 *
 * Features:
 *   - "Test Connection" button → fetches the model list
 *   - Green badge with model count on success
 *   - Red error message on failure (wrong URL, server down, CORS)
 *   - Model dropdown auto-refreshes when the URL changes
 *   - Selected model is persisted via onSelect callback
 *
 * Ollama API: GET {url}/api/tags → { models: [{ name: "llama3.2:latest", size: 3825819519, ... }] }
 */
export function OllamaModelPicker({
  url,
  selectedModel,
  onSelect,
}: {
  url: string;
  selectedModel: string;
  onSelect: (model: string) => void;
}) {
  const [models, setModels] = useState<{ name: string; size?: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState(false);

  // Fetch models from Ollama /api/tags
  const fetchModels = useCallback(async (serverUrl: string) => {
    setLoading(true);
    setError(null);
    try {
      // Normalize URL: strip trailing slash, default to http://localhost:11434
      const base = serverUrl.trim().replace(/\/$/, '') || 'http://localhost:11434';
      const tagsUrl = `${base}/api/tags`;
      const response = await fetch(tagsUrl, { method: 'GET' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      const modelList: { name: string; size?: number }[] = (data.models || []).map((m: { name: string; size?: number }) => ({
        name: m.name,
        size: m.size,
      }));
      setModels(modelList);
      setTested(true);
      if (modelList.length === 0) {
        setError('No models found. Run "ollama pull llama3.2" to download a model.');
      }
    } catch (e) {
      setModels([]);
      setTested(true);
      const msg = String(e);
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setError('Cannot connect to Ollama. Make sure it\'s running (ollama serve) and the URL is correct.');
      } else {
        setError(msg);
      }
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

  return (
    <div className="pt-3 border-t border-border-subtle">
      <div className="flex items-center justify-between mb-2">
        <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold">
          Ollama Models
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
          title="Refresh model list from Ollama server"
        >
          {loading ? <Loader size={10} className="animate-spin" /> : <RefreshCw size={10} />}
          {tested && !error && models.length > 0 ? `${models.length} models` : 'Test Connection'}
        </button>
      </div>

      {/* Model dropdown */}
      {models.length > 0 ? (
        <select
          className="w-full text-sm font-mono bg-bg-tertiary border border-border-default rounded px-2 py-1.5"
          value={selectedModel}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="">— Select a model —</option>
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
              {m.size ? ` (${(m.size / 1e9).toFixed(1)} GB)` : ''}
            </option>
          ))}
        </select>
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
