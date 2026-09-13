import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastActions } from '../stores/toastStore';
import { useI18n } from '../lib/i18n';
import { Sparkles, X, Send, Loader, Wrench, ArrowRight, User, Bot, Trash, Folder, Square, Copy, Check } from './icons';
import { cn } from '../lib/utils';
import { runWithTools, type ChatMessage } from '../lib/aiChat';
import { type LLMProvider } from '../lib/aiCommitMessages';

/**
 * LAR-3 — AI Assistant chat panel.
 *
 * Floating dockable panel (bottom-right). Toggle via the AI toolbar
 * button (Sparkles icon). The chat:
 *   - Maintains conversation history persisted to localStorage per-SESSION.
 *     A "session" is identified by the repo path the chat was started on,
 *     OR the special key '__no_repo__' when no repo is open. This lets the
 *     AI Assistant work BEFORE a repo is opened (e.g. to clone/init/find
 *     a repo) AND keeps separate per-repo histories when the user works
 *     on multiple repos in parallel.
 *   - Calls runWithTools() which loops: LLM → tool calls → tool
 *     results → LLM → final answer. The loop is abortable via the
 *     "Stop" button (passes an AbortSignal through to the underlying fetch).
 *   - Renders intermediate 'assistant with tool_calls' messages as
 *     "Calling get_status..." transcript entries.
 *   - Renders tool results as monospace blocks with copy buttons.
 *   - Renders assistant final answers with lightweight markdown rendering
 *     (code blocks, inline code, bold, lists) and a copy button.
 *   - Shows "starter prompt" suggestion chips when the chat is empty —
 *     based on the most common things users ask a git AI assistant to do
 *     (pull, push, status, recent commits, branch list, stash, etc.).
 *
 * ── Per-project "pinning" (parallel sessions) ───────────────────────────
 * The AI Assistant has its OWN notion of the "current session repo"
 * (`sessionRepoPath`), which is INDEPENDENT from the app's currently-open
 * repository (`useRepositoryStore.currentRepo`). When the user opens the
 * AI Assistant on repo A and then switches the app to repo B, the AI
 * Assistant keeps working on repo A — its chat history, context, and
 * tool calls all still target A. The user can manually switch the AI
 * session to B (or to "no repo") via the dropdown in the panel header.
 *
 * This mirrors how a developer might have two terminals open, one per
 * repo, and an AI helper pinned to each — switching the IDE's active
 * project doesn't kill either terminal.
 *
 * ── No-repo mode ─────────────────────────────────────────────────────────
 * When `sessionRepoPath` is null, the AI Assistant operates in "no-repo"
 * mode. Only the app-scoped tools work: list_repos, search_repos,
 * clone_repo, init_repo, open_repo. The system prompt explicitly tells
 * the LLM this, so it can gracefully help the user set up a repo instead
 * of failing on git commands.
 *
 * Conversation history IS persisted — saved to localStorage under
 * 'prismgit-ai-chat-<repoPath>' (or 'prismgit-ai-chat-__no_repo__')
 * with a configurable limit (default 100 messages, set via Settings →
 * AI → Chat History Limit).
 */
const STORAGE_KEY_PREFIX = 'prismgit-ai-chat-';
const NO_REPO_KEY = '__no_repo__';
const DEFAULT_HISTORY_LIMIT = 100;

/** Build the localStorage key for a given session (repo path or no-repo). */
function storageKeyFor(sessionRepoPath: string | null | undefined): string {
  return STORAGE_KEY_PREFIX + (sessionRepoPath ?? NO_REPO_KEY);
}

