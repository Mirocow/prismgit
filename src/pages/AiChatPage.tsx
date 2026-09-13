import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastActions } from '../stores/toastStore';
import { useI18n } from '../lib/i18n';
import {
  Sparkles, Send, Loader, Wrench, ArrowRight, User, Bot, Trash, Folder,
  Square, Copy, Check, ChevronRight, ChevronDown, Search, X,
} from '../components/icons';
import { cn } from '../lib/utils';
import { runWithTools, type ChatMessage, type TokenUsage } from '../lib/aiChat';
import { type LLMProvider } from '../lib/aiCommitMessages';

/**
 * Full-page version of the AI Assistant chat.
 *
 * The floating AiAssistant.tsx panel is great for quick one-shot questions,
 * but for longer conversations the user wants a full page with more room —
 * that's what this page provides. It reuses the same runWithTools agentic
 * loop and the same per-project localStorage history key scheme, so a
 * conversation started in the floating panel can be continued here (and
 * vice-versa).
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  Header: AI Chat • <repo name>           [Clear] [Stop/Send]  │
 *   ├────────────────────────────────┬─────────────────────────────┤
 *   │  Messages (70%)                │  Chat Search (30%)           │
 *   │  - user / assistant / tool     │  Filter messages by text    │
 *   │  - markdown rendering         │  (case-insensitive,          │
 *   │  - tool-call transcript        │   highlights matches)       │
 *   │  - starter prompts (when empty)│                             │
 *   │                                │                             │
 *   ├────────────────────────────────┤  Match list (filtered)       │
 *   │  Token usage bar               │                             │
 *   ├────────────────────────────────┴─────────────────────────────┤
 *   │  Input: textarea + Send/Stop                                  │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * IMPORTANT: This page does NOT replace the floating AiAssistant panel —
 * both coexist. The panel is for quick access; this page is for longer
 * conversations. They share localStorage history so the user can switch
 * between them mid-conversation.
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

/**
 * Starter prompts — shown as clickable chips when the chat is empty.
 * Same set as the floating AiAssistant panel for consistency.
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

export default function AiChatPage() {
  const { t } = useI18n();
  const currentRepo = useRepositoryStore(s => s.currentRepo);
  const settings = useSettingsStore(s => s.settings);
  const toast = useToastActions();
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Session repo path ──────────────────────────────────────────────────
  // Default to the app's current repo (or null if no repo is open).
  const [sessionRepoPath, setSessionRepoPath] = useState<string | null>(
    currentRepo?.path ?? null,
  );

  // When the user opens a different repo in the app, follow along —
  // UNLESS they've manually switched the session via the dropdown. For
  // simplicity in the full-page version, we always follow the app's
  // current repo. If the user wants to keep a session pinned to a
  // different repo, they can use the floating panel.
  useEffect(() => {
    setSessionRepoPath(currentRepo?.path ?? null);
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
  // ── Token usage tracking — same as the floating panel.
  const [tokenUsage, setTokenUsage] = useState<{ input: number; output: number; contextSize: number }>({ input: 0, output: 0, contextSize: 0 });

  // ── Abort controller for the "Stop" button.
  const abortRef = useRef<AbortController | null>(null);

  // ── Chat search state — filters messages by text, highlights matches.
  const [searchQuery, setSearchQuery] = useState('');

  // Load persisted chat history when the session changes.
  useEffect(() => {
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
    if (messages.length === 0) return;
    const timer = setTimeout(() => {
      saveChatHistory(sessionRepoPath, messages, historyLimit);
    }, 500);
    return () => clearTimeout(timer);
  }, [messages, sessionRepoPath, historyLimit]);

  // Cleanup: if the page unmounts while a request is in flight, abort it.
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
    const provider = buildProvider();
    if (!provider) {
      toast.info(t('changes.aiNoProvider'), t('changes.aiSetProviderHint'));
      return;
    }
    setInput('');
    // Capture the current message list BEFORE appending the new user
    // message — this is what we pass as priorHistory to runWithTools.
    // (Using the functional update form would give us the new array, not
    // the pre-send history we want.)
    const priorHistory = messages;
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await runWithTools(userMsg, provider, sessionRepoPath ?? undefined, {
        signal: controller.signal,
        priorHistory,
        contextMaxChars: settings?.aiContextMaxChars ?? 20_000,
        onTokenUsage: (usage: TokenUsage) => {
          setTokenUsage({
            input: usage.inputTokens,
            output: usage.outputTokens,
            contextSize: usage.contextSize,
          });
        },
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
  }, [input, messages, sessionRepoPath, buildProvider, toast, t, settings]);

  /** Stop the in-flight LLM call. */
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

  // ── Search filtering ────────────────────────────────────────────────────
  // Filter which messages are shown based on the search query. Case-
  // insensitive. When the search is empty, all messages are shown.
  const searchLower = searchQuery.trim().toLowerCase();
  const filteredMessages = useMemo(() => {
    if (!searchLower) return messages;
    return messages.filter(m => m.content?.toLowerCase().includes(searchLower));
  }, [messages, searchLower]);

  const matchCount = searchLower ? filteredMessages.length : 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-default bg-bg-elevated flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Sparkles size={16} className="text-accent flex-shrink-0" />
          <span className="text-sm font-medium flex-shrink-0">{t('aiAssistant.title')}</span>
          {/* Session switcher — clickable badge showing the current session's repo. */}
          <div className="relative ml-2 min-w-0">
            <button
              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-bg-secondary border border-border-subtle hover:border-accent transition-colors max-w-full"
              onClick={() => setShowSessionMenu(v => !v)}
              title={sessionRepo?.path ?? (sessionRepoPath === null ? t('aiAssistant.noRepoMode') : t('aiAssistant.loading'))}
            >
              <Folder size={12} className="flex-shrink-0 text-text-tertiary" />
              <span className="truncate max-w-40">
                {sessionRepo
                  ? sessionRepo.name
                  : sessionRepoPath === null
                    ? (t('aiAssistant.noRepo') || 'No repo')
                    : '…'}
              </span>
              <span className="text-text-tertiary text-3xs">▾</span>
            </button>
            {showSessionMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowSessionMenu(false)} />
                <div className="absolute top-full left-0 mt-1 w-80 bg-bg-elevated border border-border-default rounded shadow-xl z-20 max-h-96 overflow-y-auto">
                  <button
                    className={cn(
                      'w-full text-left px-3 py-2 text-xs hover:bg-bg-hover transition-colors border-b border-border-subtle',
                      sessionRepoPath === null && 'bg-accent-muted text-accent',
                    )}
                    onClick={() => switchSession(null)}
                  >
                    <div className="flex items-center gap-2">
                      <Folder size={12} className="text-text-tertiary" />
                      <span>{t('aiAssistant.noRepoMode') || 'No repository (app-level mode)'}</span>
                    </div>
                    <div className="text-3xs text-text-tertiary mt-0.5 ml-[20px]">
                      Use list_repos / clone_repo / init_repo tools.
                    </div>
                  </button>
                  {currentRepo && currentRepo.path !== sessionRepoPath && (
                    <button
                      className="w-full text-left px-3 py-2 text-xs hover:bg-bg-hover transition-colors border-b border-border-subtle"
                      onClick={() => switchSession(currentRepo.path)}
                    >
                      <div className="flex items-center gap-2">
                        <Folder size={12} className="text-accent" />
                        <span className="font-medium">{currentRepo.name}</span>
                        <span className="text-3xs text-accent ml-auto">current</span>
                      </div>
                      <div className="text-3xs text-text-tertiary mt-0.5 ml-[20px] truncate">{currentRepo.path}</div>
                    </button>
                  )}
                  <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold px-3 pt-2 pb-1">
                    Known repositories
                  </div>
                  {sortedRepos.length === 0 ? (
                    <div className="px-3 py-2 text-2xs text-text-tertiary italic">
                      No repositories yet. Switch to “No repository” mode and use clone_repo or init_repo.
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
                          <Folder size={12} className="text-text-tertiary flex-shrink-0" />
                          <span className="truncate flex-1">{r.name}</span>
                        </div>
                        <div className="text-3xs text-text-tertiary mt-0.5 ml-[20px] truncate">{r.path}</div>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
          {/* Message count badge */}
          {messages.length > 0 && (
            <span className="text-3xs text-text-tertiary px-1.5 py-0.5 rounded bg-bg-secondary border border-border-subtle flex-shrink-0">
              {messages.length} {messages.length === 1 ? 'message' : 'messages'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {messages.length > 0 && (
            <button
              className="btn btn-ghost !px-2 !py-1 text-xs flex items-center gap-1"
              onClick={handleClear}
              title={t('aiAssistant.clearHistory')}
            >
              <Trash size={11} />
              <span className="hidden sm:inline">Clear chat</span>
            </button>
          )}
        </div>
      </div>

      {/* Body: chat (70%) + search sidebar (30%) */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Chat panel — 70% width */}
        <div className="flex flex-col flex-[7] min-w-0 border-r border-border-default">
          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            {messages.length === 0 ? (
              <div className="space-y-4 h-full flex flex-col justify-center max-w-2xl mx-auto">
                <div className="text-sm text-text-tertiary text-center py-4">
                  {sessionRepoPath === null
                    ? (t('aiAssistant.emptyHintNoRepo') || 'No repository open. Ask me to list, clone, or create a repo. Use list_repos to see what you have.')
                    : t('aiAssistant.emptyHint')}
                </div>
                {/* Starter prompt chips */}
                <div className="flex flex-wrap gap-2 justify-center">
                  {starterPrompts.map(sp => (
                    <button
                      key={sp.label}
                      onClick={() => void handleSend(sp.prompt)}
                      className="text-xs px-3 py-1.5 rounded border border-border-default bg-bg-secondary hover:border-accent hover:bg-accent-muted hover:text-accent transition-colors text-text-secondary"
                      title={sp.prompt}
                    >
                      {sp.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : filteredMessages.length === 0 && searchLower ? (
              <div className="text-sm text-text-tertiary text-center py-8">
                No messages match “{searchQuery}”.
              </div>
            ) : (
              <>
                {filteredMessages.map((msg, idx) => (
                  <MessageBubble key={idx} msg={msg} highlight={searchLower || undefined} />
                ))}
                {busy && (
                  <div className="flex items-center gap-2 text-xs text-text-tertiary pl-2">
                    <Loader size={12} className="spin" />
                    {t('aiAssistant.thinking')}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Token usage bar */}
          {(tokenUsage.input > 0 || tokenUsage.output > 0) && (
            <div className="flex items-center gap-4 px-4 py-1 border-t border-border-subtle bg-bg-tertiary text-3xs text-text-tertiary flex-shrink-0">
              <span title="Input tokens (sent to the model)">
                <span className="text-text-secondary font-medium">↓ {tokenUsage.input.toLocaleString()}</span> in
              </span>
              <span title="Output tokens (generated by the model)">
                <span className="text-text-secondary font-medium">↑ {tokenUsage.output.toLocaleString()}</span> out
              </span>
              <span title="Total context size (all messages + tools sent to the model)">
                <span className="text-text-secondary font-medium">∑ {tokenUsage.contextSize.toLocaleString()}</span> ctx
              </span>
              {tokenUsage.contextSize > 50000 && (
                <span className="text-status-warning" title="Context is getting large — consider starting a new conversation">
                  ⚠ large context
                </span>
              )}
            </div>
          )}

          {/* Input */}
          <div className="border-t border-border-default p-3 flex items-end gap-2 flex-shrink-0 bg-bg-elevated">
            <textarea
              className="flex-1 text-sm p-2.5 resize-none bg-bg-primary border border-border-default rounded outline-none focus:border-accent min-h-[44px] max-h-40"
              rows={2}
              placeholder={sessionRepoPath === null
                ? (t('aiAssistant.inputPlaceholderNoRepo') || 'Ask me to list, clone, or create a repo...')
                : t('aiAssistant.inputPlaceholder')}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={busy}
            />
            {busy ? (
              <button
                className="btn btn-danger !px-3 !py-2 flex-shrink-0"
                onClick={handleStop}
                title="Stop generation"
                aria-label="Stop generation"
              >
                <Square size={14} className="fill-current" />
              </button>
            ) : (
              <button
                className="btn btn-primary !px-3 !py-2 flex-shrink-0"
                onClick={() => void handleSend()}
                disabled={!input.trim()}
                title={t('aiAssistant.send')}
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Search panel — 30% width */}
        <div className="flex flex-col flex-[3] min-w-0 bg-bg-secondary">
          <div className="px-3 py-2 border-b border-border-default flex items-center gap-2 bg-bg-elevated">
            <Search size={12} className="text-text-tertiary flex-shrink-0" />
            <span className="text-xs font-medium text-text-secondary">Chat Search</span>
            <span className="text-3xs text-text-tertiary ml-auto">
              {searchLower ? `${matchCount} ${matchCount === 1 ? 'match' : 'matches'}` : `${messages.length} total`}
            </span>
          </div>
          <div className="p-2 border-b border-border-subtle">
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search messages…"
                className="w-full text-xs pl-7 pr-7 py-1.5 bg-bg-primary border border-border-default rounded outline-none focus:border-accent"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 icon-btn !w-4 !h-4 text-text-tertiary hover:text-text-primary"
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          </div>

          {/* Search results list — quick previews of matching messages */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
            {!searchLower ? (
              <div className="text-2xs text-text-tertiary text-center py-6 px-3 leading-relaxed">
                Type to search through the chat history. Matching messages are filtered in the chat
                panel on the left, and listed here as quick previews.
              </div>
            ) : filteredMessages.length === 0 ? (
              <div className="text-2xs text-text-tertiary text-center py-6">
                No matches found.
              </div>
            ) : (
              filteredMessages.map((msg, idx) => {
                const role = msg.role;
                const preview = msg.content.split('\n')[0].slice(0, 100);
                return (
                  <div
                    key={idx}
                    className={cn(
                      'p-2 rounded border text-2xs cursor-default transition-colors',
                      role === 'user' && 'bg-accent-muted border-accent/30',
                      role === 'assistant' && 'bg-bg-tertiary border-border-subtle',
                      role === 'tool' && 'bg-bg-tertiary border-border-subtle font-mono',
                    )}
                    title={msg.content}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      {role === 'user' && <User size={9} className="text-accent flex-shrink-0" />}
                      {role === 'assistant' && <Bot size={9} className="text-accent flex-shrink-0" />}
                      {role === 'tool' && <Wrench size={9} className="text-text-tertiary flex-shrink-0" />}
                      <span className="text-3xs uppercase tracking-wide text-text-tertiary font-medium">
                        {role === 'tool' ? (msg.toolName ?? 'tool') : role}
                      </span>
                    </div>
                    <div className="text-text-secondary line-clamp-3 break-words">
                      {highlightMatch(preview, searchLower)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Render a chat message bubble. Different layouts for:
 *   - user: right-aligned, accent background
 *   - tool: monospace block with Wrench icon + copy button (collapsible)
 *   - assistant with tool_calls: italic "Calling tool..." bubble
 *   - assistant final: markdown-rendered with copy button
 *
 * When `highlight` is set (a lowercase search query), matching substrings
 * are wrapped in <mark> elements.
 */
function MessageBubble({ msg, highlight }: { msg: ChatMessage; highlight?: string }) {
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
        <div className="bg-accent text-text-inverse rounded-lg px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap break-words">
          {highlight ? highlightMatch(msg.content, highlight) : msg.content}
        </div>
        <User size={16} className="flex-shrink-0 mt-0.5 text-text-tertiary" />
      </div>
    );
  }
  if (msg.role === 'tool') {
    return <ToolResultBubble msg={msg} highlight={highlight} />;
  }
  if (msg.role === 'assistant' && msg.toolCalls?.length) {
    const content = msg.content?.trim();
    if (!content) return null;
    return (
      <div className="flex items-center gap-1.5 pl-1 text-2xs text-text-tertiary italic opacity-70">
        <ArrowRight size={10} />
        <span>{highlight ? highlightMatch(content, highlight) : content}</span>
      </div>
    );
  }
  // assistant final answer
  return (
    <div className="flex items-start gap-2 group">
      <Bot size={16} className="flex-shrink-0 mt-0.5 text-accent" />
      <div className="bg-bg-secondary rounded-lg px-3 py-2 text-sm max-w-[85%] min-w-0 break-words">
        {highlight
          ? <MarkdownLiteWithHighlight text={msg.content} highlight={highlight} />
          : <MarkdownLite text={msg.content} />}
        <div className="mt-1.5 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleCopy}
            className="icon-btn !w-5 !h-5 hover:text-accent"
            title="Copy message"
            aria-label="Copy message"
          >
            {copied ? <Check size={12} className="text-status-added" /> : <Copy size={12} />}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Tool result bubble — ALWAYS COLLAPSED by default (same as the floating
 * panel). Clicking the header toggles expand/collapse.
 */
function ToolResultBubble({ msg, highlight }: { msg: ChatMessage; highlight?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => { /* ignore */ });
  }, [msg.content]);

  const firstLine = useMemo(() => {
    const line = msg.content.split('\n').find(l => l.trim());
    if (!line) return '(empty result)';
    return line.length > 80 ? line.slice(0, 80) + '…' : line;
  }, [msg.content]);

  const lineCount = useMemo(() => msg.content.split('\n').length, [msg.content]);

  return (
    <div className="bg-bg-tertiary border border-border-subtle rounded text-xs font-mono">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-2xs text-text-tertiary hover:bg-bg-hover transition-colors rounded-t"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <Wrench size={10} />
        <span className="font-medium text-text-secondary">{msg.toolName}</span>
        {!expanded && (
          <span className="text-text-tertiary truncate flex-1 ml-1 opacity-70">
            {highlight ? highlightMatch(firstLine, highlight) : firstLine}
          </span>
        )}
        <span className="text-3xs text-text-tertiary flex-shrink-0 ml-auto px-1 rounded bg-bg-secondary">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        </span>
        <span
          onClick={handleCopy}
          className="icon-btn !w-4 !h-4 hover:text-accent flex-shrink-0 cursor-pointer"
          title="Copy result"
        >
          {copied ? <Check size={10} className="text-status-added" /> : <Copy size={10} />}
        </span>
      </button>
      {expanded && (
        <div className="px-2.5 pb-2 text-text-secondary max-h-72 overflow-y-auto whitespace-pre-wrap break-words border-t border-border-subtle">
          {highlight ? highlightMatch(msg.content, highlight) : msg.content}
        </div>
      )}
    </div>
  );
}

/**
 * Highlight all case-insensitive occurrences of `query` in `text` by
 * wrapping them in <mark> elements. Returns a React fragment.
 */
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  // Escape regex special characters in the query.
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(re);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return (
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-700 text-text-primary rounded px-0.5">
          {part}
        </mark>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/**
 * Markdown renderer that highlights matches inside text segments (not
 * inside code blocks — preserves their formatting as-is).
 */
function MarkdownLiteWithHighlight({ text, highlight }: { text: string; highlight: string }) {
  const segments = useMemo(() => {
    const parts: { type: 'code' | 'text'; content: string; lang?: string }[] = [];
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
              <pre className="bg-bg-tertiary border border-border-subtle rounded p-2 text-2xs font-mono overflow-x-auto max-h-72">
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
        return <TextSegmentWithHighlight key={i} text={seg.content} highlight={highlight} />;
      })}
    </div>
  );
}

/** Render a text segment with inline formatting AND match highlighting. */
function TextSegmentWithHighlight({ text, highlight }: { text: string; highlight: string }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: { ordered: boolean; items: string[] } | null = null;

  const flushList = (key: number) => {
    if (!listItems) return;
    if (listItems.ordered) {
      blocks.push(
        <ol key={`ol-${key}`} className="list-decimal ml-4 space-y-0.5 text-text-primary">
          {listItems.items.map((it, i) => <li key={i}><InlineFormatWithHighlight text={it} highlight={highlight} /></li>)}
        </ol>
      );
    } else {
      blocks.push(
        <ul key={`ul-${key}`} className="list-disc ml-4 space-y-0.5 text-text-primary">
          {listItems.items.map((it, i) => <li key={i}><InlineFormatWithHighlight text={it} highlight={highlight} /></li>)}
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
        blocks.push(<p key={`p-${i}`} className="text-text-primary leading-relaxed"><InlineFormatWithHighlight text={line} highlight={highlight} /></p>);
      }
    }
  });
  flushList(lines.length);

  return <>{blocks}</>;
}

/** Inline formatting: **bold** and `inline code`, with match highlighting. */
function InlineFormatWithHighlight({ text, highlight }: { text: string; highlight: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold text-text-primary">{highlightMatch(part.slice(2, -2), highlight)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i} className="px-1 py-0.5 rounded bg-bg-tertiary text-text-primary text-3xs font-mono">{part.slice(1, -1)}</code>;
        }
        return <span key={i}>{highlightMatch(part, highlight)}</span>;
      })}
    </>
  );
}

/**
 * Lightweight markdown renderer — no external dependency.
 * Same as the one in AiAssistant.tsx (copied here because AiAssistant
 * doesn't export its helpers).
 */
function MarkdownLite({ text }: { text: string }) {
  const segments = useMemo(() => {
    const parts: { type: 'code' | 'text'; content: string; lang?: string }[] = [];
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
              <pre className="bg-bg-tertiary border border-border-subtle rounded p-2 text-2xs font-mono overflow-x-auto max-h-72">
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
        return <TextSegment key={i} text={seg.content} />;
      })}
    </div>
  );
}

/** Render a text segment with inline bold/code and bullet/numbered lists. */
function TextSegment({ text }: { text: string }) {
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
