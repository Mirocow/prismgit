/**
 * LAR-3 — AI Chat protocol.
 *
 * Provides:
 *   - callLLM(messages, provider, options) — one-shot completion (non-streaming).
 *   - callLLMStreamChat(messages, provider, options) — streaming variant.
 *   - runWithTools(userMessage, provider, repoPath) — agentic loop:
 *       1. Call LLM with the user's message + tool definitions.
 *       2. If the LLM requests a tool call, execute the tool and feed
 *          the result back to the LLM.
 *       3. Repeat until the LLM produces a final answer (no tool calls).
 *
 * The protocol supports two tool-call formats:
 *   - OpenAI / Custom / GitHub / Mistral: `tool_calls` array in the
 *     response, with `function.name` + `function.arguments` (JSON string).
 *   - Anthropic: `content` array with `type: 'tool_use'` blocks.
 *
 * Ollama doesn't support tool calls natively — falls back to a regex
 * parser that looks for `<tool>get_status</tool>` patterns in the
 * generated text (best-effort, not robust).
 */

import type { LLMProvider } from './aiCommitMessages';
import { AI_TOOLS, getTool, type AITool } from './aiTools';
import { api } from './api';

/**
 * Proxy fetch through the Electron main process (IPC) to bypass CORS.
 * Ollama and other local LLM servers don't send Access-Control-Allow-Origin
 * headers, so the renderer's fetch() is blocked. The main process has no
 * CORS restriction.
 *
 * Returns { ok, status, statusText, body } where body is the raw response text.
 * The caller parses JSON from body as needed.
 *
 * ── Model-loading retry (Ollama) ───────────────────────────────────────
 * When Ollama receives a request for a model that isn't currently loaded
 * in memory, it returns HTTP 404 with a body like:
 *   { "error": "model 'llama3.2' not found, try pulling it first" }
 * OR (newer versions) HTTP 200 with a streaming "loading model..." preamble
 * that takes 5-60 seconds before the first token. Older versions also emit
 * HTTP 503 while the model is loading on another worker.
 *
 * The proxyFetch wrapper detects the "model not loaded" signature and
 * retries up to `MAX_RETRIES` times with exponential backoff (2s, 4s, 8s).
 * After each retry, the model is usually loaded and the next request
 * succeeds immediately. This prevents the AI Assistant from erroring out
 * on the first message of a session — the user just sees "Loading model…"
 * for a few seconds, then the response streams in normally.
 */
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

/** Detect Ollama "model not loaded" / "model loading" responses. */
function isModelLoading(status: number, body: string): boolean {
  // HTTP 404 + "model not found" — older Ollama signature.
  // HTTP 503 — newer Ollama when another worker is loading the model.
  if (status === 503) return true;
  if (status === 404) {
    const lower = body.toLowerCase();
    return (
      lower.includes('not found') ||
      lower.includes('try pulling') ||
      lower.includes('model ') && lower.includes(' loading')
    );
  }
  // Some Ollama versions return 200 but with an error body (rare).
  if (status === 200) {
    const lower = body.toLowerCase();
    if (lower.includes('"error"') && lower.includes('loading')) return true;
  }
  return false;
}

