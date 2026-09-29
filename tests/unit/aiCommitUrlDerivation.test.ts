/**
 * URL derivation for the AI COMMIT-MESSAGE path — the regression pins for
 * the "AI подсказчик к коммитам не работает" bug.
 *
 * ROOT CAUSE (fixed): callOllama/callOpenAICompatible/callAnthropic used
 * provider.url AS-IS. The Ollama preset and provider registry store the
 * BASE url ("http://localhost:11434", no path) → the request POSTed to the
 * server ROOT → real Ollama answers 404 → proxyFetch misread it as "model
 * loading" and retried 3x with 2-8s backoff → 14s of silence, then
 * "AI generation failed". OpenRouter preset stores a base URL too
 * ("https://openrouter.ai/api/v1") — same class of failure. The AI CHAT
 * page derived its URLs correctly, which is why chat worked while the
 * commit suggester appeared dead.
 *
 * These tests pin: every stored URL shape derives to the canonical
 * endpoint for every provider family, batch AND streaming.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the network layer: aiChat also imports ./api (window-dependent).
vi.mock('../../src/lib/aiChat', () => ({
  proxyFetch: vi.fn(),
  isModelLoading: vi.fn(),
}));

import { proxyFetch } from '../../src/lib/aiChat';
import {
  generateCommitMessage,
  callLLMStream,
  type LLMProvider,
} from '../../src/lib/aiCommitMessages';

const mockProxyFetch = proxyFetch as unknown as ReturnType<typeof vi.fn>;

function ollamaProvider(url?: string): LLMProvider {
  return { id: 'ollama', name: 'ollama', type: 'ollama', url, model: 'llama3.2' };
}
function openaiProvider(url?: string): LLMProvider {
  return { id: 'custom', name: 'custom', type: 'custom', url, model: 'some-model', apiKey: 'k' };
}
function anthropicProvider(url?: string): LLMProvider {
  return { id: 'anthropic', name: 'anthropic', type: 'anthropic', url, model: 'claude-3-5-sonnet', apiKey: 'k' };
}

/** Successful per-protocol proxyFetch body so generateCommitMessage resolves. */
function okBodyFor(type: LLMProvider['type']): string {
  if (type === 'anthropic') return JSON.stringify({ content: [{ text: 'feat: ok' }] });
  if (type === 'ollama') return JSON.stringify({ message: { content: 'feat: ok' } });
  return JSON.stringify({ choices: [{ message: { content: 'feat: ok' } }] });
}

async function urlPassedToProxyFetch(provider: LLMProvider): Promise<string> {
  mockProxyFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', body: okBodyFor(provider.type) });
  await generateCommitMessage({ diff: 'diff --git a/x b/x', provider });
  expect(mockProxyFetch).toHaveBeenCalledTimes(1);
  return mockProxyFetch.mock.calls[0][0] as string;
}