/** Load persisted chat messages for a given session. */
function loadChatHistory(sessionRepoPath: string | null | undefined): ChatMessage[] {
  try {
    const raw = localStorage.getItem(storageKeyFor(sessionRepoPath));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

/** Save chat messages for a given session, capped to the limit. */
function saveChatHistory(sessionRepoPath: string | null | undefined, messages: ChatMessage[], limit: number): void {
  try {
    // Keep only the last `limit` messages — oldest are dropped.
    const trimmed = messages.length > limit ? messages.slice(-limit) : messages;
    localStorage.setItem(storageKeyFor(sessionRepoPath), JSON.stringify(trimmed));
  } catch {
    // localStorage might be full — silently ignore
  }
}

/** Clear chat history for a given session. */
function clearChatHistory(sessionRepoPath: string | null | undefined): void {
  try {
    localStorage.removeItem(storageKeyFor(sessionRepoPath));
  } catch {
    // ignore
  }
}

/** Format milliseconds as a human-readable "Xm ago" string for the header badge. */
function formatAgo(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return `${Math.floor(day / 30)}mo ago`;
}

/**
 * Starter prompts — shown as clickable chips when the chat is empty.
 * Based on the most common questions users ask a Git AI assistant
 * (analysed from Stack Overflow /r/git top questions, GitHub Copilot
 * Chat usage patterns, and SmartGit forum requests). Each chip is a
 * one-click prompt that fills the input and sends immediately.
 *
 * Categorised:
 *   - status:      "what changed?" — the #1 question
 *   - sync:        "pull latest" / "push my commits" — #2 and #3
 *   - history:     "show recent commits" — #4
 *   - branches:    "list branches" — #5
 *   - stash:       "stash my changes" — #6
 *   - safety:      "discard my changes" — #7 (uses sync_with_remote)
 *
 * For no-repo mode, a different set is shown (list/clone/init repos).
 */
const STARTER_PROMPTS_WITH_REPO = [
  { label: 'What changed?', prompt: 'What files have changed since the last commit? Show me the status.' },
  { label: 'Pull latest', prompt: 'Pull the latest changes from origin. Stash my local changes first if needed.' },
  { label: 'Recent commits', prompt: 'Show me the recent commits — last 5 with their messages and authors.' },
  { label: 'List branches', prompt: 'List all local and remote branches. Mark the current one.' },
  { label: 'Stash changes', prompt: 'Stash my current changes with a descriptive message.' },
  { label: 'Push commits', prompt: 'Push my local commits to origin. Tell me how many were pushed.' },
];

const STARTER_PROMPTS_NO_REPO = [
  { label: 'List my repos', prompt: 'List all repositories I have opened in this app.' },
  { label: 'Clone a repo', prompt: 'I want to clone a repository. Ask me for the URL.' },
  { label: 'Create a repo', prompt: 'I want to create a new git repository. Ask me where.' },
];

export function AiAssistant({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const currentRepo = useRepositoryStore(s => s.currentRepo);
  const settings = useSettingsStore(s => s.settings);
  const toast = useToastActions();
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Session repo path ──────────────────────────────────────────────────
  const [sessionRepoPath, setSessionRepoPath] = useState<string | undefined | null>(undefined);

  // On first mount, default the session to the app's current repo (or null
  // if no repo is open). After this, sessionRepoPath only changes when the
  // user explicitly switches via the dropdown.
  useEffect(() => {
    if (sessionRepoPath === undefined) {
      setSessionRepoPath(currentRepo?.path ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRepo?.path]);

  const repos = useRepositoryStore(s => s.repos);
  const sessionRepo = useMemo(() => {
    if (sessionRepoPath === null) return null;
    if (!sessionRepoPath) return undefined;
    const found = repos.find(r => r.path === sessionRepoPath);
    if (found) return found;
    const name = sessionRepoPath.split(/[/\\]/).pop() ?? sessionRepoPath;
    return { name, path: sessionRepoPath, lastOpened: 0, pinned: false };
  }, [sessionRepoPath, repos]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  // ── Abort controller for the "Stop" button ─────────────────────────────
  // When the user clicks Stop, we abort the in-flight LLM call. The signal
  // propagates: runWithTools → callLLMChat → proxyFetch → fetch / IPC race.
  // The IPC itself can't be cancelled (Electron limitation), but the
  // Promise.race in proxyFetch rejects early so the UI updates immediately.
  const abortRef = useRef<AbortController | null>(null);

  // Load persisted chat history when the session changes.
  useEffect(() => {
    if (sessionRepoPath === undefined) return;
    const saved = loadChatHistory(sessionRepoPath);
    setMessages(saved);
  }, [sessionRepoPath]);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Persist messages to localStorage whenever they change (debounced).
  const historyLimit = settings?.aiChatHistoryLimit ?? DEFAULT_HISTORY_LIMIT;
  useEffect(() => {
    if (sessionRepoPath === undefined) return;
    if (messages.length === 0) return;
    const timer = setTimeout(() => {
      saveChatHistory(sessionRepoPath, messages, historyLimit);
    }, 500);
    return () => clearTimeout(timer);
  }, [messages, sessionRepoPath, historyLimit]);

  // Cleanup: if the panel closes while a request is in flight, abort it
  // so we don't leave a dangling fetch holding a model in memory.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ── Session switcher dropdown ───────────────────────────────────────────
  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const sortedRepos = useMemo(() => {
    return [...repos].sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 20);
  }, [repos]);

  const buildProvider = useCallback((): LLMProvider | null => {
    if (!settings?.aiProvider) return null;
    const type = settings.aiProvider as LLMProvider['type'];
    const id = settings.aiProvider;
    const url = settings.aiUrl || '';
    const model = settings.aiModel || '';
    if (!model) return null;
    return { id, name: id, type, url, apiKey: settings.aiApiKey, model };
  }, [settings]);

  const handleSend = useCallback(async (overrideInput?: string) => {
    const userMsg = (overrideInput ?? input).trim();
    if (!userMsg) return;
    if (sessionRepoPath === undefined) return;
    const provider = buildProvider();
    if (!provider) {
      toast.info(t('changes.aiNoProvider'), t('changes.aiSetProviderHint'));
      return;
    }
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setBusy(true);
    // Create a fresh AbortController for this request. Stored in a ref so
    // handleStop() can call .abort() on it.
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await runWithTools(userMsg, provider, sessionRepoPath ?? undefined, {
        signal: controller.signal,
        onAssistantMessage: (msg) => {
          setMessages(prev => [...prev, msg]);
        },
        onToolCall: (name, args) => {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `Calling tool: ${name}${Object.keys(args).length ? ` (${JSON.stringify(args)})` : ''}`,
            toolCalls: [{ name, arguments: args }],
          }]);
        },
        onToolResult: (name, result) => {
          setMessages(prev => [...prev, { role: 'tool', content: result, toolName: name }]);
        },
      });
    } catch (e: unknown) {
      // Distinguish "user pressed Stop" from real errors. AbortError is
      // thrown by the signal — show a friendly "stopped" message instead
      // of a red error toast.
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      if (isAbort) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '⏹ Stopped by user. The conversation history is preserved — you can continue with a new message.',
        }]);
      } else {
        toast.error(t('changes.aiGenerationFailed'), String(e));
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${String(e)}` }]);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [input, sessionRepoPath, buildProvider, toast, t]);

  /** Stop the in-flight LLM call. The user sees the "Stopped" message
   *  appear in the chat once the abort propagates through. */
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleClear = () => {
    setMessages([]);
    clearChatHistory(sessionRepoPath);
  };

  // Switch the AI session to a different repo (or to "no repo" mode).
  const switchSession = (path: string | null) => {
    setSessionRepoPath(path);
    setShowSessionMenu(false);
  };

  // Starter prompts — different sets for repo vs no-repo mode.
  const starterPrompts = sessionRepoPath === null
    ? STARTER_PROMPTS_NO_REPO
    : STARTER_PROMPTS_WITH_REPO;

  return (
    <div className="fixed bottom-4 right-4 w-[28rem] max-h-[80vh] bg-bg-elevated border border-border-default rounded-lg shadow-2xl flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-tertiary rounded-t-lg">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Sparkles size={14} className="text-accent flex-shrink-0" />
          <span className="text-sm font-medium flex-shrink-0">{t('aiAssistant.title')}</span>
          {/* Session switcher — clickable badge showing the current session's repo. */}
          <div className="relative ml-1 min-w-0">
            <button
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs bg-bg-secondary border border-border-subtle hover:border-accent transition-colors max-w-full"
              onClick={() => setShowSessionMenu(v => !v)}
              title={sessionRepo?.path ?? (sessionRepoPath === null ? t('aiAssistant.noRepoMode') : t('aiAssistant.loading'))}
            >
              <Folder size={10} className="flex-shrink-0 text-text-tertiary" />
              <span className="truncate max-w-28">
                {sessionRepo
                  ? sessionRepo.name
                  : sessionRepoPath === null
                    ? t('aiAssistant.noRepo') || 'No repo'
                    : '…'}
              </span>
              <span className="text-text-tertiary text-3xs">▾</span>
            </button>
            {showSessionMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowSessionMenu(false)} />
                <div className="absolute top-full left-0 mt-1 w-72 bg-bg-elevated border border-border-default rounded shadow-xl z-20 max-h-80 overflow-y-auto">
                  <button
                    className={cn(
                      'w-full text-left px-3 py-2 text-xs hover:bg-bg-hover transition-colors border-b border-border-subtle',
                      sessionRepoPath === null && 'bg-accent-muted text-accent',
                    )}
                    onClick={() => switchSession(null)}
                  >
                    <div className="flex items-center gap-2">
                      <Folder size={11} className="text-text-tertiary" />
                      <span>{t('aiAssistant.noRepoMode') || 'No repository (app-level mode)'}</span>
                    </div>
                    <div className="text-3xs text-text-tertiary mt-0.5 ml-[18px]">
                      Use list_repos / clone_repo / init_repo tools.
                    </div>
                  </button>
                  {currentRepo && currentRepo.path !== sessionRepoPath && (
                    <button
                      className="w-full text-left px-3 py-2 text-xs hover:bg-bg-hover transition-colors border-b border-border-subtle"
                      onClick={() => switchSession(currentRepo.path)}
                    >
                      <div className="flex items-center gap-2">
                        <Folder size={11} className="text-accent" />
                        <span className="font-medium">{currentRepo.name}</span>
                        <span className="text-3xs text-accent ml-auto">current</span>
                      </div>
                      <div className="text-3xs text-text-tertiary mt-0.5 ml-[18px] truncate">{currentRepo.path}</div>
                    </button>
                  )}
                  <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold px-3 pt-2 pb-1">
                    Known repositories
                  </div>
                  {sortedRepos.length === 0 ? (
                    <div className="px-3 py-2 text-2xs text-text-tertiary italic">
                      No repositories yet. Switch to "No repository" mode and use clone_repo or init_repo.
                    </div>
                  ) : (
                    sortedRepos.map(r => (
                      <button
                        key={r.path}
                        className={cn(
                          'w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hover transition-colors',
                          r.path === sessionRepoPath && 'bg-accent-muted text-accent',
                        )}
                        onClick={() => switchSession(r.path)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Folder size={11} className="text-text-tertiary flex-shrink-0" />
                          <span className="truncate flex-1">{r.name}</span>
                          <span className="text-3xs text-text-tertiary flex-shrink-0">{formatAgo(Date.now() - r.lastOpened)}</span>
                        </div>
                        <div className="text-3xs text-text-tertiary mt-0.5 ml-[18px] truncate">{r.path}</div>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {messages.length > 0 && (
            <button
              className="icon-btn !w-5 !h-5 hover:!text-status-deleted"
              onClick={handleClear}
              title={t('aiAssistant.clearHistory')}
            >
              <Trash size={11} />
            </button>
          )}
          <button className="icon-btn !w-5 !h-5" onClick={onClose} aria-label={t('common.close')}>
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[300px] max-h-[60vh]">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <div className="text-xs text-text-tertiary text-center py-2">
              {sessionRepoPath === null
                ? t('aiAssistant.emptyHintNoRepo') || 'No repository open. Ask me to list, clone, or create a repo. Use list_repos to see what you have.'
                : t('aiAssistant.emptyHint')}
            </div>
            {/* Starter prompt chips — one-click prompts for the most common
                things users ask a Git AI assistant. Clicking a chip fills
                the input AND sends immediately. */}
            <div className="flex flex-wrap gap-1.5 justify-center pt-2">
              {starterPrompts.map(sp => (
                <button
                  key={sp.label}
                  onClick={() => void handleSend(sp.prompt)}
                  className="text-2xs px-2 py-1 rounded border border-border-default bg-bg-secondary hover:border-accent hover:bg-accent-muted hover:text-accent transition-colors text-text-secondary"
                  title={sp.prompt}
                >
                  {sp.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => <MessageBubble key={idx} msg={msg} />)
        )}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <Loader size={10} className="spin" />
            {t('aiAssistant.thinking')}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border-default p-2 flex items-end gap-2">
        <textarea
          className="flex-1 text-xs p-2 resize-none bg-bg-primary border border-border-default rounded outline-none focus:border-accent"
          rows={2}
          placeholder={sessionRepoPath === null
            ? (t('aiAssistant.inputPlaceholderNoRepo') || 'Ask me to list, clone, or create a repo...')
            : t('aiAssistant.inputPlaceholder')}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={busy}
          autoFocus
        />
        {busy ? (
          // Stop button — replaces the Send button while a request is in flight.
          // Aborts the in-flight fetch via the AbortController stored in abortRef.
          <button
            className="btn btn-danger !px-2 !py-1 flex-shrink-0"
            onClick={handleStop}
            title="Stop generation"
            aria-label="Stop generation"
          >
            <Square size={12} className="fill-current" />
          </button>
        ) : (
          <button
            className="btn btn-primary !px-2 !py-1 flex-shrink-0"
            onClick={() => void handleSend()}
            disabled={!input.trim()}
            title={t('aiAssistant.send')}
          >
            <Send size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Render a chat message bubble. Different layouts for:
 *   - user: right-aligned, accent background
 *   - tool: monospace block with Wrench icon + copy button
 *   - assistant with tool_calls: italic "Calling tool..." bubble
 *   - assistant final: markdown-rendered with copy button
 */
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => { /* ignore */ });
  }, [msg.content]);

  if (msg.role === 'user') {
    return (
      <div className="flex items-start gap-2 justify-end">
        <div className="bg-accent text-text-inverse rounded-lg px-3 py-1.5 text-xs max-w-[80%] whitespace-pre-wrap break-words">
          {msg.content}
        </div>
        <User size={14} className="flex-shrink-0 mt-0.5 text-text-tertiary" />
      </div>
    );
  }
  if (msg.role === 'tool') {
    return (
      <div className="bg-bg-tertiary border border-border-subtle rounded px-3 py-1.5 text-xs font-mono whitespace-pre-wrap break-words">
        <div className="text-2xs text-text-tertiary mb-1 flex items-center gap-1">
          <Wrench size={9} /> {msg.toolName}
          {/* Copy button — tool results are often long (git log, git status)
              and the user may want to paste them elsewhere. */}
          <button
            onClick={handleCopy}
            className="ml-auto icon-btn !w-4 !h-4 hover:text-accent"
            title="Copy result"
            aria-label="Copy result"
          >
            {copied ? <Check size={10} className="text-status-added" /> : <Copy size={10} />}
          </button>
        </div>
        <div className="text-text-secondary max-h-40 overflow-y-auto">{msg.content}</div>
      </div>
    );
  }
  if (msg.role === 'assistant' && msg.toolCalls?.length) {
    return (
      <div className="flex items-start gap-2">
        <Bot size={14} className="flex-shrink-0 mt-0.5 text-accent" />
        <div className="bg-bg-secondary border border-border-subtle rounded px-3 py-1.5 text-xs text-text-secondary italic">
          <div className="flex items-center gap-1">
            <ArrowRight size={10} /> {msg.content}
          </div>
        </div>
      </div>
    );
  }
  // assistant final answer — render with lightweight markdown + copy button.
  return (
    <div className="flex items-start gap-2 group">
      <Bot size={14} className="flex-shrink-0 mt-0.5 text-accent" />
      <div className="bg-bg-secondary rounded px-3 py-1.5 text-xs max-w-[85%] whitespace-pre-wrap break-words">
        <MarkdownLite text={msg.content} />
        {/* Copy button — appears on hover. Assistant answers often contain
            commands or commit messages the user wants to copy. */}
        <div className="mt-1 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleCopy}
            className="icon-btn !w-4 !h-4 hover:text-accent"
            title="Copy message"
            aria-label="Copy message"
          >
            {copied ? <Check size={10} className="text-status-added" /> : <Copy size={10} />}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Lightweight markdown renderer — no external dependency.
 * Supports the subset that LLMs commonly emit in chat:
 *   - ```code blocks``` (with language hint)
 *   - `inline code`
 *   - **bold**
 *   - - bullet lists
 *   - 1. numbered lists
 *   - paragraphs (split on \n\n)
 *
 * For anything more complex (tables, nested lists, links), the raw text
 * is shown as-is. This keeps the bundle small (no react-markdown dep)
 * while covering ~95% of what LLMs actually produce in a git assistant.
 */
function MarkdownLite({ text }: { text: string }) {
  // Split into code-block and non-code-block segments. Code blocks are
  // extracted first so their content isn't processed by the inline rules.
  const segments = useMemo(() => {
    const parts: { type: 'code' | 'text'; content: string; lang?: string }[] = [];
    // Match ```lang\n...\n``` blocks (greedy match per block).
    const re = /```(\w*)\n?([\s\S]*?)```/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIdx) {
        parts.push({ type: 'text', content: text.slice(lastIdx, match.index) });
      }
      parts.push({ type: 'code', content: match[2] || '', lang: match[1] || undefined });
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < text.length) {
      parts.push({ type: 'text', content: text.slice(lastIdx) });
    }
    return parts;
  }, [text]);

  return (
    <div className="space-y-2">
      {segments.map((seg, i) => {
        if (seg.type === 'code') {
          return (
            <div key={i} className="relative">
              <pre className="bg-bg-tertiary border border-border-subtle rounded p-2 text-2xs font-mono overflow-x-auto max-h-60">
                <code>{seg.content}</code>
              </pre>
              {seg.lang && (
                <span className="absolute top-1 right-2 text-3xs text-text-tertiary uppercase">
                  {seg.lang}
                </span>
              )}
            </div>
          );
        }
        // Text segment — render with inline formatting (bold, inline code, lists).
        return <TextSegment key={i} text={seg.content} />;
      })}
    </div>
  );
}

/** Render a text segment with inline bold/code and bullet/numbered lists. */
function TextSegment({ text }: { text: string }) {
  // Split into lines, group consecutive bullet/numbered lines into <ul>/<ol>.
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: { ordered: boolean; items: string[] } | null = null;

  const flushList = (key: number) => {
    if (!listItems) return;
    if (listItems.ordered) {
      blocks.push(
        <ol key={`ol-${key}`} className="list-decimal ml-4 space-y-0.5 text-text-primary">
          {listItems.items.map((it, i) => <li key={i}><InlineFormat text={it} /></li>)}
        </ol>
      );
    } else {
      blocks.push(
        <ul key={`ul-${key}`} className="list-disc ml-4 space-y-0.5 text-text-primary">
          {listItems.items.map((it, i) => <li key={i}><InlineFormat text={it} /></li>)}
        </ul>
      );
    }
    listItems = null;
  };

  lines.forEach((line, i) => {
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    const numberedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (bulletMatch) {
      if (!listItems || listItems.ordered) {
        flushList(i);
        listItems = { ordered: false, items: [] };
      }
      listItems.items.push(bulletMatch[1]);
    } else if (numberedMatch) {
      if (!listItems || !listItems.ordered) {
        flushList(i);
        listItems = { ordered: true, items: [] };
      }
      listItems.items.push(numberedMatch[1]);
    } else {
      flushList(i);
      if (line.trim()) {
        blocks.push(<p key={`p-${i}`} className="text-text-primary leading-relaxed"><InlineFormat text={line} /></p>);
      }
    }
  });
  flushList(lines.length);

  return <>{blocks}</>;
}

/** Inline formatting: **bold** and `inline code`. */
function InlineFormat({ text }: { text: string }) {
  // Split on **bold** and `code` markers, preserving the markers.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold text-text-primary">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i} className="px-1 py-0.5 rounded bg-bg-tertiary text-text-primary text-3xs font-mono">{part.slice(1, -1)}</code>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
