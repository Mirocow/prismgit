import { ipcMain, net, session } from 'electron';
import * as ai from '../services/ai.js';
import type { AiProviderConfig } from '../services/ai.js';
import { loadAIMemory, saveAIMemoryEntry, buildMemorySummary } from '../services/aiMemory.js';

// ═══════════════════════════════════════════════════════════════════════════
// netFetch — unified HTTP client for the main process.
//
// Uses Electron's `net.request` with the DEFAULT session, which means:
//   ✓ System proxy settings (HTTP_PROXY, PAC, VPN, Zscaler, GlobalProtect)
//   ✓ System certificate store (macOS Keychain, Windows Certificate Store)
//   ✓ System DNS resolver
//   ✓ Cookie jar (same as the renderer's fetch)
//
// Previous attempts:
//   1. Node.js fetch (undici) → "TypeError: fetch failed" (ignores system proxy)
//   2. net.request without session → "ERR_CONNECTION_CLOSED" (no session =
//      no proxy/cert config)
//   3. net.request + fetch fallback → still failed on some networks
//
// This version: net.request WITH the default session. The default session
// is the same one the renderer uses — it has all the system network
// settings baked in by Chromium on startup.
// ═══════════════════════════════════════════════════════════════════════════

export interface ProviderModelInfo {
  id: string;
  size?: number;
  family?: string;
  parameterSize?: string;
  quantization?: string;
  format?: string;
}

/** Response-like object compatible with old fetch() call sites. */
interface NetResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<any>;
  text: () => Promise<string>;
}

/**
 * Make an HTTP request using Electron's net module.
 *
 * @param url     Full URL (e.g. "https://openrouter.ai/api/v1/models")
 * @param method  HTTP method (default: GET)
 * @param headers Request headers
 * @param body    Request body string (for POST/PUT)
 */
function netFetch(
  url: string,
  method: string = 'GET',
  headers: Record<string, string> = {},
  body?: string,
): Promise<NetResponse> {
  return new Promise((resolve, reject) => {
    // Build the request options. Use the default session so Chromium's
    // network stack (proxy, SSL, DNS, cookies) is used.
    
    const ses = (session as any).defaultSession;
    const sesFetch = ses ? (ses as any).fetch(url, {
      method,
      headers,
      body: (method !== 'GET' && method !== 'HEAD' && body) ? body : undefined,
    }) : null;

    // ses.fetch is available in Electron 32+ (returns a Promise<Response>).
    // If it's not available (older Electron), fall through to net.request.
    if (sesFetch) {
      sesFetch
        .then(async (res: any) => {
          const text = await res.text();
          resolve({
            ok: res.ok,
            status: res.status,
            statusText: res.statusText || '',
            json: async () => JSON.parse(text),
            text: async () => text,
          });
        })
        .catch((err: Error) => {
          // ses.fetch failed — fall back to net.request
          netRequestFallback(url, method, headers, body).then(resolve).catch(reject);
        });
      return;
    }

    // Fall back to net.request if ses.fetch is not available.
    netRequestFallback(url, method, headers, body).then(resolve).catch(reject);
  });
}

/** Fallback: use net.request directly (Electron < 32 or ses.fetch unavailable). */
function netRequestFallback(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<NetResponse> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method });

    // Apply headers
    for (const [key, value] of Object.entries(headers)) {
      request.setHeader(key, value);
    }

    let respBody = '';
    let respStatus = 0;
    let respStatusText = '';

    request.on('response', (response) => {
      respStatus = response.statusCode;
      respStatusText = response.statusMessage || '';
      response.on('data', (chunk: Buffer) => { respBody += chunk.toString(); });
      response.on('end', () => {
        resolve({
          ok: respStatus >= 200 && respStatus < 300,
          status: respStatus,
          statusText: respStatusText,
          json: async () => JSON.parse(respBody),
          text: async () => respBody,
        });
      });
      response.on('error', (e: Error) => reject(e));
    });

    request.on('error', (e: Error) => reject(e));

    if (body && method !== 'GET' && method !== 'HEAD') {
      request.write(body);
    }
    request.end();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// providerListModels — fetch available models from a provider.
