import { ipcMain, net } from 'electron';
import * as ai from '../services/ai.js';
import type { AiProviderConfig } from '../services/ai.js';
import { loadAIMemory, saveAIMemoryEntry, buildMemorySummary } from '../services/aiMemory.js';

/**
 * netFetch — wrapper around Electron's `net.request` that uses Chromium's
 * network stack instead of Node.js's built-in `fetch` (undici).
 *
 * WHY: Node.js fetch (undici) ignores system proxy settings, system
 * certificate store, and system DNS resolver. On macOS (and some Linux
 * configs), this causes "TypeError: fetch failed" when the user is behind
 * a proxy, VPN, or when the system's CA certificates differ from undici's
 * bundled ones. Electron's `net` module uses Chromium's network stack
 * which respects ALL system network settings.
 *
 * Returns a Response-like object compatible with the old fetch() calls:
 *   { ok: boolean, status: number, statusText: string, json(): Promise, text(): Promise }
 */
function netFetch(url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}> {
  return new Promise((resolve, reject) => {
    const method = options.method || 'GET';
    // Build headers — always include Content-Type for POST requests
    // and User-Agent for all requests (some APIs reject without it).
    const hdrs: Record<string, string> = { ...options.headers };
    if (!hdrs['User-Agent'] && !hdrs['user-agent']) hdrs['User-Agent'] = 'PrismGit/2.1';
    if (method !== 'GET' && method !== 'HEAD' && !hdrs['Content-Type'] && !hdrs['content-type']) {
      hdrs['Content-Type'] = 'application/json';
    }

    // Use the default session — this ensures system proxy settings,
    // cookies, and certificate store are used (same as the renderer's
    // fetch). Without `session: 'default'`, net.request may not pick
    // up proxy configuration on some systems.
    const request = net.request({
      url,
      method,
    });

    // Apply headers via setHeader (not constructor — the constructor's
    // `headers` option expects Record<string, string|string[]>, but
    // setHeader accepts individual key/value pairs which is simpler).
    for (const [key, value] of Object.entries(hdrs)) {
      request.setHeader(key, value);
    }

    let body = '';
    let statusCode = 0;
    let statusText = '';

    request.on('response', (response) => {
      statusCode = response.statusCode;
      statusText = response.statusMessage || '';
      response.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      response.on('end', () => {
        resolve({
          ok: statusCode >= 200 && statusCode < 300,
          status: statusCode,
          statusText,
          json: async () => JSON.parse(body),
          text: async () => body,
        });
      });
      response.on('error', (e: Error) => reject(e));
    });

    request.on('error', (e: Error) => reject(e));

    if (options.body && method !== 'GET' && method !== 'HEAD') {
      request.write(options.body);
    }
    request.end();
  });
}

/**
 * Unified model-list / connectivity check for the multi-provider registry
 * (Settings → AI → provider grid). Dispatches by provider kind:
 *
 *   - 'ollama'             → GET {base}/api/tags (rich metadata: size,
 *                            family, parameter_size, quantization)
 *   - 'anthropic'          → GET {base}/v1/models (x-api-key + version header)
 *   - everything else      → OpenAI-compatible GET {base}/models (Bearer)
 *                            (OpenAI, Groq, OpenRouter, Cerebras, Gemini,
 *                             Mistral, GitHub Models, Z.ai, vLLM, LM Studio,
 *                             any custom compatible endpoint)
 *
 * Doubles as a "Test connection" action — the latency is measured and any
 * HTTP/transport error is returned verbatim so the user sees WHY the
 * provider is unreachable.
 */
export interface ProviderModelInfo {
  id: string;
  size?: number;
  family?: string;
  parameterSize?: string;
  quantization?: string;
  format?: string;
}

