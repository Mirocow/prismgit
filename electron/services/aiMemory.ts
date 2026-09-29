/**
 * Persistent AI memory — stores facts about a project between chat sessions.
 *
 * The AI Assistant reads this file on startup and injects known facts into
 * the system prompt, so it "remembers" things like:
 *   - "this project uses conventional commits"
 *   - "main branch is 'main' not 'master'"
 *   - "tests use vitest, run with: npm test"
 *   - "don't commit the dist/ folder"
 *
 * The memory is stored in `.prismgit/ai-memory.json` inside the repo.
 * This is NOT committed to git (add `.prismgit/` to .gitignore) — it's
 * the user's personal AI assistant memory, not project config.
 *
 * The AI can also UPDATE the memory during a conversation via the
 * `save_memory` tool — e.g. "remember that this project uses trunk-based
 * development" → the AI calls save_memory with key="branching_strategy"
 * value="trunk-based".
 */

import * as fs from 'fs';
import * as path from 'path';

export interface AIMemoryEntry {
  /** Key — short identifier, e.g. "branching_strategy", "commit_convention". */
  key: string;
  /** Value — the fact itself, e.g. "conventional commits with feat/fix/docs prefixes". */
  value: string;
  /** When this was saved (ISO timestamp). */
  savedAt: string;
  /** Optional category for grouping in the UI. */
  category?: string;
}

export interface AIMemoryFile {
  /** Schema version — bump if the format changes. */
  version: 1;
  /** The memory entries. */
  entries: AIMemoryEntry[];
}

const MEMORY_DIR = '.prismgit';
const MEMORY_FILE = 'ai-memory.json';
const SAVE_DEBOUNCE_MS = 500;

/** Get the path to the memory file for a given repo. */
function memoryFilePath(repoPath: string): string {
  return path.join(repoPath, MEMORY_DIR, MEMORY_FILE);
}

// PERFORMANCE (ST-IO6): the previous implementation called 4 synchronous fs
// operations per `saveAIMemoryEntry` — existsSync + mkdirSync + readFileSync
// + writeFileSync — blocking the Electron main-process event loop for ~10 ms
// on each save. The AI assistant calls save_memory multiple times per
// conversation (often 3-5× in quick succession when the model decides to
// persist several facts). Now saveAIMemoryEntry / deleteAIMemoryEntry:
//   1) Use async `fs.promises.*` (no main-loop blocking).
//   2) Debounce writes 500 ms — multiple saves within 500 ms coalesce into a
//      single disk write. The in-memory `pendingEntries` Map is the source
//      of truth between flushes so reads stay consistent.
const pendingEntries = new Map<string, AIMemoryEntry[]>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Load the AI memory for a repo. Returns empty entries if file doesn't exist.
 *
 * If there are pending (un-flushed) writes for this repo, returns the
 * pending list so reads stay consistent with the most recent writes. */
export function loadAIMemory(repoPath: string): AIMemoryEntry[] {
  // Pending writes take precedence — they are more recent than the file.
  const pending = pendingEntries.get(repoPath);
  if (pending) return pending.slice();
  try {
    const filePath = memoryFilePath(repoPath);
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as AIMemoryFile;
    if (parsed && Array.isArray(parsed.entries)) return parsed.entries;
    return [];
  } catch {
    return [];
  }
}

function scheduleFlush(repoPath: string): void {
  if (saveTimers.has(repoPath)) return;
  const t = setTimeout(async () => {
    saveTimers.delete(repoPath);
    const entries = pendingEntries.get(repoPath);
    if (!entries) return;
    pendingEntries.delete(repoPath);
    try {
      const dir = path.join(repoPath, MEMORY_DIR);
      await fs.promises.mkdir(dir, { recursive: true });
      const file: AIMemoryFile = { version: 1, entries };
      await fs.promises.writeFile(
        memoryFilePath(repoPath),
        JSON.stringify(file, null, 2),
        'utf8'
      );
    } catch {
      // Silently fail — memory is a nice-to-have, not critical. Restore
      // the pending entries so the next save attempt includes them.
      const next = pendingEntries.get(repoPath);
      pendingEntries.set(repoPath, next ? [...entries, ...next] : entries);
    }
  }, SAVE_DEBOUNCE_MS);
  saveTimers.set(repoPath, t);
}

/** Save a new memory entry (or update an existing one by key).
 *
 * Returns immediately — the actual disk write is debounced 500 ms later. */
export function saveAIMemoryEntry(repoPath: string, key: string, value: string, category?: string): void {
  const entries = pendingEntries.get(repoPath) ?? loadAIMemory(repoPath);
  // Update existing or add new (operate on a copy so we don't mutate the
  // pending array in place — loadAIMemory callers expect a snapshot).
  const next = entries.slice();
  const idx = next.findIndex(e => e.key === key);
  const entry: AIMemoryEntry = { key, value, savedAt: new Date().toISOString(), category };
  if (idx >= 0) next[idx] = entry;
  else next.push(entry);
  pendingEntries.set(repoPath, next);
  scheduleFlush(repoPath);
}

/** Delete a memory entry by key. */
export function deleteAIMemoryEntry(repoPath: string, key: string): void {
  const entries = pendingEntries.get(repoPath) ?? loadAIMemory(repoPath);
  const filtered = entries.filter(e => e.key !== key);
  if (filtered.length === entries.length) return; // nothing deleted
  pendingEntries.set(repoPath, filtered);
  scheduleFlush(repoPath);
}

/** Build a text summary of the memory entries for injection into the system prompt. */
export function buildMemorySummary(entries: AIMemoryEntry[]): string {
  if (entries.length === 0) return '';
  const lines: string[] = ['Project memory (facts the user told you to remember):'];
  for (const e of entries) {
    lines.push(`  - ${e.key}: ${e.value}`);
  }
  return lines.join('\n');
}
