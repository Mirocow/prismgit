/**
 * AI integration (SmartGit 25 "AI Assisted Commenting"):
 * generates commit messages from a staged diff via an OpenAI-compatible
 * chat-completions API (OpenAI, Anthropic-compatible proxies, Ollama, etc.).
 * Fully opt-in: nothing is sent anywhere until the user configures a provider
 * and explicitly presses the AI button.
 */

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
  const timeout = setTimeout(() => controller.abort(), 120_000);
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
    clearTimeout(timeout);
  }
}
