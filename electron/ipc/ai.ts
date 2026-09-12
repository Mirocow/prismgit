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
  // The renderer can't fetch Ollama directly because Ollama doesn't
  // send Access-Control-Allow-Origin headers, so the browser blocks it.
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
}