async function proxyFetch(
  url: string,
  headers: Record<string, string>,
  body: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; statusText: string; body: string }> {
  let lastError: { ok: boolean; status: number; statusText: string; body: string } | null = null;
  let backoff = INITIAL_BACKOFF_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // If the user pressed Stop, abort immediately — don't start another
    // retry attempt. The caller (runWithTools) will surface this as an
    // AbortError that the UI distinguishes from a real failure.
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    let result: { ok: boolean; status: number; statusText: string; body: string };
    // Try IPC proxy first (Electron main process — no CORS restriction)
    try {
      // Race the IPC call against the abort signal. Electron IPC itself
      // doesn't support cancellation, but if the user presses Stop, the
      // signal fires and we reject early — the in-flight IPC result is
      // discarded. For Ollama (which can take 30-300s for a slow model),
      // this is the difference between "instant stop" and "wait 5 minutes".
      const ipcPromise = api.ai?.chat?.({ url, headers, body, method: 'POST' });
      if (signal) {
        result = await Promise.race([
          ipcPromise as Promise<typeof result>,
          new Promise<typeof result>((_, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
          }),
        ]);
      } else {
        const r = await ipcPromise;
        if (!r) throw new Error('IPC returned empty');
        result = r;
      }
    } catch (e) {
      // If the user aborted, rethrow the AbortError immediately — don't
      // fall through to the retry/model-loading logic below.
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
        throw new DOMException('Aborted', 'AbortError');
      }
      // Fallback: direct fetch (works in Tauri and browser contexts without CORS)
      try {
        const res = await fetch(url, { method: 'POST', headers, body, signal });
        const text = await res.text();
        result = { ok: res.ok, status: res.status, statusText: res.statusText, body: text };
      } catch (e2) {
        // If the abort happened during the direct fetch, rethrow.
        if (signal?.aborted || (e2 instanceof DOMException && e2.name === 'AbortError')) {
          throw new DOMException('Aborted', 'AbortError');
        }
        // Network-level failure (server killed connection mid-load, ECONNRESET,
        // fetch abort on the long initial wait). If we haven't exhausted retries,
        // treat as model-loading and retry.
        if (attempt < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, backoff));
          backoff *= 2;
          continue;
        }
        throw e2;
      }
    }

    // Success — return immediately.
    if (result.ok) return result;

    lastError = result;

    // Detect "model not loaded" — retry with backoff so Ollama can finish
    // loading the model in the background. After 2-3 retries (4-12 seconds
    // total), the model is typically warm and subsequent requests succeed.
    if (attempt < MAX_RETRIES && isModelLoading(result.status, result.body)) {
      await new Promise(resolve => setTimeout(resolve, backoff));
      backoff *= 2;
      continue;
    }

    // Non-retryable error — return to the caller for normal handling.
    return result;
  }

  // Exhausted retries — return the last error response.
  return lastError ?? { ok: false, status: 0, statusText: 'Exhausted retries', body: '' };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** For role='tool' — the name of the tool that produced this result. */
  toolName?: string;
  /** For role='assistant' — parsed tool calls requested by the LLM. */
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  /** Tool name (must match a registered AITool). */
  name: string;
  /** Parsed arguments object. */
  arguments: Record<string, unknown>;
  /** Raw arguments string (JSON) — kept for OpenAI compat. */
  rawArguments?: string;
  /** For Anthropic — the tool_use block id. */
  id?: string;
}

/**
 * Build the system prompt that describes available tools.
 * Sent to the LLM as the first system message.
 *
 * The prompt explicitly distinguishes between:
 *   - Repository-scoped tools (require an open repo): get_status, get_log,
 *     get_diff, get_branches, stage_files, commit, push, etc.
 *   - App-scoped tools (work WITHOUT an open repo): list_repos,
 *     search_repos, clone_repo, init_repo, open_repo.
 * This lets the AI gracefully handle "no repo open" by suggesting the user
 * clone/init/open one instead of failing on a git command.
 */
export function buildToolSystemPrompt(tools: AITool[] = AI_TOOLS, repoPath?: string): string {
  const toolDocs = tools.map(t => `- ${t.name}: ${t.description}\n  Parameters: ${JSON.stringify(t.parameters)}`).join('\n');
  const repoContext = repoPath
    ? `Current repository context: ${repoPath}\nYou can run git commands against this repo directly using the repository-scoped tools.`
    : `No repository is currently open. For repository-scoped tools (get_status, get_log, commit, push, etc.) to work, the user must first open or clone a repo. Use the app-scoped tools (list_repos, search_repos, clone_repo, init_repo, open_repo) to help them set one up — they do NOT require an open repo.`;
  return `You are PrismGit's AI assistant — you help the user manage their Git repositories.

${repoContext}

You have access to tools for reading repository data, performing git actions, AND managing the app's repository list.

Available tools:
${toolDocs}

Rules:
1. For greetings or general conversation (e.g. "hello", "how are you"), respond directly without calling any tools.
2. For git-related questions, CALL the appropriate tool FIRST — never fabricate results.
3. For write actions (stage, commit, push, etc.), call the tool directly.
4. After tools return, summarize the result in 1-3 sentences based on ACTUAL data.
5. If a tool fails, report the error and suggest what the user should do.
6. For commit messages, use imperative mood: "Add feature X", "Fix bug Y".
7. You can chain multiple tool calls: e.g. get_status → stage_files → commit → push.
8. If the user asks to "open" / "switch to" / "find" a repository, use list_repos + search_repos + open_repo.
9. If the user asks to "clone" or "create" a repo, use clone_repo or init_repo — these work even when no repo is currently open.
10. Be concise — users want quick answers, not essays.
11. PREFERRED PULL STRATEGY: when the user says "pull", "слей последние изменения", "update from remote", use the pull tool with default settings — it auto-stashes local changes, runs \`git pull --rebase\`, then restores the stash. This matches the user's preferred workflow and avoids the "unstaged changes" error.
12. DESTRUCTIVE OPERATIONS: when the user explicitly says "discard", "откатить локальные изменения", "reset to HEAD", "throw away my changes", use discard_changes (permanent) or sync_with_remote (resets to origin/<branch> but keeps a stash as a safety net). NEVER call discard_changes without an explicit user request.
13. If a git operation fails with "index.lock exists", tell the user another git operation may be running and to wait a moment and retry — do NOT try to delete the lock file automatically.
`;
}

