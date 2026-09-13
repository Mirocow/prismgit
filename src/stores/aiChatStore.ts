import { create } from 'zustand';
import type { ChatMessage, TokenUsage } from '../lib/aiChat';

/**
 * AI Chat shared state — keeps the floating AiAssistant.tsx popup and the
 * full-page AiChatPage.tsx in sync.
 *
 * Both surfaces used to maintain their own copy of `messages` (loaded from
 * localStorage on mount, written back on change). The bug: when both were
 * open at the same time, edits in one didn't reflect in the other until the
 * user closed and re-opened. Worse, `setMessages` in one would race the
 * other's debounced save — causing the latest message to be lost.
 *
 * Solution: lift messages / busy / tokenUsage / input to a shared store.
 * Both surfaces subscribe to slices via useAiChatStore selectors. Mutations
 * go through store actions, which also persist to localStorage (debounced)
 * and broadcast a 'prismgit-ai-chat-update' CustomEvent so the other surface
 * re-renders immediately even if it's mounted in the same window.
 *
 * The sessionRepoPath is also kept here so both surfaces track the same
 * repo (switching in one switches the other).
 *
 * Cross-tab/window sync (rare: popup and page open in different windows):
 * the 'storage' event fires when localStorage is mutated by another window.
 * We listen for it and reload from the new key.
 */

const STORAGE_KEY_PREFIX = 'prismgit-ai-chat-';
const NO_REPO_KEY = '__no_repo__';
const DEFAULT_HISTORY_LIMIT = 100;
const SAVE_DEBOUNCE_MS = 500;
const UPDATE_EVENT = 'prismgit-ai-chat-update';

function storageKeyFor(sessionRepoPath: string | null | undefined): string {
  return STORAGE_KEY_PREFIX + (sessionRepoPath ?? NO_REPO_KEY);
}

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

function saveChatHistory(sessionRepoPath: string | null | undefined, messages: ChatMessage[], limit: number): void {
  try {
    const trimmed = messages.length > limit ? messages.slice(-limit) : messages;
    localStorage.setItem(storageKeyFor(sessionRepoPath), JSON.stringify(trimmed));
    // Broadcast a same-window update event so any other mounted AiAssistant
    // or AiChatPage subscriber re-reads its slices. (The native 'storage'
    // event only fires in OTHER windows — not the one that wrote.)
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: { sessionRepoPath } }));
  } catch {
    // localStorage might be full — silently ignore
  }
}

function clearChatHistory(sessionRepoPath: string | null | undefined): void {
  try {
    localStorage.removeItem(storageKeyFor(sessionRepoPath));
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: { sessionRepoPath } }));
  } catch {
    // ignore
  }
}

export interface AiChatState {
  /** Session repo path — null = no-repo mode, undefined = not yet initialized. */
  sessionRepoPath: string | null | undefined;
  messages: ChatMessage[];
  input: string;
  busy: boolean;
  tokenUsage: { input: number; output: number; contextSize: number };

  /** Set the active session repo path (and load its persisted history). */
  setSessionRepoPath: (path: string | null) => void;
  /** Append a message (user, assistant, tool, or tool-result). */
  appendMessage: (msg: ChatMessage) => void;
  /** Replace the entire message list (used by clear / regenerate). */
  setMessages: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  /** Set the input box text. */
  setInput: (input: string) => void;
  /** Mark a chat request as in-flight (true) or done (false). */
  setBusy: (busy: boolean) => void;
  /** Update token usage bar. */
  setTokenUsage: (usage: { input: number; output: number; contextSize: number }) => void;
  /** Clear all messages + persisted history for the current session. */
  clearMessages: () => void;
  /** Reload messages from localStorage (used by the cross-window sync listener). */
  reloadFromStorage: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useAiChatStore = create<AiChatState>((set, get) => ({
  sessionRepoPath: undefined,
  messages: [],
  input: '',
  busy: false,
  tokenUsage: { input: 0, output: 0, contextSize: 0 },

  setSessionRepoPath: (path) => {
    set({ sessionRepoPath: path, messages: loadChatHistory(path), tokenUsage: { input: 0, output: 0, contextSize: 0 } });
  },

  appendMessage: (msg) => {
    set((state) => ({ messages: [...state.messages, msg] }));
    // Debounced save — the most recent call wins.
    scheduleSave(get);
  },

  setMessages: (updater) => {
    set((state) => ({
      messages: typeof updater === 'function' ? (updater as (p: ChatMessage[]) => ChatMessage[])(state.messages) : updater,
    }));
    scheduleSave(get);
  },

  setInput: (input) => set({ input }),
  setBusy: (busy) => set({ busy }),
  setTokenUsage: (usage) => set({ tokenUsage: usage }),

  clearMessages: () => {
    const { sessionRepoPath } = get();
    clearChatHistory(sessionRepoPath);
    set({ messages: [], tokenUsage: { input: 0, output: 0, contextSize: 0 } });
  },

  reloadFromStorage: () => {
    const { sessionRepoPath } = get();
    set({ messages: loadChatHistory(sessionRepoPath) });
  },
}));

function scheduleSave(get: () => AiChatState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { sessionRepoPath, messages } = get();
    // historyLimit comes from settings — we read it lazily here to avoid
    // an import cycle with settingsStore.
    let limit = DEFAULT_HISTORY_LIMIT;
    try {
      const rawSettings = localStorage.getItem('prismgit-settings');
      if (rawSettings) {
        const parsed = JSON.parse(rawSettings);
        if (parsed && typeof parsed.aiChatHistoryLimit === 'number') {
          limit = parsed.aiChatHistoryLimit;
        }
      }
    } catch {
      // ignore
    }
    saveChatHistory(sessionRepoPath, messages, limit);
  }, SAVE_DEBOUNCE_MS);
}

// ── Cross-window sync ─────────────────────────────────────────────────────
// Listen for 'storage' events (fires when ANOTHER window mutates localStorage
// — same as opening the popup and the page in two windows of the same app).
// Reload from the new key so both surfaces stay in sync.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith(STORAGE_KEY_PREFIX)) {
      // Only reload if the changed key matches the current session.
      const { sessionRepoPath } = useAiChatStore.getState();
      if (e.key === storageKeyFor(sessionRepoPath)) {
        useAiChatStore.getState().reloadFromStorage();
      }
    }
  });
  // Same-window custom event — fired by saveChatHistory() after a write so
  // any other mounted subscriber in the same window picks up the change.
  // (Both AiAssistant popup and AiChatPage mount in the same window when
  // both are open simultaneously — this is the common case.)
  window.addEventListener(UPDATE_EVENT, () => {
    // No-op: subscribers using useAiChatStore selectors re-render automatically
    // because set() was called. This listener exists only to allow future
    // extensions (e.g. external code that wants to be notified).
  });
}

// Export the helpers so the AiAssistant.tsx "Export chat log as Markdown"
// feature can reuse them without duplicating logic.
export { storageKeyFor, loadChatHistory, saveChatHistory, clearChatHistory };
export type { ChatMessage, TokenUsage };
