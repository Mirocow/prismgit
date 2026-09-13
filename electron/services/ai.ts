/**
 * AI integration (SmartGit 25 "AI Assisted Commenting"):
 * generates commit messages from a staged diff via an OpenAI-compatible
 * chat-completions API (OpenAI, Anthropic-compatible proxies, Ollama, etc.).
 * Fully opt-in: nothing is sent anywhere until the user configures a provider
 * and explicitly presses the AI button.
 */

import { getSetting } from './storage.js';

export interface AiProviderConfig {
  /** Base URL, e.g. https://api.openai.com/v1 or http://localhost:11434/v1 */
  url: string;
  apiKey?: string;
  model: string;
  /** Max diff size (bytes) to send — larger diffs are rejected with a clear error. */
  maxDiffSize?: number;
  /** Optional custom prompt template; {{gitDiff}} placeholder is replaced. */
  prompt?: string;
}

export const DEFAULT_AI_PROMPT =
  'You are an expert software engineer. Write a git commit message for the following diff.\n' +
  'Rules:\n' +
  '- First line: imperative-mood summary, max 72 characters, no trailing period.\n' +
  '- Then one blank line, then a short description wrapped at 72 characters (optional).\n' +
  '- Reply with the commit message text ONLY, no code fences, no explanations.';

export const DEFAULT_MAX_DIFF_SIZE = 131072; // 128 KiB, SmartGit default is conservative

/**
 * Default AI request timeout in seconds (5 min). User-configurable via
 * Settings → AI → Request timeout. The value is read from the settings
 * store on every request so changes take effect immediately.
 */
export const DEFAULT_AI_REQUEST_TIMEOUT_SEC = 300;

/** Min/max bounds for the AI request timeout (seconds). */
export const AI_REQUEST_TIMEOUT_MIN_SEC = 10;
export const AI_REQUEST_TIMEOUT_MAX_SEC = 3600;

/**
 * Resolve the AI request timeout (in milliseconds) from the user's settings.
 * Falls back to DEFAULT_AI_REQUEST_TIMEOUT_SEC when unset, clamped to
 * [AI_REQUEST_TIMEOUT_MIN_SEC, AI_REQUEST_TIMEOUT_MAX_SEC]. A value of 0
 * disables the timeout entirely (returned as undefined → no AbortController
 * timer is set).
 */
export function getAiRequestTimeoutMs(): number | undefined {
  const raw = getSetting<number>('aiRequestTimeoutSec');
  if (raw === 0) return undefined; // user explicitly disabled
  const clamped = Math.max(
    AI_REQUEST_TIMEOUT_MIN_SEC,
    Math.min(AI_REQUEST_TIMEOUT_MAX_SEC, typeof raw === 'number' ? raw : DEFAULT_AI_REQUEST_TIMEOUT_SEC),
  );
  return clamped * 1000;
}

function buildPromptBody(cfg: AiProviderConfig, diff: string, hint?: string): string {
  const template = cfg.prompt?.trim() ? cfg.prompt : DEFAULT_AI_PROMPT;
  let body = template.replace(/\{\{\s*gitDiff\s*\}\}/g, diff);
  if (hint) body += `\n\nAdditional instruction from the user: ${hint}`;
  return body;
}

/**
 * Call the /chat/completions endpoint and return the generated message text.
 * Works with any OpenAI-compatible provider (OpenAI, Ollama, LM Studio, ...).
 */
export async function generateCommitMessage(
  cfg: AiProviderConfig,
  diff: string,
  hint?: string
): Promise<string> {
  if (!cfg.url) throw new Error('AI provider URL is not configured');
  if (!cfg.model) throw new Error('AI model is not configured');
  const maxDiff = cfg.maxDiffSize ?? DEFAULT_MAX_DIFF_SIZE;
  if (diff.length > maxDiff) {
    throw new Error(
      `The Git diff is too large (${(diff.length / 1024).toFixed(0)} KiB > ${(maxDiff / 1024).toFixed(0)} KiB). Reduce maxDiffSize or stage fewer files.`
    );
  }

  const base = cfg.url.replace(/\/+$/, '');
  const endpoint = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const payload = {
    model: cfg.model,
    messages: [{ role: 'user', content: buildPromptBody(cfg, diff, hint) }],
    temperature: 0.2,
    stream: false,
  };

  const controller = new AbortController();
  // Read the user-configured timeout (Settings → AI → Request timeout).
  // Falls back to DEFAULT_AI_REQUEST_TIMEOUT_SEC (300 s) when unset.
  const timeoutMs = getAiRequestTimeoutMs();
  const timeout = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`AI request failed (${res.status}): ${text.slice(0, 400) || res.statusText}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (json.error?.message) throw new Error(`AI error: ${json.error.message}`);
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI returned an empty response');
    // Strip markdown fences if the model wrapped the message
    return content
      .replace(/^```[a-z]*\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
