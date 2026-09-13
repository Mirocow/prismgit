import { ipcMain } from 'electron';
import * as ai from '../services/ai.js';
import type { AiProviderConfig } from '../services/ai.js';

export function registerAiIpc(): void {
  ipcMain.handle(
    'ai:generateCommitMessage',
    (_e, cfg: AiProviderConfig, diff: string, hint?: string) =>
      ai.generateCommitMessage(cfg, diff, hint)
  );

  // Ollama model list — fetch /api/tags via main process (no CORS).
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
        const models = (data.models || []).map((m: { name: string; size?: number }) => ({
          name: m.name,
          size: m.size,
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
      try {
        const res = await fetch(config.url, {
          method: config.method || 'POST',
          headers: config.headers,
          body: config.body,
          signal: controller.signal,
        });
        const text = await res.text();
        return { ok: res.ok, status: res.status, statusText: res.statusText, body: text };
      } catch (e) {
        const msg = String(e);
        const friendly = msg.includes('fetch') || msg.includes('abort')
          ? `Failed to connect to ${config.url}. Check if the server is running and the URL is correct.`
          : msg;
        return { ok: false, status: 0, statusText: friendly, body: '' };
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
  );
}