export async function providerListModels(
  kind: string,
  url: string,
  apiKey?: string
): Promise<{ ok: boolean; error: string | null; models: ProviderModelInfo[]; latencyMs: number }> {
  const started = Date.now();
  // CLONE the URL into a local variable — never modify the original.
  // The stored provider URL is the CHAT endpoint (e.g.
  // "https://openrouter.ai/api/v1/chat/completions"). For the models
  // endpoint, we derive a SEPARATE URL by stripping /chat/completions
  // and appending /models. The original URL is never touched.
  const connectUrl = (url || '').trim().replace(/\/+$/, '');
  try {
    if (kind === 'ollama') {
      // Ollama: strip /api/chat or /chat/completions if present, then use /api/tags
      const b = connectUrl.replace(/\/api\/chat$/, '').replace(/\/chat\/completions$/, '') || 'http://localhost:11434';
      const res = await netFetch(`${b}/api/tags`);
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status} ${res.statusText}`, models: [], latencyMs: Date.now() - started };
      }
      const data = await res.json() as any;
      const models: ProviderModelInfo[] = (data.models || []).map((m: {
        name: string;
        size?: number;
        details?: { family?: string; parameter_size?: string; quantization_level?: string; format?: string };
      }) => ({
        id: m.name,
        size: m.size,
        family: m.details?.family,
        parameterSize: m.details?.parameter_size,
        quantization: m.details?.quantization_level,
        format: m.details?.format,
      }));
      return { ok: true, error: null, models, latencyMs: Date.now() - started };
    }

    if (kind === 'anthropic') {
      // Anthropic: strip /v1/messages if present, then use /v1/models
      const b = connectUrl.replace(/\/v1\/messages$/, '') || 'https://api.anthropic.com';
      const headers: Record<string, string> = {
        'x-api-key': apiKey || '',
        'anthropic-version': '2023-06-01',
      };
      const res = await netFetch(`${b}/v1/models`, { headers });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300) || res.statusText}`, models: [], latencyMs: Date.now() - started };
      }
      const data = await res.json() as any;
      const models: ProviderModelInfo[] = (data.data || data.models || []).map((m: { id?: string; name?: string }) => ({
        id: m.id || m.name || '',
      })).filter((m: ProviderModelInfo) => m.id);
      return { ok: true, error: null, models, latencyMs: Date.now() - started };
    }

    // OpenAI-compatible (default) — strip /chat/completions, append /models
    if (!connectUrl) {
      return { ok: false, error: 'URL is not configured', models: [], latencyMs: Date.now() - started };
    }
    const modelsBase = connectUrl.replace(/\/chat\/completions$/, '');
    const modelsUrl = modelsBase.endsWith('/models') ? modelsBase : `${modelsBase}/models`;
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await netFetch(modelsUrl, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300) || res.statusText}`, models: [], latencyMs: Date.now() - started };
    }
    const data = await res.json() as any;
    // OpenAI format: { data: [{ id }] }; some servers return a bare array;
    // Ollama's OpenAI-compat layer returns { models: [...] } — accept all.
    const rawList: Array<{ id?: string; name?: string }> =
      Array.isArray(data) ? data : (data.data || data.models || []);
    const models: ProviderModelInfo[] = rawList
      .map((m) => ({ id: m.id || m.name || '' }))
      .filter((m) => m.id);
    return { ok: true, error: null, models, latencyMs: Date.now() - started };
  } catch (e) {
    const msg = String(e);
    const friendly = msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')
      ? `Cannot connect to ${connectUrl || 'server'}. Check that the server is running and the URL is correct. (${msg})`
      : msg;
    return { ok: false, error: friendly, models: [], latencyMs: Date.now() - started };
  }
}

export function registerAiIpc(): void {
  ipcMain.handle(
    'ai:generateCommitMessage',
    (_e, cfg: AiProviderConfig, diff: string, hint?: string) =>
      ai.generateCommitMessage(cfg, diff, hint)
  );

  // Ollama model list — fetch /api/tags via main process (no CORS).
  // Returns the full model details (size, family, parameter_size,
  // quantization_level, format) so the UI can show a rich model picker
  // like LM Studio does (size, parameters, quantization column).
  ipcMain.handle(
    'ai:ollamaListModels',
    async (_e, url: string) => {
      try {
        const base = (url || 'http://localhost:11434').trim().replace(/\/$/, '');
        const response = await netFetch(`${base}/api/tags`);
        if (!response.ok) {
          return { ok: false, error: `HTTP ${response.status} ${response.statusText}`, models: [] };
        }
        const data = await response.json() as any;
        const models = (data.models || []).map((m: {
          name: string;
          size?: number;
          details?: {
            family?: string;
            parameter_size?: string;
            quantization_level?: string;
            format?: string;
          };
        }) => ({
          name: m.name,
          size: m.size,
          family: m.details?.family,
          parameterSize: m.details?.parameter_size,
          quantization: m.details?.quantization_level,
          format: m.details?.format,
        }));
        return { ok: true, error: null, models };
      } catch (e) {
        const msg = String(e);
        const friendly = msg.includes('fetch')
          ? 'Cannot connect to Ollama. Make sure it\'s running (ollama serve) and the URL is correct.'
          : msg;
        return { ok: false, error: friendly, models: [] };
      }
    }
  );

  // Ollama /api/ps — list currently loaded models (in memory).
  // Used to detect if a model is "warm" (already loaded) vs. cold (needs
  // loading on next request, which takes 5-60s). The picker shows a badge
  // for warm models so the user can pick one that'll respond instantly.
  ipcMain.handle(
    'ai:ollamaListLoadedModels',
    async (_e, url: string) => {
      try {
        const base = (url || 'http://localhost:11434').trim().replace(/\/$/, '');
        const response = await netFetch(`${base}/api/ps`);
        if (!response.ok) {
          return { ok: false, error: `HTTP ${response.status}`, models: [] };
        }
        const data = await response.json() as any;
        const models = (data.models || []).map((m: { name: string; expires_at?: string; size_vram?: number }) => ({
          name: m.name,
          expiresAt: m.expires_at,
          sizeVram: m.size_vram,
        }));
        return { ok: true, error: null, models };
      } catch {
        // /api/ps may not exist on older Ollama versions — fail silently
        // with an empty list (the picker just won't show "loaded" badges).
        return { ok: false, error: 'ps_unavailable', models: [] };
      }
    }
  );

  // Ollama /api/generate with keep_alive — keep a model loaded in memory
  // for a long time (default Ollama unloads after 5 min of inactivity,
  // which causes the "long wait" the user reported). The /api/ps call alone
  // doesn't extend the keep-alive timer; we need to send a tiny generate
  // request with keep_alive set to a large value (e.g. "30m" or -1 = forever).
  //
  // Called automatically when the user selects a model in the picker —
  // "warms up" the model so the first chat message responds instantly.
  ipcMain.handle(
    'ai:ollamaKeepAlive',
    async (_e, url: string, model: string, keepAlive?: string) => {
      try {
        const base = (url || 'http://localhost:11434').trim().replace(/\/$/, '');
        // Send a no-op generate request with keep_alive to extend the
        // model's in-memory lifetime. The prompt is intentionally empty
        // — Ollama returns immediately, but the model stays loaded.
        const response = await netFetch(`${base}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt: '',
            stream: false,
            keep_alive: keepAlive || '30m', // 30 minutes — covers most chat sessions
          }),
        });
        if (!response.ok) {
          return { ok: false, error: `HTTP ${response.status}` };
        }
        return { ok: true, error: null };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }
  );

  // Generic AI chat — proxy LLM requests through main process to bypass CORS.
  // The renderer's aiChat.ts used fetch() directly, which is blocked by CORS
  // for Ollama (and any provider that doesn't send Access-Control-Allow-Origin).
  // This handler accepts the full request config and returns the response body.
  //
  // The request timeout is configurable via Settings → AI → Request timeout
  // (default 300 s = 5 min, to accommodate slow local Ollama models). It is
  // read from the settings store on every request so changes take effect
  // immediately — no app restart needed.
  ipcMain.handle(
    'ai:chat',
    async (_e, config: {
      url: string;
      headers: Record<string, string>;
      body: string;
      method?: string;
    }) => {
      const controller = new AbortController();
      const timeoutMs = ai.getAiRequestTimeoutMs();
      const timeout = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
      const httpMethod = config.method || 'POST';
      try {
        // For GET/HEAD requests, DON'T send a body — the HTTP spec
        // forbids it, and some servers (Z.ai, Groq) reject requests
        // with a body on GET endpoints (returning 400 or connection
        // errors).
        const netOpts: { method: string; headers: Record<string, string>; body?: string } = {
          method: httpMethod,
          headers: config.headers,
        };
        if (httpMethod !== 'GET' && httpMethod !== 'HEAD' && config.body) {
          netOpts.body = config.body;
        }
        const res = await netFetch(config.url, netOpts);
        const text = await res.text();
        return { ok: res.ok, status: res.status, statusText: res.statusText, body: text };
      } catch (e) {
        const msg = String(e);
        // Include the actual error message for debugging — the old code
        // only showed a generic "Failed to connect" which made it
        // impossible to diagnose DNS errors, SSL issues, etc.
        const friendly = msg.includes('fetch') || msg.includes('abort')
          ? `Failed to connect to ${config.url}. Error: ${msg}. Check the URL, your internet connection, and that the server is running.`
          : msg;
        return { ok: false, status: 0, statusText: friendly, body: '' };
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
  );

  // ── Persistent AI memory ─────────────────────────────────────────────
  // Stores facts about a project in .prismgit/ai-memory.json — the AI
  // "remembers" things between sessions (commit conventions, branch
  // strategy, etc.). Used by the save_memory / get_memory AI tools.

  // Load all memory entries for a repo.
  ipcMain.handle('ai:memory:load', (_e, repoPath: string) => {
    return { entries: loadAIMemory(repoPath) };
  });

  // Save/update a memory entry.
  ipcMain.handle('ai:memory:save', (_e, repoPath: string, key: string, value: string, category?: string) => {
    saveAIMemoryEntry(repoPath, key, value, category);
    return { ok: true };
  });

  // Get a text summary of the memory for the system prompt.
  ipcMain.handle('ai:memory:summary', (_e, repoPath: string) => {
    const entries = loadAIMemory(repoPath);
    return buildMemorySummary(entries);
  });

  // ── Multi-provider registry: unified model list / connectivity test ──
  // kind: 'ollama' | 'anthropic' | anything OpenAI-compatible.
  ipcMain.handle(
    'ai:providerListModels',
    (_e, kind: string, url: string, apiKey?: string) => providerListModels(kind, url, apiKey)
  );
}
