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
  // PR detail — fetches single PR with full body + stats (additions/deletions/
  // changed_files/mergeable/draft/labels). Used by the PR detail view.
  ipcMain.handle('github:getPullRequest', (_e, owner: string, repo: string, prNumber: number) =>
    github.getPullRequest(owner, repo, prNumber)
  );
  ipcMain.handle('github:listPRFiles', (_e, owner: string, repo: string, prNumber: number) =>
    github.listPRFiles(owner, repo, prNumber)
  );
  ipcMain.handle('github:listPRIssueComments', (_e, owner: string, repo: string, prNumber: number) =>
    github.listPRIssueComments(owner, repo, prNumber)
  );
  ipcMain.handle('github:getCheckRuns', (_e, owner: string, repo: string, shas: string[]) =>
    github.getCheckRuns(owner, repo, shas)
  );
  ipcMain.handle('github:logout', () => github.logout());
  ipcMain.handle('github:getAuthState', () => github.getStoredAuthState());

  // === SmartGit Manual: PR management — comment, approve, merge, close ===
  ipcMain.handle('github:addPRLineComment', (_e, owner: string, repo: string, prNumber: number, data: any) =>
    github.addPRLineComment(owner, repo, prNumber, data)
  );
  ipcMain.handle('github:addPRComment', (_e, owner: string, repo: string, prNumber: number, body: string) =>
    github.addPRComment(owner, repo, prNumber, body)
  );
  ipcMain.handle('github:submitPRReview', (_e, owner: string, repo: string, prNumber: number, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body?: string) =>
    github.submitPRReview(owner, repo, prNumber, event, body)
  );
  ipcMain.handle('github:mergePR', (_e, owner: string, repo: string, prNumber: number, options?: any) =>
    github.mergePR(owner, repo, prNumber, options)
  );
  ipcMain.handle('github:closePR', (_e, owner: string, repo: string, prNumber: number) =>
    github.closePR(owner, repo, prNumber)
  );
  ipcMain.handle('github:reopenPR', (_e, owner: string, repo: string, prNumber: number) =>
    github.reopenPR(owner, repo, prNumber)
  );
  ipcMain.handle('github:listPRComments', (_e, owner: string, repo: string, prNumber: number) =>
    github.listPRComments(owner, repo, prNumber)
  );
}
