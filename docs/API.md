# API Reference

Complete reference for all Git operations, IPC channels, and the `window.smartgit` API.

## window.smartgit

The preload script exposes a typed API via `contextBridge`. All operations are async and return Promises.

### git

#### Status & Working Tree

```typescript
// Get repository status
git.status(repoPath: string): Promise<StatusResult>

// Stage files
git.add(repoPath: string, files: string[]): Promise<void>
git.addAll(repoPath: string): Promise<void>

// Restore files (git restore)
git.restore(repoPath: string, files: string[], staged?: boolean): Promise<void>

// Commit
git.commit(
  repoPath: string,
  message: string,
  amend?: boolean,
  signoff?: boolean,
  noVerify?: boolean
): Promise<string>  // returns commit hash

// Clean untracked files
git.clean(
  repoPath: string,
  paths: string[],
  dryRun?: boolean,
  force?: boolean,
  directories?: boolean
): Promise<string[]>
```

#### Network

```typescript
git.push(
  repoPath: string,
  remote?: string,           // default: 'origin'
  branch?: string,
  setUpstream?: boolean,
  force?: boolean,           // --force-with-lease
  tags?: boolean
): Promise<void>

git.pull(
  repoPath: string,
  remote?: string,
  branch?: string,
  rebase?: boolean,          // --rebase
  noFF?: boolean             // --no-ff
): Promise<void>

git.fetch(
  repoPath: string,
  remote?: string,
  prune?: boolean,           // --prune
  tags?: boolean             // --tags
): Promise<void>

git.fetchAll(repoPath: string, prune?: boolean): Promise<void>
```

#### Log & History

```typescript
git.log(
  repoPath: string,
  options?: {
    maxCount?: number,       // default: 500
    branch?: string,
    file?: string,           // filter by file
    follow?: boolean,        // follow renames
    all?: boolean            // --all
  }
): Promise<LogEntry[]>

// Get files changed in a commit
git.commitFiles(repoPath: string, hash: string): Promise<CommitFile[]>

// Get diff of a commit vs its parent
git.diffCommit(repoPath: string, hash: string, parentHash?: string): Promise<DiffResult>
```

#### Branches

```typescript
git.branches(repoPath: string): Promise<BranchInfo[]>

git.checkout(
  repoPath: string,
  branch: string,
  options?: { newBranch?: boolean; force?: boolean; track?: boolean }
): Promise<void>

git.createBranch(
  repoPath: string,
  name: string,
  startPoint?: string,       // default: 'HEAD'
  force?: boolean,
  track?: boolean
): Promise<void>

git.deleteBranch(
  repoPath: string,
  name: string,
  force?: boolean,
  remote?: boolean           // delete remote branch
): Promise<void>

git.renameBranch(repoPath: string, oldName: string, newName: string): Promise<void>
```

#### Merge & Rebase

```typescript
git.merge(
  repoPath: string,
  branch: string,
  options?: { noFf?: boolean; squash?: boolean; ffOnly?: boolean; strategy?: string }
): Promise<{ conflicts: string[]; fastForward: boolean; alreadyUpToDate: boolean }>

git.abortMerge(repoPath: string): Promise<void>
git.continueMerge(repoPath: string): Promise<void>

git.rebase(
  repoPath: string,
  onto: string,
  options?: { interactive?: boolean; autosquash?: boolean; abort?: boolean; continue?: boolean; skip?: boolean }
): Promise<void>
```

#### Diff

```typescript
git.diff(
  repoPath: string,
  file: string,
  options?: { staged?: boolean; ref?: string }
): Promise<DiffResult>

git.diffBranches(repoPath: string, base: string, compare: string): Promise<DiffResult>
```

#### Stash

```typescript
git.stashList(repoPath: string): Promise<StashEntry[]>

git.stashPush(
  repoPath: string,
  message?: string,
  includeUntracked?: boolean,
  keepIndex?: boolean,
  files?: string[]            // stash specific files
): Promise<string>           // returns stash hash

git.stashPop(repoPath: string, index?: number): Promise<void>
git.stashApply(repoPath: string, index?: number): Promise<void>
git.stashDrop(repoPath: string, index?: number): Promise<void>
git.stashBranch(repoPath: string, branch: string, index?: number): Promise<void>
```

#### Tags

```typescript
git.tags(repoPath: string): Promise<TagInfo[]>

git.createTag(
  repoPath: string,
  name: string,
  message?: string,           // for annotated tags
  ref?: string,
  force?: boolean,
  annotated?: boolean
): Promise<void>

git.deleteTag(repoPath: string, name: string, remote?: boolean): Promise<void>
git.pushTag(repoPath: string, name: string, remote?: string): Promise<void>
```