describe('AI commit message — Ollama endpoint derivation (THE bug)', () => {
  beforeEach(() => { mockProxyFetch.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('derives /api/chat from the BASE url the preset/registry stores', async () => {
    // THE user-facing regression: preset defaultUrl = 'http://localhost:11434'.
    expect(await urlPassedToProxyFetch(ollamaProvider('http://localhost:11434')))
      .toBe('http://localhost:11434/api/chat');
  });

  it('strips a trailing slash before appending /api/chat', async () => {
    expect(await urlPassedToProxyFetch(ollamaProvider('http://localhost:11434/')))
      .toBe('http://localhost:11434/api/chat');
  });

  it('keeps an explicit /api/chat url unchanged', async () => {
    expect(await urlPassedToProxyFetch(ollamaProvider('http://localhost:11434/api/chat')))
      .toBe('http://localhost:11434/api/chat');
  });

  it('rewrites an OpenAI-style /chat/completions url to /api/chat', async () => {
    expect(await urlPassedToProxyFetch(ollamaProvider('http://localhost:11434/chat/completions')))
      .toBe('http://localhost:11434/api/chat');
  });

  it('defaults to localhost when no url is set', async () => {
    expect(await urlPassedToProxyFetch(ollamaProvider(undefined)))
      .toBe('http://localhost:11434/api/chat');
  });

  it('works for a remote Ollama host with a custom port', async () => {
    expect(await urlPassedToProxyFetch(ollamaProvider('http://192.168.1.50:11434')))
      .toBe('http://192.168.1.50:11434/api/chat');
  });

  it('sends an Ollama-shaped body (messages + options, stream:false)', async () => {
    mockProxyFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', body: okBodyFor('ollama') });
    await generateCommitMessage({ diff: 'd', provider: ollamaProvider('http://localhost:11434') });
    const body = JSON.parse(mockProxyFetch.mock.calls[0][2] as string);
    expect(body.model).toBe('llama3.2');
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.stream).toBe(false);
  });
});

describe('AI commit message — OpenAI-compatible endpoint derivation', () => {
  beforeEach(() => { mockProxyFetch.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('derives /chat/completions from the BASE url (OpenRouter preset)', async () => {
    // OpenRouter preset defaultUrl = 'https://openrouter.ai/api/v1' — the
    // second instance of the same bug class.
    expect(await urlPassedToProxyFetch(openaiProvider('https://openrouter.ai/api/v1')))
      .toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('keeps a full endpoint url unchanged (OpenAI preset)', async () => {
    expect(await urlPassedToProxyFetch(openaiProvider('https://api.openai.com/v1/chat/completions')))
      .toBe('https://api.openai.com/v1/chat/completions');
  });

  it('keeps a full endpoint url unchanged (Groq preset)', async () => {
    expect(await urlPassedToProxyFetch(openaiProvider('https://api.groq.com/openai/v1/chat/completions')))
      .toBe('https://api.groq.com/openai/v1/chat/completions');
  });

  it('keeps a full endpoint url unchanged (Z.ai preset)', async () => {
    expect(await urlPassedToProxyFetch(openaiProvider('https://api.z.ai/api/paas/v4/chat/completions')))
      .toBe('https://api.z.ai/api/paas/v4/chat/completions');
  });

  it('defaults to the OpenAI endpoint when no url is set', async () => {
    expect(await urlPassedToProxyFetch(openaiProvider(undefined)))
      .toBe('https://api.openai.com/v1/chat/completions');
  });
});

describe('AI commit message — Anthropic endpoint derivation', () => {
  beforeEach(() => { mockProxyFetch.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('derives /v1/messages from the BASE url', async () => {
    expect(await urlPassedToProxyFetch(anthropicProvider('https://api.anthropic.com')))
      .toBe('https://api.anthropic.com/v1/messages');
  });

  it('keeps a full /v1/messages url unchanged', async () => {
    expect(await urlPassedToProxyFetch(anthropicProvider('https://api.anthropic.com/v1/messages')))
      .toBe('https://api.anthropic.com/v1/messages');
  });
});

describe('AI commit message — streaming endpoint derivation', () => {
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => { vi.restoreAllMocks(); });

  function ndjsonStream(lines: unknown[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    const data = lines.map((l) => JSON.stringify(l) + '\n').join('');
    return new ReadableStream({
      start(c) { c.enqueue(enc.encode(data)); c.close(); },
    });
  }
  function sseStream(tokens: string[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    const chunks = tokens.map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
    chunks.push('data: [DONE]\n\n');
    return new ReadableStream({
      start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); },
    });
  }

  function anthropicSseStream(text: string): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    const payload = `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`;
    return new ReadableStream({
      start(c) { c.enqueue(enc.encode(payload)); c.close(); },
    });
  }

  async function streamUrl(provider: LLMProvider): Promise<string> {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    if (provider.type === 'ollama') {
      fetchMock.mockResolvedValueOnce({ ok: true, body: ndjsonStream([{ message: { content: 'feat: x' }, done: true }]) });
    } else if (provider.type === 'anthropic') {
      fetchMock.mockResolvedValueOnce({ ok: true, body: anthropicSseStream('feat: x') });
    } else {
      fetchMock.mockResolvedValueOnce({ ok: true, body: sseStream(['feat: x']) });
    }
    const gen = callLLMStream(provider, 'sys', 'user', 64);
    const it = await gen.next();
    expect(it.done).toBe(false);
    return fetchMock.mock.calls[0][0] as string;
  }

  it('streamOllama derives /api/chat from the BASE url', async () => {
    expect(await streamUrl(ollamaProvider('http://localhost:11434')))
      .toBe('http://localhost:11434/api/chat');
  });

  it('streamOpenAICompatible derives /chat/completions from the BASE url', async () => {
    expect(await streamUrl(openaiProvider('https://openrouter.ai/api/v1')))
      .toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('streamAnthropic derives /v1/messages from the BASE url', async () => {
    expect(await streamUrl(anthropicProvider('https://api.anthropic.com')))
      .toBe('https://api.anthropic.com/v1/messages');
  });
});