/**
 * Run the agentic tool-use loop:
 *   1. Send user message + tool definitions to LLM.
 *   2. If LLM requests tool calls, execute them and feed results back.
 *   3. Repeat until LLM produces a final answer (no tool calls).
 *
 * Returns the final assistant message + the conversation history
 * (including all tool results, so the UI can show them as a transcript).
 *
 * The `onAssistantMessage` callback is called for each assistant
 * intermediate message (with tool_calls) and for the final answer —
 * useful for the UI to render the agent's "thinking" trace.
 *
 * `repoPath` is now optional — when undefined, only the app-scoped tools
 * (list_repos, search_repos, clone_repo, init_repo, open_repo) can run
 * successfully. The system prompt tells the LLM which tools are available
 * and what context (repo or no-repo) it's operating in.
 *
 * ── Abort / Stop ──────────────────────────────────────────────────────
 * Pass an `AbortSignal` via `options.signal` to cancel the loop mid-flight.
 * The signal is forwarded to `callLLMChat()` and from there to the
 * underlying fetch. When aborted:
 *   - If the LLM call is in flight: fetch is aborted, the awaited promise
 *     rejects with an AbortError, and runWithTools re-throws it (the UI's
 *     catch block decides whether to show "stopped by user" or "error").
 *   - If a tool call is in flight: the IPC call cannot be aborted (Electron
 *     IPC doesn't support cancellation), but the loop checks `signal.aborted`
 *     before each iteration and bails out cleanly.
 */
export async function runWithTools(
  userMessage: string,
  provider: LLMProvider,
  repoPath: string | undefined,
  options?: {
    onAssistantMessage?: (msg: ChatMessage) => void;
    onToolCall?: (name: string, args: Record<string, unknown>) => void;
    onToolResult?: (name: string, result: string) => void;
    maxIterations?: number;
    /** Abort signal — when aborted, the loop bails out and the in-flight
     *  fetch is cancelled. Used by the AI Assistant "Stop" button. */
    signal?: AbortSignal;
  },
): Promise<{ finalMessage: string; history: ChatMessage[] }> {
  const history: ChatMessage[] = [
    { role: 'system', content: buildToolSystemPrompt(AI_TOOLS, repoPath) },
    { role: 'user', content: userMessage },
  ];
  const maxIterations = options?.maxIterations ?? 5;
  const signal = options?.signal;
  for (let i = 0; i < maxIterations; i++) {
    // Check abort BEFORE each LLM call — if the user pressed Stop during
    // a tool execution, we don't want to start another expensive LLM call.
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    // Call the LLM with the current history.
    const assistantMessage = await callLLMChat(history, provider, signal);
    options?.onAssistantMessage?.(assistantMessage);
    history.push(assistantMessage);
    // If no tool calls, we're done — return the final message.
    if (!assistantMessage.toolCalls || assistantMessage.toolCalls.length === 0) {
      return { finalMessage: assistantMessage.content, history };
    }
    // Execute each requested tool call.
    for (const call of assistantMessage.toolCalls) {
      // Check abort before each tool call — long-running tools (clone_repo,
      // sync_with_remote) can be interrupted between consecutive tool calls
      // even if the in-flight one can't be cancelled.
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const tool = getTool(call.name);
      options?.onToolCall?.(call.name, call.arguments);
      if (!tool) {
        const errMsg = `Tool '${call.name}' is not available.`;
        options?.onToolResult?.(call.name, errMsg);
        history.push({ role: 'tool', content: errMsg, toolName: call.name });
        continue;
      }
      try {
        // repoPath may be undefined for app-scoped tools — they ignore it.
        // Repository-scoped tools will fail at api.git.* with a clear error
        // (e.g. "no repo open"), which the LLM can recover from by suggesting
        // the user open one.
        const result = await tool.execute(call.arguments, repoPath ?? '');
        options?.onToolResult?.(call.name, result);
        history.push({ role: 'tool', content: result, toolName: call.name });
      } catch (e) {
        // If the abort happened DURING tool execution (Electron IPC can't
        // be cancelled, but the NEXT iteration check above will catch it),
        // we still record the partial result so the user sees what happened.
        const errMsg = `Tool '${call.name}' failed: ${String(e)}`;
        options?.onToolResult?.(call.name, errMsg);
        history.push({ role: 'tool', content: errMsg, toolName: call.name });
      }
    }
  }
  // Hit the iteration cap — return the last assistant message.
  const last = history[history.length - 1];
  return { finalMessage: last?.content ?? 'No final message.', history };
}

