/**
 * AI Commit Messages integration (SmartGit Manual v25+ feature).
 *
 * Supports multiple LLM providers: OpenAI, Anthropic, GitHub Models, Ollama,
 * Mistral, and Custom (OpenAI-compatible).
 *
 * Usage:
 *   - User types `@ai` placeholder in commit message → replaced by AI-generated message on commit
 *   - User types `WIP` as entire message → replaced by `WIP: <ai generated message>`
 *   - "Generate" button in commit editor → previews the AI message before commit
 *
 * Configuration is stored in AppSettings and in .git/config under [smartgit-ai-llm "..."] sections.
 */

export interface LLMProvider {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'github' | 'ollama' | 'mistral' | 'custom';
  url: string;
  apiKey?: string;
  model: string;
  /** Max tokens for the response. */
  maxTokens?: number;
  /** Temperature for generation (0-1). */
  temperature?: number;
}

export interface AICommitMessageConfig {
  enabled: boolean;
  /** LLM provider id from the providers list. */
  defaultProvider?: string;
  /** Wrap description at this column (default 72). */
  wrapDescription?: number;
  /** Behavior when AI generation is in progress but commit is requested. */
  onManualIntervention?: 'stop' | 'continue-in-background';
}

/** Default system prompt for AI commit message generation. */
const DEFAULT_PROMPT = `You are a helpful assistant that writes Git commit messages.
Given the diff of changes, write a clear and concise commit message following these rules:

1. First line: imperative mood, no more than 50 characters, no period at end.
2. Blank line.
3. Body: wrap at 72 characters. Explain WHAT and WHY (not HOW). One blank line between paragraphs.
4. If the change adds a feature, prefix with "feat:".
5. If the change fixes a bug, prefix with "fix:".
6. If the change is a refactor, prefix with "refactor:".
7. If the change updates docs, prefix with "docs:".
8. If the change updates tests, prefix with "test:".
9. If the change updates chore/build, prefix with "chore:".

Output ONLY the commit message, no explanation, no code fences.`;

export interface GenerateMessageParams {
  diff: string;
  /** Recent commit messages for style consistency. */
  recentMessages?: string[];
  /** Optional custom prompt override. */
  systemPrompt?: string;
  /** Provider to use. */
  provider: LLMProvider;
  /** Max tokens (default 256). */
  maxTokens?: number;
}

/**
 * Generate a commit message from a diff using the configured LLM provider.
 *
 * Implementation note: this is a browser-side fetch that talks directly to the
 * LLM API. The API key is stored in AppSettings and read from there.
 */
export async function generateCommitMessage(params: GenerateMessageParams): Promise<string> {
  const { diff, recentMessages = [], systemPrompt = DEFAULT_PROMPT, provider, maxTokens = 256 } = params;

  // Truncate diff to avoid token limits (rough: 4 chars per token, ~12k tokens max)
  const truncatedDiff = diff.length > 48000
    ? diff.slice(0, 48000) + '\n... (diff truncated)'
    : diff;

  const userPrompt = recentMessages.length > 0
    ? `Recent commit messages for style reference:\n${recentMessages.map(m => '- ' + m.split('\n')[0]).join('\n')}\n\nGenerate a commit message for these changes:\n\n${truncatedDiff}`
    : `Generate a commit message for these changes:\n\n${truncatedDiff}`;

  switch (provider.type) {
    case 'openai':
    case 'custom':
    case 'github':
      return callOpenAICompatible(provider, systemPrompt, userPrompt, maxTokens);
    case 'anthropic':
      return callAnthropic(provider, systemPrompt, userPrompt, maxTokens);
    case 'ollama':
      return callOllama(provider, systemPrompt, userPrompt, maxTokens);
    case 'mistral':
      return callOpenAICompatible(provider, systemPrompt, userPrompt, maxTokens);
    default:
      throw new Error(`Unsupported provider type: ${provider.type}`);
  }
}

