import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastActions } from '../stores/toastStore';
import { useI18n } from '../lib/i18n';
import { Sparkles, X, Send, Loader, Wrench, ArrowRight, User, Bot, Trash, Folder, Square, Copy, Check, Download, ChevronRight, ChevronDown, RefreshCw } from './icons';
import { cn } from '../lib/utils';
import { runWithTools, type ChatMessage, type TokenUsage } from '../lib/aiChat';
import { PROVIDER_PRESETS, getProviderPreset, type LLMProvider } from '../lib/aiCommitMessages';

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
 * ── Project switching ──────────────────────────────────────────────────
 * The AI Assistant FOLLOWS the app's currently-open repository. When
 * the user switches projects in the sidebar, the AI Assistant switches
 * too — loading the new project's chat history and scoping tool calls
 * to the new repo. The user can also manually switch via the dropdown
 * in the panel header (e.g. to "no repo" mode for clone/init tasks).
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

/**
 * Export the full chat conversation as a Markdown file — used to share
 * the conversation with the developer for debugging / improving the AI
 * Assistant. The format is human-readable:
 *
 *   # PrismGit AI Assistant — Chat Log
 *   Session: <repo path or 'No repository'>
 *   Exported: 2026-09-13T15:42:00.000Z
 *   Messages: 12
 *
 *   ## 👤 User
 *   What changed since the last commit?
 *
 *   ## 🤖 Assistant
 *   Calling tool: get_status
 *
 *   ### 🔧 get_status
 *   Current branch: main
 *   ...
 *
 *   ## 🤖 Assistant
 *   You have 3 modified files...
 *
 * Each message is included — user prompts, assistant reasoning, tool
 * calls, tool results, errors. Nothing is truncated, so the developer
 * sees exactly what the AI saw and did.
 */
