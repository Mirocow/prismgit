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

/** Get the path to the memory file for a given repo. */
function memoryFilePath(repoPath: string): string {
  return path.join(repoPath, MEMORY_DIR, MEMORY_FILE);
}

/** Load the AI memory for a repo. Returns empty entries if file doesn't exist. */
export function loadAIMemory(repoPath: string): AIMemoryEntry[] {
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

/** Save a new memory entry (or update an existing one by key). */
export function saveAIMemoryEntry(repoPath: string, key: string, value: string, category?: string): void {
  try {
    const dir = path.join(repoPath, MEMORY_DIR);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const entries = loadAIMemory(repoPath);
    // Update existing or add new.
    const idx = entries.findIndex(e => e.key === key);
    const entry: AIMemoryEntry = { key, value, savedAt: new Date().toISOString(), category };
    if (idx >= 0) entries[idx] = entry;
    else entries.push(entry);
    const file: AIMemoryFile = { version: 1, entries };
    fs.writeFileSync(memoryFilePath(repoPath), JSON.stringify(file, null, 2), 'utf8');
  } catch {
    // Silently fail — memory is a nice-to-have, not critical.
  }
}

/** Delete a memory entry by key. */
export function deleteAIMemoryEntry(repoPath: string, key: string): void {
  try {
    const entries = loadAIMemory(repoPath);
    const filtered = entries.filter(e => e.key !== key);
    if (filtered.length === entries.length) return; // nothing deleted
    const file: AIMemoryFile = { version: 1, entries: filtered };
    fs.writeFileSync(memoryFilePath(repoPath), JSON.stringify(file, null, 2), 'utf8');
  } catch {
    // ignore
  }
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