//
// The stored provider URL can be in two forms:
//   A) Base URL:      "https://openrouter.ai/api/v1/"
//   B) Full endpoint: "https://openrouter.ai/api/v1/chat/completions"
//
// For the models endpoint we need:
//   A → "https://openrouter.ai/api/v1/models"
//   B → "https://openrouter.ai/api/v1/models"  (strip /chat/completions first)
//
// The original stored URL is NEVER modified — we work on a local clone.
// ═══════════════════════════════════════════════════════════════════════════

export async function providerListModels(
  kind: string,
  url: string,
  apiKey?: string
): Promise<{ ok: boolean; error: string | null; models: ProviderModelInfo[]; latencyMs: number }> {
  const started = Date.now();
  // Clone the URL — never modify the original stored value.
  const connectUrl = (url || '').trim().replace(/\/+$/, '');

  // Default headers for all requests.
  const baseHeaders: Record<string, string> = { 'User-Agent': 'PrismGit/2.1' };
  if (apiKey) baseHeaders['Authorization'] = `Bearer ${apiKey}`;

  try {
    // ── Ollama: strip /api/chat or /chat/completions, append /api/tags ──
    if (kind === 'ollama') {
      const b = connectUrl.replace(/\/api\/chat$/, '').replace(/\/chat\/completions$/, '') || 'http://localhost:11434';
      const res = await netFetch(`${b}/api/tags`, 'GET', baseHeaders);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${res.statusText}`, models: [], latencyMs: Date.now() - started };
      const data = await res.json() as any;
      const models: ProviderModelInfo[] = (data.models || []).map((m: any) => ({
        id: m.name, size: m.size, family: m.details?.family,
        parameterSize: m.details?.parameter_size, quantization: m.details?.quantization_level, format: m.details?.format,
      }));
      return { ok: true, error: null, models, latencyMs: Date.now() - started };
    }

    // ── Anthropic: strip /v1/messages, append /v1/models ──
    if (kind === 'anthropic') {
      const b = connectUrl.replace(/\/v1\/messages$/, '') || 'https://api.anthropic.com';
      const headers: Record<string, string> = { 'x-api-key': apiKey || '', 'anthropic-version': '2023-06-01', 'User-Agent': 'PrismGit/2.1' };
      const res = await netFetch(`${b}/v1/models`, 'GET', headers);
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300) || res.statusText}`, models: [], latencyMs: Date.now() - started };
      }
      const data = await res.json() as any;
      const models: ProviderModelInfo[] = (data.data || data.models || []).map((m: any) => ({ id: m.id || m.name || '' })).filter((m: ProviderModelInfo) => m.id);
      return { ok: true, error: null, models, latencyMs: Date.now() - started };
    }

    // ── OpenAI-compatible (default): strip /chat/completions, append /models ──
    if (!connectUrl) return { ok: false, error: 'URL is not configured', models: [], latencyMs: Date.now() - started };

    const modelsBase = connectUrl.replace(/\/chat\/completions$/, '');
    const modelsUrl = modelsBase.endsWith('/models') ? modelsBase : `${modelsBase}/models`;

    const res = await netFetch(modelsUrl, 'GET', baseHeaders);
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300) || res.statusText}`, models: [], latencyMs: Date.now() - started };
    }
    const data = await res.json() as any;
    const rawList: Array<{ id?: string; name?: string }> = Array.isArray(data) ? data : (data.data || data.models || []);
    const models: ProviderModelInfo[] = rawList.map((m) => ({ id: m.id || m.name || '' })).filter((m) => m.id);
    return { ok: true, error: null, models, latencyMs: Date.now() - started };
  } catch (e) {
    const msg = String(e);
    const friendly = msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('ERR_')
      ? `Cannot connect to ${connectUrl}. Check that the URL is correct and your network allows access. (${msg})`
      : msg;
    return { ok: false, error: friendly, models: [], latencyMs: Date.now() - started };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// IPC Handlers
// ═══════════════════════════════════════════════════════════════════════════

export function registerAiIpc(): void {
  ipcMain.handle(
    'ai:generateCommitMessage',
    (_e, cfg: AiProviderConfig, diff: string, hint?: string) =>
      ai.generateCommitMessage(cfg, diff, hint)
  );

  ipcMain.handle(
    'ai:providerListModels',
    (_e, kind: string, url: string, apiKey?: string) =>
      providerListModels(kind, url, apiKey)
  );

  // ── Ollama-specific handlers ──────────────────────────────────────────
  ipcMain.handle(
    'ai:ollamaListModels',
    async (_e, url: string) => {
      const base = (url || 'http://localhost:11434').replace(/\/+$/, '').replace(/\/api\/chat$/, '').replace(/\/chat\/completions$/, '');
      try {
        const res = await netFetch(`${base}/api/tags`, 'GET', { 'User-Agent': 'PrismGit/2.1' });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, models: [] };
        const data = await res.json() as any;
        const models = (data.models || []).map((m: any) => ({
          name: m.name, size: m.size,
          details: { family: m.details?.family, parameter_size: m.details?.parameter_size, quantization_level: m.details?.quantization_level, format: m.details?.format },
        }));
        return { ok: true, error: null, models };
      } catch (e) {
        return { ok: false, error: String(e), models: [] };
      }
    }
  );

  ipcMain.handle(
    'ai:ollamaListLoadedModels',
    async (_e, url: string) => {
      const base = (url || 'http://localhost:11434').replace(/\/+$/, '');
      try {
        const res = await netFetch(`${base}/api/ps`, 'GET', { 'User-Agent': 'PrismGit/2.1' });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, models: [] };
        const data = await res.json() as any;
        const models = (data.models || []).map((m: any) => ({ name: m.name, expires_at: m.expires_at, size_vram: m.size_vram }));
        return { ok: true, models };
      } catch {
        return { ok: false, error: 'ps_unavailable', models: [] };
      }
    }
  );

  ipcMain.handle(
    'ai:ollamaWarmModel',
    async (_e, url: string, model: string, keepAlive?: string) => {
      const base = (url || 'http://localhost:11434').replace(/\/+$/, '');
      try {
        const res = await netFetch(
          `${base}/api/generate`,
          'POST',
          { 'Content-Type': 'application/json', 'User-Agent': 'PrismGit/2.1' },
          JSON.stringify({ model, prompt: '', keep_alive: keepAlive || '30m', stream: false }),
        );
        return { ok: res.ok };
      } catch {
        return { ok: false };
      }
    }
  );

  // ── Chat proxy (all AI chat requests go through here) ──────────────────
  // The renderer's proxyFetch sends { url, headers, body, method } here.
  // We forward to the actual AI endpoint using netFetch (which uses
  // Chromium's network stack via the default session).
  ipcMain.handle(
    'ai:chat',
    async (_e, config: { url: string; headers: Record<string, string>; body: string; method?: string }) => {
      const httpMethod = config.method || 'POST';
      // Build headers — add Content-Type and User-Agent if missing.
      const hdrs: Record<string, string> = { ...config.headers };
      if (!hdrs['Content-Type'] && !hdrs['content-type']) hdrs['Content-Type'] = 'application/json';
      if (!hdrs['User-Agent'] && !hdrs['user-agent']) hdrs['User-Agent'] = 'PrismGit/2.1';

      try {
        const res = await netFetch(config.url, httpMethod, hdrs, config.body);
        const text = await res.text();
        return { ok: res.ok, status: res.status, statusText: res.statusText, body: text };
      } catch (e) {
        const msg = String(e);
        const friendly = msg.includes('fetch') || msg.includes('abort') || msg.includes('ERR_')
          ? `Failed to connect to ${config.url}. Error: ${msg}. Check the URL, your internet connection, and network/proxy settings.`
          : msg;
        return { ok: false, status: 0, statusText: friendly, body: '' };
      }
    }
  );

  // ── Persistent AI memory ─────────────────────────────────────────────
  ipcMain.handle('ai:getMemory', (_e, repoPath: string) => {
    const memory = loadAIMemory(repoPath);
    return buildMemorySummary(memory);
  });

  ipcMain.handle('ai:saveMemory', (_e, repoPath: string, key: string, value: string, category?: string) => {
    saveAIMemoryEntry(repoPath, key, value, category);
    return true;
  });
}