/** OpenAI-compatible API (also used for GitHub Models, Mistral, Custom). */
async function callOpenAICompatible(
  provider: LLMProvider,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string> {
  const url = provider.url || 'https://api.openai.com/v1/chat/completions';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (provider.apiKey) {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  }
  const body = {
    model: provider.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: maxTokens,
    temperature: provider.temperature ?? 0.4,
  };
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API error ${response.status}: ${text}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty LLM response');
  return content.trim();
}

/** Anthropic Claude API. */
async function callAnthropic(
  provider: LLMProvider,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string> {
  const url = provider.url || 'https://api.anthropic.com/v1/messages';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (provider.apiKey) {
    headers['x-api-key'] = provider.apiKey;
  }
  const body = {
    model: provider.model,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    max_tokens: maxTokens,
  };
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text}`);
  }
  const data = await response.json();
  const content = data.content?.[0]?.text;
  if (!content) throw new Error('Empty Anthropic response');
  return content.trim();
}

/** Ollama (local, no API key needed). */
async function callOllama(
  provider: LLMProvider,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string> {
  const url = provider.url || 'http://localhost:11434/api/chat';
  const body = {
    model: provider.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    options: {
      num_predict: maxTokens,
      temperature: provider.temperature ?? 0.4,
    },
    stream: false,
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama API error ${response.status}: ${text}`);
  }
  const data = await response.json();
  const content = data.message?.content;
  if (!content) throw new Error('Empty Ollama response');
  return content.trim();
}

/**
 * Wrap a commit message description at the specified column.
 * Preserves the subject/body separation (first line, blank, body).
 */
export function wrapCommitMessage(message: string, col = 72): string {
  const lines = message.split('\n');
  if (lines.length === 0) return message;
  const subject = lines[0];
  const body = lines.slice(1).join('\n').trim();
  if (!body) return subject;
  // Wrap body paragraphs
  const paragraphs = body.split('\n\n');
  const wrapped = paragraphs.map(p => {
    const words = p.split(/\s+/);
    const out: string[] = [];
    let line = '';
    for (const w of words) {
      if (line.length + w.length + 1 > col) {
        out.push(line);
        line = w;
      } else {
        line = line ? line + ' ' + w : w;
      }
    }
    if (line) out.push(line);
    return out.join('\n');
  });
  return subject + '\n\n' + wrapped.join('\n\n');
}

/**
 * Detect the `@ai` or `WIP` placeholder in a commit message.
 * Returns the placeholder kind, or null if no placeholder is present.
 */
export function detectAIPlaceholder(message: string): 'ai' | 'wip' | null {
  const trimmed = message.trim();
  if (trimmed === 'WIP' || trimmed === 'wip') return 'wip';
  if (trimmed === '@ai' || trimmed === '@AI') return 'ai';
  if (trimmed.includes('@ai')) return 'ai'; // Allow "@ai" inline as a marker
  return null;
}

/**
 * Apply the AI placeholder substitution.
 *   - 'ai': replace the entire message with the AI-generated message
 *   - 'wip': replace with "WIP: <ai generated message>"
 */
export function applyAIPlaceholder(message: string, aiMessage: string, kind: 'ai' | 'wip'): string {
  if (kind === 'wip') return `WIP: ${aiMessage.split('\n')[0]}`;
  return aiMessage;
}

/**
 * SmartGit Manual: Custom AI Prompts with template variables.
 * Substitutes {{var}} placeholders in a prompt template.
 *
 * Supported variables:
 *   {{branch}}         — current branch name
 *   {{author}}        — git config user.name
 *   {{date}}          — ISO date string
 *   {{repository}}    — repository name (basename)
 *   {{remoteUrl}}     — remote URL (origin)
 *   {{commitCount}}   — number of commits being merged/stashed/etc
 *   {{fileCount}}     — number of files changed
 *   {{diff}}          — the diff content
 *   {{recentMessages}} — recent commit messages for style reference
 */
export function substitutePromptTemplate(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (full, key: string) => {
    const val = vars[key];
    return val !== undefined ? String(val) : full;
  });
}

