import { ipcMain } from 'electron';
import * as github from '../services/github.js';

export function registerGithubIpc(): void {
  ipcMain.handle('github:authWithPAT', (_e, token: string) => github.authWithPAT(token));
  ipcMain.handle('github:authWithOAuth', () => github.authWithOAuth());
  ipcMain.handle('github:getCurrentUser', () => github.getCurrentUser());
  ipcMain.handle('github:getRepositories', (_e, page?: number) =>
    github.getRepositories(page || 1)
  );
  ipcMain.handle('github:getOrgRepositories', (_e, org: string, page?: number) =>
    github.getOrgRepositories(org, page || 1)
  );
  ipcMain.handle(
    'github:createPullRequest',
    (_e, owner: string, repo: string, data: { title: string; head: string; base: string; body?: string }) =>
      github.createPullRequest(owner, repo, data)
  );
  ipcMain.handle('github:listPullRequests', (_e, owner: string, repo: string, state?: 'open' | 'closed' | 'all') =>
    github.listPullRequests(owner, repo, state)
  );
  ipcMain.handle('github:getCheckRuns', (_e, owner: string, repo: string, shas: string[]) =>
    github.getCheckRuns(owner, repo, shas)
  );
  ipcMain.handle('github:logout', () => github.logout());
  ipcMain.handle('github:getAuthState', () => github.getStoredAuthState());
}
