/**
 * v2.3.12 — structured LLM error reporting + OpenRouter free-model fallback.
 *
 * WHY THIS MODULE EXISTS
 * ======================
 * The user hit this (reported against OpenRouter free models):
 *
 *   Error: Error: OpenAI chat error 429: {"error":{"message":"Provider
 *   returned error","code":429,"metadata":{"raw":"google/gemma-4-31b-it:free
 *   is temporarily rate-limited upstream. Please retry shortly, or add your
 *   own key ...","provider_name":"Google AI Studio","is_byok":false,
 *   "limit_source":"upstream_provider_shared_pool","remedy_hint":"Retry
 *   shortly, ..."}}}
 *
 * Two defects in that wall of text:
 *   1. RAW JSON dumped at the user — the useful part (metadata.raw) was
 *      buried inside, while the generic "Provider returned error" was the
 *      only field the old code ever read (it read none, actually — it
 *      stringified the whole body).
 *   2. Double "Error: Error:" prefix — the UI layer prepended "Error: " to
 *      `String(e)` which already starts with "Error: " for Error objects.
 *
 * And one missing behavior: OpenRouter's free models share ONE rate-limited
 * upstream pool, but the meta-model `openrouter/free` routes across ALL of
 * them — exactly why the user observed "only openrouter/free works". When a
 * `:free` model 429s, we retry once through `openrouter/free` automatically
 * and tell the user what happened (toast), instead of failing.
 *
 * Used by:
 *   - src/lib/aiChat.ts             (assistant chat — all 3 protocols)
 *   - src/lib/aiCommitMessages.ts   (commit messages — batch + streaming)
 *   - electron/services/ai.ts       (main-process commit-message IPC)
 *   - src/components/AiAssistant.tsx, src/pages/AiChatPage.tsx,
 *     src/pages/ChangesPage.tsx     (localized rendering)
 *   - src/components/AiProvidersGrid.tsx (FREE badges in the model dropdown)
 *
 * The module is intentionally dependency-free (no i18n, no React, no IPC) so
 * it can be imported from both the renderer and the Electron main process
 * (same pattern as src/lib/diffParser.ts).
 */

// ── Error kinds ─────────────────────────────────────────────────────────────

export type LLMErrorKind =
  | 'rate-limit'    // 429 — free pool busy / key quota exhausted
  | 'auth'          // 401/403 — key invalid, expired or missing
  | 'credits'       // 402 — payment required for this model
  | 'model-not-found' // 404 — wrong model id or model removed upstream
  | 'network'       // status 0 — cannot reach the endpoint at all
  | 'http'          // any other non-OK status
  | 'unknown';      // anything that isn't an HTTP error (parse failures, …)

/**
 * OpenRouter's meta-model: routes a request across ALL free models and all
 * providers, dodging per-model upstream rate limits. This is the reliable
 * "free" entry point — the fallback target for 429'd `:free` models.
 */
export const OPENROUTER_FREE_MODEL = 'openrouter/free';

// ── Provider error body parsing ─────────────────────────────────────────────

export interface ParsedProviderError {
  /** The most human-readable message the provider sent. */
  message?: string;
  /** Provider-suggested remedy (OpenRouter metadata.remedy_hint). */
  remedy?: string;
}

/**
 * Extract the readable parts from a non-2xx response body.
 *
 * OpenRouter nests the REAL message in `error.metadata.raw` while
 * `error.message` is a generic "Provider returned error" — preferring `raw`
 * is the difference between "google/gemma-…:free is temporarily rate-limited
 * upstream" and a useless "Provider returned error". Plain OpenAI-style
 * bodies (`{"error":{"message":...}}`) are handled too, as is non-JSON text.
 */
