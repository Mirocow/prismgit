import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastActions } from '../stores/toastStore';
import { useI18n, useI18nStore } from '../lib/i18n';
import { Sparkles, X, Send, Loader, Wrench, ArrowRight, User, Bot, Trash, Folder, Square, Copy, Check, Download, ChevronRight, ChevronDown, RefreshCw, Star } from './icons';
import { cn } from '../lib/utils';
import { runWithTools, type ChatMessage, type TokenUsage } from '../lib/aiChat';
import type { LLMProvider } from '../lib/aiCommitMessages';
import {
  getEnabledAiProviders, getActiveAiProvider, buildProviderFromActiveEntry,
  ensureAiProvidersMigrated, activateAiProvider,
} from '../lib/aiProviders';
import MarkdownRenderer from './MarkdownRenderer';
import { AiFavoritesPanel } from './AiFavoritesPanel';
import { useAiFavoritesStore } from '../stores/aiFavoritesStore';
import type { AiFavoriteNote } from '../lib/aiFavorites';
import {
  useAiChatStore,
  storageKeyFor, loadChatHistory, saveChatHistory, clearChatHistory,
} from '../stores/aiChatStore';

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
 * ── Shared state with AiChatPage ──────────────────────────────────────
 * The popup and the full-page AiChatPage share the SAME store
 * (useAiChatStore) so messages / busy / tokenUsage / input / sessionRepoPath
 * stay in sync. Whatever the user types in the popup is visible in the page
 * (and vice-versa) without any explicit synchronization code. This is the
 * fix for the user's complaint that the two surfaces were out of sync.
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
const DEFAULT_HISTORY_LIMIT = 100;

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
export function exportChatLog(
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
export function formatAgo(ms: number): string {
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

  const repos = useRepositoryStore(s => s.repos);

  // ── Shared chat state — synced with AiChatPage via useAiChatStore ──────
  // Both surfaces subscribe to the same store, so messages / busy / input
  // / tokenUsage stay in sync without any explicit event handling.
  const sessionRepoPath = useAiChatStore((s) => s.sessionRepoPath);
  const messages = useAiChatStore((s) => s.messages);
  const input = useAiChatStore((s) => s.input);
  const busy = useAiChatStore((s) => s.busy);
  const tokenUsage = useAiChatStore((s) => s.tokenUsage);
  const setSessionRepoPath = useAiChatStore((s) => s.setSessionRepoPath);
  const setInput = useAiChatStore((s) => s.setInput);
  const setBusy = useAiChatStore((s) => s.setBusy);
  const setTokenUsage = useAiChatStore((s) => s.setTokenUsage);
  const storeAppendMessage = useAiChatStore((s) => s.appendMessage);
  const storeSetMessages = useAiChatStore((s) => s.setMessages);
  const storeClearMessages = useAiChatStore((s) => s.clearMessages);

  const sessionRepo = useMemo(() => {
    if (sessionRepoPath === null) return null;
    if (!sessionRepoPath) return undefined;
    const found = repos.find(r => r.path === sessionRepoPath);
    if (found) return found;
    const name = sessionRepoPath.split(/[/\\]/).pop() ?? sessionRepoPath;
    return { name, path: sessionRepoPath, lastOpened: 0, pinned: false };
  }, [sessionRepoPath, repos]);

  // ── Abort controller for the "Stop" button ─────────────────────────────
  // When the user clicks Stop, we abort the in-flight LLM call. The signal
  // propagates: runWithTools → callLLMChat → proxyFetch → fetch / IPC race.
  // The IPC itself can't be cancelled (Electron limitation), but the
  // Promise.race in proxyFetch rejects early so the UI updates immediately.
  const abortRef = useRef<AbortController | null>(null);

  // ── Favorites (saved parts of the dialogue, tree navigation) ───────────
  const [showFavorites, setShowFavorites] = useState(false);
  const [flashIdx, setFlashIdx] = useState<number | null>(null);

  const saveFavorite = useCallback((msg: ChatMessage) => {
    if (msg.role !== 'user' && msg.role !== 'assistant') return;
    useAiFavoritesStore.getState().addNote(null, {
      content: msg.content,
      role: msg.role,
      repoPath: sessionRepoPath ?? undefined,
    });
    toast.success(t('aiFav.saved'));
  }, [sessionRepoPath, t, toast]);

  // Scroll to + flash-highlight the original message of a favorite note.
  const jumpToNote = useCallback((note: AiFavoriteNote): boolean => {
    const idx = messages.findIndex((m) => m.content === note.content);
    if (idx < 0) return false;
    setShowFavorites(false);
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`[data-msg-idx="${idx}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlashIdx(idx);
      setTimeout(() => setFlashIdx(null), 1800);
    });
    return true;
  }, [messages]);

  // Follow the app's currentRepo — when the user switches projects in the
  // sidebar, the AI Assistant follows (loads that project's chat history).
  useEffect(() => {
    setSessionRepoPath(currentRepo?.path ?? null);
  }, [currentRepo?.path, setSessionRepoPath]);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

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
    // Preferred: the multi-provider registry (Settings → AI grid).
    const fromRegistry = buildProviderFromActiveEntry(settings);
    if (fromRegistry) return fromRegistry;
    // Legacy fallback: flat fields (registry not migrated yet / empty).
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
      storeAppendMessage({ role: 'user', content: userMsg });
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
        userLocale: useI18nStore.getState().locale,
        onTokenUsage: (usage) => {
          setTokenUsage({
            input: usage.inputTokens,
            output: usage.outputTokens,
            contextSize: usage.contextSize,
          });
        },
        onAssistantMessage: (msg) => {
          storeAppendMessage(msg);
        },
        onToolCall: (name, args) => {
          storeAppendMessage({
            role: 'assistant',
            content: `Calling tool: ${name}${Object.keys(args).length ? ` (${JSON.stringify(args)})` : ''}`,
            toolCalls: [{ name, arguments: args }],
          });
        },
        onToolResult: (name, result) => {
          storeAppendMessage({ role: 'tool', content: result, toolName: name });
        },
      });
    } catch (e: unknown) {
      // Distinguish "user pressed Stop" from real errors. AbortError is
      // thrown by the signal — show a friendly "stopped" message instead
      // of a red error toast.
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      if (isAbort) {
        storeAppendMessage({
          role: 'assistant',
          content: t('aiAssistant.stoppedByUser'),
        });
      } else {
        toast.error(t('changes.aiGenerationFailed'), String(e));
        storeAppendMessage({ role: 'assistant', content: `Error: ${String(e)}` });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [input, sessionRepoPath, buildProvider, toast, t, messages, settings, storeAppendMessage, setInput, setBusy, setTokenUsage]);

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
    storeClearMessages();
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
  const enabledProviders = useMemo(() => getEnabledAiProviders(settings), [settings]);
  const activeProvider = useMemo(() => getActiveAiProvider(settings), [settings]);

  // One-shot legacy → registry migration.
  useEffect(() => {
    void ensureAiProvidersMigrated(settings, setSetting);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchProvider = useCallback(async (entryId: string) => {
    await activateAiProvider(settings, setSetting, entryId);
    setShowProviderMenu(false);
  }, [settings, setSetting]);

  // Resizable panel — user can drag the edges to resize the chat.
  // Default: 28rem (448px) wide × 80vh tall. Stored in localStorage.
  const [panelWidth, setPanelWidth] = useState(() => {
    try { return parseInt(localStorage.getItem('prismgit-ai-panel-width') || '448', 10); }
    catch { return 448; }
  });
  const [panelHeight, setPanelHeight] = useState(() => {
    try { return parseInt(localStorage.getItem('prismgit-ai-panel-height') || '600', 10); }
    catch { return 600; }
  });
  const dragRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  // Save to localStorage on change (debounced via requestAnimationFrame).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        localStorage.setItem('prismgit-ai-panel-width', String(panelWidth));
        localStorage.setItem('prismgit-ai-panel-height', String(panelHeight));
      } catch { /* ignore */ }
    });
    return () => cancelAnimationFrame(id);
  }, [panelWidth, panelHeight]);

  const handleResizeStart = useCallback((e: React.MouseEvent, edge: 'left' | 'top' | 'corner') => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startY: e.clientY, startW: panelWidth, startH: panelHeight };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      if (edge === 'left' || edge === 'corner') {
        // Dragging left edge → width increases as mouse moves left
        const newW = Math.max(320, Math.min(800, dragRef.current.startW - dx));
        setPanelWidth(newW);
      }
      if (edge === 'top' || edge === 'corner') {
        // Dragging top edge → height increases as mouse moves up
        const newH = Math.max(300, Math.min(window.innerHeight - 100, dragRef.current.startH - dy));
        setPanelHeight(newH);
      }
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = edge === 'left' ? 'ew-resize' : edge === 'top' ? 'ns-resize' : 'nwse-resize';
    document.body.style.userSelect = 'none';
  }, [panelWidth, panelHeight]);

  // Starter prompts — different sets for repo vs no-repo mode.
  const starterPrompts = sessionRepoPath === null
    ? STARTER_PROMPTS_NO_REPO
    : STARTER_PROMPTS_WITH_REPO;

  return (
    <div
      className="fixed bottom-4 right-4 bg-bg-elevated border border-border-default rounded-lg shadow-2xl flex flex-col z-50"
      style={{ width: `${panelWidth}px`, height: `${panelHeight}px` }}
    >
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
                    <span className="text-3xs text-text-tertiary mt-0.5 ml-[18px]">
                      {t('aiAssistant.noRepoToolsHint')}
                    </span>
                  </button>
                  {currentRepo && currentRepo.path !== sessionRepoPath && (
                    <button
                      className="w-full text-left px-3 py-2 text-xs hover:bg-bg-hover transition-colors border-b border-border-subtle"
                      onClick={() => switchSession(currentRepo.path)}
                    >
                      <div className="flex items-center gap-2">
                        <Folder size={11} className="text-accent" />
                        <span className="font-medium">{currentRepo.name}</span>
                        <span className="text-3xs text-accent ml-auto">{t('aiAssistant.currentRepo')}</span>
                      </div>
                      <div className="text-3xs text-text-tertiary mt-0.5 ml-[18px] truncate">{currentRepo.path}</div>
                    </button>
                  )}
                  <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold px-3 pt-2 pb-1">
                    {t('aiAssistant.knownRepositories')}
                  </div>
                  {sortedRepos.length === 0 ? (
                    <div className="px-3 py-2 text-2xs text-text-tertiary italic">
                      {t('aiAssistant.noRepositoriesYet')}
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
          {/* Provider switcher — lists the unlimited provider registry
              (Settings → AI grid). Switching mid-conversation preserves
              history; each entry keeps its own URL/key/model. */}
          <div className="relative ml-1">
            <button
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs bg-bg-secondary border border-border-subtle hover:border-accent transition-colors"
              onClick={() => setShowProviderMenu(v => !v)}
              title={activeProvider ? `${t('aiAssistant.providerTitle')}: ${activeProvider.name}` : t('aiAssistant.noProviderSelected')}
            >
              <span className="truncate max-w-20">
                {activeProvider
                  ? activeProvider.name
                  : t('aiAssistant.noProviderSelected')}
              </span>
              <span className="text-text-tertiary text-3xs">▾</span>
            </button>
            {showProviderMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowProviderMenu(false)} />
                <div className="absolute top-full right-0 mt-1 w-64 bg-bg-elevated border border-border-default rounded shadow-xl z-20 max-h-80 overflow-y-auto">
                  <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold px-3 pt-2 pb-1">
                    {t('aiAssistant.switchProvider')}
                  </div>
                  {enabledProviders.length === 0 && (
                    <div className="px-3 py-2 text-2xs text-text-tertiary italic">
                      {t('aiAssistant.noProvidersHint') || 'Add providers in Settings → AI.'}
                    </div>
                  )}
                  {enabledProviders.map(p => (
                    <button
                      key={p.id}
                      className={cn(
                        'w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hover transition-colors flex items-center gap-2',
                        activeProvider?.id === p.id && 'bg-accent-muted text-accent',
                      )}
                      onClick={() => void switchProvider(p.id)}
                    >
                      <span className="flex-1 truncate">{p.name}</span>
                      {p.apiKey && (
                        <span className="text-3xs text-status-added" title="API key saved">✓</span>
                      )}
                    </button>
                  ))}
                  <div className="text-3xs text-text-tertiary px-3 py-1.5 border-t border-border-subtle">
                    {t('aiAssistant.switchProviderHint')}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Favorites toggle — tree of saved parts of the dialogue */}
          <button
            className={cn('icon-btn !w-5 !h-5', showFavorites ? '!text-accent' : 'hover:!text-accent')}
            onClick={() => setShowFavorites(v => !v)}
            title={t('aiFav.title')}
            aria-label={t('aiFav.title')}
          >
            <Star size={11} />
          </button>
          {messages.length > 0 && (
            <>
              {/* Export chat log as Markdown — used to share the
                  conversation with the developer for debugging / improving
                  the AI Assistant. The .md file lands in the user's
                  Downloads directory. */}
              <button
                className="icon-btn !w-5 !h-5 hover:!text-accent"
                onClick={() => exportChatLog(messages, sessionRepoPath, sessionRepo?.name)}
                title={t('aiAssistant.exportChatLog')}
                aria-label={t('aiAssistant.exportChatLabel')}
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

      {/* Messages — or the favorites tree when toggled */}
      {showFavorites ? (
        <AiFavoritesPanel
          className="flex-1 min-h-[300px] max-h-[60vh]"
          onInsertToInput={(text) => setInput((input ? input.replace(/\s+$/, '') + '\n\n' : '') + text)}
          onJumpToNote={jumpToNote}
        />
      ) : (
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
              return (
                <div
                  key={idx}
                  data-msg-idx={idx}
                  className={cn(
                    'rounded transition-colors',
                    flashIdx === idx && 'bg-accent-muted/40 outline outline-1 outline-accent/60 -mx-1 px-1',
                  )}
                >
                  <MessageBubble
                    msg={msg}
                    onRegenerate={retryHandler}
                    onSaveFavorite={() => saveFavorite(msg)}
                    t={t}
                  />
                </div>
              );
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
      )}

      {/* Token usage bar — shows input/output tokens and context size.
          Helps the user understand how much of their quota is being
          consumed and whether the context is getting too large. */}
      {(tokenUsage.input > 0 || tokenUsage.output > 0) && (
        <div className="flex items-center gap-3 px-3 py-1 border-t border-border-subtle bg-bg-tertiary text-3xs text-text-tertiary">
          <span title={t('aiAssistant.tokensInput')}>
            <span className="text-text-secondary font-medium">↓ {tokenUsage.input.toLocaleString()}</span> {t('aiAssistant.tokensIn')}
          </span>
          <span title={t('aiAssistant.tokensOutput')}>
            <span className="text-text-secondary font-medium">↑ {tokenUsage.output.toLocaleString()}</span> {t('aiAssistant.tokensOut')}
          </span>
          <span title={t('aiAssistant.tokensContext')}>
            <span className="text-text-secondary font-medium">∑ {tokenUsage.contextSize.toLocaleString()}</span> {t('aiAssistant.tokensCtx')}
          </span>
          {tokenUsage.contextSize > 50000 && (
            <span className="text-status-warning" title={t('aiAssistant.largeContextTitle')}>
              ⚠ {t('aiAssistant.largeContextWarn')}
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
            title={t('aiAssistant.stopGeneration')}
            aria-label={t('aiAssistant.stopGeneration')}
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
      {/* Resize handles — left edge (horizontal), top edge (vertical),
          top-left corner (diagonal). The panel is anchored bottom-right,
          so we resize from the LEFT and TOP edges only. */}
      <div
        className="absolute top-0 left-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-accent/30 transition-colors z-10"
        onMouseDown={(e) => handleResizeStart(e, 'left')}
      />
      <div
        className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-accent/30 transition-colors z-10"
        onMouseDown={(e) => handleResizeStart(e, 'top')}
      />
      <div
        className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize hover:bg-accent/40 transition-colors rounded-tl-lg z-10"
        onMouseDown={(e) => handleResizeStart(e, 'corner')}
      />
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
export function MessageBubble({ msg, onRegenerate, onSaveFavorite, t }: { msg: ChatMessage; onRegenerate?: () => void; onSaveFavorite?: () => void; t: (key: string) => string }) {
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
          <div className="flex items-center gap-2">
            {onRegenerate && (
              <button
                className="flex items-center gap-0.5 text-3xs text-text-tertiary hover:text-accent transition-colors"
                onClick={onRegenerate}
                title={t('aiAssistant.resendMessage')}
              >
                <RefreshCw size={9} />
                {t('aiAssistant.retry')}
              </button>
            )}
            {onSaveFavorite && (
              <button
                className="flex items-center gap-0.5 text-3xs text-text-tertiary hover:text-accent transition-colors"
                onClick={onSaveFavorite}
                title={t('aiFav.saveTooltip')}
              >
                <Star size={9} />
                {t('aiFav.save')}
              </button>
            )}
          </div>
        </div>
        <User size={14} className="flex-shrink-0 mt-0.5 text-text-tertiary" />
      </div>
    );
  }
  if (msg.role === 'tool') {
    return <ToolResultBubble msg={msg} t={t} />;
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
        {/* Action buttons — Retry (regenerate) + Copy + Save to favorites. Always visible. */}
        <div className="mt-1 flex justify-end gap-2">
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className="flex items-center gap-0.5 text-3xs text-text-tertiary hover:text-accent transition-colors"
              title={t('aiAssistant.regenerateResponse')}
            >
              <RefreshCw size={9} />
              {t('aiAssistant.retry')}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-0.5 text-3xs text-text-tertiary hover:text-accent transition-colors"
            title={t('aiAssistant.copyMessage')}
          >
            {copied ? <Check size={9} className="text-status-added" /> : <Copy size={9} />}
            {copied ? t('aiAssistant.copied') : t('aiAssistant.copy')}
          </button>
          {onSaveFavorite && (
            <button
              onClick={onSaveFavorite}
              className="flex items-center gap-0.5 text-3xs text-text-tertiary hover:text-accent transition-colors"
              title={t('aiFav.saveTooltip')}
            >
              <Star size={9} />
              {t('aiFav.save')}
            </button>
          )}
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
export function ToolResultBubble({ msg, t }: { msg: ChatMessage; t?: (key: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const tFn = t ?? ((k: string) => k);

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
    if (!line) return tFn('aiAssistant.emptyResult');
    return line.length > 80 ? line.slice(0, 80) + '…' : line;
  }, [msg.content, tFn]);

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
          {lineCount} {lineCount === 1 ? tFn('aiAssistant.line') : tFn('aiAssistant.lines')}
        </span>
        {/* Copy button — always visible, stops propagation so it doesn't toggle. */}
        <span
          onClick={handleCopy}
          className="icon-btn !w-4 !h-4 hover:text-accent flex-shrink-0 cursor-pointer"
          title={tFn('aiAssistant.copyResult')}
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
 * Lightweight markdown renderer — DELEGATES to MarkdownRenderer.tsx which has
 * full support for syntax highlighting, tables, blockquotes, nested lists,
 * headings, links, and task lists.
 *
 * Kept as a thin wrapper for backwards compatibility (other files import
 * MarkdownLite from this module).
 */
export function MarkdownLite({ text }: { text: string }) {
  return <MarkdownRenderer text={text} />;
}
