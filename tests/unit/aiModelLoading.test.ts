/**
 * isModelLoading — the retry classifier for proxyFetch.
 *
 * Regression pin: a 404 with "not found" used to be classified as
 * "model loading" → proxyFetch retried 3x with 2+4+8 s backoff. When
 * callOllama POSTed to the server root (base-url bug, fixed in
 * aiCommitMessages), real Ollama answered 404 "path '/' not found" → the
 * user stared at a spinner for ~14 s before "AI generation failed".
 * "not found" is PERMANENT — the user must fix the URL or pull the model.
 */
import { describe, it, expect } from 'vitest';
import { isModelLoading } from '../../src/lib/aiChat';

describe('isModelLoading — retry classification', () => {
  it('retries on 503 (another worker loading the model)', () => {
    expect(isModelLoading(503, '')).toBe(true);
    expect(isModelLoading(503, 'service unavailable')).toBe(true);
  });

  it('retries on the LEGACY 404 "model … loading" signature', () => {
    expect(isModelLoading(404, 'model llama3.2 is loading')).toBe(true);
    expect(isModelLoading(404, 'model "gpt:latest" is loading, please wait')).toBe(true);
  });

  it('does NOT retry the Ollama root-path 404 (the crash-trigger body)', () => {
    // Exact body real Ollama returns for the pre-fix POST /:
    expect(isModelLoading(404, '{"error":"path \'/\' not found"}')).toBe(false);
  });

  it('does NOT retry "model not found" / "try pulling" (permanent)', () => {
    expect(isModelLoading(404, "model 'foo' not found, try pulling it")).toBe(false);
    expect(isModelLoading(404, 'model not found')).toBe(false);
    expect(isModelLoading(404, 'try pulling the model')).toBe(false);
  });

  it('does NOT retry an empty/unknown 404 body', () => {
    expect(isModelLoading(404, '')).toBe(false);
  });

  it('retries 200-with-loading-error body (rare Ollama shape)', () => {
    expect(isModelLoading(200, '{"error": "model is loading"}')).toBe(true);
  });

  it('does NOT retry a normal 200 body', () => {
    expect(isModelLoading(200, '{"message":{"content":"feat: x"}}')).toBe(false);
  });

  it('does NOT retry server errors other than 503', () => {
    expect(isModelLoading(500, 'oops')).toBe(false);
    expect(isModelLoading(401, 'unauthorized')).toBe(false);
    expect(isModelLoading(429, 'rate limited')).toBe(false);
  });
});
