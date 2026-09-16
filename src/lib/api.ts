import type {
  StatusResult,
  LogEntry,
  BranchInfo,
  RemoteInfo,
  RemoteProperties,
  StashEntry,
  TagInfo,
  SubmoduleInfo,
  DiffResult,
  FileStatus,
  DiffHunk,
  DiffLine,
  WorktreeInfo,
  ReflogEntry,
  CommitFile,
  BlameLine,
  BlameResult,
  GitConfigEntry,
  DirNode,
  RecyclableCommit,
  LfsLock,
  LfsLockInfo,
  BidirectionalBlameResult,
  NoteCategory,
  CommitNote,
  SubtreeInfo,
  UnreachableCommit,
  BugtraqConfig,
  RemoteCheckSummary,
  PushResult,
} from '../../electron/types/git-api';
import type {
  GithubUser,
  GithubRepository,
  GithubPullRequest,
  GithubPRFile,
  GithubPRComment,
  GithubPRCommit,
  CommitCheckStatus,
} from '../../electron/types/github-api';
import type {
  GitLabUser,
  GitLabProject,
  GitLabMergeRequest,
  GitLabPipeline,
  GitLabApi,
} from '../../electron/types/gitlab-api';
import type { AppSettings, RepositoryEntry, RepositoryMetadata, RepoGroup } from '../../electron/types/settings-api';
import type { CommandLogEntry } from '../../electron/types/command-log-api';
import type { SshKeyMeta, SshTestResult, SshSystemKey, CredentialsStatus, SecretEntryMeta, SshProfile, SshProfileInput, SshProfileTestParams, SshUrlResolution } from '../../electron/types/ssh-api';

export type {
  StatusResult,
  LogEntry,
  BranchInfo,
  RemoteInfo,
  RemoteProperties,
  StashEntry,
  TagInfo,
  SubmoduleInfo,
  DiffResult,
  FileStatus,
  DiffHunk,
  DiffLine,
  WorktreeInfo,
  ReflogEntry,
  CommitFile,
  BlameLine,
  BlameResult,
  GitConfigEntry,
  DirNode,
  RecyclableCommit,
  LfsLock,
  LfsLockInfo,
  BidirectionalBlameResult,
  NoteCategory,
  CommitNote,
  SubtreeInfo,
  UnreachableCommit,
  BugtraqConfig,
  RemoteCheckSummary,
  PushResult,
  CommandLogEntry,
  GithubUser,
  GithubRepository,
  GithubPullRequest,
  GithubPRFile,
  GithubPRComment,
  GithubPRCommit,
  CommitCheckStatus,
  GitLabUser,
  GitLabProject,
  GitLabMergeRequest,
  GitLabPipeline,
  AppSettings,
  RepositoryEntry,
  RepositoryMetadata,
  RepoGroup,
  SshKeyMeta,
  SshTestResult,
  SshSystemKey,
  SshProfile,
  SshProfileInput,
  SshProfileTestParams,
  SshUrlResolution,
  CredentialsStatus,
  SecretEntryMeta,
};

// Runtime-agnostic api: delegate to Tauri adapter when running under
// Tauri (window.__TAURI_INTERNALS__ is set by Tauri 2.x), otherwise
// use the Electron preload binding (window.smartgit).
//
// The Tauri adapter (src/lib/api-tauri.ts) implements the most critical
// methods (git.raw/status/branches/tags/stashList/log/reflog, fs picker,
// watcher, app.openExternal). Methods not yet wired in Tauri throw —
// the frontend should gracefully disable those features when running
// under Tauri (see isTauri() helper).
import { tauriApi, isTauri } from './api-tauri';

// Use 'unknown as' cast so TypeScript doesn't complain about the partial
// Tauri adapter — methods that aren't implemented on the Tauri side
// will throw at runtime, which the UI can catch and degrade gracefully.
type AnyApi = typeof window.smartgit;
export const api: AnyApi = isTauri()
  ? (tauriApi as unknown as AnyApi)
  : window.smartgit;

// Under Tauri, window.smartgit doesn't exist (Tauri exposes window.__TAURI__
// instead). But many components call window.smartgit.events.on(...) directly
// rather than through the `api` import. Mirror the tauriApi onto
// window.smartgit so those calls don't crash — they'll hit the no-op stubs.
if (isTauri() && typeof window !== 'undefined' && !(window as { smartgit?: unknown }).smartgit) {
  (window as { smartgit: unknown }).smartgit = tauriApi;
}

export { isTauri };
