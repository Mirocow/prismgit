/**
 * GitLab IPC handlers — mirrors the github.ts IPC shape so the renderer
 * can talk to GitLab (cloud + self-hosted) with the same calling convention
 * as GitHub. Used by the Pull Requests page (GitLab MRs), the Reviews page,
 * and the Clone dialog (GitLab projects list).
 */
import { ipcMain } from 'electron';
import * as gitlab from '../services/gitlab.js';

export function registerGitlabIpc(): void {
  // === Auth ===
  ipcMain.handle('gitlab:authWithPAT', (_e, token: string, baseUrl?: string) =>
    gitlab.authWithPAT(token, baseUrl)
  );
  ipcMain.handle('gitlab:logout', () => gitlab.logout());
  ipcMain.handle('gitlab:getAuthState', () => gitlab.getAuthStatePublic());

  // === Projects (clone source list) ===
  ipcMain.handle('gitlab:listProjects', (_e, page?: number, perPage?: number) =>
    gitlab.listProjects(page || 1, perPage || 50)
  );
  ipcMain.handle('gitlab:getProjectByPath', (_e, pathWithNamespace: string) =>
    gitlab.getProjectByPath(pathWithNamespace)
  );

  // === Merge requests (GitLab equivalent of pull requests) ===
  ipcMain.handle('gitlab:listMergeRequests', (_e, projectId: number, state?: 'opened' | 'closed' | 'merged' | 'all') =>
    gitlab.listMergeRequests(projectId, state || 'opened')
  );
  // MR detail — used by the PR review surface (Reviews page).
  ipcMain.handle('gitlab:getMergeRequest', (_e, projectId: number, mrIid: number) =>
    gitlab.getMergeRequest(projectId, mrIid)
  );
  ipcMain.handle('gitlab:listMRChanges', (_e, projectId: number, mrIid: number) =>
    gitlab.listMRChanges(projectId, mrIid)
  );
  ipcMain.handle('gitlab:listMRNotes', (_e, projectId: number, mrIid: number) =>
    gitlab.listMRNotes(projectId, mrIid)
  );
  ipcMain.handle('gitlab:listMRCommits', (_e, projectId: number, mrIid: number) =>
    gitlab.listMRCommits(projectId, mrIid)
  );
  ipcMain.handle(
    'gitlab:createMergeRequest',
    (_e, projectId: number, data: { title: string; source_branch: string; target_branch: string; description?: string }) =>
      gitlab.createMergeRequest(projectId, data)
  );

  // === MR actions (approve, merge, comment) ===
  ipcMain.handle('gitlab:approveMergeRequest', (_e, projectId: number, mrIid: number) =>
    gitlab.approveMergeRequest(projectId, mrIid)
  );
  ipcMain.handle(
    'gitlab:mergeMergeRequest',
    (_e, projectId: number, mrIid: number, options?: { squash?: boolean; should_remove_source_branch?: boolean }) =>
      gitlab.mergeMergeRequest(projectId, mrIid, options || {})
  );
  ipcMain.handle('gitlab:addMRComment', (_e, projectId: number, mrIid: number, body: string) =>
    gitlab.addMRComment(projectId, mrIid, body)
  );

  // === Pipelines (GitLab CI) ===
  ipcMain.handle('gitlab:listPipelines', (_e, projectId: number, sha?: string) =>
    gitlab.listPipelines(projectId, sha)
  );
}
