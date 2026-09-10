import { ipcMain } from 'electron';
import * as ai from '../services/ai.js';
import type { AiProviderConfig } from '../services/ai.js';

export function registerAiIpc(): void {
  ipcMain.handle(
    'ai:generateCommitMessage',
    (_e, cfg: AiProviderConfig, diff: string, hint?: string) =>
      ai.generateCommitMessage(cfg, diff, hint)
  );
}
