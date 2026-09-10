import { contextBridge, ipcRenderer } from 'electron';
import type { GitApi } from './types/git-api.js';
import type { GithubApi } from './types/github-api.js';
import type { FsApi } from './types/fs-api.js';
import type { SettingsApi } from './types/settings-api.js';

const api = {
  // Git operations
  git: {
    status: (repoPath: string) => ipcRenderer.invoke('git:status', repoPath),
    listDirectories: (repoPath: string, maxDepth?: number) => ipcRenderer.invoke('git:listDirectories', repoPath, maxDepth),
    add: (repoPath: string, files: string[]) => ipcRenderer.invoke('git:add', repoPath, files),
    addAll: (repoPath: string) => ipcRenderer.invoke('git:addAll', repoPath),
    restore: (repoPath: string, files: string[], staged?: boolean) => ipcRenderer.invoke('git:restore', repoPath, files, staged),
    commit: (repoPath: string, message: string, amend?: boolean, signoff?: boolean, noVerify?: boolean) =>
      ipcRenderer.invoke('git:commit', repoPath, message, amend, signoff, noVerify),
    clean: (repoPath: string, paths: string[], dryRun?: boolean, force?: boolean, directories?: boolean) =>
      ipcRenderer.invoke('git:clean', repoPath, paths, dryRun, force, directories),
    push: (repoPath: string, remote?: string, branch?: string, setUpstream?: boolean, force?: boolean, tags?: boolean) =>
      ipcRenderer.invoke('git:push', repoPath, remote, branch, setUpstream, force, tags),
    pull: (repoPath: string, remote?: string, branch?: string, rebase?: boolean, noFF?: boolean) =>
      ipcRenderer.invoke('git:pull', repoPath, remote, branch, rebase, noFF),
    fetch: (repoPath: string, remote?: string, prune?: boolean, tags?: boolean) =>
      ipcRenderer.invoke('git:fetch', repoPath, remote, prune, tags),
    fetchAll: (repoPath: string, prune?: boolean) => ipcRenderer.invoke('git:fetchAll', repoPath, prune),
    log: (repoPath: string, options?: { maxCount?: number; branch?: string; branches?: string[]; file?: string; follow?: boolean; all?: boolean }) =>
      ipcRenderer.invoke('git:log', repoPath, options),
    findCommit: (repoPath: string, query: string) => ipcRenderer.invoke('git:findCommit', repoPath, query),
    commitFiles: (repoPath: string, hash: string) => ipcRenderer.invoke('git:commitFiles', repoPath, hash),
    diffCommit: (repoPath: string, hash: string, parentHash?: string) =>
      ipcRenderer.invoke('git:diffCommit', repoPath, hash, parentHash),
    commitExists: (repoPath: string, hash: string) =>
      ipcRenderer.invoke('git:commitExists', repoPath, hash),
    branches: (repoPath: string) => ipcRenderer.invoke('git:branches', repoPath),
    remotes: (repoPath: string) => ipcRenderer.invoke('git:remotes', repoPath),
    checkout: (repoPath: string, branch: string, options?: { newBranch?: boolean; force?: boolean; track?: boolean }) =>
      ipcRenderer.invoke('git:checkout', repoPath, branch, options),
    checkoutFile: (repoPath: string, file: string, ref?: string) => ipcRenderer.invoke('git:checkoutFile', repoPath, file, ref),
    createBranch: (repoPath: string, name: string, startPoint?: string, force?: boolean, track?: boolean) =>
      ipcRenderer.invoke('git:createBranch', repoPath, name, startPoint, force, track),
    deleteBranch: (repoPath: string, name: string, force?: boolean, remote?: boolean) =>
      ipcRenderer.invoke('git:deleteBranch', repoPath, name, force, remote),
    renameBranch: (repoPath: string, oldName: string, newName: string) =>
      ipcRenderer.invoke('git:renameBranch', repoPath, oldName, newName),
    merge: (repoPath: string, branch: string, options?: { noFf?: boolean; squash?: boolean; ffOnly?: boolean; strategy?: string }) =>
      ipcRenderer.invoke('git:merge', repoPath, branch, options),
    abortMerge: (repoPath: string) => ipcRenderer.invoke('git:abortMerge', repoPath),
    continueMerge: (repoPath: string) => ipcRenderer.invoke('git:continueMerge', repoPath),
    mergeTree: (repoPath: string, ours: string, theirs: string) =>
      ipcRenderer.invoke('git:mergeTree', repoPath, ours, theirs),
    aheadBehind: (repoPath: string, base: string, compare: string) =>
      ipcRenderer.invoke('git:aheadBehind', repoPath, base, compare),
    diff: (repoPath: string, file: string, options?: { staged?: boolean; ref?: string }) =>
      ipcRenderer.invoke('git:diff', repoPath, file, options),
    diffBranches: (repoPath: string, base: string, compare: string) =>
      ipcRenderer.invoke('git:diffBranches', repoPath, base, compare),
    stashList: (repoPath: string) => ipcRenderer.invoke('git:stashList', repoPath),
    stashPush: (repoPath: string, message?: string, includeUntracked?: boolean, keepIndex?: boolean, files?: string[]) =>
      ipcRenderer.invoke('git:stashPush', repoPath, message, includeUntracked, keepIndex, files),
    stashPop: (repoPath: string, index?: number) => ipcRenderer.invoke('git:stashPop', repoPath, index),
    stashApply: (repoPath: string, index?: number) => ipcRenderer.invoke('git:stashApply', repoPath, index),
    stashDrop: (repoPath: string, index?: number) => ipcRenderer.invoke('git:stashDrop', repoPath, index),
    stashBranch: (repoPath: string, branch: string, index?: number) =>
      ipcRenderer.invoke('git:stashBranch', repoPath, branch, index),
    tags: (repoPath: string) => ipcRenderer.invoke('git:tags', repoPath),
    createTag: (repoPath: string, name: string, message?: string, ref?: string, force?: boolean, annotated?: boolean) =>
      ipcRenderer.invoke('git:createTag', repoPath, name, message, ref, force, annotated),
    deleteTag: (repoPath: string, name: string, remote?: boolean) =>
      ipcRenderer.invoke('git:deleteTag', repoPath, name, remote),
    pushTag: (repoPath: string, name: string, remote?: string) =>
      ipcRenderer.invoke('git:pushTag', repoPath, name, remote),
    submodules: (repoPath: string) => ipcRenderer.invoke('git:submodules', repoPath),
    submoduleInit: (repoPath: string, name?: string) => ipcRenderer.invoke('git:submoduleInit', repoPath, name),
    submoduleUpdate: (repoPath: string, name?: string, init?: boolean, recursive?: boolean) =>
      ipcRenderer.invoke('git:submoduleUpdate', repoPath, name, init, recursive),
    submoduleSync: (repoPath: string, name?: string) => ipcRenderer.invoke('git:submoduleSync', repoPath, name),
    submoduleDeinit: (repoPath: string, name: string, force?: boolean) =>
      ipcRenderer.invoke('git:submoduleDeinit', repoPath, name, force),
    submoduleAdd: (repoPath: string, url: string, targetPath: string, branch?: string) =>
      ipcRenderer.invoke('git:submoduleAdd', repoPath, url, targetPath, branch),
    clone: (url: string, targetPath: string, options?: { depth?: number; branch?: string; recursive?: boolean; shallowSubmodules?: boolean }) =>
      ipcRenderer.invoke('git:clone', url, targetPath, options),
    init: (targetPath: string, bare?: boolean) => ipcRenderer.invoke('git:init', targetPath, bare),
    addRemote: (repoPath: string, name: string, url: string) => ipcRenderer.invoke('git:addRemote', repoPath, name, url),
    removeRemote: (repoPath: string, name: string) => ipcRenderer.invoke('git:removeRemote', repoPath, name),
    renameRemote: (repoPath: string, oldName: string, newName: string) =>
      ipcRenderer.invoke('git:renameRemote', repoPath, oldName, newName),
    setRemoteUrl: (repoPath: string, name: string, url: string, pushUrl?: boolean) =>
      ipcRenderer.invoke('git:setRemoteUrl', repoPath, name, url, pushUrl),
    isRepo: (targetPath: string) => ipcRenderer.invoke('git:isRepo', targetPath),
    currentBranch: (repoPath: string) => ipcRenderer.invoke('git:currentBranch', repoPath),
    revParse: (repoPath: string, ref: string) => ipcRenderer.invoke('git:revParse', repoPath, ref),
    revParseArgs: (repoPath: string, args: string[]) => ipcRenderer.invoke('git:revParseArgs', repoPath, args),
    raw: (repoPath: string, args: string[]) => ipcRenderer.invoke('git:raw', repoPath, args),
    // New: full git CLI surface coverage
    grep: (repoPath: string, pattern: string, options?: string[]) => ipcRenderer.invoke('git:grep', repoPath, pattern, options),
    applyPatch: (repoPath: string, patch: string | string[], options?: Record<string, null> | string[]) => ipcRenderer.invoke('git:applyPatch', repoPath, patch, options),
    show: (repoPath: string, args: string[]) => ipcRenderer.invoke('git:show', repoPath, args),
    showBuffer: (repoPath: string, args: string[]) => ipcRenderer.invoke('git:showBuffer', repoPath, args),
    mirror: (remoteUrl: string, targetPath: string) => ipcRenderer.invoke('git:mirror', remoteUrl, targetPath),
    countObjects: (repoPath: string, verbose?: boolean) => ipcRenderer.invoke('git:countObjects', repoPath, verbose),
    updateServerInfo: (repoPath: string) => ipcRenderer.invoke('git:updateServerInfo', repoPath),
    listRemote: (repoPath: string, remote?: string) => ipcRenderer.invoke('git:listRemote', repoPath, remote),
    addAnnotatedTag: (repoPath: string, name: string, message: string, ref?: string) => ipcRenderer.invoke('git:addAnnotatedTag', repoPath, name, message, ref),

    // SmartGit 20-24 extended
    worktrees: (repoPath: string) => ipcRenderer.invoke('git:worktrees', repoPath),
    worktreeAdd: (repoPath: string, targetPath: string, branch?: string, commit?: string, detach?: boolean) =>
      ipcRenderer.invoke('git:worktreeAdd', repoPath, targetPath, branch, commit, detach),
    worktreeRemove: (repoPath: string, targetPath: string, force?: boolean) =>
      ipcRenderer.invoke('git:worktreeRemove', repoPath, targetPath, force),
    worktreePrune: (repoPath: string) => ipcRenderer.invoke('git:worktreePrune', repoPath),
    worktreeMove: (repoPath: string, oldPath: string, newPath: string) =>
      ipcRenderer.invoke('git:worktreeMove', repoPath, oldPath, newPath),
    reflog: (repoPath: string, ref?: string, maxCount?: number) => ipcRenderer.invoke('git:reflog', repoPath, ref, maxCount),
    reflogDelete: (repoPath: string, index: number, ref?: string) =>
      ipcRenderer.invoke('git:reflogDelete', repoPath, index, ref),
    cherryPick: (repoPath: string, hashes: string[], noCommit?: boolean) =>
      ipcRenderer.invoke('git:cherryPick', repoPath, hashes, noCommit),
    cherryPickAbort: (repoPath: string) => ipcRenderer.invoke('git:cherryPickAbort', repoPath),
    cherryPickContinue: (repoPath: string) => ipcRenderer.invoke('git:cherryPickContinue', repoPath),
    revert: (repoPath: string, hashes: string[], noCommit?: boolean) =>
      ipcRenderer.invoke('git:revert', repoPath, hashes, noCommit),
    revertAbort: (repoPath: string) => ipcRenderer.invoke('git:revertAbort', repoPath),
    revertContinue: (repoPath: string) => ipcRenderer.invoke('git:revertContinue', repoPath),
    rebase: (repoPath: string, onto: string, options?: { interactive?: boolean; autosquash?: boolean; abort?: boolean; continue?: boolean; skip?: boolean }) =>
      ipcRenderer.invoke('git:rebase', repoPath, onto, options),
    bisectStart: (repoPath: string) => ipcRenderer.invoke('git:bisectStart', repoPath),
    bisectGood: (repoPath: string, ref?: string) => ipcRenderer.invoke('git:bisectGood', repoPath, ref),
    bisectBad: (repoPath: string, ref?: string) => ipcRenderer.invoke('git:bisectBad', repoPath, ref),
    bisectSkip: (repoPath: string) => ipcRenderer.invoke('git:bisectSkip', repoPath),
    bisectReset: (repoPath: string) => ipcRenderer.invoke('git:bisectReset', repoPath),
    bisectLog: (repoPath: string) => ipcRenderer.invoke('git:bisectLog', repoPath),
    bisectStatus: (repoPath: string) => ipcRenderer.invoke('git:bisectStatus', repoPath),
    blame: (repoPath: string, file: string, ref?: string) => ipcRenderer.invoke('git:blame', repoPath, file, ref),
    ignore: (repoPath: string, patterns: string[], localOnly?: boolean) =>
      ipcRenderer.invoke('git:ignore', repoPath, patterns, localOnly),
    isIgnored: (repoPath: string, file: string) => ipcRenderer.invoke('git:isIgnored', repoPath, file),
    editIgnoreFile: (repoPath: string, scope: 'local' | 'global') =>
      ipcRenderer.invoke('git:editIgnoreFile', repoPath, scope),
    editCommitMessage: (repoPath: string, hash: string, message: string) =>
      ipcRenderer.invoke('git:editCommitMessage', repoPath, hash, message),
    splitOffFiles: (repoPath: string, hash: string, files: string[], message: string) =>
      ipcRenderer.invoke('git:splitOffFiles', repoPath, hash, files, message),
    configGet: (repoPath: string, key: string, scope?: 'system' | 'global' | 'local') =>
      ipcRenderer.invoke('git:configGet', repoPath, key, scope),
    configSet: (repoPath: string, key: string, value: string, scope?: 'system' | 'global' | 'local') =>
      ipcRenderer.invoke('git:configSet', repoPath, key, value, scope),
    configList: (repoPath: string, scope?: 'system' | 'global' | 'local') =>
      ipcRenderer.invoke('git:configList', repoPath, scope),
    configUnset: (repoPath: string, key: string, scope?: 'system' | 'global' | 'local') =>
      ipcRenderer.invoke('git:configUnset', repoPath, key, scope),
    findRef: (repoPath: string, query: string) => ipcRenderer.invoke('git:findRef', repoPath, query),
    reset: (repoPath: string, mode: 'soft' | 'mixed' | 'hard' | 'keep', ref?: string) =>
      ipcRenderer.invoke('git:reset', repoPath, mode, ref),
    resetFile: (repoPath: string, file: string, ref?: string) =>
      ipcRenderer.invoke('git:resetFile', repoPath, file, ref),
    extractRepoInfo: (repoPath: string) => ipcRenderer.invoke('git:extractRepoInfo', repoPath),
    revealInFileManager: (fullPath: string) => ipcRenderer.invoke('git:revealInFileManager', fullPath),
    openFile: (fullPath: string) => ipcRenderer.invoke('git:openFile', fullPath),
    moveFile: (repoPath: string, fromPath: string, toPath: string) =>
      ipcRenderer.invoke('git:moveFile', repoPath, fromPath, toPath),
    getIndexFlags: (repoPath: string, file: string) =>
      ipcRenderer.invoke('git:getIndexFlags', repoPath, file),
    setIndexFlag: (repoPath: string, file: string, flag: 'assume-unchanged' | 'skip-worktree', value: boolean) =>
      ipcRenderer.invoke('git:setIndexFlag', repoPath, file, flag, value),
    deleteFile: (repoPath: string, file: string) => ipcRenderer.invoke('git:deleteFile', repoPath, file),

    // LFS support
    lfsStatus: (repoPath: string) => ipcRenderer.invoke('git:lfsStatus', repoPath),
    lfsPull: (repoPath: string, files?: string[]) => ipcRenderer.invoke('git:lfsPull', repoPath, files),
    lfsPush: (repoPath: string) => ipcRenderer.invoke('git:lfsPush', repoPath),
    lfsFetch: (repoPath: string) => ipcRenderer.invoke('git:lfsFetch', repoPath),
    lfsInstall: (repoPath: string) => ipcRenderer.invoke('git:lfsInstall', repoPath),
    lfsTrack: (repoPath: string, patterns: string[]) => ipcRenderer.invoke('git:lfsTrack', repoPath, patterns),
    lfsList: (repoPath: string) => ipcRenderer.invoke('git:lfsList', repoPath),

    // Split commit
    splitCommit: (repoPath: string, hash: string) => ipcRenderer.invoke('git:splitCommit', repoPath, hash),

    // Stage/unstage specific lines
    stageLines: (repoPath: string, file: string, ranges: { start: number; end: number }[]) =>
      ipcRenderer.invoke('git:stageLines', repoPath, file, ranges),
    unstageLines: (repoPath: string, file: string, ranges: { start: number; end: number }[]) =>
      ipcRenderer.invoke('git:unstageLines', repoPath, file, ranges),
  } as GitApi,

  // GitHub integration
  github: {
    authWithPAT: (token: string) => ipcRenderer.invoke('github:authWithPAT', token),
    authWithOAuth: () => ipcRenderer.invoke('github:authWithOAuth'),
    getCurrentUser: () => ipcRenderer.invoke('github:getCurrentUser'),
    getRepositories: (page?: number) => ipcRenderer.invoke('github:getRepositories', page),
    getOrgRepositories: (org: string, page?: number) => ipcRenderer.invoke('github:getOrgRepositories', org, page),
    createPullRequest: (owner: string, repo: string, data: { title: string; head: string; base: string; body?: string }) =>
      ipcRenderer.invoke('github:createPullRequest', owner, repo, data),
    listPullRequests: (owner: string, repo: string, state?: 'open' | 'closed' | 'all') =>
      ipcRenderer.invoke('github:listPullRequests', owner, repo, state),
    logout: () => ipcRenderer.invoke('github:logout'),
    getAuthState: () => ipcRenderer.invoke('github:getAuthState'),
  } as GithubApi,

  // File system
  fs: {
    openDirectoryPicker: () => ipcRenderer.invoke('dialog:openDirectory'),
    openRepositoryPicker: () => ipcRenderer.invoke('dialog:openRepository'),
    showSaveDialog: (opts: Electron.SaveDialogOptions) => ipcRenderer.invoke('dialog:showSaveDialog', opts),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
    pathBasename: (filePath: string) => ipcRenderer.invoke('fs:pathBasename', filePath),
    pathDirname: (filePath: string) => ipcRenderer.invoke('fs:pathDirname', filePath),
  } as FsApi,

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    getRepos: () => ipcRenderer.invoke('settings:getRepos'),
    addRepo: (repo: { path: string; name: string }) => ipcRenderer.invoke('settings:addRepo', repo),
    removeRepo: (path: string) => ipcRenderer.invoke('settings:removeRepo', path),
    updateRepo: (path: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('settings:updateRepo', path, updates),

    // Repository metadata
    getRepoMetadata: (path: string) => ipcRenderer.invoke('settings:getRepoMetadata', path),
    getRepoMetadataAll: () => ipcRenderer.invoke('settings:getRepoMetadataAll'),
    setRepoMetadata: (path: string, metadata: unknown) =>
      ipcRenderer.invoke('settings:setRepoMetadata', path, metadata),
    updateRepoMetadata: (path: string, updates: unknown) =>
      ipcRenderer.invoke('settings:updateRepoMetadata', path, updates),
    deleteRepoMetadata: (path: string) => ipcRenderer.invoke('settings:deleteRepoMetadata', path),
    toggleFavorite: (path: string) => ipcRenderer.invoke('settings:toggleFavorite', path),
    addTag: (path: string, tag: string) => ipcRenderer.invoke('settings:addTag', path, tag),
    removeTag: (path: string, tag: string) => ipcRenderer.invoke('settings:removeTag', path, tag),
    refreshRepoStats: (path: string) => ipcRenderer.invoke('settings:refreshRepoStats', path),
  } as SettingsApi,

  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizeChange: (cb: (maximized: boolean) => void) => {
      const listener = (_: unknown, value: boolean) => cb(value);
      ipcRenderer.on('window:maximizeChanged', listener);
      return () => ipcRenderer.removeListener('window:maximizeChanged', listener);
    },
  },

  // App info
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
    openExternal: (url: string) => ipcRenderer.send('app:openExternal', url),
  },

  // File watcher for auto-refresh
  watcher: {
    start: (repoPath: string) => ipcRenderer.invoke('watcher:start', repoPath),
    stop: (repoPath: string) => ipcRenderer.invoke('watcher:stop', repoPath),
    onChanged: (cb: (data: { repoPath: string; eventType: string; timestamp: number }) => void) => {
      const listener = (_: unknown, data: { repoPath: string; eventType: string; timestamp: number }) => cb(data);
      ipcRenderer.on('watcher:changed', listener);
      return () => ipcRenderer.removeListener('watcher:changed', listener);
    },
  },

  // Context menu
  contextMenu: {
    show: (items: Array<{ label?: string; type?: 'separator' | 'normal' | 'checkbox' | 'radio'; checked?: boolean; enabled?: boolean; accelerator?: string; clickId?: string }>) =>
      ipcRenderer.invoke('context-menu:show', items),
    onClick: (cb: (clickId: string) => void) => {
      const listener = (_: unknown, clickId: string) => cb(clickId);
      ipcRenderer.on('context-menu:click', listener);
      return () => ipcRenderer.removeListener('context-menu:click', listener);
    },
  },

  // Clipboard
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
  },

  // Menu events (one-way from main to renderer)
  events: {
    on: (channel: string, cb: (...args: unknown[]) => void) => {
      const listener = (_: unknown, ...args: unknown[]) => cb(...args);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
    off: (channel: string) => {
      ipcRenderer.removeAllListeners(channel);
    },
  },
} as const;

contextBridge.exposeInMainWorld('smartgit', api);

export type SmartGitApi = typeof api;
