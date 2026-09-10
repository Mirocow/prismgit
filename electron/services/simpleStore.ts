/**
 * Simple JSON file-based storage — replacement for electron-store
 * Works in CommonJS context (Electron main process) without ESM issues.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

interface StoreData {
  [key: string]: unknown;
}

export class SimpleStore {
  private filePath: string;
  private data: StoreData;
  private writeTimer: NodeJS.Timeout | null = null;
  private hadLoadedData: boolean = false;

  constructor(options: { name: string; defaults?: StoreData } = { name: 'config' }) {
    // Get userData directory.
    //
    // Priority:
    //   1. PRISMGIT_USER_DATA env var — used by E2E tests to isolate state
    //      per test run (so test fixtures don't pollute real user data).
    //   2. Electron's app.getPath('userData') — the standard location,
    //      platform-dependent (e.g. ~/.config/PrismGit on Linux).
    //   3. process.env.HOME / /tmp — fallback for non-Electron contexts
    //      (some unit tests import this module without a running Electron).
    const overridePath = process.env.PRISMGIT_USER_DATA;
    const userDataPath = overridePath
      ? overridePath
      : app
        ? app.getPath('userData')
        : process.env.HOME || '/tmp';
    this.filePath = path.join(userDataPath, `${options.name}.json`);
    this.data = { ...(options.defaults || {}) };
    this.load();
    // One-time migration: if the new file doesn't exist but a legacy
    // `smartgit-*` version does, copy it over so users don't lose data.
    this.migrateLegacyName(options.name, userDataPath, options.defaults || {});
  }

  /**
   * Migrate legacy `smartgit-*` store files to the new `prismgit-*` name.
   * Only runs if the new file doesn't exist yet (first launch after rename).
   * Once migrated, the old file is left in place (not deleted) as a backup.
   */
  private migrateLegacyName(newName: string, userDataPath: string, defaults: StoreData): void {
    // Only migrate files that follow the `prismgit-*` naming pattern
    // (previously `smartgit-*`).
    if (!newName.startsWith('prismgit-')) return;
    // If the new file already exists and has data, don't migrate.
    if (this.hadLoadedData) return;
    const legacyName = 'smartgit-' + newName.substring('prismgit-'.length);
    const legacyPath = path.join(userDataPath, `${legacyName}.json`);
    try {
      if (fs.existsSync(legacyPath)) {
        const content = fs.readFileSync(legacyPath, 'utf8');
        const parsed = JSON.parse(content);
        this.data = { ...defaults, ...parsed };
        this.scheduleWrite();
      }
    } catch {
      // Ignore migration errors — keep defaults
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(content);
        // Merge: existing data (defaults) + loaded data
        this.data = { ...this.data, ...parsed };
        // Mark that we found existing data (prevents legacy migration
        // from overwriting a file that already exists).
        this.hadLoadedData = Object.keys(parsed).length > 0;
      }
    } catch {
      // If file is corrupted, keep defaults
    }
  }

  private scheduleWrite(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }
    // Debounce writes to avoid excessive I/O
    this.writeTimer = setTimeout(() => {
      this.writeNow();
      this.writeTimer = null;
    }, 100);
  }

  private writeNow(): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Write atomically: write to temp file, then rename
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.filePath);
    } catch {
      // Ignore write errors (e.g., disk full)
    }
  }

  get<T = unknown>(key: string): T | undefined {
    return this.data[key] as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.data[key] = value;
    this.scheduleWrite();
  }

  delete(key: string): void {
    delete this.data[key];
    this.scheduleWrite();
  }

  clear(): void {
    this.data = {};
    this.scheduleWrite();
  }

  has(key: string): boolean {
    return key in this.data;
  }

  get all(): StoreData {
    return { ...this.data };
  }

  // Flush any pending writes (call on app quit)
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.writeNow();
  }
}
