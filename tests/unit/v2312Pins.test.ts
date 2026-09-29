import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LLMApiError, OPENROUTER_FREE_MODEL, parseProviderErrorBody, kindFromStatus,
  describeLLMError, llmErrorDetail, llmErrorTitleKey, isRateLimitedResponse,
  shouldFallbackToOpenRouterFree, subscribeLLMFallback, notifyLLMFallback, isFreeModel,
} from '../../src/lib/aiErrors';
import { PROVIDER_PRESETS } from '../../src/lib/aiCommitMessages';

/**
 * v2.3.12 pins — «из бесплатных доступна только openrouter/free» + the raw
 * `Error: Error: OpenAI chat error 429: {"error":{…}}` wall.
 *
 * The user's 429 payload proved the model id was passed CORRECTLY (a wrong id
 * is a 404 "No endpoints found"; the 429 names the model and provider) — what
 * was broken was (1) the app dumped the raw JSON at the user with a double
 * "Error: " prefix, and (2) a rate-limited :free model failed the request
 * instead of retrying through the openrouter/free meta-router (the one entry
 * point that always works — exactly what the user observed).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const flat = (s: string) => s.replace(/\s+/g, '').replace(/"/g, "'");

// The EXACT error payload from the user's report (v2.3.11 session).
const USER_PAYLOAD = JSON.stringify({
  error: {
    message: 'Provider returned error',
    code: 429,
    metadata: {
      raw: 'google/gemma-4-31b-it:free is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations',
      provider_name: 'Google AI Studio',
      is_byok: false,
      provider_error_code: '429',
      limit_source: 'upstream_provider_shared_pool',
      remedy_hint: 'Retry shortly, add your own provider key (https://openrouter.ai/settings/integrations), or route to another provider with provider routing: https://openrouter.ai/docs/features/provider-routing',
    },
  },
});

describe('v2.3.12 — provider error bodies parse to the readable part', () => {
  it('the user payload: metadata.raw wins over the generic "Provider returned error"', () => {
    const parsed = parseProviderErrorBody(429, USER_PAYLOAD);
    expect(parsed.message).toContain('google/gemma-4-31b-it:free is temporarily rate-limited upstream');
    expect(parsed.message).not.toBe('Provider returned error');
    expect(parsed.remedy).toContain('openrouter.ai/settings/integrations');
  });

  it('plain OpenAI-style {error:{message}} bodies parse too', () => {
    const parsed = parseProviderErrorBody(401, '{"error":{"message":"Incorrect API key provided"}}');
    expect(parsed.message).toBe('Incorrect API key provided');
  });

  it('non-JSON bodies degrade to trimmed text, never to a JSON wall', () => {
    const parsed = parseProviderErrorBody(502, '<html>Bad gateway</html>');
    expect(parsed.message).toBe('<html>Bad gateway</html>');
  });

  it('status → kind mapping', () => {
    expect(kindFromStatus(429)).toBe('rate-limit');
    expect(kindFromStatus(401)).toBe('auth');
    expect(kindFromStatus(403)).toBe('auth');
    expect(kindFromStatus(402)).toBe('credits');
    expect(kindFromStatus(404)).toBe('model-not-found');
    expect(kindFromStatus(0)).toBe('network');
    expect(kindFromStatus(500)).toBe('http');
  });
});

describe('v2.3.12 — LLMApiError carries structure AND survives IPC as text', () => {
  it('live instance: kind, status, providerMessage, remedy', () => {
    const e = new LLMApiError(429, USER_PAYLOAD);
    expect(e.kind).toBe('rate-limit');
    expect(e.status).toBe(429);
    expect(e.providerMessage).toContain('temporarily rate-limited upstream');
    expect(e.remedy).toBeTruthy();
    expect(e.message).toMatch(/^\[rate-limit 429\] /);
  });

  it('describeLLMError revives the same info from a plain Error (IPC-marshaled)', () => {
    const ipcLike = new Error(new LLMApiError(429, USER_PAYLOAD).message);
    const info = describeLLMError(ipcLike);
    expect(info.kind).toBe('rate-limit');
    expect(info.status).toBe(429);
    expect(info.providerMessage).toContain('temporarily rate-limited upstream');
  });

  it('describeLLMError strips the "Error: " prefix (no more double Error: Error:)', () => {
    const info = describeLLMError(new Error('Error: something odd'));
    expect(info.providerMessage).toBe('something odd');
    expect(info.providerMessage?.startsWith('Error:')).toBe(false);
  });

  it('llmErrorDetail: one short readable line, no JSON braces', () => {
    const detail = llmErrorDetail(new LLMApiError(429, USER_PAYLOAD));
    expect(detail).toContain('temporarily rate-limited upstream');
    expect(detail).not.toContain('{"error"');
    expect(detail.length).toBeLessThanOrEqual(240);
  });

  it('title keys exist for every kind', () => {
    for (const k of ['rate-limit', 'auth', 'credits', 'model-not-found', 'network', 'http', 'unknown'] as const) {
      expect(llmErrorTitleKey(k)).toMatch(/^aiErr\./);
    }
  });
});

describe('v2.3.12 — 429 on an OpenRouter :free model retries via openrouter/free', () => {
  it('the user case: openrouter + :free model + 429 → fallback', () => {
    expect(shouldFallbackToOpenRouterFree('openrouter', 'google/gemma-4-31b-it:free', 429, USER_PAYLOAD)).toBe(true);
  });

  it('the meta-router itself never falls back (no loops)', () => {
    expect(shouldFallbackToOpenRouterFree('openrouter', OPENROUTER_FREE_MODEL, 429, USER_PAYLOAD)).toBe(false);
  });

  it('paid models do NOT silently downgrade to a free router', () => {
    expect(shouldFallbackToOpenRouterFree('openrouter', 'anthropic/claude-3.5-sonnet', 429, USER_PAYLOAD)).toBe(false);
  });

  it('other providers / non-rate-limit failures never fall back', () => {
    expect(shouldFallbackToOpenRouterFree('groq', 'llama-3.1-8b-instant', 429, '')).toBe(false);
    expect(shouldFallbackToOpenRouterFree('openrouter', 'x:free', 401, '')).toBe(false);
    expect(shouldFallbackToOpenRouterFree('openrouter', 'x:free', 500, '')).toBe(false);
  });

  it('isRateLimitedResponse: 429, and 503-with-rate-limit-text', () => {
    expect(isRateLimitedResponse(429, '')).toBe(true);
    expect(isRateLimitedResponse(503, 'Rate limit exceeded')).toBe(true);
    expect(isRateLimitedResponse(503, 'model loading')).toBe(false);
  });

  it('the fallback event reaches subscribers and never throws', () => {
    const seen: string[] = [];
    const good = subscribeLLMFallback((m) => seen.push(m));
    // A throwing listener must not break the notification for others.
    const bad = subscribeLLMFallback(() => { throw new Error('listener bug'); });
    expect(() => notifyLLMFallback('x/y:free')).not.toThrow();
    expect(seen).toEqual(['x/y:free']);
    // Unsubscribed listeners stop receiving events.
    good();
    bad();
    notifyLLMFallback('a/b:free');
    expect(seen).toEqual(['x/y:free']);
  });
});

describe('v2.3.12 — OpenRouter preset points at the reliable free entry', () => {
  it('default model is the openrouter/free meta-router (old :free default was removed upstream)', () => {
    const preset = PROVIDER_PRESETS.find(p => p.id === 'openrouter');
    expect(preset?.defaultModel).toBe(OPENROUTER_FREE_MODEL);
  });

  it('the description explains the router AND that :free models are auto-retried', () => {
    const preset = PROVIDER_PRESETS.find(p => p.id === 'openrouter');
    expect(preset?.description).toContain('openrouter/free');
    expect(preset?.description.toLowerCase()).toContain('rate-limited');
  });
});

describe('v2.3.12 — model dropdown marks free models', () => {
  it('isFreeModel: :free suffix, pricing 0, and the meta-router', () => {
    expect(isFreeModel({ id: 'google/gemma-4-31b-it:free' })).toBe(true);
    expect(isFreeModel({ id: 'openrouter/free' })).toBe(true);
    expect(isFreeModel({ id: 'some/model', pricing: { prompt: '0' } })).toBe(true);
    expect(isFreeModel({ id: 'some/model', pricing: { prompt: '0.000001' } })).toBe(false);
    expect(isFreeModel({ id: 'meta-llama/llama-3.1-8b-instruct' })).toBe(false);
    expect(isFreeModel({ id: '' })).toBe(false);
  });
});

describe('v2.3.12 — source pins: no raw error dumps, fallbacks wired', () => {
  const aiChat = flat(read('src/lib/aiChat.ts'));
  const aiCommit = flat(read('src/lib/aiCommitMessages.ts'));
  const assistant = flat(read('src/components/AiAssistant.tsx'));
  const chatPage = flat(read('src/pages/AiChatPage.tsx'));

  it('no raw "<provider> chat error <status>: <body>" throws remain', () => {
    for (const src of [aiChat, aiCommit]) {
      expect(src).not.toContain('chaterror${res.status}:${res.body}');
      expect(src).not.toContain('LLMAPIerror${response.status}:${response.body}');
      expect(src).not.toContain('streamerror${response.status}:${text}');
      expect(src).not.toContain('APIerror${response.status}:${response.body}');
    }
  });

  it('callOpenAIChat: fallback fires BEFORE the error throw, after the tools retry', () => {
    const i = aiChat.indexOf('asyncfunctioncallOpenAIChat');
    const body = aiChat.slice(i, i + 4000);
    const toolsRetry = body.indexOf('isToolsUnsupported(res.status,res.body)');
    const fallback = body.indexOf('shouldFallbackToOpenRouterFree(provider.type,provider.model,res.status,res.body)');
    const throwAt = body.indexOf('thrownewLLMApiError(res.status,res.body)');
    expect(toolsRetry).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(toolsRetry);
    expect(throwAt).toBeGreaterThan(fallback);
    expect(body).toContain(`{...provider,model:OPENROUTER_FREE_MODEL}`);
  });

  it('commit-message paths (batch + streaming) retry via the router too', () => {
    expect(aiCommit).toContain('shouldFallbackToOpenRouterFree(provider.type,provider.model,response.status,response.body)');
    expect(aiCommit).toContain('OPENROUTER_FREE_MODEL');
    // streaming path (direct fetch, OpenRouter sends CORS headers)
    const s = aiCommit.indexOf('streamOpenAICompatible');
    const seg = aiCommit.slice(s, s + 5000);
    expect(seg).toContain('shouldFallbackToOpenRouterFree(provider.type,provider.model,response.status,text)');
  });

  it('the double "Error: Error:" chat rendering is gone; localized lines instead', () => {
    expect(assistant).not.toContain("Error:${String(e)}");
    expect(chatPage).not.toContain("Error:${String(e)}");
    expect(assistant).toContain('describeLLMError(e)');
    expect(chatPage).toContain('describeLLMError(e)');
    expect(assistant).toContain('llmErrorTitleKey(info.kind)');
    expect(chatPage).toContain('llmErrorTitleKey(info.kind)');
  });

  it('both chat surfaces subscribe to the fallback notice', () => {
    expect(assistant).toContain('subscribeLLMFallback((model)');
    expect(chatPage).toContain('subscribeLLMFallback((model)');
  });
});

describe('v2.3.12 — i18n: aiErr keys in all four locales', () => {
  const domain = read('src/i18n/locales/domains/aiassistant.ts');
  const locales = ['en', 'ru', 'zh', 'de'] as const;
  const keys = [
    'aiErr.rateLimitTitle', 'aiErr.authTitle', 'aiErr.creditsTitle',
    'aiErr.modelNotFoundTitle', 'aiErr.networkTitle', 'aiErr.httpTitle',
    'aiErr.unknownTitle', 'aiErr.fallbackToastTitle', 'aiErr.fallbackToastDetail',
  ];

  it('every locale block defines every key', () => {
    for (const locale of locales) {
      const m = new RegExp(`export const ${locale}: Record<string, string> = \\{([\\s\\S]*?)\\n\\};`);
      const block = m.exec(domain)?.[1] ?? '';
      expect(block.length).toBeGreaterThan(1000); // sanity: we got a real block
      for (const key of keys) {
        expect(block).toContain(`'${key}':`);
      }
    }
  });

  it('the grid filter label exists in all four settings locales', () => {
    const settings = read('src/i18n/locales/domains/settings.ts');
    const count = (settings.match(/'settings\.aiGridFreeOnly':/g) ?? []).length;
    expect(count).toBe(4);
  });
});

describe('v2.3.12 — electron main process joins the structured errors', () => {
  it('generateCommitMessage (IPC path) throws LLMApiError and retries via the router', () => {
    const src = flat(read('electron/services/ai.ts'));
    expect(src).toContain("from'../../src/lib/aiErrors'");
    expect(src).toContain('shouldFallbackToOpenRouterFree(');
    expect(src).toContain('thrownewLLMApiError(');
    // OpenRouter detected by host (the IPC config has no provider type)
    expect(src).toContain('openrouter\\.ai');
    // the old raw dump is gone
    expect(src).not.toContain('AIrequestfailed(${res.status})');
  });
});
