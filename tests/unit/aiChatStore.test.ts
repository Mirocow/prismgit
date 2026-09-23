/**
 * aiChatStore — shared AI-chat state contract.
 *
 * Covers the documented invariants:
 *  1. Per-repo history isolation — each sessionRepoPath gets its own
 *     localStorage key; switching repos swaps the loaded history.
 *  2. appendMessage / setMessages persist via the 500ms debounced save.
 *  3. The configured aiChatHistoryLimit (settingsStore) TRIMS history on
 *     save — the old code read a non-existent localStorage key and the
 *     limit was silently ignored (bug Б2 in docs/implementation-plan).
 *  4. clearMessages wipes storage for the CURRENT repo only.
 *  5. reloadFromStorage picks up cross-window 'storage' writes.
 *  6. flushChatHistory flushes a pending debounced save immediately.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useAiChatStore, flushChatHistory, storageKeyFor } from '../../src/stores/aiChatStore';
import { useSettingsStore } from '../../src/stores/settingsStore';
import type { ChatMessage } from '../../src/lib/aiChat';

const msg = (role: 'user' | 'assistant', content: string): ChatMessage =>
  ({ role, content, ts: Date.now() } as ChatMessage);

describe('aiChatStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    // Fresh store state per test (zustand setState merges).
    useAiChatStore.setState({
      sessionRepoPath: undefined,
      messages: [],
      input: '',
      busy: false,
      tokenUsage: { input: 0, output: 0, contextSize: 0 },
    });
    useSettingsStore.setState({ settings: {} });
  });

  it('storageKeyFor isolates sessions per repo path', () => {
    expect(storageKeyFor('/repo/a')).toBe('prismgit-ai-chat-/repo/a');
    expect(storageKeyFor('/repo/b')).toBe('prismgit-ai-chat-/repo/b');
    expect(storageKeyFor(null)).toBe('prismgit-ai-chat-__no_repo__');
    expect(storageKeyFor(undefined)).toBe('prismgit-ai-chat-__no_repo__');
  });

  it('setSessionRepoPath loads the persisted history for THAT repo', () => {
    const a = [msg('user', 'hello A')];
    localStorage.setItem(storageKeyFor('/repo/a'), JSON.stringify(a));
    localStorage.setItem(storageKeyFor('/repo/b'), JSON.stringify([msg('user', 'hello B')]));

    useAiChatStore.getState().setSessionRepoPath('/repo/a');
    expect(useAiChatStore.getState().messages).toHaveLength(1);
    expect(useAiChatStore.getState().messages[0].content).toBe('hello A');

    useAiChatStore.getState().setSessionRepoPath('/repo/b');
    expect(useAiChatStore.getState().messages[0].content).toBe('hello B');

    // No repo session — reads the __no_repo__ key (empty here).
    useAiChatStore.getState().setSessionRepoPath(null);
    expect(useAiChatStore.getState().messages).toHaveLength(0);
  });

  it('corrupt persisted JSON degrades to an empty history, not a crash', () => {
    localStorage.setItem(storageKeyFor('/repo/bad'), '{not json');
    useAiChatStore.getState().setSessionRepoPath('/repo/bad');
    expect(useAiChatStore.getState().messages).toEqual([]);
  });

  it('appendMessage persists after the 500ms debounce', () => {
    vi.useFakeTimers();
    useAiChatStore.getState().setSessionRepoPath('/repo/a');
    useAiChatStore.getState().appendMessage(msg('user', 'q1'));
    useAiChatStore.getState().appendMessage(msg('assistant', 'a1'));

    // Not yet — debounce still pending.
    expect(localStorage.getItem(storageKeyFor('/repo/a'))).toBeNull();

    vi.advanceTimersByTime(600);
    const saved = JSON.parse(localStorage.getItem(storageKeyFor('/repo/a'))!);
    expect(saved).toHaveLength(2);
    expect(saved[1].content).toBe('a1');
    vi.useRealTimers();
  });

  it('aiChatHistoryLimit TRIMS the persisted history to the last N messages', () => {
    vi.useFakeTimers();
    useSettingsStore.setState({ settings: { aiChatHistoryLimit: 3 } });
    useAiChatStore.getState().setSessionRepoPath('/repo/a');

    for (let i = 1; i <= 5; i++) {
      useAiChatStore.getState().appendMessage(msg('user', `m${i}`));
    }
    vi.advanceTimersByTime(600);

    const saved: ChatMessage[] = JSON.parse(localStorage.getItem(storageKeyFor('/repo/a'))!);
    // Only the LAST 3 survive the configured limit.
    expect(saved).toHaveLength(3);
    expect(saved.map((m) => m.content)).toEqual(['m3', 'm4', 'm5']);
    // The in-memory list is NOT trimmed (the UI keeps the session context).
    expect(useAiChatStore.getState().messages).toHaveLength(5);
    vi.useRealTimers();
  });

  it('clearMessages wipes the current session only', () => {
    localStorage.setItem(storageKeyFor('/repo/a'), JSON.stringify([msg('user', 'a')]));
    localStorage.setItem(storageKeyFor('/repo/b'), JSON.stringify([msg('user', 'b')]));

    useAiChatStore.getState().setSessionRepoPath('/repo/a');
    useAiChatStore.getState().appendMessage(msg('user', 'more'));
    useAiChatStore.getState().clearMessages();

    expect(localStorage.getItem(storageKeyFor('/repo/a'))).toBeNull();
    expect(useAiChatStore.getState().messages).toEqual([]);
    // The other repo's history is untouched.
    expect(JSON.parse(localStorage.getItem(storageKeyFor('/repo/b'))!)).toHaveLength(1);
  });

  it('reloadFromStorage re-reads the key (cross-window sync path)', () => {
    useAiChatStore.getState().setSessionRepoPath('/repo/a');
    // Another window writes the shared key.
    const external = [msg('assistant', 'from window 2')];
    localStorage.setItem(storageKeyFor('/repo/a'), JSON.stringify(external));

    useAiChatStore.getState().reloadFromStorage();
    expect(useAiChatStore.getState().messages).toEqual(external);
  });

  it('flushChatHistory saves a pending debounce immediately', () => {
    vi.useFakeTimers();
    useAiChatStore.getState().setSessionRepoPath('/repo/a');
    useAiChatStore.getState().appendMessage(msg('user', 'last words'));

    // App quits BEFORE the debounce fires — flush must persist anyway.
    flushChatHistory();
    const saved: ChatMessage[] = JSON.parse(localStorage.getItem(storageKeyFor('/repo/a'))!);
    expect(saved).toHaveLength(1);
    expect(saved[0].content).toBe('last words');
    vi.useRealTimers();
  });

  it('setMessages accepts an updater function over the previous list', () => {
    useAiChatStore.getState().setSessionRepoPath('/repo/a');
    useAiChatStore.getState().setMessages([msg('user', 'one')]);
    useAiChatStore.getState().setMessages((prev) => [...prev, msg('assistant', 'two')]);
    expect(useAiChatStore.getState().messages.map((m) => m.content)).toEqual(['one', 'two']);
  });
});
