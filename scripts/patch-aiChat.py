#!/usr/bin/env python3
"""Patch aiChat.ts to add priorHistory, token usage, and context compression."""
import re

FILE = '/home/z/prismgit/src/lib/aiChat.ts'
content = open(FILE, 'r').read()

# 1. Replace the runWithTools function signature + body
old_sig = """export async function runWithTools(
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
    history.push(assistantMessage);"""

new_sig = """const COMPRESS_THRESHOLD = 20;
const COMPRESS_KEEP_RECENT = 6;

export async function runWithTools(
  userMessage: string,
  provider: LLMProvider,
  repoPath: string | undefined,
  options?: {
    onAssistantMessage?: (msg: ChatMessage) => void;
    onToolCall?: (name: string, args: Record<string, unknown>) => void;
    onToolResult?: (name: string, result: string) => void;
    maxIterations?: number;
    signal?: AbortSignal;
    /** Prior conversation history (without system prompt). When provided,
     *  the AI remembers what was said/done before in this chat session. */
    priorHistory?: ChatMessage[];
    /** Called after each LLM response with token usage stats. */
    onTokenUsage?: (usage: TokenUsage) => void;
  },
): Promise<{ finalMessage: string; history: ChatMessage[] }> {
  const systemPrompt = buildToolSystemPrompt(AI_TOOLS, repoPath);
  const priorMessages = options?.priorHistory ?? [];

  // ── Context compression ────────────────────────────────────────────
  // When history exceeds COMPRESS_THRESHOLD messages, compress old ones
  // into a text summary to keep the context window manageable.
  let compressedPrior: ChatMessage[];
  if (priorMessages.length > COMPRESS_THRESHOLD) {
    const toCompress = priorMessages.slice(0, priorMessages.length - COMPRESS_KEEP_RECENT);
    const toKeep = priorMessages.slice(-COMPRESS_KEEP_RECENT);
    const summaryLines: string[] = ['[Previous conversation summary — compressed to save context]:'];
    for (const m of toCompress) {
      if (m.role === 'system') continue;
      const firstLine = (m.content || '').split('\\n')[0].slice(0, 120);
      if (m.role === 'tool') {
        summaryLines.push(`  [tool:${m.toolName}] ${firstLine}`);
      } else if (m.role === 'assistant' && m.toolCalls?.length) {
        summaryLines.push(`  [assistant->tool:${m.toolCalls[0].name}] ${firstLine}`);
      } else {
        summaryLines.push(`  [${m.role}] ${firstLine}`);
      }
    }
    summaryLines.push(`(${toCompress.length} messages compressed — ${toKeep.length} recent kept)`);
    compressedPrior = [
      { role: 'system' as const, content: summaryLines.join('\\n') },
      ...toKeep,
    ];
  } else {
    compressedPrior = priorMessages.filter(m => m.role !== 'system');
  }

  const history: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...compressedPrior,
    { role: 'user', content: userMessage },
  ];
  const maxIterations = options?.maxIterations ?? 5;
  const signal = options?.signal;
  for (let i = 0; i < maxIterations; i++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    // Call the LLM with the current history.
    const { message: assistantMessage, usage } = await callLLMChatWithUsage(history, provider, signal);
    if (usage && options?.onTokenUsage) {
      options.onTokenUsage(usage);
    }
    options?.onAssistantMessage?.(assistantMessage);
    history.push(assistantMessage);"""

if old_sig in content:
    content = content.replace(old_sig, new_sig, 1)
    print("OK: replaced runWithTools signature + body start")
else:
    print("FAIL: old_sig not found")
    exit(1)

# 2. Add callLLMChatWithUsage function after callLLMChat
old_call = """export async function callLLMChat(
  messages: ChatMessage[],
  provider: LLMProvider,
  signal?: AbortSignal,
): Promise<ChatMessage> {"""

