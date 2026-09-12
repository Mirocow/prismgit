import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callLLMStream, generateCommitMessageStream, type LLMProvider } from '../../src/lib/aiCommitMessages';

const PROVIDER: LLMProvider = {
  id: 'openai',
  name: 'openai',
  type: 'openai',
  url: 'https://api.openai.com/v1/chat/completions',
  apiKey: 'sk-fake',
  model: 'gpt-4',
};

/** Build a fake ReadableStream emitting chunks of SSE text. */
function makeSSEStream(tokens: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = tokens.map(tok => `data: ${JSON.stringify({ choices: [{ delta: { content: tok } }] })}\n\n`);
  chunks.push('data: [DONE]\n\n');
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/**
 * Helper: drain an async generator into the list of yielded values AND
 * capture its return value (the full concatenated message).
 */
async function drain<T, R>(gen: AsyncGenerator<T, R, unknown>): Promise<{ yielded: T[]; returned: R | undefined }> {
  const yielded: T[] = [];
  let result = await gen.next();
  while (!result.done) {
    yielded.push(result.value);
    result = await gen.next();
  }
  return { yielded, returned: result.value };
}

describe('LAR-1 — callLLMStream (OpenAI-compatible)', () => {
  beforeEach(() => { global.fetch = vi.fn() as unknown as typeof fetch; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('yields tokens as they arrive', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: makeSSEStream(['Hello', ' ', 'world', '!']),
    });
    const onToken: string[] = [];
    const { yielded, returned } = await drain(callLLMStream(PROVIDER, 'sys', 'user', 100, {
      onToken: t => onToken.push(t),
    }));
    expect(yielded).toEqual(['Hello', ' ', 'world', '!']);
    expect(onToken).toEqual(['Hello', ' ', 'world', '!']);
    expect(returned).toBe('Hello world!');
  });

  it('handles [DONE] sentinel correctly', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: makeSSEStream(['A', 'B', 'C']),
    });
    const { yielded } = await drain(callLLMStream(PROVIDER, 'sys', 'user', 100));
    expect(yielded).toEqual(['A', 'B', 'C']);
  });

  it('throws on non-2xx response', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });
    const gen = callLLMStream(PROVIDER, 'sys', 'user', 100);
    await expect(gen.next()).rejects.toThrow();
  });

  it('calls onToken for each yielded token', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: makeSSEStream(['x', 'y', 'z']),
    });
    const calls: string[] = [];
    await drain(callLLMStream(PROVIDER, 'sys', 'user', 100, { onToken: t => calls.push(t) }));
    expect(calls).toEqual(['x', 'y', 'z']);
  });

  it('returns the full concatenated message as generator return value', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: makeSSEStream(['feat:', ' add', ' new', ' feature']),
    });
    const { returned } = await drain(callLLMStream(PROVIDER, 'sys', 'user', 100));
    expect(returned).toBe('feat: add new feature');
  });

  it('works with generateCommitMessageStream wrapper', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: makeSSEStream(['feat:', ' add', ' new', ' feature']),
    });
    const onToken: string[] = [];
    const { returned } = await drain(generateCommitMessageStream(
      { diff: 'diff --git a/foo b/foo\n+added', provider: PROVIDER },
      { onToken: t => onToken.push(t) },
    ));
    expect(onToken).toEqual(['feat:', ' add', ' new', ' feature']);
    expect(returned).toBe('feat: add new feature');
  });

  it('handles empty stream (only [DONE])', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: makeSSEStream([]),
    });
    const { yielded, returned } = await drain(callLLMStream(PROVIDER, 'sys', 'user', 100));
    expect(yielded).toEqual([]);
    expect(returned).toBe('');
  });

  it('handles multi-line content in a single delta', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: makeSSEStream(['feat: subject\n\nLong body paragraph\nstill body']),
    });
    const { returned } = await drain(callLLMStream(PROVIDER, 'sys', 'user', 100));
    expect(returned).toContain('feat: subject');
    expect(returned).toContain('Long body paragraph');
    expect(returned).toContain('still body');
  });
});

describe('LAR-1 — callLLMStream dispatch by provider type', () => {
  beforeEach(() => { global.fetch = vi.fn() as unknown as typeof fetch; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('routes Anthropic providers to the Anthropic SSE parser', async () => {
    const anthropicProvider: LLMProvider = { ...PROVIDER, type: 'anthropic', url: 'https://api.anthropic.com/v1/messages' };
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }) + '\n\n'));
        controller.enqueue(encoder.encode('event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } }) + '\n\n'));
        controller.close();
      },
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, body: stream });
    const { returned } = await drain(callLLMStream(anthropicProvider, 'sys', 'user', 100));
    expect(returned).toBe('Hello world');
  });

  it('routes Ollama providers to the NDJSON parser', async () => {
    const ollamaProvider: LLMProvider = { ...PROVIDER, type: 'ollama', url: 'http://localhost:11434' };
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ message: { content: 'Hello' } }) + '\n'));
        controller.enqueue(encoder.encode(JSON.stringify({ message: { content: ' world' } }) + '\n'));
        controller.enqueue(encoder.encode(JSON.stringify({ message: { content: '' }, done: true }) + '\n'));
        controller.close();
      },
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, body: stream });
    const { returned } = await drain(callLLMStream(ollamaProvider, 'sys', 'user', 100));
    expect(returned).toBe('Hello world');
  });
});