/**
 * One-shot chat completion (non-streaming). Returns the assistant's
 * message — content + any parsed tool_calls.
 *
 * The optional `signal` is forwarded to the underlying fetch — when
 * aborted, the fetch is cancelled and the promise rejects with an
 * AbortError. Used by runWithTools to support the "Stop" button.
 */
export async function callLLMChat(
  messages: ChatMessage[],
  provider: LLMProvider,
  signal?: AbortSignal,
): Promise<ChatMessage> {
  // Dispatch by provider type.
  switch (provider.type) {
    case 'openai':
    case 'custom':
    case 'github':
    case 'mistral':
      return callOpenAIChat(messages, provider, signal);
    case 'anthropic':
      return callAnthropicChat(messages, provider, signal);
    case 'ollama':
      return callOllamaChat(messages, provider, signal);
    default:
      throw new Error(`Unsupported provider type for chat: ${provider.type}`);
  }
}

async function callOpenAIChat(messages: ChatMessage[], provider: LLMProvider, signal?: AbortSignal): Promise<ChatMessage> {
  const url = provider.url || 'https://api.openai.com/v1/chat/completions';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  const body = JSON.stringify({
    model: provider.model,
    messages: messages.map(m => {
      // For role='tool', OpenAI expects {role: 'tool', content, tool_call_id}.
      if (m.role === 'tool') return { role: 'tool', content: m.content, tool_call_id: m.toolName };
      // For role='assistant' with tool_calls, include them in the response.
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id ?? `call_${tc.name}`,
            type: 'function',
            function: { name: tc.name, arguments: tc.rawArguments ?? JSON.stringify(tc.arguments) },
          })),
        };
      }
      return { role: m.role, content: m.content };
    }),
    tools: AI_TOOLS.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
    max_tokens: 1024,
    temperature: provider.temperature ?? 0.4,
  });
  const res = await proxyFetch(url, headers, body, signal);
  if (!res.ok) {
    throw new Error(`OpenAI chat error ${res.status}: ${res.body}`);
  }
  const data = JSON.parse(res.body);
  const msg = data.choices?.[0]?.message ?? {};
  const toolCalls: ToolCall[] | undefined = msg.tool_calls?.map((tc: { id: string; function: { name: string; arguments: string } }) => {
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(tc.function.arguments || '{}'); } catch { /* leave empty */ }
    return {
      name: tc.function.name,
      arguments: parsed,
      rawArguments: tc.function.arguments,
      id: tc.id,
    };
  });
  return {
    role: 'assistant',
    content: msg.content ?? '',
    toolCalls,
  };
}

async function callAnthropicChat(messages: ChatMessage[], provider: LLMProvider, signal?: AbortSignal): Promise<ChatMessage> {
  const url = provider.url || 'https://api.anthropic.com/v1/messages';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (provider.apiKey) headers['x-api-key'] = provider.apiKey;
  // Anthropic's API: separate system from messages; tools array.
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  const userMessages = messages.filter(m => m.role !== 'system').map(m => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...m.toolCalls.map(tc => ({
            type: 'tool_use',
            id: tc.id ?? `toolu_${tc.name}`,
            name: tc.name,
            input: tc.arguments,
          })),
        ],
      };
    }
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolName, content: m.content }],
      };
    }
    return { role: m.role, content: m.content };
  });
  const body = JSON.stringify({
    model: provider.model,
    system,
    messages: userMessages,
    tools: AI_TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    max_tokens: 1024,
  });
  const res = await proxyFetch(url, headers, body, signal);
  if (!res.ok) {
    throw new Error(`Anthropic chat error ${res.status}: ${res.body}`);
  }
  const data = JSON.parse(res.body);
  // Anthropic returns content as an array of blocks (text + tool_use).
  const blocks = data.content ?? [];
  const textParts = blocks.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
  const toolUses: ToolCall[] | undefined = blocks
    .filter((b: { type: string }) => b.type === 'tool_use')
    .map((b: { id: string; name: string; input: Record<string, unknown> }) => ({
      name: b.name,
      arguments: b.input,
      id: b.id,
    }));
  return {
    role: 'assistant',
    content: textParts,
    toolCalls: toolUses?.length ? toolUses : undefined,
  };
}

