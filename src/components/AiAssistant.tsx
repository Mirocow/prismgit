import { useState, useRef, useEffect, useCallback } from 'react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastActions } from '../stores/toastStore';
import { useI18n } from '../lib/i18n';
import { Sparkles, X, Send, Loader, Wrench, ArrowRight, User, Bot } from './icons';
import { cn } from '../lib/utils';
import { runWithTools, type ChatMessage } from '../lib/aiChat';
import { type LLMProvider } from '../lib/aiCommitMessages';

/**
 * LAR-3 — AI Assistant chat panel.
 *
 * Floating dockable panel (bottom-right). Toggle via the AI toolbar
 * button (Sparkles icon). The chat:
 *   - Maintains conversation history in local state.
 *   - Calls runWithTools() which loops: LLM → tool calls → tool
 *     results → LLM → final answer.
 *   - Renders intermediate 'assistant with tool_calls' messages as
 *     "Calling get_status..." transcript entries.
 *   - Renders tool results as monospace blocks.
 *
 * The AI provider comes from settingsStore (same as the commit-message
 * AI). If no provider is configured, shows an empty state pointing the
 * user to Settings → AI Commit Messages.
 *
 * Conversation history is NOT persisted — cleared on unmount. A
 * follow-up could persist to localStorage per-repo.
 */
export function AiAssistant({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const repo = useRepositoryStore(s => s.currentRepo);
  const settings = useSettingsStore(s => s.settings);
  const toast = useToastActions();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

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
    if (!input.trim() || !repo) return;
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
      await runWithTools(userMsg, provider, repo.path, {
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
  }, [input, repo, buildProvider, toast, t]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="fixed bottom-4 right-4 w-96 max-h-[600px] bg-bg-elevated border border-border-default rounded-lg shadow-2xl flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-tertiary rounded-t-lg">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-accent" />
          <span className="text-sm font-medium">{t('aiAssistant.title')}</span>
          {repo && <span className="text-2xs text-text-tertiary truncate max-w-32" title={repo.path}>{repo.name}</span>}
        </div>
        <button className="icon-btn !w-5 !h-5" onClick={onClose} aria-label={t('common.close')}>
          <X size={12} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[200px] max-h-[400px]">
        {messages.length === 0 ? (
          <div className="text-xs text-text-tertiary text-center py-4">
            {t('aiAssistant.emptyHint')}
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
          placeholder={t('aiAssistant.inputPlaceholder')}
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