function exportChatLog(
  messages: ChatMessage[],
  sessionRepoPath: string | null | undefined,
  sessionRepoName: string | undefined,
): void {
  const exportedAt = new Date().toISOString();
  const sessionLabel = sessionRepoPath
    ? `${sessionRepoName ?? sessionRepoPath} (\`${sessionRepoPath}\`)`
    : 'No repository (app-level mode)';
  const lines: string[] = [
    '# PrismGit AI Assistant — Chat Log',
    '',
    `- **Session:** ${sessionLabel}`,
    `- **Exported:** ${exportedAt}`,
    `- **Messages:** ${messages.length}`,
    '',
    '---',
    '',
  ];

  for (const msg of messages) {
    if (msg.role === 'user') {
      lines.push('## 👤 User', '');
      lines.push(msg.content);
      lines.push('');
    } else if (msg.role === 'assistant' && msg.toolCalls?.length) {
      lines.push('## 🤖 Assistant (tool call)', '');
      lines.push(msg.content);
      lines.push('');
    } else if (msg.role === 'assistant') {
      lines.push('## 🤖 Assistant', '');
      lines.push(msg.content);
      lines.push('');
    } else if (msg.role === 'tool') {
      lines.push(`### 🔧 ${msg.toolName ?? 'tool'}`, '');
      // Wrap tool results in a code block so the markdown viewer doesn't
      // misinterpret git output (which often contains #, *, etc.).
      lines.push('```');
      lines.push(msg.content);
      lines.push('```');
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  const md = lines.join('\n');
  // Build a filename that includes the repo name (sanitised) + timestamp.
  const safeName = (sessionRepoName ?? 'no-repo').replace(/[^a-zA-Z0-9_-]/g, '_');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `prismgit-chat-${safeName}-${ts}.md`;

  // Trigger a browser download. In Electron/Tauri this lands in the
  // user's Downloads directory — same as any other file save.
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the blob URL after the click — the browser keeps the download
  // alive even after the URL is revoked, as long as the click happened.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const setSetting = useSettingsStore(s => s.setSetting);
  const toast = useToastActions();
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Session repo path ──────────────────────────────────────────────────
  // FOLLOWS the app's currentRepo — when the user switches projects,
  // the AI Assistant switches too (loads that project's chat history).
  const [sessionRepoPath, setSessionRepoPath] = useState<string | undefined | null>(undefined);

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
  // ── Token usage tracking ───────────────────────────────────────────────
  // Shows the user how many tokens were consumed (input + output) and the
  // total context size. Updated via onTokenUsage callback from runWithTools.
  const [tokenUsage, setTokenUsage] = useState<{ input: number; output: number; contextSize: number }>({ input: 0, output:  0, contextSize: 0 });

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

  const handleSend = useCallback(async (overrideInput?: string, isRegenerate = false) => {
    const userMsg = (overrideInput ?? input).trim();
    if (!userMsg) return;
    if (sessionRepoPath === undefined) return;
    const provider = buildProvider();
    if (!provider) {
      toast.info(t('changes.aiNoProvider'), t('changes.aiSetProviderHint'));
      return;
    }
    if (!isRegenerate) {
      setInput('');
      setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    }
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // For regenerate: pass messages WITHOUT the last assistant response
      // so the AI generates a fresh answer. The user message is already
      // in the history, so we DON'T add a duplicate.
      const historyForContext = isRegenerate
        ? messages.slice(0, messages.length - 1) // drop last assistant msg
        : messages;
      await runWithTools(userMsg, provider, sessionRepoPath ?? undefined, {
        signal: controller.signal,
        priorHistory: historyForContext,
        contextMaxChars: settings?.aiContextMaxChars ?? 20_000,
        onTokenUsage: (usage) => {
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

  // ── Provider switcher ──────────────────────────────────────────────
  // Switch LLM provider ON THE FLY — mid-conversation. The conversation
  // history and context are preserved (they're passed as priorHistory to
  // runWithTools, which doesn't depend on the provider). The new provider
  // continues the conversation from where the old one left off.
  //
  // Per-provider configs (URL + API key + model) are saved/restored from
  // aiProviderConfigs so the user doesn't re-enter credentials on each switch.
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const switchProvider = useCallback(async (newProviderId: string) => {
    const oldProviderId = settings?.aiProvider || '';
    // ── 1. Save current provider's config to aiProviderConfigs ──
    // Read the CURRENT flat values (aiUrl, aiApiKey, aiModel) and merge
    // them into the configs store. We use functional updates to avoid
    // stale-closure issues — settings in this closure may be outdated
    // by the time the async setSetting calls complete.
    const currentUrl = settings?.aiUrl || '';
    const currentApiKey = settings?.aiApiKey || '';
    const currentModel = settings?.aiModel || '';

    // Build the updated configs map — merge old + new.
    const existingConfigs = settings?.aiProviderConfigs || {};
    const updatedConfigs = { ...existingConfigs };
    if (oldProviderId) {
      const existing = updatedConfigs[oldProviderId] || {};
      updatedConfigs[oldProviderId] = {
        url: currentUrl || existing.url,
        apiKey: currentApiKey || existing.apiKey,
        model: currentModel || existing.model,
      };
    }

    // ── 2. Get the new provider's saved config or defaults ──
    const preset = getProviderPreset(newProviderId);
    const savedConfig = updatedConfigs[newProviderId];
    const newUrl = savedConfig?.url || preset.defaultUrl;
    const newModel = savedConfig?.model || preset.defaultModel;
    const newApiKey = savedConfig?.apiKey || '';

    // ── 3. Apply ALL settings in one batch ──
    // We set them all together so the UI updates atomically — no flicker
    // of half-switched state (old URL with new model, etc.).
    await Promise.all([
      setSetting('aiProviderConfigs', updatedConfigs),
      setSetting('aiProvider', newProviderId),
      setSetting('aiUrl', newUrl),
      setSetting('aiModel', newModel),
      setSetting('aiApiKey', newApiKey),
    ]);
    setShowProviderMenu(false);
  }, [settings, setSetting]);

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
          {/* Provider switcher — compact dropdown to switch LLM provider
              ON THE FLY. Saves the current provider's config (URL+key+model)
              and restores the new provider's saved config. Conversation
              history is preserved — the new provider continues the chat. */}
          <div className="relative ml-1">
            <button
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs bg-bg-secondary border border-border-subtle hover:border-accent transition-colors"
              onClick={() => setShowProviderMenu(v => !v)}
              title={settings?.aiProvider ? `Provider: ${getProviderPreset(settings.aiProvider).label}` : 'No provider selected'}
            >
              <span className="truncate max-w-20">
                {settings?.aiProvider
                  ? getProviderPreset(settings.aiProvider).label.split(' ')[0]
                  : 'no provider'}
              </span>
              <span className="text-text-tertiary text-3xs">▾</span>
            </button>
            {showProviderMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowProviderMenu(false)} />
                <div className="absolute top-full right-0 mt-1 w-64 bg-bg-elevated border border-border-default rounded shadow-xl z-20 max-h-80 overflow-y-auto">
                  <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold px-3 pt-2 pb-1">
                    Switch AI Provider
                  </div>
                  {PROVIDER_PRESETS.map(p => (
                    <button
                      key={p.id}
                      className={cn(
                        'w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hover transition-colors flex items-center gap-2',
                        settings?.aiProvider === p.id && 'bg-accent-muted text-accent',
                      )}
                      onClick={() => switchProvider(p.id)}
                    >
                      <span className="flex-1 truncate">{p.label}</span>
                      {p.freeTier && (
                        <span className="text-3xs px-1 rounded bg-status-added/15 text-status-added">FREE</span>
                      )}
                      {settings?.aiProviderConfigs?.[p.id]?.apiKey && (
                        <span className="text-3xs text-status-added" title="API key saved">✓</span>
                      )}
                    </button>
                  ))}
                  <div className="text-3xs text-text-tertiary px-3 py-1.5 border-t border-border-subtle">
                    Switching preserves the conversation — the new provider continues the chat.
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {messages.length > 0 && (
            <>
              {/* Export chat log as Markdown — used to share the
                  conversation with the developer for debugging / improving
                  the AI Assistant. The .md file lands in the user's
                  Downloads directory. */}
              <button
                className="icon-btn !w-5 !h-5 hover:!text-accent"
                onClick={() => exportChatLog(messages, sessionRepoPath, sessionRepo?.name)}
                title="Export chat log as Markdown (for debugging / sharing)"
                aria-label="Export chat log"
              >
                <Download size={11} />
              </button>
              <button
                className="icon-btn !w-5 !h-5 hover:!text-status-deleted"
                onClick={handleClear}
                title={t('aiAssistant.clearHistory')}
              >
                <Trash size={11} />
              </button>
            </>
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
          <>
            {messages.map((msg, idx) => {
              // For user messages: retry re-sends that message.
              // For assistant final answers: retry finds the last user
              // message BEFORE this answer and re-sends it.
              const canRetry = !busy && (msg.role === 'user' || (msg.role === 'assistant' && !msg.toolCalls?.length));
              let retryHandler: (() => void) | undefined;
              if (canRetry) {
                if (msg.role === 'user') {
                  retryHandler = () => void handleSend(msg.content, true);
                } else {
                  // Find the last user message before this assistant message
                  let lastUserMsg: string | null = null;
                  for (let i = idx - 1; i >= 0; i--) {
                    if (messages[i].role === 'user') { lastUserMsg = messages[i].content; break; }
                  }
                  if (lastUserMsg) retryHandler = () => void handleSend(lastUserMsg!, true);
                }
              }
              return <MessageBubble key={idx} msg={msg} onRegenerate={retryHandler} />;
            })}
          </>
        )}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <Loader size={10} className="spin" />
            {t('aiAssistant.thinking')}
          </div>
        )}
      </div>

      {/* Token usage bar — shows input/output tokens and context size.
          Helps the user understand how much of their quota is being
          consumed and whether the context is getting too large. */}
      {(tokenUsage.input > 0 || tokenUsage.output > 0) && (
        <div className="flex items-center gap-3 px-3 py-1 border-t border-border-subtle bg-bg-tertiary text-3xs text-text-tertiary">
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
function MessageBubble({ msg, onRegenerate }: { msg: ChatMessage; onRegenerate?: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => { /* ignore */ });
  }, [msg.content]);

  if (msg.role === 'user') {
    return (
      <div className="flex items-start gap-2 justify-end group">
        <div className="flex flex-col items-end gap-0.5">
          <div className="bg-accent text-text-inverse rounded-lg px-3 py-1.5 text-xs max-w-[80%] whitespace-pre-wrap break-words">
            {msg.content}
          </div>
          {/* Retry button — ALWAYS visible (not hover-only). Re-sends
              this message to get a fresh AI response. */}
          {onRegenerate && (
            <button
              className="flex items-center gap-0.5 text-3xs text-text-tertiary hover:text-accent transition-colors"
              onClick={onRegenerate}
              title="Resend this message"
            >
              <RefreshCw size={9} />
              Retry
            </button>
          )}
        </div>
        <User size={14} className="flex-shrink-0 mt-0.5 text-text-tertiary" />
      </div>
    );
  }
  if (msg.role === 'tool') {
    return <ToolResultBubble msg={msg} />;
  }
  if (msg.role === 'assistant' && msg.toolCalls?.length) {
    // "Calling tool: get_status" — kept VERY compact (single line, no bubble,
    // muted text). The real content is in the tool result block below
    // (which is collapsed by default).
    //
    // HIDE empty-content messages entirely — some LLMs (especially Ollama
    // with tool-use) send an assistant message with tool_calls but EMPTY
    // content. Showing an empty "Calling tool: " line is confusing — the
    // tool name is already in the toolCalls array, and the user sees the
    // collapsed tool-result block below with the real tool name. So we
    // render nothing for empty-content tool-call messages.
    const content = msg.content?.trim();
    if (!content) return null;
    return (
      <div className="flex items-center gap-1 pl-1 text-2xs text-text-tertiary italic opacity-70">
        <ArrowRight size={9} />
        <span>{content}</span>
      </div>
    );
  }
  // assistant final answer — render with lightweight markdown + copy + retry.
  return (
    <div className="flex items-start gap-2 group">
      <Bot size={14} className="flex-shrink-0 mt-0.5 text-accent" />
      <div className="bg-bg-secondary rounded px-3 py-1.5 text-xs max-w-[85%] whitespace-pre-wrap break-words">
        <MarkdownLite text={msg.content} />
        {/* Action buttons — Retry (regenerate) + Copy. Always visible. */}
        <div className="mt-1 flex justify-end gap-2">
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className="flex items-center gap-0.5 text-3xs text-text-tertiary hover:text-accent transition-colors"
              title="Regenerate this response"
            >
              <RefreshCw size={9} />
              Retry
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-0.5 text-3xs text-text-tertiary hover:text-accent transition-colors"
            title="Copy message"
          >
            {copied ? <Check size={9} className="text-status-added" /> : <Copy size={9} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Tool result bubble — ALWAYS COLLAPSED by default.
 *
 * The user explicitly asked for this: tool results like get_status / get_log
 * can be very long (50+ lines of git output), and seeing them all expanded
 * floods the chat transcript. By default the bubble shows only:
 *   - the tool name (🔧 get_status)
 *   - a one-line preview (first non-empty line, truncated to 80 chars)
 *   - a chevron to expand/collapse
 *   - a copy button (always visible — user may want to copy without expanding)
 *
 * Clicking the header toggles between collapsed (default) and expanded.
 * When expanded, the full content is shown in a scrollable monospace block
 * (max-h-60 so even 1000-line outputs don't take over the chat).
 */
function ToolResultBubble({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // don't toggle expand when clicking copy
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => { /* ignore */ });
  }, [msg.content]);

  // One-line preview — first non-empty line, truncated.
  const firstLine = useMemo(() => {
    const line = msg.content.split('\n').find(l => l.trim());
    if (!line) return '(empty result)';
    return line.length > 80 ? line.slice(0, 80) + '…' : line;
  }, [msg.content]);

  // Total line count — shown as a badge so the user knows how much is hidden.
  const lineCount = useMemo(() => msg.content.split('\n').length, [msg.content]);

  return (
    <div className="bg-bg-tertiary border border-border-subtle rounded text-xs font-mono">
      {/* Header — clickable to toggle expand/collapse */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-2xs text-text-tertiary hover:bg-bg-hover transition-colors rounded-t"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <Wrench size={9} />
        <span className="font-medium text-text-secondary">{msg.toolName}</span>
        {/* Preview — shown only when collapsed. */}
        {!expanded && (
          <span className="text-text-tertiary truncate flex-1 ml-1 opacity-70">{firstLine}</span>
        )}
        {/* Line count badge — tells the user how much is hidden. */}
        <span className="text-3xs text-text-tertiary flex-shrink-0 ml-auto px-1 rounded bg-bg-secondary">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        </span>
        {/* Copy button — always visible, stops propagation so it doesn't toggle. */}
        <span
          onClick={handleCopy}
          className="icon-btn !w-4 !h-4 hover:text-accent flex-shrink-0 cursor-pointer"
          title="Copy result"
        >
          {copied ? <Check size={10} className="text-status-added" /> : <Copy size={10} />}
        </span>
      </button>
      {/* Content — only rendered when expanded. */}
      {expanded && (
        <div className="px-2.5 pb-2 text-text-secondary max-h-60 overflow-y-auto whitespace-pre-wrap break-words border-t border-border-subtle">
          {msg.content}
        </div>
      )}
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