export function parseProviderErrorBody(status: number, body: string): ParsedProviderError {
  const text = (body ?? '').trim();
  if (text) {
    try {
      const json = JSON.parse(text) as {
        error?: {
          message?: unknown;
          metadata?: { raw?: unknown; remedy_hint?: unknown };
        };
        message?: unknown;
      };
      const err = json.error;
      const meta = err?.metadata;
      const raw = typeof meta?.raw === 'string' ? meta.raw.trim() : '';
      const errMsg = typeof err?.message === 'string' ? err.message.trim() : '';
      const topMsg = typeof json.message === 'string' ? json.message.trim() : '';
      const message = raw || errMsg || topMsg;
      const remedy = typeof meta?.remedy_hint === 'string' ? meta.remedy_hint.trim() : '';
      const out: ParsedProviderError = {};
      if (message) out.message = message;
      if (remedy && remedy !== message) out.remedy = remedy;
      if (out.message || out.remedy) return out;
    } catch {
      // Not JSON — fall through to plain-text handling.
    }
    return { message: text.slice(0, 240) };
  }
  return { message: status > 0 ? `HTTP ${status}` : 'Network error' };
}

/** Map an HTTP status to the coarse error kind used for i18n titles. */
export function kindFromStatus(status: number): LLMErrorKind {
  if (status === 429) return 'rate-limit';
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'credits';
  if (status === 404) return 'model-not-found';
  if (status === 0) return 'network';
  return 'http';
}

// ── The error class ─────────────────────────────────────────────────────────

/**
 * Thrown by every LLM HTTP call site in the app (renderer AND main process).
 *
 * `message` is prefixed with a parseable marker `[<kind> <status>]` so that
 * an error marshaled through Electron IPC (where the class identity is lost
 * and only `.message` survives) can still be classified at the UI layer by
 * `reviveLLMError()`.
 */
export class LLMApiError extends Error {
  readonly kind: LLMErrorKind;
  readonly status: number;
  /** Best human-readable line from the provider body. */
  readonly providerMessage?: string;
  /** Provider-suggested remedy (OpenRouter remedy_hint). */
  readonly remedy?: string;

  constructor(status: number, body: string) {
    const parsed = parseProviderErrorBody(status, body);
    const kind = kindFromStatus(status);
    const prefix = `[${kind}${status > 0 ? ` ${status}` : ''}]`;
    const bodyText = parsed.message ?? (status > 0 ? `HTTP ${status}` : 'Network error');
    super(`${prefix} ${bodyText}`);
    this.name = 'LLMApiError';
    this.kind = kind;
    this.status = status;
    this.providerMessage = parsed.message;
    this.remedy = parsed.remedy;
  }
}

export interface LLMErrorInfo {
  kind: LLMErrorKind;
  status?: number;
  providerMessage?: string;
  remedy?: string;
}

/**
 * Recover structured error info from ANY thrown value:
 *  - a live LLMApiError (renderer call sites),
 *  - an Error whose message carries the `[kind status]` marker (errors that
 *    crossed Electron IPC — the main-process commit-message path),
 *  - anything else → kind 'unknown' with the stringified text (prefix
 *    "Error: " stripped so the UI never shows "Error: Error:" again).
 */
export function describeLLMError(e: unknown): LLMErrorInfo {
  if (e instanceof LLMApiError) {
    return { kind: e.kind, status: e.status, providerMessage: e.providerMessage, remedy: e.remedy };
  }
  if (e instanceof Error) {
    const m = /^\[([\w-]+)(?: (\d+))?\][ ]?([\s\S]*)$/.exec(e.message);
    if (m) {
      const info: LLMErrorInfo = { kind: m[1] as LLMErrorKind };
      if (m[2]) info.status = Number(m[2]);
      const rest = m[3].trim();
      if (rest) info.providerMessage = rest;
      return info;
    }
  }
  if (e instanceof DOMException && e.name === 'AbortError') {
    return { kind: 'unknown' }; // callers handle abort separately
  }
  // Use e.message directly — String(e) prepends its own "Error: " (name +
  // ': ' + message), which is exactly how the double-prefix bug arose.
  const text = (e instanceof Error ? e.message : String(e ?? ''))
    .replace(/^Error:\s*/, '')
    .trim();
  const info: LLMErrorInfo = { kind: 'unknown' };
  if (text) info.providerMessage = text.slice(0, 240);
  return info;
}

