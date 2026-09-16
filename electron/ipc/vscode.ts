/**
 * IPC surface for the VSCode integration (see services/vscode.ts).
 */
import { ipcMain } from 'electron';
import simpleGit from 'simple-git';
import { GIT_UNSAFE_OPTIONS } from '../services/git-env.js';
import {
  detectVsCodeCached,
  openInVsCode,
  openFileDiffVsHead,
  openMergeInVsCode,
  openFileVersionInVsCode,
  openCommitFileDiffInVsCode,
  openCommitPatchInVsCode,
  openWorkspaceInVsCode,
  getDiffToolStatus,
  installVsCodeDiffMergeTool,
  removeVsCodeDiffMergeTool,
} from '../services/vscode.js';

/** Create a SimpleGit instance with the correct unsafe options. */
function sg(repoPath: string) {
  return simpleGit({ baseDir: repoPath, ...GIT_UNSAFE_OPTIONS });
}

export function registerVscodeIpc(): void {
  ipcMain.handle('vscode:detect', (_e, force?: boolean) => detectVsCodeCached(!!force));

  ipcMain.handle('vscode:open', (_e, repoPath: string, target?: { file?: string; line?: number }) =>
    openInVsCode(repoPath, target));

  ipcMain.handle('vscode:openFileDiff', (_e, repoPath: string, file: string) =>
    openFileDiffVsHead(sg(repoPath), repoPath, file));

  ipcMain.handle('vscode:openMerge', (_e, repoPath: string, file: string) =>
    openMergeInVsCode(sg(repoPath), repoPath, file));

  ipcMain.handle('vscode:openFileVersion', (_e, repoPath: string, sha: string, file: string) =>
    openFileVersionInVsCode(sg(repoPath), repoPath, sha, file));

  ipcMain.handle('vscode:openCommitFileDiff', (_e, repoPath: string, sha: string, file: string) =>
    openCommitFileDiffInVsCode(sg(repoPath), repoPath, sha, file));

  ipcMain.handle('vscode:openCommitPatch', (_e, repoPath: string, sha: string) =>
    openCommitPatchInVsCode(sg(repoPath), repoPath, sha));

  ipcMain.handle('vscode:openWorkspace', (_e, name: string, folderPaths: string[]) =>
    openWorkspaceInVsCode(name, folderPaths));

  ipcMain.handle('vscode:diffToolStatus', (_e, repoPath: string) => getDiffToolStatus(repoPath));

  ipcMain.handle('vscode:installDiffTool', (_e, repoPath: string) =>
    installVsCodeDiffMergeTool(repoPath));

  ipcMain.handle('vscode:removeDiffTool', (_e, repoPath: string) =>
    removeVsCodeDiffMergeTool(repoPath));
}