/**
 * Generate a merge commit message using AI.
 * SmartGit Manual: AI for Merge descriptions.
 */
export interface GenerateMergeMessageParams {
  /** The branch being merged in. */
  sourceBranch: string;
  /** The branch being merged into (usually current). */
  targetBranch: string;
  /** Diff of the merge (source branch commits). */
  diff: string;
  /** Number of commits being merged. */
  commitCount: number;
  /** LLM provider. */
  provider: LLMProvider;
  /** Optional custom prompt template. */
  systemPrompt?: string;
}

export async function generateMergeMessage(params: GenerateMergeMessageParams): Promise<string> {
  const { sourceBranch, targetBranch, diff, commitCount, provider, systemPrompt } = params;
  const prompt = systemPrompt || `You are a helpful assistant that writes Git merge commit messages.
Given the source branch, target branch, and a diff of changes being merged, write a clear merge commit message.

Rules:
1. First line: "Merge branch '<source>' into <target>" or describe the feature being merged.
2. Optional body: summarize what was changed, wrapped at 72 chars.
3. If the source branch name indicates a feature/fix, mention it in the body.

Output ONLY the merge commit message, no explanation.`;
  const userPrompt = `Source branch: ${sourceBranch}\nTarget branch: ${targetBranch}\nCommits being merged: ${commitCount}\n\nDiff:\n${diff.slice(0, 48000)}`;
  return callProvider(provider, prompt, userPrompt, 256);
}

/**
 * Generate a stash message using AI.
 * SmartGit Manual: AI for Stash descriptions.
 */
export interface GenerateStashMessageParams {
  /** Diff of the stashed changes. */
  diff: string;
  /** Number of files in the stash. */
  fileCount: number;
  /** Current branch name. */
  branch?: string;
  /** LLM provider. */
  provider: LLMProvider;
  /** Optional custom prompt template. */
  systemPrompt?: string;
}

export async function generateStashMessage(params: GenerateStashMessageParams): Promise<string> {
  const { diff, fileCount, branch, provider, systemPrompt } = params;
  const prompt = systemPrompt || `You are a helpful assistant that writes Git stash messages.
Given a diff of stashed changes, write a short, descriptive stash message.

Rules:
1. Single line, no more than 72 characters.
2. Start with "WIP:" or describe what was being worked on.
3. Mention the primary file or feature being changed.

Output ONLY the stash message, no explanation.`;
  const userPrompt = `Branch: ${branch || 'unknown'}\nFiles: ${fileCount}\n\nDiff:\n${diff.slice(0, 32000)}`;
  return callProvider(provider, prompt, userPrompt, 128);
}

/**
 * MED-3 — Generate 3-5 candidate git branch names using AI, based on the
 * list of changed files. Used by the BranchesPage "New Branch" dialog:
 *
 *   user stages a few files → opens New Branch → clicks ✨ AI Suggest →
 *   gets back kebab-case names like 'feature/add-user-auth' to pick from.
 *
 * The prompt deliberately uses file paths (not the diff body) because:
 *  - branch names are short, so file-name context is enough;
 *  - we keep the request small (cheap to stream over slow connections);
 *  - we never leak secret file contents to the LLM beyond what filenames
 *    already reveal.
 *
 * The output is parsed loosely: each non-empty line is one candidate,
 * backticks / quotes / leading dashes are stripped.
 */
export interface GenerateBranchNameParams {
  /** List of changed file paths (staged + untracked, capped at 20). */
  files: string[];
  /** LLM provider. */
  provider: LLMProvider;
  /** Optional custom prompt template. */
  systemPrompt?: string;
  /** Recent branch names for style consistency (e.g. 'feature/auth'). */
  recentBranches?: string[];
  /** How many candidates to request (default 5). */
  count?: number;
}

