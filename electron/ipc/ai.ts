import { ipcMain } from 'electron';
import * as ai from '../services/ai.js';
import type { AiProviderConfig } from '../services/ai.js';
import { loadAIMemory, saveAIMemoryEntry, buildMemorySummary } from '../services/aiMemory.js';

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
        const response = await fetch(`${base}/api/tags`);
        if (!response.ok) {
          return { ok: false, error: `HTTP ${response.status} ${response.statusText}`, models: [] };
        }
        const data = await response.json();
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
        const response = await fetch(`${base}/api/ps`);
        if (!response.ok) {
          return { ok: false, error: `HTTP ${response.status}`, models: [] };
        }
        const data = await response.json();
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
        const response = await fetch(`${base}/api/generate`, {
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
        const fetchOpts: RequestInit = {
          method: httpMethod,
          headers: config.headers,
          signal: controller.signal,
        };
        if (httpMethod !== 'GET' && httpMethod !== 'HEAD' && config.body) {
          fetchOpts.body = config.body;
        }
        const res = await fetch(config.url, fetchOpts);
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
}
