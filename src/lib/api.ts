import type {
  StatusResult,
  LogEntry,
  BranchInfo,
  RemoteInfo,
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
} from '../../electron/types/git-api';
import type {
  GithubUser,
  GithubRepository,
  GithubPullRequest,
} from '../../electron/types/github-api';
import type { AppSettings, RepositoryEntry } from '../../electron/types/settings-api';

export type {
  StatusResult,
  LogEntry,
  BranchInfo,
  RemoteInfo,
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
  GithubUser,
  GithubRepository,
  GithubPullRequest,
  AppSettings,
  RepositoryEntry,
};

export const api = window.smartgit;
