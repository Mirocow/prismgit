/**
 * AI utilities — shared helpers used across the AI subsystem.
 *
 * This module centralizes all the duplicated logic that was previously
 * copy-pasted across aiChat.ts, aiTools.ts, aiProviders.ts,
 * aiCommitMessages.ts, ipc/ai.ts, CloudModelPicker.tsx,
 * AiProvidersGrid.tsx, and OllamaModelPicker.tsx.
 *
 * Senior-dev refactor: ONE source of truth for URL derivation, provider
 * building, default constants, and format helpers.
 */

import type { AppSettings, AiProviderEntry } from '../../electron/types/settings-api';
import type { LLMProvider } from './aiCommitMessages';

// ═══════════════════════════════════════════════════════════════════════════
// Default constants — single source of truth
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_MAX_DIFF_SIZE = 131_072;          // 128 KiB
export const DEFAULT_DIFF_TRUNCATE_CHARS = 48_000;
export const DEFAULT_MAX_TOKENS_CHAT = 1024;
export const DEFAULT_MAX_TOKENS_COMMIT = 256;
export const DEFAULT_MAX_ITERATIONS = 5;
export const DEFAULT_HISTORY_LIMIT = 100;
export const DEFAULT_REQUEST_TIMEOUT_SEC = 300;
export const MAX_RETRIES = 3;
export const INITIAL_BACKOFF_MS = 2000;

// ═══════════════════════════════════════════════════════════════════════════
// URL helpers — used by renderer (CloudModelPicker, AiProvidersGrid) and
// backend (ipc/ai.ts providerListModels). ONE implementation, used everywhere.
// ═══════════════════════════════════════════════════════════════════════════

/** Strip trailing slashes and /chat/completions suffix (clone, never modify original). */
export function normalizeBaseUrl(url: string): string {
  return (url || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}

/**
 * Derive the models-list URL from a stored provider URL.
 *
 * Handles all provider types:
 *   - Ollama: strip /api/chat or /chat/completions → append /api/tags
 *   - Anthropic: strip /v1/messages → append /v1/models
 *   - OpenAI-compatible: strip /chat/completions → append /models
 *
 * The original URL is NEVER modified — we work on a local clone.
 */
export function deriveModelsUrl(kind: string, url: string): string {
  const base = normalizeBaseUrl(url);
  if (!base) return '';

  if (kind === 'ollama') {
    return base.replace(/\/api\/chat$/, '') + '/api/tags';
  }
  if (kind === 'anthropic') {
    return base.replace(/\/v1\/messages$/, '') + '/v1/models';
  }
  // OpenAI-compatible (default)
  const modelsBase = base.replace(/\/chat\/completions$/, '');
  return modelsBase.endsWith('/models') ? modelsBase : `${modelsBase}/models`;
}

/** Derive the chat-completions URL from a stored provider URL. */
export function deriveChatUrl(url: string): string {
  const base = normalizeBaseUrl(url);
  if (!base) return '';
  if (/\/chat\/completions$/.test(base)) return base;
  return `${base}/chat/completions`;
}

/** Derive the Anthropic messages URL from a stored provider URL. */
export function deriveAnthropicUrl(url: string): string {
  const base = normalizeBaseUrl(url).replace(/\/v1\/messages$/, '');
  if (!base) return '';
  if (/\/v1\/messages$/.test(base)) return base;
  return `${base}/v1/messages`;
}

/** Derive the Ollama chat URL from a stored provider URL. */
export function deriveOllamaChatUrl(url: string): string {
  const base = normalizeBaseUrl(url).replace(/\/api\/chat$/, '').replace(/\/chat\/completions$/, '');
  if (!base) return 'http://localhost:11434';
  return `${base}/api/chat`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Provider building — unified, replaces 3 copies in ChangesPage/AiAssistant/AiChatPage
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build an LLMProvider from the settings, preferring the multi-provider
 * registry and falling back to the legacy flat fields (aiProvider/aiUrl/
 * aiApiKey/aiModel). This is the ONLY place that should build an
 * LLMProvider for chat/commit — all call sites import this function.
 *
 * Replaces the duplicated `buildProvider` in:
 *   - src/components/AiAssistant.tsx L308-320
 *   - src/pages/AiChatPage.tsx L180-192
 *   - src/pages/ChangesPage.tsx L44-63
 */
export function buildProviderFromSettings(settings: Partial<AppSettings> | undefined): LLMProvider | null {
  if (!settings) return null;

  // Preferred: multi-provider registry
  const providers = Array.isArray(settings.aiProviders) ? settings.aiProviders : [];
  const activeId = settings.aiActiveProviderId;
  if (activeId) {
    const entry = providers.find((e: AiProviderEntry) => e.id === activeId && e.enabled);
    if (entry?.model) {
      return {
        id: entry.id,
        name: entry.name,
        type: entry.kind as LLMProvider['type'],
        url: entry.url,
        apiKey: entry.apiKey,
        model: entry.model,
      };
    }
  }

  // Legacy fallback: flat fields
  if (!settings.aiProvider) return null;
  const type = settings.aiProvider as LLMProvider['type'];
  const model = settings.aiModel || '';
  if (!model) return null;
  return {
    id: settings.aiProvider,
    name: settings.aiProvider,
    type,
    url: settings.aiUrl || '',
    apiKey: settings.aiApiKey,
    model,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Format helpers — single source of truth
// ═══════════════════════════════════════════════════════════════════════════

/** Format milliseconds as a human-readable "X ago" string. */
export function formatAgo(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} mo ago`;
  return `${Math.floor(mo / 12)} yr ago`;
}

/** Format bytes as a human-readable size string. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Extract the repo name from a git URL. */
export function extractRepoNameFromUrl(input: string): string {
  const m = input.match(/\/([^/]+?)(?:\.git)?(?:\?|#|$)/);
  return m?.[1] ?? '';
}

// ═══════════════════════════════════════════════════════════════════════════
// Header helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Build auth headers for a provider kind + API key. */
export function buildAuthHeaders(kind: string, apiKey?: string): Record<string, string> {
  if (!apiKey) return {};
  if (kind === 'anthropic') {
    return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  }
  return { 'Authorization': `Bearer ${apiKey}` };
}
