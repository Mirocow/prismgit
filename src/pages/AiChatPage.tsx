import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastActions } from '../stores/toastStore';
import { useI18n, useI18nStore } from '../lib/i18n';
import {
  Sparkles, Send, Loader, Wrench, ArrowRight, User, Bot, Trash, Folder,
  Square, Copy, Check, ChevronRight, ChevronDown, Search, X,
  Download, RefreshCw,
} from '../components/icons';
import { cn } from '../lib/utils';
import { runWithTools, type ChatMessage, type TokenUsage } from '../lib/aiChat';
import {
  PROVIDER_PRESETS, getProviderPreset, type LLMProvider,
} from '../lib/aiCommitMessages';
import {
  exportChatLog, formatAgo, MessageBubble, ToolResultBubble,
} from '../components/AiAssistant';
import { ResizableSplitter, useResizableWidth } from '../components/ResizableSplitter';
import { useAiChatStore } from '../stores/aiChatStore';

/**
 * Full-page version of the AI Assistant chat.
 *
 * Same feature set as the floating popup AiAssistant.tsx:
 *   - 12-provider switcher (switch provider on the fly, mid-conversation)
 *   - Per-provider configs saved in aiProviderConfigs
 *   - Retry + Copy buttons on every message (user + assistant)
 *   - Export chat log as Markdown
 *   - Tool results collapsed by default with line-count badge
 *   - Token usage bar (input / output / context)
 *   - Stop button (AbortController)
 *   - Project switching — follows the app's current repo
 *   - Session switcher dropdown (switch between known repos or "no repo")
 *   - Starter prompt chips (different sets for repo vs no-repo)
 *
 * Layout (with vertical ResizableSplitter between chat and search):
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  Header: AI Chat • <repo> [provider ▾]      [Export] [Clear] │
 *   ├──────────────────────────────────┬───────────────────────────┤
 *   │  Chat panel (resizable)          │  Chat Search (resizable)   │
 *   │  - user / assistant / tool       │  - search input           │
 *   │  - Retry + Copy on each msg      │  - filtered results list  │
 *   │  - markdown rendering           │                           │
 *   │  - starter prompts (when empty)  │                           │
 *   │  - token usage bar               │                           │
 *   │  - input + Stop/Send             │                           │
 *   └──────────────────────────────────┴───────────────────────────┘
 *                  ▲
 *                  └── ResizableSplitter (drag left/right to resize)
 *
 * State sync: the popup and the page share `useAiChatStore` — messages,
 * busy, input, tokenUsage, sessionRepoPath are all kept in sync without
 * explicit event handling. Whatever the user types in the popup is visible
 * in the page (and vice-versa).
 */

/**
 * Starter prompts — same as the floating panel for consistency.
 * Labels are localized via the t() function at render time.
 */
const STARTER_PROMPTS_WITH_REPO = [
  { labelKey: 'aiAssistant.starterWhatChanged', prompt: 'What files have changed since the last commit? Show me the status.' },
  { labelKey: 'aiAssistant.starterPullLatest', prompt: 'Pull the latest changes from origin. Stash my local changes first if needed.' },
  { labelKey: 'aiAssistant.starterRecentCommits', prompt: 'Show me the recent commits — last 5 with their messages and authors.' },
  { labelKey: 'aiAssistant.starterListBranches', prompt: 'List all local and remote branches. Mark the current one.' },
  { labelKey: 'aiAssistant.starterStashChanges', prompt: 'Stash my current changes with a descriptive message.' },
  { labelKey: 'aiAssistant.starterPushCommits', prompt: 'Push my local commits to origin. Tell me how many were pushed.' },
];

const STARTER_PROMPTS_NO_REPO = [
  { labelKey: 'aiAssistant.starterListRepos', prompt: 'List all repositories I have opened in this app.' },
  { labelKey: 'aiAssistant.starterCloneRepo', prompt: 'I want to clone a repository. Ask me for the URL.' },
  { labelKey: 'aiAssistant.starterCreateRepo', prompt: 'I want to create a new git repository. Ask me where.' },
];