export async function generateBranchNames(params: GenerateBranchNameParams): Promise<string[]> {
  const { files, provider, systemPrompt, recentBranches = [], count = 5 } = params;
  if (files.length === 0) return [];

  const prompt = systemPrompt || `You are a helpful assistant that suggests Git branch names.
Given a list of changed files, suggest ${count} candidate branch names.

Rules:
1. Use kebab-case (lowercase letters, digits, hyphens).
2. Format: <type>/<short-description>, e.g. feature/add-user-auth, fix/rename-detection, refactor/extract-filter.
3. Type prefix MUST be one of: feature, fix, refactor, docs, test, chore, build, ci, perf, revert.
4. Short-description: 2-5 words summarising the change.
5. No prefix variation — exactly one type per name.
6. Do NOT repeat candidates.

Output ONLY the branch names, one per line. No bullet points, no numbering, no code fences, no quotes.`;

  const recentBlock = recentBranches.length > 0
    ? `\nRecent branch names in this repo (for style reference — do not repeat these exact names):\n${recentBranches.map(b => '- ' + b).join('\n')}\n`
    : '';

  const userPrompt = `Changed files (${files.length}):\n${files.slice(0, 20).map(f => '- ' + f).join('\n')}${recentBlock}\nSuggest ${count} branch names.`;
  const raw = await callProvider(provider, prompt, userPrompt, 256);

  return raw
    .split('\n')
    .map(s => s.trim())
    .map(s => s.replace(/^[`'"\-•*\d.\s]+/, '').replace(/[`'"]/g, '').trim())
    .filter(s => s.length > 0 && s.length <= 80)
    // Enforce conventional-commits type prefix and kebab-case description.
    // Allow both 'feat' (canonical) and 'feature' (ergonomic) as prefixes.
    .filter(s => /^(feat|feature|fix|docs|style|refactor|perf|test|chore|build|ci|revert)(\/[a-z0-9][a-z0-9-]*)+$/.test(s))
    .slice(0, count);
}

/** Internal: call the appropriate provider. */
async function callProvider(
  provider: LLMProvider,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string> {
  switch (provider.type) {
    case 'openai':
    case 'custom':
    case 'github':
      return callOpenAICompatible(provider, systemPrompt, userPrompt, maxTokens);
    case 'anthropic':
      return callAnthropic(provider, systemPrompt, userPrompt, maxTokens);
    case 'ollama':
      return callOllama(provider, systemPrompt, userPrompt, maxTokens);
    case 'mistral':
      return callOpenAICompatible(provider, systemPrompt, userPrompt, maxTokens);
    default:
      throw new Error(`Unsupported provider type: ${provider.type}`);
  }
}

// ============================================================================
// LAR-1 — Streaming AI responses.
//
// Adds `callLLMStream()` and `generateCommitMessageStream()` that yield
// tokens as they arrive from the LLM, so the user sees the message
// compose itself in real time instead of waiting for the full response
// (5-15 sec for long PR descriptions).
//
// All three provider families support streaming:
//   - OpenAI / Custom / GitHub / Mistral  → SSE `data: {choices:[{delta:{content}}]}\n\n`
//   - Anthropic                           → SSE `event: content_block_delta` + `data: {delta:{text}}\n\n`
//   - Ollama                              → NDJSON (one JSON object per line, `message.content`)
//
// The frontend's ChangesPage integrates this via `for await (const tok of generateCommitMessageStream(...))`,
// appending each token to the commit-message textarea in real time.
// ============================================================================

/**
 * Streaming variant of callProvider. Yields tokens as they arrive.
 * Returns the full concatenated message when the generator completes.
 *
 * The `onToken` callback is also called for each token — useful for
 * callers that want to update UI without using `for await`.
 */
export async function* callLLMStream(
  provider: LLMProvider,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  options?: { onToken?: (token: string) => void; signal?: AbortSignal },
): AsyncGenerator<string, string, unknown> {
  let full = '';
  const onToken = options?.onToken;
  const signal = options?.signal;

  // --- OpenAI-compatible (OpenAI / Custom / GitHub / Mistral) ---
  async function* streamOpenAICompatible(): AsyncGenerator<string> {
    const url = provider.url || 'https://api.openai.com/v1/chat/completions';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
    const body = JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: provider.temperature ?? 0.4,
      stream: true,
    });
    const response = await fetch(url, { method: 'POST', headers, body, signal });
    if (!response.ok || !response.body) {
      const text = await response.text();
      throw new Error(`LLM stream error ${response.status}: ${text}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          const token = json.choices?.[0]?.delta?.content;
          if (token) {
            full += token;
            onToken?.(token);
            yield token;
          }
        } catch { /* ignore non-JSON keepalive lines */ }
      }
    }
  }

  // --- Anthropic (Claude) ---
  async function* streamAnthropic(): AsyncGenerator<string> {
    const url = provider.url || 'https://api.anthropic.com/v1/messages';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      Accept: 'text/event-stream',
    };
    if (provider.apiKey) headers['x-api-key'] = provider.apiKey;
    const body = JSON.stringify({
      model: provider.model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: maxTokens,
      stream: true,
    });
    const response = await fetch(url, { method: 'POST', headers, body, signal });
    if (!response.ok || !response.body) {
      const text = await response.text();
      throw new Error(`Anthropic stream error ${response.status}: ${text}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentData = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) currentData += line.slice(6);
        else if (line === '' && currentData) {
          try {
            const json = JSON.parse(currentData);
            // Anthropic delta events arrive as:
            //   { type: 'content_block_delta', delta: { type: 'text_delta', text: '<token>' } }
            if (json.type === 'content_block_delta' && json.delta?.text) {
              full += json.delta.text;
              onToken?.(json.delta.text);
              yield json.delta.text;
            }
          } catch { /* ignore */ }
          currentData = '';
        }
      }
    }
  }

  // --- Ollama (NDJSON — one JSON object per line) ---
  async function* streamOllama(): AsyncGenerator<string> {
    const url = (provider.url || 'http://localhost:11434') + '/api/chat';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: true,
      options: { temperature: provider.temperature ?? 0.4 },
    });
    const response = await fetch(url, { method: 'POST', headers, body, signal });
    if (!response.ok || !response.body) {
      const text = await response.text();
      throw new Error(`Ollama stream error ${response.status}: ${text}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed);
          const token = json.message?.content;
          const doneFlag = json.done;
          if (token) {
            full += token;
            onToken?.(token);
            yield token;
          }
          if (doneFlag) return;
        } catch { /* ignore */ }
      }
    }
  }

  // Dispatch by provider type.
  switch (provider.type) {
    case 'openai':
    case 'custom':
    case 'github':
    case 'mistral':
      yield* streamOpenAICompatible();
      break;
    case 'anthropic':
      yield* streamAnthropic();
      break;
    case 'ollama':
      yield* streamOllama();
      break;
    default:
      throw new Error(`Unsupported provider type for streaming: ${provider.type}`);
  }

  return full; // AsyncGenerator return value — the full concatenated message.
}

/**
 * Streaming variant of generateCommitMessage. Yields tokens as they arrive.
 * Returns the full message when the generator completes.
 *
 * Usage:
 *   for await (const tok of generateCommitMessageStream(params, { onToken: t => setCommitMsg(p => p + t) })) {
 *     // token already applied via onToken callback above
 *   }
 */
export async function* generateCommitMessageStream(
  params: GenerateMessageParams,
  options?: { onToken?: (token: string) => void; signal?: AbortSignal },
): AsyncGenerator<string, string, unknown> {
  const { diff, recentMessages = [], systemPrompt = DEFAULT_PROMPT, provider, maxTokens = 256 } = params;
  const truncatedDiff = diff.length > 48000 ? diff.slice(0, 48000) + '\n... (diff truncated)' : diff;
  const userPrompt = recentMessages.length > 0
    ? `Recent commit messages for style reference:\n${recentMessages.map(m => '- ' + m.split('\n')[0]).join('\n')}\n\nGenerate a commit message for these changes:\n\n${truncatedDiff}`
    : `Generate a commit message for these changes:\n\n${truncatedDiff}`;
  return yield* callLLMStream(provider, systemPrompt, userPrompt, maxTokens, options);
}
