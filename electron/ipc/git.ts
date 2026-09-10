import { ipcMain, shell } from 'electron';
import * as path from 'path';
import * as gitService from '../services/git.js';

export function registerGitIpc(): void {
  // Status & working tree
  ipcMain.handle('git:status', (_e, p: string) => gitService.status(p));
  ipcMain.handle('git:listDirectories', (_e, p: string, d?: number) => gitService.listDirectories(p, d));
  ipcMain.handle('git:add', (_e, p: string, f: string[]) => gitService.add(p, f));
  ipcMain.handle('git:addAll', (_e, p: string) => gitService.addAll(p));
  ipcMain.handle('git:restore', (_e, p: string, f: string[], staged?: boolean) => gitService.restore(p, f, staged));
  ipcMain.handle('git:commit', (_e, p: string, m: string, a?: boolean, so?: boolean, nv?: boolean) =>
    gitService.commit(p, m, a, so, nv)
  );
  ipcMain.handle('git:clean', (_e, p: string, paths: string[], dryRun?: boolean, force?: boolean, dirs?: boolean) =>
    gitService.clean(p, paths, dryRun, force, dirs)
  );

  // Network
  ipcMain.handle('git:push', (_e, p: string, r?: string, b?: string, u?: boolean, f?: boolean, t?: boolean) =>
    gitService.push(p, r, b, u, f, t)
  );
  ipcMain.handle('git:pull', (_e, p: string, r?: string, b?: string, rb?: boolean, nff?: boolean) =>
    gitService.pull(p, r, b, rb, nff)
  );
  ipcMain.handle('git:fetch', (_e, p: string, r?: string, pr?: boolean, t?: boolean) =>
    gitService.fetch(p, r, pr, t)
  );
  ipcMain.handle('git:fetchAll', (_e, p: string, pr?: boolean) => gitService.fetchAll(p, pr));
  ipcMain.handle('git:fetchDeepen', (_e, p: string, r?: string, c?: number) => gitService.fetchDeepen(p, r, c ?? 100));
  ipcMain.handle('git:setFetchDepth', (_e, p: string, r?: string, d?: number) => gitService.setFetchDepth(p, r, d ?? 0));
  ipcMain.handle('git:remoteProperties', (_e, p: string, n: string) => gitService.remoteProperties(p, n));

  // Log & history
  ipcMain.handle('git:log', (_e, p: string, o?: { maxCount?: number; branch?: string; branches?: string[]; file?: string; follow?: boolean; all?: boolean }) =>
    gitService.log(p, o || {})
  );
  ipcMain.handle('git:findCommit', (_e, p: string, q: string) => gitService.findCommit(p, q));
  ipcMain.handle('git:commitFiles', (_e, p: string, h: string) => gitService.commitFiles(p, h));
  ipcMain.handle('git:diffCommit', (_e, p: string, h: string, ph?: string) => gitService.diffCommit(p, h, ph));
  ipcMain.handle('git:commitExists', (_e, p: string, h: string) => gitService.commitExists(p, h));

  // Branches
  ipcMain.handle('git:branches', (_e, p: string) => gitService.branches(p));
  ipcMain.handle('git:checkout', (_e, p: string, b: string, o?: { newBranch?: boolean; force?: boolean; track?: boolean }) =>
    gitService.checkout(p, b, o)
  );
  ipcMain.handle('git:checkoutFile', (_e, p: string, f: string, ref?: string) => gitService.checkoutFile(p, f, ref));
  // Working-tree file operations (file context menu)
  ipcMain.handle('git:moveFile', (_e, p: string, from: string, to: string) => gitService.moveFile(p, from, to));
  ipcMain.handle('git:getIndexFlags', (_e, p: string, f: string) => gitService.getIndexFlags(p, f));
  ipcMain.handle('git:setIndexFlag', (_e, p: string, f: string, flag: 'assume-unchanged' | 'skip-worktree', v: boolean) =>
    gitService.setIndexFlag(p, f, flag, v)
  );
  ipcMain.handle('git:deleteFile', (_e, p: string, f: string) => gitService.deleteFile(p, f));
  ipcMain.handle('git:createBranch', (_e, p: string, n: string, sp?: string, f?: boolean, t?: boolean) =>
    gitService.createBranch(p, n, sp, f, t)
  );
  ipcMain.handle('git:deleteBranch', (_e, p: string, n: string, f?: boolean, r?: boolean) =>
    gitService.deleteBranch(p, n, f, r)
  );
  ipcMain.handle('git:renameBranch', (_e, p: string, o: string, n: string) => gitService.renameBranch(p, o, n));

  // Remotes
  ipcMain.handle('git:remotes', (_e, p: string) => gitService.remotes(p));
  ipcMain.handle('git:addRemote', (_e, p: string, n: string, u: string) => gitService.addRemote(p, n, u));
  ipcMain.handle('git:removeRemote', (_e, p: string, n: string) => gitService.removeRemote(p, n));
  ipcMain.handle('git:renameRemote', (_e, p: string, o: string, n: string) => gitService.renameRemote(p, o, n));
  ipcMain.handle('git:setRemoteUrl', (_e, p: string, n: string, u: string, pu?: boolean) => gitService.setRemoteUrl(p, n, u, pu));

  // Merge
  ipcMain.handle('git:merge', (_e, p: string, b: string, o?: { noFf?: boolean; squash?: boolean; ffOnly?: boolean; strategy?: string }) =>
    gitService.merge(p, b, o)
  );
  ipcMain.handle('git:abortMerge', (_e, p: string) => gitService.abortMerge(p));
  ipcMain.handle('git:continueMerge', (_e, p: string) => gitService.continueMerge(p));
  ipcMain.handle('git:mergeTree', (_e, p: string, o: string, t: string) => gitService.mergeTree(p, o, t));
  ipcMain.handle('git:aheadBehind', (_e, p: string, b: string, c: string) => gitService.aheadBehind(p, b, c));

  // Diff
  ipcMain.handle('git:diff', (_e, p: string, f: string, o?: { staged?: boolean; ref?: string }) =>
    gitService.diff(p, f, o)
  );
  ipcMain.handle('git:diffBranches', (_e, p: string, b: string, c: string) => gitService.diffBranches(p, b, c));

  // Stash
  ipcMain.handle('git:stashList', (_e, p: string) => gitService.stashList(p));
  ipcMain.handle('git:stashPush', (_e, p: string, m?: string, iu?: boolean, ki?: boolean, f?: string[]) =>
    gitService.stashPush(p, m, iu, ki, f)
  );
  ipcMain.handle('git:stashPop', (_e, p: string, i?: number) => gitService.stashPop(p, i));
  ipcMain.handle('git:stashApply', (_e, p: string, i?: number) => gitService.stashApply(p, i));
  ipcMain.handle('git:stashDrop', (_e, p: string, i?: number) => gitService.stashDrop(p, i));
  ipcMain.handle('git:stashBranch', (_e, p: string, b: string, i?: number) => gitService.stashBranch(p, b, i));
  ipcMain.handle('git:stashRename', (_e, p: string, i: number, m: string) => gitService.renameStash(p, i, m));

  // Tags
  ipcMain.handle('git:tags', (_e, p: string) => gitService.tags(p));
  ipcMain.handle('git:createTag', (_e, p: string, n: string, m?: string, r?: string, f?: boolean, a?: boolean) =>
    gitService.createTag(p, n, m, r, f, a)
  );
  ipcMain.handle('git:deleteTag', (_e, p: string, n: string, r?: boolean) => gitService.deleteTag(p, n, r));
  ipcMain.handle('git:pushTag', (_e, p: string, n: string, r?: string) => gitService.pushTag(p, n, r));

  // Submodules
  ipcMain.handle('git:submodules', (_e, p: string) => gitService.submodules(p));
  ipcMain.handle('git:submoduleInit', (_e, p: string, n?: string) => gitService.submoduleInit(p, n));
  ipcMain.handle('git:submoduleUpdate', (_e, p: string, n?: string, i?: boolean, r?: boolean) =>
    gitService.submoduleUpdate(p, n, i, r)
  );
  ipcMain.handle('git:submoduleSync', (_e, p: string, n?: string) => gitService.submoduleSync(p, n));
  ipcMain.handle('git:submoduleDeinit', (_e, p: string, n: string, f?: boolean) => gitService.submoduleDeinit(p, n, f));
  ipcMain.handle('git:submoduleAdd', (_e, p: string, u: string, pp: string, b?: string) => gitService.submoduleAdd(p, u, pp, b));

  // Repo management
  ipcMain.handle('git:clone', (_e, u: string, t: string, o?: { depth?: number; branch?: string; recursive?: boolean; shallowSubmodules?: boolean }) =>
    gitService.clone(u, t, o)
  );
  ipcMain.handle('git:init', (_e, t: string, b?: boolean) => gitService.init(t, b));
  ipcMain.handle('git:isRepo', (_e, p: string) => gitService.isRepo(p));
  ipcMain.handle('git:currentBranch', (_e, p: string) => gitService.currentBranch(p));
  ipcMain.handle('git:revParse', (_e, p: string, r: string) => gitService.revParse(p, r));
  ipcMain.handle('git:revParseArgs', (_e, p: string, a: string[]) => gitService.revParseArgs(p, a));
  ipcMain.handle('git:raw', (_e, p: string, a: string[]) => gitService.raw(p, a));
  // New: full git CLI surface coverage (added per simple-git comprehensive test spec)
  ipcMain.handle('git:grep', (_e, p: string, pat: string, opts?: string[]) => gitService.grep(p, pat, opts));
  ipcMain.handle('git:applyPatch', (_e, p: string, patch: string | string[], opts?: Record<string, null> | string[]) => gitService.applyPatch(p, patch, opts));
  ipcMain.handle('git:show', (_e, p: string, a: string[]) => gitService.show(p, a));
  ipcMain.handle('git:showBuffer', (_e, p: string, a: string[]) => gitService.showBuffer(p, a));
  ipcMain.handle('git:mirror', (_e, url: string, target: string) => gitService.mirror(url, target));
  ipcMain.handle('git:countObjects', (_e, p: string, verbose?: boolean) => gitService.countObjects(p, verbose));
  ipcMain.handle('git:updateServerInfo', (_e, p: string) => gitService.updateServerInfo(p));
  ipcMain.handle('git:listRemote', (_e, p: string, remote?: string) => gitService.listRemote(p, remote));
  ipcMain.handle('git:addAnnotatedTag', (_e, p: string, name: string, msg: string, ref?: string) => gitService.addAnnotatedTag(p, name, msg, ref));

  // Worktrees (SmartGit 20+)
  ipcMain.handle('git:worktrees', (_e, p: string) => gitService.worktrees(p));
  ipcMain.handle('git:worktreeAdd', (_e, p: string, tp: string, b?: string, c?: string, d?: boolean) =>
    gitService.worktreeAdd(p, tp, b, c, d)
  );
  ipcMain.handle('git:worktreeRemove', (_e, p: string, tp: string, f?: boolean) => gitService.worktreeRemove(p, tp, f));
  ipcMain.handle('git:worktreePrune', (_e, p: string) => gitService.worktreePrune(p));
  ipcMain.handle('git:worktreeMove', (_e, p: string, op: string, np: string) => gitService.worktreeMove(p, op, np));

  // Reflog (SmartGit 20+)
  ipcMain.handle('git:reflog', (_e, p: string, r?: string, m?: number) => gitService.reflog(p, r, m));
  ipcMain.handle('git:reflogDelete', (_e, p: string, i: number, r?: string) => gitService.reflogDelete(p, i, r));

  // Cherry Pick (SmartGit 20+)
  ipcMain.handle('git:cherryPick', (_e, p: string, h: string[], nc?: boolean) => gitService.cherryPick(p, h, nc));
  ipcMain.handle('git:cherryPickAbort', (_e, p: string) => gitService.cherryPickAbort(p));
  ipcMain.handle('git:cherryPickContinue', (_e, p: string) => gitService.cherryPickContinue(p));

  // Revert (SmartGit 20+)
  ipcMain.handle('git:revert', (_e, p: string, h: string[], nc?: boolean) => gitService.revert(p, h, nc));
  ipcMain.handle('git:revertAbort', (_e, p: string) => gitService.revertAbort(p));
  ipcMain.handle('git:revertContinue', (_e, p: string) => gitService.revertContinue(p));

  // Rebase (SmartGit 20+)
  ipcMain.handle('git:rebase', (_e, p: string, o: string, opts?: { interactive?: boolean; autosquash?: boolean; abort?: boolean; continue?: boolean; skip?: boolean }) =>
    gitService.rebase(p, o, opts)
  );

  // Bisect (SmartGit 20+)
  ipcMain.handle('git:bisectStart', (_e, p: string) => gitService.bisectStart(p));
  ipcMain.handle('git:bisectGood', (_e, p: string, r?: string) => gitService.bisectGood(p, r));
  ipcMain.handle('git:bisectBad', (_e, p: string, r?: string) => gitService.bisectBad(p, r));
  ipcMain.handle('git:bisectSkip', (_e, p: string) => gitService.bisectSkip(p));
  ipcMain.handle('git:bisectReset', (_e, p: string) => gitService.bisectReset(p));
  ipcMain.handle('git:bisectLog', (_e, p: string) => gitService.bisectLog(p));
  ipcMain.handle('git:bisectStatus', (_e, p: string) => gitService.bisectStatus(p));

  // Blame (SmartGit 20+)
  ipcMain.handle('git:blame', (_e, p: string, f: string, r?: string) => gitService.blame(p, f, r));

  // Ignore (SmartGit 20+)
  ipcMain.handle('git:ignore', (_e, p: string, patterns: string[], localOnly?: boolean) =>
    gitService.ignore(p, patterns, localOnly)
  );
  ipcMain.handle('git:isIgnored', (_e, p: string, f: string) => gitService.isIgnored(p, f));
  ipcMain.handle('git:editIgnoreFile', (_e, p: string, scope: 'local' | 'global') =>
    gitService.editIgnoreFile(p, scope)
  );

  // Edit commit message (SmartGit 20+)
  ipcMain.handle('git:editCommitMessage', (_e, p: string, h: string, m: string) =>
    gitService.editCommitMessage(p, h, m)
  );

  // Split off files (SmartGit 22+)
  ipcMain.handle('git:splitOffFiles', (_e, p: string, h: string, f: string[], m: string) =>
    gitService.splitOffFiles(p, h, f, m)
  );

  // Config (SmartGit 20+)
  ipcMain.handle('git:configGet', (_e, p: string, k: string, s?: 'system' | 'global' | 'local') =>
    gitService.configGet(p, k, s)
  );
  ipcMain.handle('git:configSet', (_e, p: string, k: string, v: string, s?: 'system' | 'global' | 'local') =>
    gitService.configSet(p, k, v, s)
  );
  ipcMain.handle('git:configList', (_e, p: string, s?: 'system' | 'global' | 'local') =>
    gitService.configList(p, s)
  );
  ipcMain.handle('git:configUnset', (_e, p: string, k: string, s?: 'system' | 'global' | 'local') =>
    gitService.configUnset(p, k, s)
  );

  // Find ref (SmartGit 22+)
  ipcMain.handle('git:findRef', (_e, p: string, q: string) => gitService.findRef(p, q));

  // Reset (SmartGit 20+)
  ipcMain.handle('git:reset', (_e, p: string, mode: 'soft' | 'mixed' | 'hard' | 'keep', ref?: string) =>
    gitService.reset(p, mode, ref)
  );
  ipcMain.handle('git:resetFile', (_e, p: string, f: string, ref?: string) => gitService.resetFile(p, f, ref));

  // Extract repo info (SmartGit 24+ "Open in Browser")
  ipcMain.handle('git:extractRepoInfo', (_e, p: string) => gitService.extractRepoInfo(p));

  // Reveal in file manager
  ipcMain.handle('git:revealInFileManager', async (_e, fullPath: string) => {
    try {
      const dir = path.dirname(fullPath);
      await shell.openPath(dir);
      return true;
    } catch {
      return false;
    }
  });

  // Open file in default app
  ipcMain.handle('git:openFile', async (_e, fullPath: string) => {
    try {
      await shell.openPath(fullPath);
      return true;
    } catch {
      return false;
    }
  });

  // LFS support
  ipcMain.handle('git:lfsStatus', (_e, p: string) => gitService.lfsStatus(p));
  ipcMain.handle('git:lfsPull', (_e, p: string, f?: string[]) => gitService.lfsPull(p, f));
  ipcMain.handle('git:lfsPush', (_e, p: string) => gitService.lfsPush(p));
  ipcMain.handle('git:lfsFetch', (_e, p: string) => gitService.lfsFetch(p));
  ipcMain.handle('git:lfsInstall', (_e, p: string) => gitService.lfsInstall(p));
  ipcMain.handle('git:lfsTrack', (_e, p: string, patterns: string[]) => gitService.lfsTrack(p, patterns));
  ipcMain.handle('git:lfsList', (_e, p: string) => gitService.lfsList(p));

  // Split commit
  ipcMain.handle('git:splitCommit', (_e, p: string, h: string) => gitService.splitCommit(p, h));

  // Stage/unstage specific lines
  ipcMain.handle('git:stageLines', (_e, p: string, f: string, ranges: { start: number; end: number }[]) =>
    gitService.stageLines(p, f, ranges)
  );
  ipcMain.handle('git:unstageLines', (_e, p: string, f: string, ranges: { start: number; end: number }[]) =>
    gitService.unstageLines(p, f, ranges)
  );

  // ============================================================
  // SmartGit Manual extended features
  // ============================================================

  // Recyclable commits
  ipcMain.handle('git:recyclableCommits', (_e, p: string) => gitService.recyclableCommits(p));

  // Subtree operations
  ipcMain.handle('git:subtreeAdd', (_e, p: string, prefix: string, url: string, branch: string, squash?: boolean) =>
    gitService.subtreeAdd(p, prefix, url, branch, squash)
  );
  ipcMain.handle('git:subtreePull', (_e, p: string, prefix: string, url: string, branch: string, squash?: boolean) =>
    gitService.subtreePull(p, prefix, url, branch, squash)
  );
  ipcMain.handle('git:subtreePush', (_e, p: string, prefix: string, remote: string, branch: string, squash?: boolean) =>
    gitService.subtreePush(p, prefix, remote, branch, squash)
  );
  ipcMain.handle('git:subtreeSplit', (_e, p: string, prefix: string, branch?: string, rejoin?: boolean) =>
    gitService.subtreeSplit(p, prefix, branch, rejoin)
  );

  // LFS Locks
  ipcMain.handle('git:lfsListLocks', (_e, p: string, r?: string) => gitService.lfsListLocks(p, r));
  ipcMain.handle('git:lfsLock', (_e, p: string, f: string, r?: string) => gitService.lfsLock(p, f, r));
  ipcMain.handle('git:lfsUnlock', (_e, p: string, f: string, r?: string) => gitService.lfsUnlock(p, f, r));

  // Git Notes
  ipcMain.handle('git:notesList', (_e, p: string, r?: string) => gitService.notesList(p, r));
  ipcMain.handle('git:noteShow', (_e, p: string, c: string, r?: string) => gitService.noteShow(p, c, r));
  ipcMain.handle('git:noteAdd', (_e, p: string, c: string, content: string, r?: string, f?: boolean) =>
    gitService.noteAdd(p, c, content, r, f)
  );
  ipcMain.handle('git:noteRemove', (_e, p: string, c: string, r?: string) => gitService.noteRemove(p, c, r));

  // Force compare
  ipcMain.handle('git:forceCompare', (_e, p: string, f: string, o?: { staged?: boolean; ref?: string }) =>
    gitService.forceCompare(p, f, o)
  );

  // EOL-only change detection
  ipcMain.handle('git:isEolOnlyChange', (_e, p: string, f: string) => gitService.isEolOnlyChange(p, f));

  // Push to Gerrit
  ipcMain.handle('git:pushToGerrit', (_e, p: string, b?: string, r?: string, o?: { draft?: boolean; reviewers?: string[]; topic?: string }) =>
    gitService.pushToGerrit(p, b, r, o)
  );

  // Partial clone
  ipcMain.handle('git:clonePartial', (_e, u: string, t: string, f?: 'blob:none' | 'tree:0' | 'blob:limit=1m', o?: { depth?: number; branch?: string; recursive?: boolean }) =>
    gitService.clonePartial(u, t, f || 'blob:none', o)
  );

  // Credential helper
  ipcMain.handle('git:setupCredentialHelper', (_e, p: string) => gitService.setupCredentialHelper(p));

  // Bidirectional blame
  ipcMain.handle('git:blameBidirectional', (_e, p: string, f: string, r?: string) =>
    gitService.blameBidirectional(p, f, r)
  );

  // Pickaxe search
  ipcMain.handle('git:pickaxeSearch', (_e, p: string, f: string, s: string, o?: { regex?: boolean; ignoreCase?: boolean }) =>
    gitService.pickaxeSearch(p, f, s, o)
  );

  // Detect renames
  ipcMain.handle('git:detectRenames', (_e, p: string, o?: { threshold?: number; ref?: string }) =>
    gitService.detectRenames(p, o)
  );

  // Is commit pushed
  ipcMain.handle('git:isCommitPushed', (_e, p: string, h: string) => gitService.isCommitPushed(p, h));

  // Squash commits
  ipcMain.handle('git:squashCommits', (_e, p: string, fromHash: string, toHash: string, m?: string) =>
    gitService.squashCommits(p, fromHash, toHash, m)
  );

  // Coalesce commits
  ipcMain.handle('git:coalesceCommits', (_e, p: string, firstHash: string, secondHash: string) =>
    gitService.coalesceCommits(p, firstHash, secondHash)
  );
}
