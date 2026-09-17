import { contextBridge, ipcRenderer } from 'electron';
import type { GitApi } from './types/git-api.js';
import type { GithubApi } from './types/github-api.js';
import type { GitLabApi } from './types/gitlab-api.js';
import type { FsApi } from './types/fs-api.js';
import type { SettingsApi } from './types/settings-api.js';
import type { CommandLogEntry } from './types/command-log-api.js';
import type { VsCodeApi } from './types/vscode-api.js';
import type { SshApi, CredentialsApi } from './types/ssh-api.js';

const api = {
  // Git operations
  git: {
    status: (repoPath: string) => ipcRenderer.invoke('git:status', repoPath),
    listDirectories: (repoPath: string, maxDepth?: number) => ipcRenderer.invoke('git:listDirectories', repoPath, maxDepth),
    listAllDirectories: (repoPath: string, maxDepth?: number) => ipcRenderer.invoke('git:listAllDirectories', repoPath, maxDepth),
    add: (repoPath: string, files: string[]) => ipcRenderer.invoke('git:add', repoPath, files),
    addAll: (repoPath: string) => ipcRenderer.invoke('git:addAll', repoPath),
    // SmartGit "Commit all except untracked" (git add -u) — no untracked files
    stageAllTracked: (repoPath: string) => ipcRenderer.invoke('git:stageAllTracked', repoPath),
    restore: (repoPath: string, files: string[], staged?: boolean) => ipcRenderer.invoke('git:restore', repoPath, files, staged),
    commit: (repoPath: string, message: string, amend?: boolean, signoff?: boolean, noVerify?: boolean) =>
      ipcRenderer.invoke('git:commit', repoPath, message, amend, signoff, noVerify),
    clean: (repoPath: string, paths: string[], dryRun?: boolean, force?: boolean, directories?: boolean) =>
      ipcRenderer.invoke('git:clean', repoPath, paths, dryRun, force, directories),
    push: (repoPath: string, remote?: string, branch?: string, setUpstream?: boolean, force?: boolean, tags?: boolean, targetBranch?: string) =>
      ipcRenderer.invoke('git:push', repoPath, remote, branch, setUpstream, force, tags, targetBranch),
    pull: (repoPath: string, remote?: string, branch?: string, rebase?: boolean, noFF?: boolean) =>
      ipcRenderer.invoke('git:pull', repoPath, remote, branch, rebase, noFF),
    fetch: (repoPath: string, remote?: string, prune?: boolean, tags?: boolean) =>
      ipcRenderer.invoke('git:fetch', repoPath, remote, prune, tags),
    fetchAll: (repoPath: string, prune?: boolean) => ipcRenderer.invoke('git:fetchAll', repoPath, prune),
    fetchDeepen: (repoPath: string, remote?: string, commits?: number) =>
      ipcRenderer.invoke('git:fetchDeepen', repoPath, remote, commits),
    setFetchDepth: (repoPath: string, remote?: string, depth?: number) =>
      ipcRenderer.invoke('git:setFetchDepth', repoPath, remote, depth),
    remoteProperties: (repoPath: string, name: string) =>
      ipcRenderer.invoke('git:remoteProperties', repoPath, name),
    log: (repoPath: string, options?: { maxCount?: number; skip?: number; branch?: string; branches?: string[]; file?: string; follow?: boolean; all?: boolean; grep?: string; grepIgnoreCase?: boolean }) =>
      ipcRenderer.invoke('git:log', repoPath, options),
    findCommit: (repoPath: string, query: string) => ipcRenderer.invoke('git:findCommit', repoPath, query),
    commitStats: (repoPath: string, options?: { maxCount?: number; skip?: number; branch?: string }) =>
      ipcRenderer.invoke('git:commitStats', repoPath, options),
    commitFiles: (repoPath: string, hash: string) => ipcRenderer.invoke('git:commitFiles', repoPath, hash),
    mergeNestedCommits: (repoPath: string, hash: string) => ipcRenderer.invoke('git:mergeNestedCommits', repoPath, hash),
    tagsAt: (repoPath: string, hash: string) => ipcRenderer.invoke('git:tagsAt', repoPath, hash),
    trackedFiles: (repoPath: string) => ipcRenderer.invoke('git:trackedFiles', repoPath),
    diffCommit: (repoPath: string, hash: string, parentHash?: string) =>
      ipcRenderer.invoke('git:diffCommit', repoPath, hash, parentHash),
    commitExists: (repoPath: string, hash: string) =>
      ipcRenderer.invoke('git:commitExists', repoPath, hash),
    branches: (repoPath: string) => ipcRenderer.invoke('git:branches', repoPath),
    remotes: (repoPath: string) => ipcRenderer.invoke('git:remotes', repoPath),
    checkout: (repoPath: string, branch: string, options?: { newBranch?: boolean; force?: boolean; track?: boolean }) =>
      ipcRenderer.invoke('git:checkout', repoPath, branch, options),
    hasSubmoduleConfigChanges: (repoPath: string, target: string) =>
      ipcRenderer.invoke('git:hasSubmoduleConfigChanges', repoPath, target),
    checkoutFile: (repoPath: string, file: string, ref?: string) => ipcRenderer.invoke('git:checkoutFile', repoPath, file, ref),
    checkoutFiles: (repoPath: string, files: string[], ref?: string) => ipcRenderer.invoke('git:checkoutFiles', repoPath, files, ref),
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
    pollRemoteSummary: (repoPath: string) => ipcRenderer.invoke('git:pollRemoteSummary', repoPath),
    pollRemoteSummaries: (paths: string[]) => ipcRenderer.invoke('git:pollRemoteSummaries', paths),
    diff: (repoPath: string, file: string, options?: { staged?: boolean; ref?: string }) =>
      ipcRenderer.invoke('git:diff', repoPath, file, options),
    diffBranches: (repoPath: string, base: string, compare: string) =>
      ipcRenderer.invoke('git:diffBranches', repoPath, base, compare),
    stashList: (repoPath: string) => ipcRenderer.invoke('git:stashList', repoPath),
    stashPush: (repoPath: string, message?: string, includeUntracked?: boolean, keepIndex?: boolean, files?: string[]) =>
      ipcRenderer.invoke('git:stashPush', repoPath, message, includeUntracked, keepIndex, files),
    stashPop: (repoPath: string, index?: number, keepIndex?: boolean) => ipcRenderer.invoke('git:stashPop', repoPath, index, keepIndex),
    stashApply: (repoPath: string, index?: number, keepIndex?: boolean) => ipcRenderer.invoke('git:stashApply', repoPath, index, keepIndex),
    stashFiles: (repoPath: string, hash: string) => ipcRenderer.invoke('git:stashFiles', repoPath, hash),
    stashFileRawDiff: (repoPath: string, hash: string, file: string) =>
      ipcRenderer.invoke('git:stashFileRawDiff', repoPath, hash, file),
    stashDrop: (repoPath: string, index?: number) => ipcRenderer.invoke('git:stashDrop', repoPath, index),
    stashBranch: (repoPath: string, branch: string, index?: number) =>
      ipcRenderer.invoke('git:stashBranch', repoPath, branch, index),
    stashRename: (repoPath: string, index: number, message: string) =>
      ipcRenderer.invoke('git:stashRename', repoPath, index, message),
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
    // Single IPC call replaces N+M per-file spawns for rename detection
    detectWorkingTreeRenames: (repoPath: string, deletedFiles: string[], untrackedFiles: string[]) =>
      ipcRenderer.invoke('git:detectWorkingTreeRenames', repoPath, deletedFiles, untrackedFiles),
    // New: full git CLI surface coverage
    grep: (repoPath: string, pattern: string, options?: string[], pathspec?: string) => ipcRenderer.invoke('git:grep', repoPath, pattern, options, pathspec),
    applyPatch: (repoPath: string, patch: string | string[], options?: Record<string, null> | string[]) => ipcRenderer.invoke('git:applyPatch', repoPath, patch, options),
    show: (repoPath: string, args: string[]) => ipcRenderer.invoke('git:show', repoPath, args),
    showBuffer: (repoPath: string, args: string[]) => ipcRenderer.invoke('git:showBuffer', repoPath, args),
    mirror: (remoteUrl: string, targetPath: string) => ipcRenderer.invoke('git:mirror', remoteUrl, targetPath),
    countObjects: (repoPath: string, verbose?: boolean) => ipcRenderer.invoke('git:countObjects', repoPath, verbose),
    updateServerInfo: (repoPath: string) => ipcRenderer.invoke('git:updateServerInfo', repoPath),
    listRemote: (repoPath: string, remote?: string) => ipcRenderer.invoke('git:listRemote', repoPath, remote),
    lsRemoteUrl: (url: string, args?: string[]) => ipcRenderer.invoke('git:lsRemoteUrl', url, args),
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
    cherryPickContinue: (repoPath: string, allowEmpty?: boolean) =>
      ipcRenderer.invoke('git:cherryPickContinue', repoPath, allowEmpty),
    cherryPickSkip: (repoPath: string) => ipcRenderer.invoke('git:cherryPickSkip', repoPath),
    revert: (repoPath: string, hashes: string[], noCommit?: boolean) =>
      ipcRenderer.invoke('git:revert', repoPath, hashes, noCommit),
    revertAbort: (repoPath: string) => ipcRenderer.invoke('git:revertAbort', repoPath),
    revertContinue: (repoPath: string) => ipcRenderer.invoke('git:revertContinue', repoPath),
    revertSkip: (repoPath: string) => ipcRenderer.invoke('git:revertSkip', repoPath),
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
    resetFiles: (repoPath: string, files: string[], ref?: string) =>
      ipcRenderer.invoke('git:resetFiles', repoPath, files, ref),
    extractRepoInfo: (repoPath: string) => ipcRenderer.invoke('git:extractRepoInfo', repoPath),
    revealInFileManager: (fullPath: string) => ipcRenderer.invoke('git:revealInFileManager', fullPath),
    openFile: (fullPath: string) => ipcRenderer.invoke('git:openFile', fullPath),
    moveFile: (repoPath: string, fromPath: string, toPath: string) =>
      ipcRenderer.invoke('git:moveFile', repoPath, fromPath, toPath),
    getIndexFlags: (repoPath: string, file: string) =>
      ipcRenderer.invoke('git:getIndexFlags', repoPath, file),
    setIndexFlag: (repoPath: string, file: string, flag: 'assume-unchanged' | 'skip-worktree', value: boolean) =>
      ipcRenderer.invoke('git:setIndexFlag', repoPath, file, flag, value),
    setIndexFlagBatch: (repoPath: string, files: string[], flag: 'assume-unchanged' | 'skip-worktree', value: boolean) =>
      ipcRenderer.invoke('git:setIndexFlagBatch', repoPath, files, flag, value),
    deleteFile: (repoPath: string, file: string) => ipcRenderer.invoke('git:deleteFile', repoPath, file),
    deleteFiles: (repoPath: string, files: string[]) => ipcRenderer.invoke('git:deleteFiles', repoPath, files),

    // LFS support
    lfsStatus: (repoPath: string) => ipcRenderer.invoke('git:lfsStatus', repoPath),
    isLfsInstalled: (repoPath: string) => ipcRenderer.invoke('git:isLfsInstalled', repoPath),
    lfsPull: (repoPath: string, files?: string[]) => ipcRenderer.invoke('git:lfsPull', repoPath, files),
    lfsPush: (repoPath: string) => ipcRenderer.invoke('git:lfsPush', repoPath),
    lfsFetch: (repoPath: string) => ipcRenderer.invoke('git:lfsFetch', repoPath),
    lfsInstall: (repoPath: string) => ipcRenderer.invoke('git:lfsInstall', repoPath),
    detectLfsConfigured: (repoPath: string) => ipcRenderer.invoke('git:detectLfsConfigured', repoPath),
    removeLfsFilter: (repoPath: string) => ipcRenderer.invoke('git:removeLfsFilter', repoPath),
    lfsTrack: (repoPath: string, patterns: string[]) => ipcRenderer.invoke('git:lfsTrack', repoPath, patterns),
    lfsUntrack: (repoPath: string, pattern: string) => ipcRenderer.invoke('git:lfsUntrack', repoPath, pattern),
    lfsFsck: (repoPath: string) => ipcRenderer.invoke('git:lfsFsck', repoPath),
    lfsList: (repoPath: string) => ipcRenderer.invoke('git:lfsList', repoPath),

    // Split commit
    splitCommit: (repoPath: string, hash: string) => ipcRenderer.invoke('git:splitCommit', repoPath, hash),

    // Stage/unstage specific lines
    stageLines: (repoPath: string, file: string, ranges: { start: number; end: number }[]) =>
      ipcRenderer.invoke('git:stageLines', repoPath, file, ranges),
    unstageLines: (repoPath: string, file: string, ranges: { start: number; end: number }[]) =>
      ipcRenderer.invoke('git:unstageLines', repoPath, file, ranges),

    // ===== Git Notes (SmartGit Notes feature) =====
    noteCategories: (repoPath: string) => ipcRenderer.invoke('git:noteCategories', repoPath),
    notesList: (repoPath: string, notesRef: string, maxCount?: number) =>
      ipcRenderer.invoke('git:notesList', repoPath, notesRef, maxCount),
    notesShow: (repoPath: string, notesRef: string, commit: string) =>
      ipcRenderer.invoke('git:notesShow', repoPath, notesRef, commit),
    notesAdd: (repoPath: string, notesRef: string, commit: string, message: string, force?: boolean) =>
      ipcRenderer.invoke('git:notesAdd', repoPath, notesRef, commit, message, force),
    notesRemove: (repoPath: string, notesRef: string, commit: string) =>
      ipcRenderer.invoke('git:notesRemove', repoPath, notesRef, commit),

    // ===== Subtrees (Remote | Subtree) =====
    subtrees: (repoPath: string) => ipcRenderer.invoke('git:subtrees', repoPath),
    subtreeAdd: (repoPath: string, opts: { name: string; path: string; remote: string; branch: string; squash?: boolean; remoteUrl?: string }) =>
      ipcRenderer.invoke('git:subtreeAdd', repoPath, opts),
    subtreePull: (repoPath: string, name: string) => ipcRenderer.invoke('git:subtreePull', repoPath, name),
    subtreePush: (repoPath: string, name: string) => ipcRenderer.invoke('git:subtreePush', repoPath, name),
    subtreeSplit: (repoPath: string, name: string, opts?: { rejoin?: boolean; annotate?: string }) =>
      ipcRenderer.invoke('git:subtreeSplit', repoPath, name, opts),
    subtreeRemove: (repoPath: string, name: string) => ipcRenderer.invoke('git:subtreeRemove', repoPath, name),

    // ===== LFS file locks =====
    lfsLocks: (repoPath: string, local?: boolean) => ipcRenderer.invoke('git:lfsLocks', repoPath, local),
    lfsLock: (repoPath: string, file: string) => ipcRenderer.invoke('git:lfsLock', repoPath, file),
    lfsUnlock: (repoPath: string, file: string, force?: boolean) =>
      ipcRenderer.invoke('git:lfsUnlock', repoPath, file, force),

    // ===== Format Patch =====
    formatPatch: (repoPath: string, opts: { outputDir: string; commit?: string; from?: string; to?: string }) =>
      ipcRenderer.invoke('git:formatPatch', repoPath, opts),

    // ===== Edit commit author =====
    editCommitAuthor: (repoPath: string, hash: string, name: string, email: string) =>
      ipcRenderer.invoke('git:editCommitAuthor', repoPath, hash, name, email),

    // ===== Verify Database / GC / Recyclable =====
    verifyDatabase: (repoPath: string) => ipcRenderer.invoke('git:verifyDatabase', repoPath),
    garbageCollect: (repoPath: string, aggressive?: boolean) =>
      ipcRenderer.invoke('git:garbageCollect', repoPath, aggressive),
    repack: (repoPath: string) => ipcRenderer.invoke('git:repack', repoPath),
    packRefs: (repoPath: string) => ipcRenderer.invoke('git:packRefs', repoPath),
    pruneObjects: (repoPath: string) => ipcRenderer.invoke('git:pruneObjects', repoPath),
    reflogExpire: (repoPath: string) => ipcRenderer.invoke('git:reflogExpire', repoPath),
    fullMaintenance: (repoPath: string) => ipcRenderer.invoke('git:fullMaintenance', repoPath),
    unreachableCommits: (repoPath: string) => ipcRenderer.invoke('git:unreachableCommits', repoPath),

    // ===== Bugtraq =====
    bugtraqConfig: (repoPath: string) => ipcRenderer.invoke('git:bugtraqConfig', repoPath),

    // ===== Index Editor helpers =====
    setIndexContent: (repoPath: string, file: string, content: string) =>
      ipcRenderer.invoke('git:setIndexContent', repoPath, file, content),
    showFile: (repoPath: string, ref: string, file: string) =>
      ipcRenderer.invoke('git:showFile', repoPath, ref, file),

    // ===== SmartGit Manual — Power User batch (merged) =====
    recyclableCommits: (repoPath: string) => ipcRenderer.invoke('git:recyclableCommits', repoPath),
    lfsListLocks: (repoPath: string, remote?: string) => ipcRenderer.invoke('git:lfsListLocks', repoPath, remote),
    noteShow: (repoPath: string, commit: string, ref?: string) => ipcRenderer.invoke('git:noteShow', repoPath, commit, ref),
    noteAdd: (repoPath: string, commit: string, content: string, ref?: string, force?: boolean) =>
      ipcRenderer.invoke('git:noteAdd', repoPath, commit, content, ref, force),
    noteRemove: (repoPath: string, commit: string, ref?: string) => ipcRenderer.invoke('git:noteRemove', repoPath, commit, ref),
    forceCompare: (repoPath: string, file: string, options?: { staged?: boolean; ref?: string }) =>
      ipcRenderer.invoke('git:forceCompare', repoPath, file, options),
    isEolOnlyChange: (repoPath: string, file: string) => ipcRenderer.invoke('git:isEolOnlyChange', repoPath, file),
    pushToGerrit: (repoPath: string, branch?: string, remote?: string, options?: { draft?: boolean; reviewers?: string[]; topic?: string }) =>
      ipcRenderer.invoke('git:pushToGerrit', repoPath, branch, remote, options),
    clonePartial: (url: string, targetPath: string, filter?: 'blob:none' | 'tree:0' | 'blob:limit=1m', options?: { depth?: number; branch?: string; recursive?: boolean }) =>
      ipcRenderer.invoke('git:clonePartial', url, targetPath, filter, options),
    setupCredentialHelper: (repoPath: string) => ipcRenderer.invoke('git:setupCredentialHelper', repoPath),
    blameBidirectional: (repoPath: string, file: string, ref?: string) =>
      ipcRenderer.invoke('git:blameBidirectional', repoPath, file, ref),
    pickaxeSearch: (repoPath: string, file: string, search: string, options?: { regex?: boolean; ignoreCase?: boolean }) =>
      ipcRenderer.invoke('git:pickaxeSearch', repoPath, file, search, options),
    detectRenames: (repoPath: string, options?: { threshold?: number; ref?: string }) =>
      ipcRenderer.invoke('git:detectRenames', repoPath, options),
    isCommitPushed: (repoPath: string, hash: string) => ipcRenderer.invoke('git:isCommitPushed', repoPath, hash),
    squashCommits: (repoPath: string, fromHash: string, toHash: string, message?: string) =>
      ipcRenderer.invoke('git:squashCommits', repoPath, fromHash, toHash, message),
    coalesceCommits: (repoPath: string, firstHash: string, secondHash: string) =>
      ipcRenderer.invoke('git:coalesceCommits', repoPath, firstHash, secondHash),

    // === SmartGit Manual v25/26 — extended backend (batch 1-7) ===
    smartPull: (repoPath: string, remote?: string, branch?: string) =>
      ipcRenderer.invoke('git:smartPull', repoPath, remote, branch),
    octopusMerge: (repoPath: string, branches: string[]) =>
      ipcRenderer.invoke('git:octopusMerge', repoPath, branches),
    isForcePushAllowed: (branch: string | undefined, policy: 'deny' | 'feature-only' | 'allow', protectedBranches?: string[]) =>
      ipcRenderer.invoke('git:isForcePushAllowed', branch, policy, protectedBranches),
    applyLineEdit: (repoPath: string, file: string, lineNumber: number, newContent: string, isStaged?: boolean) =>
      ipcRenderer.invoke('git:applyLineEdit', repoPath, file, lineNumber, newContent, isStaged),
    editInfoExclude: (repoPath: string) =>
      ipcRenderer.invoke('git:editInfoExclude', repoPath),
    traceIgnoreRule: (repoPath: string, file: string) =>
      ipcRenderer.invoke('git:traceIgnoreRule', repoPath, file),
    detectRepoFormat: (repoPath: string) =>
      ipcRenderer.invoke('git:detectRepoFormat', repoPath),
    commitSigned: (repoPath: string, message: string, options?: { gpgSign?: boolean; sshSign?: boolean; signingKey?: string; noVerify?: boolean }) =>
      ipcRenderer.invoke('git:commitSigned', repoPath, message, options),
    createSignedTag: (repoPath: string, name: string, message: string, ref?: string, sshSign?: boolean) =>
      ipcRenderer.invoke('git:createSignedTag', repoPath, name, message, ref, sshSign),
    batchOperation: (repos: string[], operation: 'fetch' | 'pull' | 'push' | 'status', options?: { remote?: string; branch?: string; force?: boolean }) =>
      ipcRenderer.invoke('git:batchOperation', repos, operation, options),
    exportConfig: (repoPath: string | null) =>
      ipcRenderer.invoke('git:exportConfig', repoPath),
    importConfig: (repoPath: string, config: any) =>
      ipcRenderer.invoke('git:importConfig', repoPath, config),
    // Memory management: release the cached SimpleGit instance for a repo
    // (closes its child process pool). Called by repositoryStore.closeRepository.
    invalidateCache: (repoPath?: string) =>
      ipcRenderer.invoke('git:invalidateCache', repoPath),
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
    getPullRequest: (owner: string, repo: string, prNumber: number) =>
      ipcRenderer.invoke('github:getPullRequest', owner, repo, prNumber),
    listPRFiles: (owner: string, repo: string, prNumber: number) =>
      ipcRenderer.invoke('github:listPRFiles', owner, repo, prNumber),
    listPRIssueComments: (owner: string, repo: string, prNumber: number) =>
      ipcRenderer.invoke('github:listPRIssueComments', owner, repo, prNumber),
    listPRCommits: (owner: string, repo: string, prNumber: number) =>
      ipcRenderer.invoke('github:listPRCommits', owner, repo, prNumber),
    getCommitFiles: (owner: string, repo: string, commitSha: string) =>
      ipcRenderer.invoke('github:getCommitFiles', owner, repo, commitSha),
    getCheckRuns: (owner: string, repo: string, shas: string[]) =>
      ipcRenderer.invoke('github:getCheckRuns', owner, repo, shas),
    logout: () => ipcRenderer.invoke('github:logout'),
    getAuthState: () => ipcRenderer.invoke('github:getAuthState'),
    // SmartGit Manual: PR management
    addPRLineComment: (owner: string, repo: string, prNumber: number, data: any) =>
      ipcRenderer.invoke('github:addPRLineComment', owner, repo, prNumber, data),
    addPRComment: (owner: string, repo: string, prNumber: number, body: string) =>
      ipcRenderer.invoke('github:addPRComment', owner, repo, prNumber, body),
    submitPRReview: (owner: string, repo: string, prNumber: number, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body?: string) =>
      ipcRenderer.invoke('github:submitPRReview', owner, repo, prNumber, event, body),
    mergePR: (owner: string, repo: string, prNumber: number, options?: any) =>
      ipcRenderer.invoke('github:mergePR', owner, repo, prNumber, options),
    closePR: (owner: string, repo: string, prNumber: number) =>
      ipcRenderer.invoke('github:closePR', owner, repo, prNumber),
    reopenPR: (owner: string, repo: string, prNumber: number) =>
      ipcRenderer.invoke('github:reopenPR', owner, repo, prNumber),
    listPRComments: (owner: string, repo: string, prNumber: number) =>
      ipcRenderer.invoke('github:listPRComments', owner, repo, prNumber),
  } as GithubApi,

  // GitLab integration — mirrors github shape. Used by the Clone modal
  // (GitLab projects tab) and the Pull Requests page (when the repo's
  // remote is on a GitLab instance). The IPC handlers live in
  // electron/ipc/gitlab.ts and were already registered in main.ts; this
  // preload binding is what makes them callable from the renderer as
  // `api.gitlab.*`.
  gitlab: {
    authWithPAT: (token: string, baseUrl?: string) =>
      ipcRenderer.invoke('gitlab:authWithPAT', token, baseUrl),
    logout: () => ipcRenderer.invoke('gitlab:logout'),
    getAuthState: () => ipcRenderer.invoke('gitlab:getAuthState'),
    listProjects: (page?: number, perPage?: number) =>
      ipcRenderer.invoke('gitlab:listProjects', page, perPage),
    getProjectByPath: (pathWithNamespace: string) =>
      ipcRenderer.invoke('gitlab:getProjectByPath', pathWithNamespace),
    listMergeRequests: (projectId: number, state?: 'opened' | 'closed' | 'merged' | 'all') =>
      ipcRenderer.invoke('gitlab:listMergeRequests', projectId, state),
    getMergeRequest: (projectId: number, mrIid: number) =>
      ipcRenderer.invoke('gitlab:getMergeRequest', projectId, mrIid),
    listMRChanges: (projectId: number, mrIid: number) =>
      ipcRenderer.invoke('gitlab:listMRChanges', projectId, mrIid),
    listMRNotes: (projectId: number, mrIid: number) =>
      ipcRenderer.invoke('gitlab:listMRNotes', projectId, mrIid),
    listMRCommits: (projectId: number, mrIid: number) =>
      ipcRenderer.invoke('gitlab:listMRCommits', projectId, mrIid),
    getCommitDiff: (projectId: number, commitSha: string) =>
      ipcRenderer.invoke('gitlab:getCommitDiff', projectId, commitSha),
    createMergeRequest: (projectId: number, data: { title: string; source_branch: string; target_branch: string; description?: string }) =>
      ipcRenderer.invoke('gitlab:createMergeRequest', projectId, data),
    approveMergeRequest: (projectId: number, mrIid: number) =>
      ipcRenderer.invoke('gitlab:approveMergeRequest', projectId, mrIid),
    mergeMergeRequest: (projectId: number, mrIid: number, options?: { squash?: boolean; should_remove_source_branch?: boolean }) =>
      ipcRenderer.invoke('gitlab:mergeMergeRequest', projectId, mrIid, options),
    addMRComment: (projectId: number, mrIid: number, body: string) =>
      ipcRenderer.invoke('gitlab:addMRComment', projectId, mrIid, body),
    listPipelines: (projectId: number, sha?: string) =>
      ipcRenderer.invoke('gitlab:listPipelines', projectId, sha),
  } as GitLabApi,

  // File system
  fs: {
    openDirectoryPicker: () => ipcRenderer.invoke('dialog:openDirectory'),
    openRepositoryPicker: () => ipcRenderer.invoke('dialog:openRepository'),
    showSaveDialog: (opts: Electron.SaveDialogOptions) => ipcRenderer.invoke('dialog:showSaveDialog', opts),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    pathBasename: (filePath: string) => ipcRenderer.invoke('fs:pathBasename', filePath),
    pathDirname: (filePath: string) => ipcRenderer.invoke('fs:pathDirname', filePath),
    openTerminal: (dirPath: string) => ipcRenderer.invoke('fs:openTerminal', dirPath),
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
    // Force-refresh the cached metadata (lastCommit, branchCount, commitCount,
    // provider...) for every configured repo. Returns the number of repos that
    // were successfully refreshed.
    refreshAllRepoStats: () => ipcRenderer.invoke('settings:refreshAllRepoStats'),

    // Repository groups (tree in the sidebar)
    getRepoGroups: () => ipcRenderer.invoke('settings:getRepoGroups'),
    createRepoGroup: (name: string, parentId?: string | null) =>
      ipcRenderer.invoke('settings:createRepoGroup', name, parentId ?? null),
    renameRepoGroup: (id: string, name: string) => ipcRenderer.invoke('settings:renameRepoGroup', id, name),
    deleteRepoGroup: (id: string) => ipcRenderer.invoke('settings:deleteRepoGroup', id),
    moveRepoGroup: (id: string, newParentId: string | null) =>
      ipcRenderer.invoke('settings:moveRepoGroup', id, newParentId),
    setRepoGroupExpanded: (id: string, expanded: boolean) =>
      ipcRenderer.invoke('settings:setRepoGroupExpanded', id, expanded),
    setRepoGroup: (path: string, groupId: string | null) =>
      ipcRenderer.invoke('settings:setRepoGroup', path, groupId),
  } as SettingsApi,

  // SSH key management (Settings → Security → SSH keys)
  ssh: {
    list: () => ipcRenderer.invoke('ssh:list'),
    generate: (options) => ipcRenderer.invoke('ssh:generate', options),
    importKey: (options) => ipcRenderer.invoke('ssh:importKey', options),
    remove: (id: string) => ipcRenderer.invoke('ssh:remove', id),
    copyPublicKey: (id: string) => ipcRenderer.invoke('ssh:copyPublicKey', id),
    test: (id: string, opts?: { host?: string; user?: string }) => ipcRenderer.invoke('ssh:test', id, opts),
    listSystemKeys: () => ipcRenderer.invoke('ssh:listSystemKeys'),
    pickKeyFile: () => ipcRenderer.invoke('ssh:pickKeyFile'),
    listProfiles: () => ipcRenderer.invoke('ssh:listProfiles'),
    saveProfile: (input) => ipcRenderer.invoke('ssh:saveProfile', input),
    deleteProfile: (id: string) => ipcRenderer.invoke('ssh:deleteProfile', id),
    testProfile: (id: string) => ipcRenderer.invoke('ssh:testProfile', id),
    testParams: (params) => ipcRenderer.invoke('ssh:testParams', params),
    resolveForUrl: (url: string) => ipcRenderer.invoke('ssh:resolveForUrl', url),
  } as SshApi,

  // Credential storage status + secrets manager (Settings → Security)
  credentials: {
    status: () => ipcRenderer.invoke('credentials:status'),
    list: () => ipcRenderer.invoke('credentials:list'),
    set: (ns: string, key: string, value: string) => ipcRenderer.invoke('credentials:set', ns, key, value),
    delete: (ns: string, key: string) => ipcRenderer.invoke('credentials:delete', ns, key),
    reveal: (ns: string, key: string) => ipcRenderer.invoke('credentials:reveal', ns, key),
  } as CredentialsApi,

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
    /** { app, electron, node } versions for the About panel (Settings → About). */
    getVersions: () => ipcRenderer.invoke('app:versions') as Promise<{ app: string; electron: string; node: string }>,
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
    openExternal: (url: string) => ipcRenderer.send('app:openExternal', url),
    /** Locale override for e2e/tests (PRISMGIT_LOCALE), empty in normal runs. */
    envLocale: (typeof process !== 'undefined' && process.env && process.env.PRISMGIT_LOCALE) || '',
    /** Notify the main process of the active UI locale (rebuilds the menu). */
    setLocale: (locale: string) => ipcRenderer.send('app:setLocale', locale),
  },

  // VSCode integration
  vscode: {
    detect: (force?: boolean) => ipcRenderer.invoke('vscode:detect', force),
    open: (repoPath: string, target?: { file?: string; line?: number }) =>
      ipcRenderer.invoke('vscode:open', repoPath, target),
    openFileDiff: (repoPath: string, file: string) => ipcRenderer.invoke('vscode:openFileDiff', repoPath, file),
    openMerge: (repoPath: string, file: string) => ipcRenderer.invoke('vscode:openMerge', repoPath, file),
    openFileVersion: (repoPath: string, sha: string, file: string) =>
      ipcRenderer.invoke('vscode:openFileVersion', repoPath, sha, file),
    openCommitFileDiff: (repoPath: string, sha: string, file: string) =>
      ipcRenderer.invoke('vscode:openCommitFileDiff', repoPath, sha, file),
    openCommitPatch: (repoPath: string, sha: string) =>
      ipcRenderer.invoke('vscode:openCommitPatch', repoPath, sha),
    openWorkspace: (name: string, folderPaths: string[]) =>
      ipcRenderer.invoke('vscode:openWorkspace', name, folderPaths),
    diffToolStatus: (repoPath: string) => ipcRenderer.invoke('vscode:diffToolStatus', repoPath),
    installDiffTool: (repoPath: string) => ipcRenderer.invoke('vscode:installDiffTool', repoPath),
    removeDiffTool: (repoPath: string) => ipcRenderer.invoke('vscode:removeDiffTool', repoPath),
  } as VsCodeApi,

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
    show: (items: Array<{ label?: string; type?: 'separator' | 'normal' | 'checkbox' | 'radio'; checked?: boolean; enabled?: boolean; accelerator?: string; clickId?: string; title?: string; submenu?: any[] }>) =>
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

  // AI integration (SmartGit 25 AI Assisted Commenting)
  ai: {
    generateCommitMessage: (cfg: { url: string; apiKey?: string; model: string; maxDiffSize?: number; prompt?: string }, diff: string, hint?: string) =>
      ipcRenderer.invoke('ai:generateCommitMessage', cfg, diff, hint),
    ollamaListModels: (url: string) =>
      ipcRenderer.invoke('ai:ollamaListModels', url),
    ollamaListLoadedModels: (url: string) =>
      ipcRenderer.invoke('ai:ollamaListLoadedModels', url),
    ollamaKeepAlive: (url: string, model: string, keepAlive?: string) =>
      ipcRenderer.invoke('ai:ollamaKeepAlive', url, model, keepAlive),
    memoryLoad: (repoPath: string) =>
      ipcRenderer.invoke('ai:memory:load', repoPath),
    memorySave: (repoPath: string, key: string, value: string, category?: string) =>
      ipcRenderer.invoke('ai:memory:save', repoPath, key, value, category),
    memorySummary: (repoPath: string) =>
      ipcRenderer.invoke('ai:memory:summary', repoPath),
    chat: (config: { url: string; headers: Record<string, string>; body: string; method?: string }) =>
      ipcRenderer.invoke('ai:chat', config),
    /** Multi-provider registry: unified model list / connectivity test. */
    providerListModels: (kind: string, url: string, apiKey?: string) =>
      ipcRenderer.invoke('ai:providerListModels', kind, url, apiKey),
  },

  // Raw git command log (Output panel → Commands tab)
  commandLog: {
    list: () => ipcRenderer.invoke('command-log:list'),
    clear: () => ipcRenderer.invoke('command-log:clear'),
    onEntry: (cb: (entry: CommandLogEntry) => void) => {
      const listener = (_: unknown, entry: CommandLogEntry) => cb(entry);
      ipcRenderer.on('command-log:entry', listener);
      return () => {
        ipcRenderer.removeListener('command-log:entry', listener);
      };
    },
  },

  // Operation log — high-level operation start/finish events emitted by the
  // main process (electron/services/operationLog.ts). Exposed here so the
  // renderer can subscribe WITHOUT using require('electron') (which breaks
  // under Vite ESM).
  operationLog: {
    onStart: (cb: (entry: { id: string; timestamp: number; action: string; command?: string; repoPath: string; status: 'running' }) => void) => {
      const listener = (_: unknown, entry: any) => cb(entry);
      ipcRenderer.on('operation-log:start', listener);
      return () => ipcRenderer.removeListener('operation-log:start', listener);
    },
    onFinish: (cb: (entry: { id: string; status: 'success' | 'error'; result?: string; error?: string }) => void) => {
      const listener = (_: unknown, entry: any) => cb(entry);
      ipcRenderer.on('operation-log:finish', listener);
      return () => ipcRenderer.removeListener('operation-log:finish', listener);
    },
  },

  // Menu events (one-way from main to renderer)
  // Avatar cache — downloads + caches avatar images on disk.
  // Renderer calls api.avatar.get(url) or api.avatar.getByEmail(email).
  // Returns a data URI string (or null) — no network in renderer.
  avatar: {
    get: (url: string) => ipcRenderer.invoke('avatar:get', url),
    getByEmail: (email: string, size?: number) => ipcRenderer.invoke('avatar:getByEmail', email, size),
  },

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