export default function AiChatPage() {
  const { t } = useI18n();
  const currentRepo = useRepositoryStore(s => s.currentRepo);
  const settings = useSettingsStore(s => s.settings);
  const setSetting = useSettingsStore(s => s.setSetting);
  const toast = useToastActions();
  const scrollRef = useRef<HTMLDivElement>(null);

  const repos = useRepositoryStore(s => s.repos);

  // ── Shared chat state — synced with the AiAssistant popup via useAiChatStore.
  // Both surfaces subscribe to the same store, so messages / busy / input /
  // tokenUsage / sessionRepoPath stay in sync without explicit event handling.
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
  const storeClearMessages = useAiChatStore((s) => s.clearMessages);

  const sessionRepo = useMemo(() => {
    if (sessionRepoPath === null) return null;
    if (!sessionRepoPath) return undefined;
    const found = repos.find(r => r.path === sessionRepoPath);
    if (found) return found;
    const name = sessionRepoPath.split(/[/\\]/).pop() ?? sessionRepoPath;
    return { name, path: sessionRepoPath, lastOpened: 0, pinned: false };
  }, [sessionRepoPath, repos]);

  const abortRef = useRef<AbortController | null>(null);

  // ── Chat search state — filters messages by text, highlights matches.
  // Local-only (not shared with the popup — search is page-specific).
  const [searchQuery, setSearchQuery] = useState('');

  // ── Resizable chat panel width (search panel takes the remainder).
  // ResizableSplitter sits BETWEEN chat and search — drag right shrinks chat,
  // drag left grows chat. Chat width is the user-controlled value.
  const { width: chatWidth, handleResize: handleChatResize } = useResizableWidth(900, 400, 1400);

  // Follow the app's currentRepo (so the AI page tracks the sidebar).
  useEffect(() => {
    setSessionRepoPath(currentRepo?.path ?? null);
  }, [currentRepo?.path, setSessionRepoPath]);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

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

  const handleSend = useCallback(async (overrideInput?: string, isRegenerate = false) => {
    const userMsg = (overrideInput ?? input).trim();
    if (!userMsg) return;
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
        onTokenUsage: (usage: TokenUsage) => {
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
  }, [input, messages, sessionRepoPath, buildProvider, toast, t, settings, storeAppendMessage, setInput, setBusy, setTokenUsage]);

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
    storeClearMessages();
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

  // ── Provider switcher ──────────────────────────────────────────────────
  // Switch LLM provider ON THE FLY — mid-conversation. The conversation
  // history and context are preserved (they're passed as priorHistory to
  // runWithTools, which doesn't depend on the provider). The new provider
  // continues the conversation from where the old one left off.
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const switchProvider = useCallback(async (newProviderId: string) => {
    const oldProviderId = settings?.aiProvider || '';
    // ── 1. Save current provider's config to aiProviderConfigs ──
    const currentUrl = settings?.aiUrl || '';
    const currentApiKey = settings?.aiApiKey || '';
    const currentModel = settings?.aiModel || '';
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
    // ── 3. Apply ALL settings in one batch (atomic — no flicker) ──
    await Promise.all([
      setSetting('aiProviderConfigs', updatedConfigs),
      setSetting('aiProvider', newProviderId),
      setSetting('aiUrl', newUrl),
      setSetting('aiModel', newModel),
      setSetting('aiApiKey', newApiKey),
    ]);
    setShowProviderMenu(false);
  }, [settings, setSetting]);

  // ── Search filtering ────────────────────────────────────────────────────
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
                      <span>{t('aiAssistant.sessionNoRepo')}</span>
                    </div>
                    <div className="text-3xs text-text-tertiary mt-0.5 ml-[20px]">
                      {t('aiAssistant.noRepoToolsHint')}
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
                        <span className="text-3xs text-accent ml-auto">{t('aiAssistant.currentRepo')}</span>
                      </div>
                      <div className="text-3xs text-text-tertiary mt-0.5 ml-[20px] truncate">{currentRepo.path}</div>
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
                          <Folder size={12} className="text-text-tertiary flex-shrink-0" />
                          <span className="truncate flex-1">{r.name}</span>
                          <span className="text-3xs text-text-tertiary flex-shrink-0">{formatAgo(Date.now() - r.lastOpened)}</span>
                        </div>
                        <div className="text-3xs text-text-tertiary mt-0.5 ml-[20px] truncate">{r.path}</div>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
          {/* Provider switcher — same as popup. Saves current provider's
              config (URL+key+model) and restores the new provider's saved
              config. Conversation history is preserved. */}
          <div className="relative ml-1">
            <button
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-bg-secondary border border-border-subtle hover:border-accent transition-colors"
              onClick={() => setShowProviderMenu(v => !v)}
              title={settings?.aiProvider
                ? `${t('aiAssistant.providerTitle')}: ${getProviderPreset(settings.aiProvider).label}`
                : t('aiAssistant.noProviderSelected')}
            >
              <span className="truncate max-w-28">
                {settings?.aiProvider
                  ? getProviderPreset(settings.aiProvider).label.split(' ')[0]
                  : t('aiAssistant.noProviderSelected')}
              </span>
              <span className="text-text-tertiary text-3xs">▾</span>
            </button>
            {showProviderMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowProviderMenu(false)} />
                <div className="absolute top-full left-0 mt-1 w-72 bg-bg-elevated border border-border-default rounded shadow-xl z-20 max-h-96 overflow-y-auto">
                  <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold px-3 pt-2 pb-1">
                    {t('aiAssistant.switchProvider')}
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
                    {t('aiAssistant.switchProviderHint')}
                  </div>
                </div>
              </>
            )}
          </div>
          {/* Message count badge */}
          {messages.length > 0 && (
            <span className="text-3xs text-text-tertiary px-1.5 py-0.5 rounded bg-bg-secondary border border-border-subtle flex-shrink-0">
              {messages.length} {messages.length === 1 ? t('aiAssistant.message') : t('aiAssistant.messages')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {messages.length > 0 && (
            <>
              {/* Export chat log — same as popup. */}
              <button
                className="btn btn-ghost !px-2 !py-1 text-xs flex items-center gap-1"
                onClick={() => exportChatLog(messages, sessionRepoPath, sessionRepo?.name)}
                title={t('aiAssistant.exportChatLog')}
                aria-label={t('aiAssistant.exportChatLabel')}
              >
                <Download size={11} />
              </button>
              <button
                className="btn btn-ghost !px-2 !py-1 text-xs flex items-center gap-1"
                onClick={handleClear}
                title={t('aiAssistant.clearHistory')}
              >
                <Trash size={11} />
                <span className="hidden sm:inline">{t('aiAssistant.clearChat')}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body: chat panel (left, resizable) + splitter + search panel (right) */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Chat panel — width controlled by chatWidth state */}
        <div className="flex flex-col min-w-0 border-r border-border-default" style={{ width: chatWidth }}>
          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            {messages.length === 0 ? (
              <div className="space-y-4 h-full flex flex-col justify-center max-w-2xl mx-auto">
                <div className="text-sm text-text-tertiary text-center py-4">
                  {sessionRepoPath === null
                    ? (t('aiAssistant.emptyHintNoRepo') || 'No repository open.')
                    : t('aiAssistant.emptyHint')}
                </div>
                {/* Starter prompt chips */}
                <div className="flex flex-wrap gap-2 justify-center">
                  {starterPrompts.map(sp => (
                    <button
                      key={sp.labelKey}
                      onClick={() => void handleSend(sp.prompt)}
                      className="text-xs px-3 py-1.5 rounded border border-border-default bg-bg-secondary hover:border-accent hover:bg-accent-muted hover:text-accent transition-colors text-text-secondary"
                      title={sp.prompt}
                    >
                      {t(sp.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            ) : filteredMessages.length === 0 && searchLower ? (
              <div className="text-sm text-text-tertiary text-center py-8">
                {t('aiAssistant.noMessagesMatch').replace('{query}', searchQuery)}
              </div>
            ) : (
              <>
                {filteredMessages.map((msg, idx) => {
                  // Build the retry handler — same logic as the popup.
                  // For user messages: re-send that message.
                  // For assistant final answers: find the last user message
                  // BEFORE this answer and re-send it (isRegenerate=true).
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
                    <MessageBubble
                      key={idx}
                      msg={msg}
                      onRegenerate={retryHandler}
                      t={t}
                    />
                  );
                })}
                {busy && (
                  <div className="flex items-center gap-2 text-xs text-text-tertiary pl-2">
                    <Loader size={12} className="spin" />
                    {t('aiAssistant.thinking')}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Token usage bar — same as popup. */}
          {(tokenUsage.input > 0 || tokenUsage.output > 0) && (
            <div className="flex items-center gap-4 px-4 py-1 border-t border-border-subtle bg-bg-tertiary text-3xs text-text-tertiary flex-shrink-0">
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
                title={t('aiAssistant.stopGeneration')}
                aria-label={t('aiAssistant.stopGeneration')}
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

        {/* ── Vertical ResizableSplitter ────────────────────────────────────
            Drag left → chat shrinks, search grows.
            Drag right → chat grows, search shrinks.
            onResize(delta) updates chatWidth by +delta (because chat is on
            the LEFT of the splitter, per the ResizableSplitter convention). */}
        <ResizableSplitter direction="horizontal" onResize={handleChatResize} />

        {/* Search panel — takes the remaining width (flex-1) */}
        <div className="flex flex-col min-w-0 flex-1 bg-bg-secondary">
          <div className="px-3 py-2 border-b border-border-default flex items-center gap-2 bg-bg-elevated">
            <Search size={12} className="text-text-tertiary flex-shrink-0" />
            <span className="text-xs font-medium text-text-secondary">{t('aiAssistant.chatSearch')}</span>
            <span className="text-3xs text-text-tertiary ml-auto">
              {searchLower
                ? `${matchCount} ${matchCount === 1 ? t('aiAssistant.match') : t('aiAssistant.matches')}`
                : `${messages.length} ${t('aiAssistant.total')}`}
            </span>
          </div>
          <div className="p-2 border-b border-border-subtle">
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('aiAssistant.searchPlaceholder')}
                className="w-full text-xs pl-7 pr-7 py-1.5 bg-bg-primary border border-border-default rounded outline-none focus:border-accent"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 icon-btn !w-4 !h-4 text-text-tertiary hover:text-text-primary"
                  title={t('aiAssistant.clearSearch')}
                  aria-label={t('aiAssistant.clearSearch')}
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
                {t('aiAssistant.searchHintEmpty')}
              </div>
            ) : filteredMessages.length === 0 ? (
              <div className="text-2xs text-text-tertiary text-center py-6">
                {t('aiAssistant.noMatchesFound')}
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
