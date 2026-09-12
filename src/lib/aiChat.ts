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
 */
export function buildToolSystemPrompt(tools: AITool[] = AI_TOOLS): string {
  const toolDocs = tools.map(t => `- ${t.name}: ${t.description}\n  Parameters: ${JSON.stringify(t.parameters)}`).join('\n');
  return `You are PrismGit's AI assistant — you help the user understand their Git repository.

You have access to the following tools. When the user asks a question, decide which tools you need to call, then call them. After receiving tool results, give a concise natural-language answer.

Available tools:
${toolDocs}

Rules:
1. Call tools only when the answer requires git data (status, log, diff, branches, stashes).
2. After tools return, summarize the findings in 1-3 sentences. Don't dump raw output.
3. If the user asks for an action you can't perform (commit, push, etc.), explain what they should do.
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
 */
export async function runWithTools(
  userMessage: string,
  provider: LLMProvider,
  repoPath: string,
  options?: {
    onAssistantMessage?: (msg: ChatMessage) => void;
    onToolCall?: (name: string, args: Record<string, unknown>) => void;
    onToolResult?: (name: string, result: string) => void;
    maxIterations?: number;
  },
): Promise<{ finalMessage: string; history: ChatMessage[] }> {
  const history: ChatMessage[] = [
    { role: 'system', content: buildToolSystemPrompt() },
    { role: 'user', content: userMessage },
  ];
  const maxIterations = options?.maxIterations ?? 5;
  for (let i = 0; i < maxIterations; i++) {
    // Call the LLM with the current history.
    const assistantMessage = await callLLMChat(history, provider);
    options?.onAssistantMessage?.(assistantMessage);
    history.push(assistantMessage);
    // If no tool calls, we're done — return the final message.
    if (!assistantMessage.toolCalls || assistantMessage.toolCalls.length === 0) {
      return { finalMessage: assistantMessage.content, history };
    }
    // Execute each requested tool call.
    for (const call of assistantMessage.toolCalls) {
      const tool = getTool(call.name);
      options?.onToolCall?.(call.name, call.arguments);
      if (!tool) {
        const errMsg = `Tool '${call.name}' is not available.`;
        options?.onToolResult?.(call.name, errMsg);
        history.push({ role: 'tool', content: errMsg, toolName: call.name });
        continue;
      }
      try {
        const result = await tool.execute(call.arguments, repoPath);
        options?.onToolResult?.(call.name, result);
        history.push({ role: 'tool', content: result, toolName: call.name });
      } catch (e) {
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
 */
export async function callLLMChat(
  messages: ChatMessage[],
  provider: LLMProvider,
): Promise<ChatMessage> {
  // Dispatch by provider type.
  switch (provider.type) {
    case 'openai':
    case 'custom':
    case 'github':
    case 'mistral':
      return callOpenAIChat(messages, provider);
    case 'anthropic':
      return callAnthropicChat(messages, provider);
    case 'ollama':
      return callOllamaChat(messages, provider);
    default:
      throw new Error(`Unsupported provider type for chat: ${provider.type}`);
  }
}

async function callOpenAIChat(messages: ChatMessage[], provider: LLMProvider): Promise<ChatMessage> {
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
  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI chat error ${res.status}: ${text}`);
  }
  const data = await res.json();
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

async function callAnthropicChat(messages: ChatMessage[], provider: LLMProvider): Promise<ChatMessage> {
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
  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic chat error ${res.status}: ${text}`);
  }
  const data = await res.json();
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

async function callOllamaChat(messages: ChatMessage[], provider: LLMProvider): Promise<ChatMessage> {
  const url = (provider.url || 'http://localhost:11434') + '/api/chat';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const body = JSON.stringify({
    model: provider.model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    stream: false,
  });
  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama chat error ${res.status}: ${text}`);
  }
  const data = await res.json();
  // Ollama doesn't natively support tool calls — best-effort regex parse.
  const content: string = data.message?.content ?? '';
  const toolCalls = parseOllamaToolCalls(content);
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