async function callOllamaChat(messages: ChatMessage[], provider: LLMProvider, signal?: AbortSignal): Promise<ChatMessage> {
  const url = (provider.url || 'http://localhost:11434') + '/api/chat';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  // Ollama's tool format:
  //   - tool definitions: tools: [{ type: 'function', function: { name, description, parameters } }]
  //   - assistant tool_calls in history: tool_calls: [{ function: { name, arguments: <object> } }]
  //   - tool result messages: role='tool', content=string
  //
  // CRITICAL: Ollama expects arguments as a JSON OBJECT, not a string.
  // OpenAI expects arguments as a JSON STRING. This difference causes
  // HTTP 400 "Value looks like object, but can't find closing '}'" if
  // we send a string to Ollama.
  //
  // However, some Ollama versions ALSO fail when tool_calls are included
  // in the message history with object arguments. The safest approach:
  // serialize tool_calls history as plain text in the content field,
  // and only pass tools in the request body (not in message history).
  // This avoids format mismatches across Ollama versions.

  const ollamaMessages = messages.map(m => {
    // Skip system messages — Ollama uses a separate 'system' field
    if (m.role === 'system') return null;

    // For tool results, include as role='tool'
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content };
    }

    // For assistant messages with tool_calls, include the tool_calls
    // but use object arguments (not stringified)
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || '',
        tool_calls: m.toolCalls.map(tc => ({
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }

    return { role: m.role, content: m.content };
  }).filter(Boolean) as Array<Record<string, unknown>>;

  // Extract system prompt from the first message
  const systemPrompt = messages.find(m => m.role === 'system')?.content || '';

  const body = JSON.stringify({
    model: provider.model,
    messages: ollamaMessages,
    system: systemPrompt,
    stream: false,
    tools: AI_TOOLS.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    })),
  });
  const res = await proxyFetch(url, headers, body, signal);
  if (!res.ok) {
    throw new Error(`Ollama chat error ${res.status}: ${res.body}`);
  }
  const data = JSON.parse(res.body);
  const content: string = data.message?.content ?? '';
  // Ollama returns tool_calls natively when the model supports it.
  const rawToolCalls = data.message?.tool_calls;
  let toolCalls: ToolCall[] | undefined;
  if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
    toolCalls = rawToolCalls.map((tc: { function: { name: string; arguments: string | Record<string, unknown> } }) => {
      let parsed: Record<string, unknown> = {};
      const args = tc.function?.arguments;
      if (typeof args === 'string') {
        try { parsed = JSON.parse(args); } catch { /* leave empty */ }
      } else if (args && typeof args === 'object') {
        parsed = args as Record<string, unknown>;
      }
      return {
        name: tc.function?.name || '',
        arguments: parsed,
      };
    });
  }
  // Fallback: if no native tool_calls, try regex parse (for older Ollama)
  if (!toolCalls) {
    toolCalls = parseOllamaToolCalls(content);
  }
  return {
    role: 'assistant',
    content: toolCalls?.length ? content.replace(/<tool>[\s\S]*?<\/tool>/g, '').trim() : content,
    toolCalls,
  };
}

/** Best-effort parser for Ollama tool-call patterns: <tool name="get_status"></tool> */
function parseOllamaToolCalls(content: string): ToolCall[] | undefined {
  const re = /<tool\s+name="([^"]+)"(?:\s+args='([^']*)')?\s*><\/tool>/g;
  const calls: ToolCall[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const name = match[1];
    let args: Record<string, unknown> = {};
    if (match[2]) {
      try { args = JSON.parse(match[2]); } catch { /* leave empty */ }
    }
    calls.push({ name, arguments: args });
  }
  return calls.length > 0 ? calls : undefined;
}