/** One-line detail for toast error details (no titles, no JSON walls). */
export function llmErrorDetail(e: unknown): string {
  const info = describeLLMError(e);
  const parts: string[] = [];
  if (info.providerMessage) parts.push(info.providerMessage.slice(0, 240));
  if (info.remedy && info.kind !== 'rate-limit') parts.push(info.remedy.slice(0, 200));
  if (parts.length === 0) parts.push(info.status ? `HTTP ${info.status}` : '—');
  return parts.join(' · ');
}

/** i18n key for the localized title of an error kind. */
export function llmErrorTitleKey(kind: LLMErrorKind): string {
  switch (kind) {
    case 'rate-limit': return 'aiErr.rateLimitTitle';
    case 'auth': return 'aiErr.authTitle';
    case 'credits': return 'aiErr.creditsTitle';
    case 'model-not-found': return 'aiErr.modelNotFoundTitle';
    case 'network': return 'aiErr.networkTitle';
    case 'http': return 'aiErr.httpTitle';
    default: return 'aiErr.unknownTitle';
  }
}

// ── OpenRouter 429 → openrouter/free fallback ──────────────────────────────

/**
 * Does this response indicate a rate limit? 429 is the standard signal;
 * some providers report 503 with "rate limit" text in the body.
 */
export function isRateLimitedResponse(status: number, body: string): boolean {
  if (status === 429) return true;
  if (status === 503 || status === 402 || status === 400) {
    return /rate.?limit/i.test(body ?? '');
  }
  return false;
}

/**
 * Should a failed OpenRouter request be retried through the free
 * meta-router (`openrouter/free`)?
 *
 * Only when ALL hold:
 *  - the provider is OpenRouter (the meta-router is an OpenRouter feature);
 *  - the failure is a rate limit (429 — the shared free pool being busy);
 *  - the configured model is itself a FREE-tier model (`:free` suffix).
 *    A paid model 429ing means the USER's key quota is exhausted — silently
 *    rerouting to a free model would change quality without consent.
 *  - the model isn't already the meta-router (no infinite retry loop).
 */
export function shouldFallbackToOpenRouterFree(
  providerType: string,
  model: string,
  status: number,
  body: string,
): boolean {
  if (providerType !== 'openrouter') return false;
  if (!model || model === OPENROUTER_FREE_MODEL) return false;
  if (!isRateLimitedResponse(status, body ?? '')) return false;
  return model.endsWith(':free');
}

// ── Fallback notifications (pub-sub) ────────────────────────────────────────

type FallbackListener = (model: string) => void;
const fallbackListeners = new Set<FallbackListener>();

/** Subscribe to "request rerouted via openrouter/free" events. Returns an unsubscribe fn. */
export function subscribeLLMFallback(cb: FallbackListener): () => void {
  fallbackListeners.add(cb);
  return () => { fallbackListeners.delete(cb); };
}

/**
 * Announce that `model` was rate-limited and the request is being retried
 * via the free meta-router. Listener errors are swallowed — a broken toast
 * handler must never break the request itself.
 */
export function notifyLLMFallback(model: string): void {
  for (const cb of fallbackListeners) {
    try { cb(model); } catch { /* listener errors must not propagate */ }
  }
}

// ── Free-model detection for model lists ───────────────────────────────────

/**
 * Is this entry from a provider model list free to use?
 *
 * OpenRouter marks free models two ways: the `:free` id suffix AND
 * `pricing.prompt === "0"` (the /api/v1/models payload). Either counts —
 * plus the `openrouter/free` meta-router itself.
 */
export function isFreeModel(m: { id: string; pricing?: Record<string, string> }): boolean {
  if (!m?.id) return false;
  if (m.id === OPENROUTER_FREE_MODEL) return true;
  if (m.id.endsWith(':free')) return true;
  const pricing = m.pricing;
  if (pricing && pricing.prompt !== undefined) {
    const v = parseFloat(pricing.prompt);
    if (!Number.isNaN(v) && v === 0) return true;
  }
  return false;
}