new_call = """export async function callLLMChat(
  messages: ChatMessage[],
  provider: LLMProvider,
  signal?: AbortSignal,
): Promise<ChatMessage> {
  const { message } = await callLLMChatWithUsage(messages, provider, signal);
  return message;
}

/**
 * Same as callLLMChat but also returns token usage stats from the LLM
 * response. Most OpenAI-compatible APIs include a `usage` object with
 * `prompt_tokens`, `completion_tokens`, `total_tokens`.
 */
export async function callLLMChatWithUsage(
  messages: ChatMessage[],
  provider: LLMProvider,
  signal?: AbortSignal,
): Promise<{ message: ChatMessage; usage?: TokenUsage }> {"""

if old_call in content:
    content = content.replace(old_call, new_call, 1)
    print("OK: added callLLMChatWithUsage")
else:
    print("FAIL: old_call not found")
    exit(1)

# 3. Add usage parsing in callOpenAIChat
old_parse = """  const data = JSON.parse(res.body);
  const msg = data.choices?.[0]?.message ?? {};
  const toolCalls: ToolCall[] | undefined = msg.tool_calls?.map"""

new_parse = """  const data = JSON.parse(res.body);
  const msg = data.choices?.[0]?.message ?? {};
  // Parse token usage from the response — most OpenAI-compatible APIs
  // (OpenAI, Groq, Cerebras, OpenRouter, Mistral, etc.) return this.
  const rawUsage = data.usage;
  const usage: TokenUsage | undefined = rawUsage ? {
    inputTokens: rawUsage.prompt_tokens ?? 0,
    outputTokens: rawUsage.completion_tokens ?? 0,
    totalTokens: rawUsage.total_tokens ?? 0,
    contextSize: rawUsage.prompt_tokens ?? 0,
  } : undefined;
  const toolCalls: ToolCall[] | undefined = msg.tool_calls?.map"""

if old_parse in content:
    content = content.replace(old_parse, new_parse, 1)
    print("OK: added usage parsing in callOpenAIChat")
else:
    print("FAIL: old_parse not found")
    exit(1)

# 4. Change the return at the end of callOpenAIChat to include usage
old_ret = """  return {
    role: 'assistant',
    content: msg.content ?? '',
    toolCalls,
  };
}

async function callAnthropicChat"""

new_ret = """  return {
    message: {
      role: 'assistant',
      content: msg.content ?? '',
      toolCalls,
    },
    usage,
  };
}

async function callAnthropicChat"""

if old_ret in content:
    content = content.replace(old_ret, new_ret, 1)
    print("OK: changed callOpenAIChat return to include usage")
else:
    print("FAIL: old_ret not found")
    exit(1)

# 5. Wrap callAnthropicChat and callOllamaChat returns to match the new interface
# Anthropic return
old_anth_ret = """  return {
    role: 'assistant',
    content: textParts,
    toolCalls: toolUses?.length ? toolUses : undefined,
  };
}

async function callOllamaChat"""

new_anth_ret = """  return {
    message: {
      role: 'assistant',
      content: textParts,
      toolCalls: toolUses?.length ? toolUses : undefined,
    },
    usage: undefined, // Anthropic returns usage in a different format
  };
}

async function callOllamaChat"""

if old_anth_ret in content:
    content = content.replace(old_anth_ret, new_anth_ret, 1)
    print("OK: changed callAnthropicChat return")
else:
    print("FAIL: old_anth_ret not found")
    exit(1)

# Ollama return
old_oll_ret = """  return {
    role: 'assistant',
    content: toolCalls?.length ? content.replace(/<tool>[\\s\\S]*?<\\/tool>/g, '').trim() : content,
    toolCalls,
  };
}"""

new_oll_ret = """  return {
    message: {
      role: 'assistant',
      content: toolCalls?.length ? content.replace(/<tool>[\\s\\S]*?<\\/tool>/g, '').trim() : content,
      toolCalls,
    },
    usage: undefined, // Ollama doesn't return usage stats in /api/chat
  };
}"""

if old_oll_ret in content:
    content = content.replace(old_oll_ret, new_oll_ret, 1)
    print("OK: changed callOllamaChat return")
else:
    print("FAIL: old_oll_ret not found")
    exit(1)

open(FILE, 'w').write(content)
print("Done — all patches applied successfully.")
