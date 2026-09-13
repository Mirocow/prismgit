import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastActions } from '../stores/toastStore';
import { useI18n } from '../lib/i18n';
import { Sparkles, X, Send, Loader, Wrench, ArrowRight, User, Bot, Trash, Folder } from './icons';
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
 *     results → LLM → final answer.
 *   - Renders intermediate 'assistant with tool_calls' messages as
 *     "Calling get_status..." transcript entries.
 *   - Renders tool results as monospace blocks.
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

export function AiAssistant({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const currentRepo = useRepositoryStore(s => s.currentRepo);
  const settings = useSettingsStore(s => s.settings);
  const toast = useToastActions();
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Session repo path ──────────────────────────────────────────────────
  // The AI Assistant's OWN notion of which repo it's working on.
  // Initialized lazily from the app's currentRepo on first mount, but
  // after that it's user-controlled via the dropdown — switching the app's
  // currentRepo does NOT change sessionRepoPath.
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

  // The "session repo" object — looked up from the app's known repos list
  // so we can show its name in the header. Falls back to a synthetic
  // { name, path } if not in the list (e.g. user typed a path manually).
  const repos = useRepositoryStore(s => s.repos);
  const sessionRepo = useMemo(() => {
    if (sessionRepoPath === null) return null; // no-repo mode
    if (!sessionRepoPath) return undefined; // not initialized yet
    const found = repos.find(r => r.path === sessionRepoPath);
    if (found) return found;
    // Synthetic — show path basename as name.
    const name = sessionRepoPath.split(/[/\\]/).pop() ?? sessionRepoPath;
    return { name, path: sessionRepoPath, lastOpened: 0, pinned: false };
  }, [sessionRepoPath, repos]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  // Load persisted chat history when the session changes.
  useEffect(() => {
    if (sessionRepoPath === undefined) return; // not initialized yet
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

  const handleSend = useCallback(async () => {
    if (!input.trim()) return;
    // No longer require a repo to be open — sessionRepoPath can be null
    // (no-repo mode), in which case only app-scoped tools will work.
    if (sessionRepoPath === undefined) return; // still initializing
    const provider = buildProvider();
    if (!provider) {
      toast.info(t('changes.aiNoProvider'), t('changes.aiSetProviderHint'));
      return;
    }
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setBusy(true);
    try {
      await runWithTools(userMsg, provider, sessionRepoPath ?? undefined, {
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
    } catch (e) {
      toast.error(t('changes.aiGenerationFailed'), String(e));
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${String(e)}` }]);
    } finally {
      setBusy(false);
    }
  }, [input, sessionRepoPath, buildProvider, toast, t]);

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
              {/* Dropdown arrow */}
              <span className="text-text-tertiary text-3xs">▾</span>
            </button>
            {showSessionMenu && (
              <>
                {/* Click-away overlay */}
                <div className="fixed inset-0 z-10" onClick={() => setShowSessionMenu(false)} />
                <div className="absolute top-full left-0 mt-1 w-72 bg-bg-elevated border border-border-default rounded shadow-xl z-20 max-h-80 overflow-y-auto">
                  {/* No-repo mode option */}
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
                  {/* App's current repo — if different from session, show as quick-switch option */}
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
                  {/* Known repos list */}
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
          <div className="text-xs text-text-tertiary text-center py-4">
            {sessionRepoPath === null
              ? t('aiAssistant.emptyHintNoRepo') || 'No repository open. Ask me to list, clone, or create a repo. Use list_repos to see what you have.'
              : t('aiAssistant.emptyHint')}
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
        <button
          className="btn btn-primary !px-2 !py-1 flex-shrink-0"
          onClick={handleSend}
          disabled={busy || !input.trim()}
          title={t('aiAssistant.send')}
        >
          {busy ? <Loader size={12} className="spin" /> : <Send size={12} />}
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'user') {
    return (
      <div className="flex items-start gap-2 justify-end">
        <div className="bg-accent text-text-inverse rounded-lg px-3 py-1.5 text-xs max-w-[80%]">
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
  // assistant final answer
  return (
    <div className="flex items-start gap-2">
      <Bot size={14} className="flex-shrink-0 mt-0.5 text-accent" />
      <div className="bg-bg-secondary rounded px-3 py-1.5 text-xs max-w-[80%] whitespace-pre-wrap break-words">
        {msg.content}
      </div>
    </div>
  );
}
