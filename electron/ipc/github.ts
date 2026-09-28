import { ipcMain } from 'electron';
import * as github from '../services/github.js';

export function registerGithubIpc(): void {
  ipcMain.handle('github:authWithPAT', (_e, token: string) => github.authWithPAT(token));
  ipcMain.handle('github:authWithOAuth', () => github.authWithOAuth());
  ipcMain.handle('github:getCurrentUser', () => github.getCurrentUser());
  // github:getRepositories — catch 401 "Bad credentials" silently.
  // When the user's GitHub PAT expires, this handler fires on every
  // CloneModal open (loadRepos). The renderer catches the rejection
  // and shows nothing, but ipcMain.handle ALSO logs the error to the
  // main-process console — which spams 6+ lines per modal open.
  // Returning an empty array on 401 suppresses the console spam while
  // keeping the renderer's existing empty-result handling intact.
  ipcMain.handle('github:getRepositories', async (_e, page?: number) => {
    try {
      return await github.getRepositories(page || 1);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('401') || msg.includes('Bad credentials')) {
        return [];
      }
      throw e;
    }
  });
  ipcMain.handle('github:getOrgRepositories', async (_e, org: string, page?: number) => {
    try {
      return await github.getOrgRepositories(org, page || 1);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('401') || msg.includes('Bad credentials')) {
        return [];
      }
      throw e;
    }
  });
  ipcMain.handle(
    'github:createPullRequest',
    (_e, owner: string, repo: string, data: { title: string; head: string; base: string; body?: string }) =>
      github.createPullRequest(owner, repo, data)
  );
  // listPullRequests — convert a 401 "Bad credentials" rejection into a
  // typed 'Not authenticated' rejection. The renderer treats it as an auth
  // problem (shows the sign-in gate, no error toasts), and the main console
  // stays readable instead of dumping GitHub's raw JSON error per call.
  ipcMain.handle('github:listPullRequests', async (_e, owner: string, repo: string, state?: 'open' | 'closed' | 'all') => {
    try {
      return await github.listPullRequests(owner, repo, state);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('401') || msg.includes('Bad credentials')) {
        throw new Error('Not authenticated: GitHub rejected the saved token (401)');
      }
      throw e;
    }
  });
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
  ipcMain.handle('github:listPRCommits', (_e, owner: string, repo: string, prNumber: number) =>
    github.listPRCommits(owner, repo, prNumber)
  );
  ipcMain.handle('github:getCommitFiles', (_e, owner: string, repo: string, commitSha: string) =>
    github.getCommitFiles(owner, repo, commitSha)
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
