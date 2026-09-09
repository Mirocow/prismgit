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

  constructor(options: { name: string; defaults?: StoreData } = { name: 'config' }) {
    // Get userData directory (Electron provides this)
    const userDataPath = app ? app.getPath('userData') : process.env.HOME || '/tmp';
    this.filePath = path.join(userDataPath, `${options.name}.json`);
    this.data = { ...(options.defaults || {}) };
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(content);
        // Merge: existing data (defaults) + loaded data
        this.data = { ...this.data, ...parsed };
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