#### Submodules

```typescript
git.submodules(repoPath: string): Promise<SubmoduleInfo[]>
git.submoduleInit(repoPath: string, name?: string): Promise<void>
git.submoduleUpdate(repoPath: string, name?: string, init?: boolean, recursive?: boolean): Promise<void>
git.submoduleSync(repoPath: string, name?: string): Promise<void>
git.submoduleDeinit(repoPath: string, name: string, force?: boolean): Promise<void>
git.submoduleAdd(repoPath: string, url: string, targetPath: string, branch?: string): Promise<void>
```

#### Worktrees

```typescript
git.worktrees(repoPath: string): Promise<WorktreeInfo[]>
git.worktreeAdd(repoPath: string, targetPath: string, branch?: string, commit?: string, detach?: boolean): Promise<void>
git.worktreeRemove(repoPath: string, targetPath: string, force?: boolean): Promise<void>
git.worktreePrune(repoPath: string): Promise<void>
git.worktreeMove(repoPath: string, oldPath: string, newPath: string): Promise<void>
```

#### Reflog

```typescript
git.reflog(repoPath: string, ref?: string, maxCount?: number): Promise<ReflogEntry[]>
git.reflogDelete(repoPath: string, index: number, ref?: string): Promise<void>
```

#### Cherry Pick & Revert

```typescript
git.cherryPick(repoPath: string, hashes: string[], noCommit?: boolean): Promise<{ conflicts: string[] }>
git.cherryPickAbort(repoPath: string): Promise<void>
git.cherryPickContinue(repoPath: string): Promise<void>

git.revert(repoPath: string, hashes: string[], noCommit?: boolean): Promise<{ conflicts: string[] }>
git.revertAbort(repoPath: string): Promise<void>
git.revertContinue(repoPath: string): Promise<void>
```

#### Bisect

```typescript
git.bisectStart(repoPath: string): Promise<void>
git.bisectGood(repoPath: string, ref?: string): Promise<void>
git.bisectBad(repoPath: string, ref?: string): Promise<void>
git.bisectSkip(repoPath: string): Promise<void>
git.bisectReset(repoPath: string): Promise<void>
git.bisectLog(repoPath: string): Promise<string>
git.bisectStatus(repoPath: string): Promise<{ state: 'bisecting' | 'none'; remaining?: number; rev?: string }>
```

#### Blame

```typescript
git.blame(repoPath: string, file: string, ref?: string): Promise<BlameResult>
```

#### Ignore

```typescript
git.ignore(repoPath: string, patterns: string[], localOnly?: boolean): Promise<void>
git.isIgnored(repoPath: string, file: string): Promise<boolean>
git.editIgnoreFile(repoPath: string, scope: 'local' | 'global'): Promise<string>  // returns file path
```

#### Config

```typescript
git.configGet(repoPath: string, key: string, scope?: 'system' | 'global' | 'local'): Promise<string | undefined>
git.configSet(repoPath: string, key: string, value: string, scope?: 'system' | 'global' | 'local'): Promise<void>
git.configList(repoPath: string, scope?: 'system' | 'global' | 'local'): Promise<GitConfigEntry[]>
git.configUnset(repoPath: string, key: string, scope?: 'system' | 'global' | 'local'): Promise<void>
```

#### Reset

```typescript
git.reset(repoPath: string, mode: 'soft' | 'mixed' | 'hard' | 'keep', ref?: string): Promise<void>
git.resetFile(repoPath: string, file: string, ref?: string): Promise<void>
```

#### LFS

```typescript
git.lfsStatus(repoPath: string): Promise<{ installed: boolean; files: { path: string; size: string; status: string }[] }>
git.lfsPull(repoPath: string, files?: string[]): Promise<void>
git.lfsPush(repoPath: string): Promise<void>
git.lfsFetch(repoPath: string): Promise<void>
git.lfsInstall(repoPath: string): Promise<void>
git.lfsTrack(repoPath: string, patterns: string[]): Promise<void>
git.lfsList(repoPath: string): Promise<string[]>
```

#### Repository Management

```typescript
git.clone(url: string, targetPath: string, options?: { depth?: number; branch?: string; recursive?: boolean; shallowSubmodules?: boolean }): Promise<string>
git.init(targetPath: string, bare?: boolean): Promise<void>
git.isRepo(targetPath: string): Promise<boolean>
git.currentBranch(repoPath: string): Promise<string | null>
git.revParse(repoPath: string, ref: string): Promise<string>
git.raw(repoPath: string, args: string[]): Promise<string>  // raw git command
```

