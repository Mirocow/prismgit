/**
 * IPC surface for the VSCode integration (see services/vscode.ts).
 */
import { ipcMain } from 'electron';
import simpleGit from 'simple-git';
import {
  detectVsCodeCached,
  openInVsCode,
  openFileDiffVsHead,
  openMergeInVsCode,
  getDiffToolStatus,
  installVsCodeDiffMergeTool,
  removeVsCodeDiffMergeTool,
} from '../services/vscode.js';

export function registerVscodeIpc(): void {
  ipcMain.handle('vscode:detect', (_e, force?: boolean) => detectVsCodeCached(!!force));

  ipcMain.handle('vscode:open', (_e, repoPath: string, target?: { file?: string; line?: number }) =>
    openInVsCode(repoPath, target));

  ipcMain.handle('vscode:openFileDiff', (_e, repoPath: string, file: string) =>
    openFileDiffVsHead(simpleGit(repoPath), repoPath, file));

  ipcMain.handle('vscode:openMerge', (_e, repoPath: string, file: string) =>
    openMergeInVsCode(simpleGit(repoPath), repoPath, file));

  ipcMain.handle('vscode:diffToolStatus', (_e, repoPath: string) => getDiffToolStatus(repoPath));

  ipcMain.handle('vscode:installDiffTool', (_e, repoPath: string) =>
    installVsCodeDiffMergeTool(repoPath));

  ipcMain.handle('vscode:removeDiffTool', (_e, repoPath: string) =>
    removeVsCodeDiffMergeTool(repoPath));
}