#### Remotes

```typescript
git.remotes(repoPath: string): Promise<RemoteInfo[]>
git.addRemote(repoPath: string, name: string, url: string): Promise<void>
git.removeRemote(repoPath: string, name: string): Promise<void>
git.renameRemote(repoPath: string, oldName: string, newName: string): Promise<void>
git.setRemoteUrl(repoPath: string, name: string, url: string, pushUrl?: boolean): Promise<void>
```

#### Find & Info

```typescript
git.findRef(repoPath: string, query: string): Promise<{ name: string; hash: string; type: 'branch' | 'tag' | 'remote' }[]>
git.extractRepoInfo(repoPath: string): Promise<{ provider: 'github' | 'gitlab' | 'bitbucket' | 'unknown'; owner?: string; repo?: string; url?: string; webUrl?: string }>
git.revealInFileManager(fullPath: string): Promise<boolean>
git.openFile(fullPath: string): Promise<boolean>
```

### github

```typescript
github.authWithPAT(token: string): Promise<GithubUser>
github.authWithOAuth(): Promise<GithubUser>
github.getCurrentUser(): Promise<GithubUser>
github.getRepositories(page?: number): Promise<GithubRepository[]>
github.getOrgRepositories(org: string, page?: number): Promise<GithubRepository[]>
github.createPullRequest(owner: string, repo: string, data: { title: string; head: string; base: string; body?: string }): Promise<GithubPullRequest>
github.listPullRequests(owner: string, repo: string, state?: 'open' | 'closed' | 'all'): Promise<GithubPullRequest[]>
github.logout(): Promise<void>
github.getAuthState(): Promise<{ authenticated: boolean; user?: GithubUser }>
```

### fs

```typescript
fs.openDirectoryPicker(): Promise<string | null>
fs.openRepositoryPicker(): Promise<string | null>
fs.showSaveDialog(opts: Electron.SaveDialogOptions): Promise<string | null>
fs.readFile(filePath: string): Promise<string>
fs.pathBasename(filePath: string): Promise<string>
fs.pathDirname(filePath: string): Promise<string>
```

### settings

```typescript
settings.get<T>(key: string): Promise<T | undefined>
settings.set(key: string, value: unknown): Promise<void>
settings.getAll(): Promise<Partial<AppSettings>>
settings.getRepos(): Promise<RepositoryEntry[]>
settings.addRepo(repo: { path: string; name: string }): Promise<void>
settings.removeRepo(path: string): Promise<void>
settings.updateRepo(path: string, updates: Record<string, unknown>): Promise<void>
```

### watcher

```typescript
watcher.start(repoPath: string): Promise<boolean>
watcher.stop(repoPath: string): Promise<boolean>
watcher.onChanged(cb: (data: { repoPath: string; eventType: string; timestamp: number }) => void): () => void
```

### contextMenu

```typescript
contextMenu.show(items: ContextMenuItem[]): Promise<boolean>
contextMenu.onClick(cb: (clickId: string) => void): () => void
```

### clipboard

```typescript
clipboard.writeText(text: string): Promise<boolean>
```

### app

```typescript
app.getVersion(): Promise<string>
app.getPlatform(): Promise<string>
app.openExternal(url: string): void
```

### events

Menu event subscriptions (one-way from main to renderer):

```typescript
events.on(channel: string, cb: (...args: unknown[]) => void): () => void
events.off(channel: string): void
```

Channels: `menu:openRepository`, `menu:cloneRepository`, `menu:initRepository`, `menu:commit`, `menu:push`, `menu:pull`, `menu:fetch`, `menu:toggleTheme`, `menu:gitFlow`, `menu:interactiveRebase`, `menu:newBranch`, `menu:stash`.

## Type Definitions

All types are defined in `electron/types/` and re-exported from `src/lib/api.ts`:

- `StatusResult`, `FileStatus`, `LogEntry`, `BranchInfo`, `RemoteInfo`
- `StashEntry`, `TagInfo`, `SubmoduleInfo`, `WorktreeInfo`, `ReflogEntry`
- `DiffResult`, `DiffHunk`, `DiffLine`, `CommitFile`, `BlameResult`, `BlameLine`
- `GitConfigEntry`
- `GithubUser`, `GithubRepository`, `GithubPullRequest`
- `AppSettings`, `RepositoryEntry`
